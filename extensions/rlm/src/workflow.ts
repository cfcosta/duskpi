import {
  getLastAssistantTextResult,
  type AgentEndEvent,
  type BeforeAgentStartEvent,
  type ExtensionAPI,
  type ExtensionContext,
  type SessionCompactEvent,
  type SessionForkEvent,
  type SessionShutdownEvent,
  type SessionStartEvent,
  type SessionSwitchEvent,
  type ToolCallEvent,
  type TurnEndEvent,
} from "../../../packages/workflow-core/src/index";
import {
  createDefaultRlmExecutor,
  type RlmExecutorInput,
  type RlmExecutorResult,
} from "./executor";
import { RlmPromptEnvironment } from "./environment";
import { parseAssistantProgram, type RlmAssistantProgram } from "./protocol";
import {
  DEFAULT_RLM_MAX_ITERATIONS,
  DEFAULT_RLM_MAX_MALFORMED_OUTPUT_RETRIES,
  DEFAULT_RLM_MAX_RECURSION_DEPTH,
  resolveRlmRequest,
  type RlmRequest,
} from "./request";

export const RLM_COMMAND_DESCRIPTION =
  "Run the Recursive Language Model workflow scaffold for long prompts and notes";

const RLM_INTERNAL_MESSAGE_TYPE = "rlm-internal";
const RLM_STATUS_KEY = "rlm";
const INITIAL_PREVIEW_CHARS = 160;
const OBSERVATION_PREVIEW_CHARS = 240;
const LOG_PREVIEW_CHARS = 240;
const SUMMARY_PREVIEW_CHARS = 240;
const RESULT_PREVIEW_CHARS = 0;

interface RlmExecutorLike {
  execute(input: RlmExecutorInput): Promise<RlmExecutorResult>;
  fork?(): RlmExecutorLike;
  dispose?(): void;
}

interface RlmFrameState {
  kind: "root" | "child";
  depth: number;
  label: string;
  environment: RlmPromptEnvironment;
  executor: RlmExecutorLike;
  activeProgram?: RlmAssistantProgram;
  storeAs?: string;
}

interface ActiveRunState {
  request: RlmRequest;
  frames: RlmFrameState[];
  pendingRequestId: string;
  awaitingResponse: boolean;
  pendingPrompt: string;
  iterationCount: number;
  malformedOutputRetries: number;
}

export interface RlmWorkflowOptions {
  maxIterations?: number;
  maxRecursionDepth?: number;
  maxMalformedOutputRetries?: number;
  executor?: RlmExecutorLike;
  executorFactory?: () => RlmExecutorLike;
}

export class RlmWorkflow {
  private state?: ActiveRunState;
  private requestSequence = 0;
  private readonly maxIterations: number;
  private readonly maxRecursionDepth: number;
  private readonly maxMalformedOutputRetries: number;
  private readonly executorFactory: () => RlmExecutorLike;

  constructor(
    private readonly api: ExtensionAPI,
    options: RlmWorkflowOptions = {},
  ) {
    this.maxIterations = options.maxIterations ?? DEFAULT_RLM_MAX_ITERATIONS;
    this.maxRecursionDepth = options.maxRecursionDepth ?? DEFAULT_RLM_MAX_RECURSION_DEPTH;
    this.maxMalformedOutputRetries =
      options.maxMalformedOutputRetries ?? DEFAULT_RLM_MAX_MALFORMED_OUTPUT_RETRIES;
    this.executorFactory =
      options.executorFactory ??
      (options.executor ? () => options.executor! : () => createDefaultRlmExecutor());
  }

  async handleCommand(args: unknown, ctx: ExtensionContext): Promise<void> {
    if (this.state?.awaitingResponse) {
      ctx.ui.notify(
        "RLM is already running. Finish the current run before starting another.",
        "warning",
      );
      return;
    }

    const request = await resolveRlmRequest(args);
    if (!request.ok) {
      ctx.ui.notify(request.error.message, "error");
      return;
    }

    const environment = RlmPromptEnvironment.fromRequest(request.value);
    const frame: RlmFrameState = {
      kind: "root",
      depth: 0,
      label: request.value.question,
      environment,
      executor: this.createFrameExecutor(),
    };
    const prompt = buildFrameStartPrompt(frame, {
      reason: "initial",
      metadata: environment.getPromptMetadata({ previewChars: INITIAL_PREVIEW_CHARS }),
    });
    const requestId = this.nextRequestId();

    this.state = {
      request: request.value,
      frames: [frame],
      pendingRequestId: requestId,
      awaitingResponse: true,
      pendingPrompt: prompt,
      iterationCount: 0,
      malformedOutputRetries: 0,
    };
    this.updateStatus(ctx);

    this.api.sendUserMessage(`${prompt}\n\n${requestIdMarker(requestId)}`);
  }

  handleToolCall(_event: ToolCallEvent, _ctx: ExtensionContext): void {}

  async handleAgentEnd(event: AgentEndEvent, ctx: ExtensionContext): Promise<void> {
    if (!this.state || !this.state.awaitingResponse) {
      return;
    }

    const messages = event.messages ?? [];
    const observedRequestId = extractRequestId(extractLastPromptText(messages) ?? "");
    if (!observedRequestId || observedRequestId !== this.state.pendingRequestId) {
      return;
    }

    const assistantResult = getLastAssistantTextResult(messages);
    if (assistantResult.kind !== "ok") {
      this.handleMalformedOutput(
        ctx,
        "RLM response was empty or invalid.",
        "RLM stopped: assistant program output remained empty or invalid.",
        "Return exactly one JavaScript program and no prose.",
      );
      return;
    }

    if (this.state.iterationCount + 1 > this.maxIterations) {
      ctx.ui.notify(`RLM stopped: exceeded max iteration budget (${this.maxIterations}).`, "error");
      this.clearState(ctx);
      return;
    }

    const program = parseAssistantProgram(assistantResult.text);
    if (!program.ok) {
      this.handleMalformedOutput(
        ctx,
        `RLM could not parse the assistant program: ${program.error.message}`,
        "RLM stopped: assistant program output remained malformed.",
        program.error.message,
      );
      return;
    }

    const frame = this.getCurrentFrame();
    if (!frame) {
      this.clearState(ctx);
      return;
    }

    frame.activeProgram = program.value;
    await this.executeFrameProgram(frame, program.value, ctx, {
      countIteration: true,
    });
  }

  handleBeforeAgentStart(
    event: BeforeAgentStartEvent,
    _ctx: ExtensionContext,
  ): void | { systemPrompt: string } {
    const frame = this.getCurrentFrame();
    if (!this.state || !frame) {
      return undefined;
    }

    return {
      systemPrompt: `${event.systemPrompt}\n\n${buildRlmSystemPrompt(frame)}`,
    };
  }

  handleTurnEnd(_event: TurnEndEvent, _ctx: ExtensionContext): void {}

  handleSessionStart(_event: SessionStartEvent, ctx: ExtensionContext): void {
    this.updateStatus(ctx);
  }

  handleSessionSwitch(_event: SessionSwitchEvent, ctx: ExtensionContext): void {
    this.clearState(ctx);
  }

  handleSessionFork(_event: SessionForkEvent, ctx: ExtensionContext): void {
    this.clearState(ctx);
  }

  handleSessionCompact(_event: SessionCompactEvent, ctx: ExtensionContext): void {
    this.clearState(ctx);
  }

  handleSessionShutdown(_event: SessionShutdownEvent, ctx: ExtensionContext): void {
    this.clearState(ctx);
  }

  private async executeFrameProgram(
    frame: RlmFrameState,
    program: RlmAssistantProgram,
    ctx: ExtensionContext,
    options: { countIteration: boolean },
  ): Promise<void> {
    if (!this.state) {
      return;
    }

    if (options.countIteration) {
      this.state.iterationCount += 1;
    }

    const execution = await frame.executor.execute({
      program,
      bindings: frame.environment.getExecutionBindings(),
    });

    if (execution.kind === "runtime_error" || execution.kind === "invalid_output") {
      this.handleMalformedOutput(
        ctx,
        `RLM program execution failed: ${execution.message}`,
        "RLM stopped: program execution remained invalid.",
        execution.message,
      );
      return;
    }

    this.applyExecutionState(frame, execution);

    if (execution.kind === "subcall") {
      this.scheduleChildFrame(frame, execution, ctx);
      return;
    }

    frame.activeProgram = undefined;

    const finalValue = frame.environment.getFinalResult();
    if (typeof finalValue === "string" && finalValue.length > 0) {
      await this.finishCompletedFrame(frame, finalValue, ctx);
      return;
    }

    this.sendObservationFollowUp(buildExecutionObservationPrompt(frame, execution), ctx);
  }

  private applyExecutionState(
    frame: RlmFrameState,
    execution: Extract<RlmExecutorResult, { kind: "completed" | "subcall" }>,
  ): void {
    const applied = frame.environment.applyVariableUpdates(execution.variables);
    const logs = summarizeLogs(execution.logs);
    const summary = summarizeSummary(execution.summary);

    if (frame.kind === "root") {
      const noteLines = [
        `result: ${execution.kind}`,
        `updatedVariables: ${applied.updatedVariableNames.length > 0 ? applied.updatedVariableNames.join(", ") : "none"}`,
        `logCount: ${execution.logs.length}`,
      ];
      if (logs.preview.length > 0) {
        noteLines.push(`logPreview: ${logs.preview}`);
      }
      if (summary.present) {
        noteLines.push(`summaryPreview: ${summary.preview}`);
      }
      frame.environment.appendScratchpadEntry(
        `iter-${this.state?.iterationCount ?? 0}`,
        noteLines.join("\n"),
      );
    }
  }

  private scheduleChildFrame(
    parent: RlmFrameState,
    execution: Extract<RlmExecutorResult, { kind: "subcall" }>,
    ctx: ExtensionContext,
  ): void {
    if (!this.state) {
      return;
    }

    const nextDepth = parent.depth + 1;
    if (nextDepth > this.maxRecursionDepth) {
      ctx.ui.notify(
        `RLM stopped: exceeded max recursion depth (${this.maxRecursionDepth}).`,
        "error",
      );
      this.clearState(ctx);
      return;
    }

    const childFrame: RlmFrameState = {
      kind: "child",
      depth: nextDepth,
      label: execution.subcall.storeAs,
      storeAs: execution.subcall.storeAs,
      environment: RlmPromptEnvironment.fromPrompt(
        execution.subcall.prompt,
        `child:${execution.subcall.storeAs}`,
      ),
      executor: this.createFrameExecutor(parent.executor),
    };

    this.state.frames.push(childFrame);
    this.sendHiddenPrompt(
      buildFrameStartPrompt(childFrame, {
        reason: "subcall",
        metadata: childFrame.environment.getPromptMetadata({ previewChars: INITIAL_PREVIEW_CHARS }),
        storeAs: execution.subcall.storeAs,
      }),
      ctx,
    );
  }

  private async finishCompletedFrame(
    frame: RlmFrameState,
    finalValue: string,
    ctx: ExtensionContext,
  ): Promise<void> {
    if (!this.state) {
      return;
    }

    if (frame.kind === "root") {
      ctx.ui.notify(`RLM final result ready at ${this.state.request.finalFilePath}.`, "info");
      this.clearState(ctx);
      return;
    }

    const completedChild = this.state.frames.pop();
    const parent = this.getCurrentFrame();
    if (!completedChild || !parent || !completedChild.storeAs) {
      this.clearState(ctx);
      return;
    }

    this.disposeExecutor(completedChild.executor);
    parent.environment.setVariable(completedChild.storeAs, finalValue);
    if (parent.kind === "root") {
      parent.environment.appendScratchpadEntry(
        `subcall:${completedChild.storeAs}`,
        `Stored child response in variable '${completedChild.storeAs}' (${finalValue.length} chars).`,
      );
    }

    if (parent.activeProgram) {
      await this.executeFrameProgram(parent, parent.activeProgram, ctx, {
        countIteration: false,
      });
      return;
    }

    this.sendObservationFollowUp(
      buildChildCompletionPrompt(parent, completedChild.storeAs, finalValue),
      ctx,
    );
  }

  private sendObservationFollowUp(prompt: string, ctx: ExtensionContext): void {
    this.sendHiddenPrompt(prompt, ctx);
  }

  private sendHiddenPrompt(prompt: string, ctx: ExtensionContext): void {
    if (!this.state) {
      return;
    }

    const requestId = this.nextRequestId();

    try {
      this.api.sendMessage(
        {
          customType: RLM_INTERNAL_MESSAGE_TYPE,
          content: `${prompt}\n\n${requestIdMarker(requestId)}`,
          display: false,
        },
        {
          triggerTurn: true,
          deliverAs: "followUp",
        },
      );
    } catch {
      ctx.ui.notify("RLM stopped: failed to send follow-up prompt.", "error");
      this.clearState(ctx);
      return;
    }

    this.state.pendingRequestId = requestId;
    this.state.awaitingResponse = true;
    this.state.pendingPrompt = prompt;
    this.state.malformedOutputRetries = 0;
    this.updateStatus(ctx);
  }

  private handleMalformedOutput(
    ctx: ExtensionContext,
    retryMessage: string,
    stopMessage: string,
    repairHint: string,
  ): void {
    if (!this.state) {
      return;
    }

    if (this.state.malformedOutputRetries < this.maxMalformedOutputRetries) {
      this.state.malformedOutputRetries += 1;
      ctx.ui.notify(
        `${retryMessage} Retrying (${this.state.malformedOutputRetries}/${this.maxMalformedOutputRetries}).`,
        "warning",
      );
      this.sendRepairPrompt(ctx, repairHint);
      return;
    }

    ctx.ui.notify(stopMessage, "error");
    this.clearState(ctx);
  }

  private sendRepairPrompt(ctx: ExtensionContext, repairHint: string): void {
    if (!this.state) {
      return;
    }

    const frame = this.getCurrentFrame();
    if (!frame) {
      this.clearState(ctx);
      return;
    }

    const repairPrompt = buildRepairPrompt(frame, repairHint);
    const requestId = this.nextRequestId();

    try {
      this.api.sendMessage(
        {
          customType: RLM_INTERNAL_MESSAGE_TYPE,
          content: `${repairPrompt}\n\n${requestIdMarker(requestId)}`,
          display: false,
        },
        {
          triggerTurn: true,
          deliverAs: "followUp",
        },
      );
    } catch {
      ctx.ui.notify("RLM stopped: failed to send the repair prompt.", "error");
      this.clearState(ctx);
      return;
    }

    this.state.pendingRequestId = requestId;
    this.state.awaitingResponse = true;
    this.state.pendingPrompt = repairPrompt;
    this.updateStatus(ctx);
  }

  private updateStatus(ctx: ExtensionContext): void {
    const frame = this.getCurrentFrame();
    if (!this.state || !frame) {
      ctx.ui.setStatus(RLM_STATUS_KEY, undefined);
      return;
    }

    const phase = frame.kind === "child" ? `child:d${frame.depth}` : "root";
    ctx.ui.setStatus(
      RLM_STATUS_KEY,
      `RLM ${phase}: ${formatLabel(frame.label)} (${this.state.iterationCount}/${this.maxIterations})`,
    );
  }

  private clearState(ctx: ExtensionContext): void {
    const frames = this.state?.frames ?? [];
    const uniqueExecutors = new Set<RlmExecutorLike>(frames.map((frame) => frame.executor));
    for (const executor of uniqueExecutors) {
      this.disposeExecutor(executor);
    }

    this.state = undefined;
    this.updateStatus(ctx);
  }

  private createFrameExecutor(parentExecutor?: RlmExecutorLike): RlmExecutorLike {
    return parentExecutor?.fork ? parentExecutor.fork() : this.executorFactory();
  }

  private disposeExecutor(executor: RlmExecutorLike): void {
    try {
      executor.dispose?.();
    } catch {
      // Best-effort cleanup only.
    }
  }

  private getCurrentFrame(): RlmFrameState | undefined {
    return this.state?.frames.at(-1);
  }

  private nextRequestId(): string {
    this.requestSequence += 1;
    return `rlm-${this.requestSequence}`;
  }
}

function buildFrameStartPrompt(
  frame: RlmFrameState,
  input: {
    reason: "initial" | "subcall";
    metadata: ReturnType<RlmPromptEnvironment["getPromptMetadata"]>;
    storeAs?: string;
  },
): string {
  const intro =
    input.reason === "initial"
      ? "You are operating inside a Recursive Language Model environment."
      : `Recursive child sub-call active. Store the eventual response in '${input.storeAs ?? "result"}' at the parent frame.`;

  return [
    intro,
    "The full prompt lives outside your context window as the variable Prompt inside the execution environment.",
    "Write exactly one JavaScript program and no prose.",
    ...buildProgramContractLines(frame),
    "Prompt metadata:",
    JSON.stringify(input.metadata, null, 2),
  ].join("\n\n");
}

function buildExecutionObservationPrompt(
  frame: RlmFrameState,
  execution: Extract<RlmExecutorResult, { kind: "completed" | "subcall" }>,
): string {
  const logs = summarizeLogs(execution.logs);
  const summary = summarizeSummary(execution.summary);
  const metadata = frame.environment.getPromptMetadata({ previewChars: OBSERVATION_PREVIEW_CHARS });

  return [
    "Execution feedback metadata.",
    "Only compact metadata from the last execution is shown here. Use code to inspect Prompt and variables symbolically.",
    "Write exactly one JavaScript program and no prose.",
    ...buildProgramContractLines(frame),
    JSON.stringify(
      {
        phase: "execution_feedback",
        frame: {
          kind: frame.kind,
          depth: frame.depth,
          label: frame.label,
        },
        prompt: metadata,
        execution: {
          result: execution.kind,
          updatedVariableNames: Object.keys(execution.variables).sort(),
          logs,
          summary,
        },
      },
      null,
      2,
    ),
  ].join("\n\n");
}

function buildChildCompletionPrompt(
  parent: RlmFrameState,
  storeAs: string,
  result: string,
): string {
  const metadata = parent.environment.getPromptMetadata({
    previewChars: OBSERVATION_PREVIEW_CHARS,
  });

  return [
    "Child sub-call completed.",
    "The child response is stored symbolically in the parent environment. Use code to read it through get(name).",
    "Write exactly one JavaScript program and no prose.",
    ...buildProgramContractLines(parent),
    JSON.stringify(
      {
        phase: "child_completed",
        frame: {
          kind: parent.kind,
          depth: parent.depth,
          label: parent.label,
        },
        prompt: metadata,
        child: {
          storedAs: storeAs,
          resultChars: result.length,
          preview: result.slice(0, RESULT_PREVIEW_CHARS),
          previewTruncated: RESULT_PREVIEW_CHARS < result.length,
        },
      },
      null,
      2,
    ),
  ].join("\n\n");
}

function buildRepairPrompt(frame: RlmFrameState, repairHint: string): string {
  return [
    frame.kind === "child"
      ? "Your previous child-frame JavaScript program was invalid."
      : "Your previous RLM JavaScript program was invalid.",
    `Error: ${repairHint}`,
    "Return exactly one corrected JavaScript program now.",
    "Do not include prose.",
    ...buildProgramContractLines(frame),
  ].join("\n\n");
}

function buildRlmSystemPrompt(frame: RlmFrameState): string {
  return [
    frame.kind === "child" ? "[RLM CHILD FRAME ACTIVE]" : "[RLM ROOT FRAME ACTIVE]",
    "Operate as a recursive language model over an external prompt variable.",
    "Return exactly one JavaScript program.",
    "Do not return prose, JSON actions, or markdown commentary.",
    "The JavaScript REPL is live within the current frame across iterations, so top-level declarations persist.",
    "Store the final answer by setting the variable Final, e.g. set('Final', answer) or setFinal(answer).",
    "Use subcall(prompt, storeAs) only when symbolic recursion is useful.",
  ].join("\n");
}

function buildProgramContractLines(frame: RlmFrameState): string[] {
  return [
    "Execution helpers available inside your JavaScript program:",
    "- The JavaScript REPL stays live across iterations within the current frame; top-level declarations and globals persist unless you overwrite them.",
    "- get(name): read the external Prompt, existing variables, or metadata bindings.",
    "- set(name, value): persist a string variable in the frame environment.",
    "- setFinal(value): alias for writing Final.",
    "- setSummary(value): emit a compact execution summary for the next turn.",
    "- log(...values): emit compact stdout-style logs.",
    "- subcall(prompt, storeAs): request a recursive child frame that returns into storeAs; when storeAs is already populated, subcall returns that value so the same program can keep iterating through loops.",
    "Recommended pattern: const P = String(get('Prompt') ?? '');",
    frame.kind === "child"
      ? "Child frames should usually either set Final or launch another permitted subcall."
      : "Root frames should build intermediate variables symbolically and set Final when done.",
    "Keep summaries and logs short; they are surfaced back only as bounded metadata.",
  ];
}

function summarizeLogs(logs: string[]): {
  count: number;
  totalChars: number;
  preview: string;
  truncated: boolean;
} {
  const combined = logs.join("\n");
  const preview = combined.slice(0, LOG_PREVIEW_CHARS);
  return {
    count: logs.length,
    totalChars: combined.length,
    preview,
    truncated: preview.length < combined.length,
  };
}

function summarizeSummary(summary: unknown): {
  present: boolean;
  charLength: number;
  preview: string;
  truncated: boolean;
} {
  if (typeof summary === "undefined") {
    return {
      present: false,
      charLength: 0,
      preview: "",
      truncated: false,
    };
  }

  const text = typeof summary === "string" ? summary : JSON.stringify(summary);
  const normalized = typeof text === "string" ? text : String(summary);
  const preview = normalized.slice(0, SUMMARY_PREVIEW_CHARS);
  return {
    present: true,
    charLength: normalized.length,
    preview,
    truncated: preview.length < normalized.length,
  };
}

function formatLabel(label: string): string {
  const normalized = label.trim().replace(/\s+/g, " ");
  if (normalized.length <= 48) {
    return normalized;
  }

  return `${normalized.slice(0, 45)}...`;
}

function requestIdMarker(requestId: string): string {
  return `<!-- workflow-request-id:${requestId} -->`;
}

function extractRequestId(message: string): string | undefined {
  const markerMatch = message.match(/<!--\s*workflow-request-id:([^>]+)\s*-->/i);
  return markerMatch?.[1]?.trim();
}

function extractLastPromptText(messages: unknown[]): string | undefined {
  const typedMessages = messages.filter(
    (message): message is { role?: unknown; content?: unknown } => {
      return typeof message === "object" && message !== null;
    },
  );

  const message = [...typedMessages].reverse().find((entry) => {
    return entry.role === "user" || entry.role === "custom";
  });

  if (!message) {
    return undefined;
  }

  return extractMessageText(message.content);
}

function extractMessageText(content: unknown): string | undefined {
  if (typeof content === "string") {
    const text = content.trim();
    return text.length > 0 ? text : undefined;
  }

  if (!Array.isArray(content)) {
    return undefined;
  }

  const text = content
    .filter((block): block is { type?: unknown; text?: unknown } => {
      return typeof block === "object" && block !== null;
    })
    .filter((block) => block.type === "text" && typeof block.text === "string")
    .map((block) => block.text)
    .join("\n")
    .trim();

  return text.length > 0 ? text : undefined;
}
