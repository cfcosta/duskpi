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
import { RlmDocumentEnvironment } from "./environment";
import { parseAssistantAction, type RlmAssistantAction } from "./protocol";
import {
  DEFAULT_RLM_MAX_ITERATIONS,
  DEFAULT_RLM_MAX_MALFORMED_OUTPUT_RETRIES,
  DEFAULT_RLM_MAX_RECURSION_DEPTH,
  DEFAULT_RLM_MAX_SLICE_CHARS,
  resolveRlmRequest,
  type RlmRequest,
} from "./request";

export const RLM_COMMAND_DESCRIPTION =
  "Run the Recursive Language Model workflow scaffold for long documents and notes";

const RLM_INTERNAL_MESSAGE_TYPE = "rlm-internal";
const RLM_STATUS_KEY = "rlm";
const INITIAL_PREVIEW_CHARS = 160;

type PendingResponse =
  | { kind: "root" }
  | {
      kind: "child";
      storeAs: string;
      prompt: string;
      depth: number;
    };

interface ActiveRunState {
  request: RlmRequest;
  environment: RlmDocumentEnvironment;
  pendingRequestId: string;
  awaitingResponse: boolean;
  pending: PendingResponse;
  pendingPrompt: string;
  iterationCount: number;
  malformedOutputRetries: number;
}

export interface RlmWorkflowOptions {
  maxIterations?: number;
  maxRecursionDepth?: number;
  maxMalformedOutputRetries?: number;
}

interface RlmSubcallAction {
  kind: "subcall";
  prompt: string;
  storeAs: string;
}

export class RlmWorkflow {
  private state?: ActiveRunState;
  private requestSequence = 0;
  private readonly maxIterations: number;
  private readonly maxRecursionDepth: number;
  private readonly maxMalformedOutputRetries: number;

  constructor(
    private readonly api: ExtensionAPI,
    options: RlmWorkflowOptions = {},
  ) {
    this.maxIterations = options.maxIterations ?? DEFAULT_RLM_MAX_ITERATIONS;
    this.maxRecursionDepth = options.maxRecursionDepth ?? DEFAULT_RLM_MAX_RECURSION_DEPTH;
    this.maxMalformedOutputRetries =
      options.maxMalformedOutputRetries ?? DEFAULT_RLM_MAX_MALFORMED_OUTPUT_RETRIES;
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

    const environment = new RlmDocumentEnvironment(request.value);
    const prompt = buildInitialPrompt(
      environment.getMetadata({ previewChars: INITIAL_PREVIEW_CHARS }),
    );
    const requestId = this.nextRequestId();

    this.state = {
      request: request.value,
      environment,
      pendingRequestId: requestId,
      awaitingResponse: true,
      pending: { kind: "root" },
      pendingPrompt: prompt,
      iterationCount: 0,
      malformedOutputRetries: 0,
    };
    this.updateStatus(ctx);

    this.api.sendUserMessage(`${prompt}\n\n${requestIdMarker(requestId)}`);
  }

  handleToolCall(_event: ToolCallEvent, _ctx: ExtensionContext): void {}

  handleAgentEnd(event: AgentEndEvent, ctx: ExtensionContext): void {
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
        "RLM stopped: assistant action output remained empty or invalid.",
        "Assistant output was empty. Return exactly one supported JSON action.",
      );
      return;
    }

    if (!this.state) {
      return;
    }

    if (this.state.iterationCount + 1 > this.maxIterations) {
      ctx.ui.notify(`RLM stopped: exceeded max iteration budget (${this.maxIterations}).`, "error");
      this.clearState(ctx);
      return;
    }

    this.state.iterationCount += 1;

    if (this.state.pending.kind === "child") {
      this.handleChildAgentEnd(assistantResult.text, ctx);
      return;
    }

    const parsedSubcall = parseSubcallAction(assistantResult.text);
    if (parsedSubcall.ok) {
      this.scheduleChildSubcall(parsedSubcall.value, ctx);
      return;
    }

    const action = parseAssistantAction(assistantResult.text);
    if (!action.ok) {
      this.handleMalformedOutput(
        ctx,
        `RLM could not parse the assistant action: ${action.error.message}`,
        "RLM stopped: assistant action output remained malformed.",
        action.error.message,
      );
      return;
    }

    if (!this.state) {
      return;
    }

    if (action.value.kind === "final_result") {
      this.state.environment.setFinalResult(action.value.result);
      ctx.ui.notify(`RLM final result ready at ${this.state.request.finalFilePath}.`, "info");
      this.clearState(ctx);
      return;
    }

    const observation = this.executeAction(action.value);
    this.sendObservationFollowUp(observation, ctx, { kind: "root" });
  }

  handleBeforeAgentStart(
    event: BeforeAgentStartEvent,
    _ctx: ExtensionContext,
  ): void | { systemPrompt: string } {
    if (!this.state) {
      return undefined;
    }

    return {
      systemPrompt: `${event.systemPrompt}\n\n${buildRlmSystemPrompt(this.state.pending)}`,
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

  private handleChildAgentEnd(text: string, ctx: ExtensionContext): void {
    if (!this.state || this.state.pending.kind !== "child") {
      return;
    }

    const action = parseAssistantAction(text);
    if (!action.ok) {
      this.handleMalformedOutput(
        ctx,
        `RLM child sub-call returned malformed output: ${action.error.message}`,
        "RLM stopped: child sub-call output remained malformed.",
        action.error.message,
      );
      return;
    }

    if (action.value.kind !== "final_result") {
      this.handleMalformedOutput(
        ctx,
        "RLM child sub-call must resolve to a final_result action.",
        "RLM stopped: child sub-call never produced a final_result action.",
        'Child sub-calls must return exactly {"action":"final_result","result":"..."}.',
      );
      return;
    }

    const childFrame = this.state.pending;
    this.state.environment.setVariable(childFrame.storeAs, action.value.result);
    this.state.environment.appendScratchpadEntry(
      `subcall:${childFrame.storeAs}`,
      action.value.result,
    );

    const observation = {
      type: "subcall_result",
      storeAs: childFrame.storeAs,
      prompt: childFrame.prompt,
      result: action.value.result,
      variableNames: this.state.environment.listVariableNames(),
    };

    this.sendObservationFollowUp(observation, ctx, { kind: "root" });
  }

  private scheduleChildSubcall(action: RlmSubcallAction, ctx: ExtensionContext): void {
    if (!this.state) {
      return;
    }

    const nextDepth = this.state.pending.kind === "child" ? this.state.pending.depth + 1 : 1;
    if (nextDepth > this.maxRecursionDepth) {
      ctx.ui.notify(
        `RLM stopped: exceeded max recursion depth (${this.maxRecursionDepth}).`,
        "error",
      );
      this.clearState(ctx);
      return;
    }

    const childPrompt = buildChildPrompt(action.prompt, action.storeAs);
    this.sendHiddenPrompt(childPrompt, ctx, {
      kind: "child",
      storeAs: action.storeAs,
      prompt: action.prompt,
      depth: nextDepth,
    });
  }

  private executeAction(action: RlmAssistantAction): unknown {
    if (!this.state) {
      return undefined;
    }

    switch (action.kind) {
      case "inspect_document":
        return {
          type: "inspect_document",
          metadata: this.state.environment.getMetadata(),
        };
      case "read_segment":
        return {
          type: "read_segment",
          segment: this.state.environment.readSegment(action.offset, action.length),
        };
      case "search_document":
        return {
          type: "search_document",
          result: this.state.environment.search(action.query, {
            maxResults: action.maxResults,
          }),
        };
      case "final_result":
        return undefined;
    }
  }

  private sendObservationFollowUp(
    observation: unknown,
    ctx: ExtensionContext,
    nextPending: PendingResponse,
  ): void {
    const prompt = buildObservationPrompt(observation);
    this.sendHiddenPrompt(prompt, ctx, nextPending);
  }

  private sendHiddenPrompt(prompt: string, ctx: ExtensionContext, pending: PendingResponse): void {
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
    this.state.pending = pending;
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

    const repairPrompt = buildRepairPrompt(this.state.pending, repairHint);
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
    if (!this.state) {
      ctx.ui.setStatus(RLM_STATUS_KEY, undefined);
      return;
    }

    const phase = this.state.pending.kind === "child" ? "child" : "root";
    ctx.ui.setStatus(
      RLM_STATUS_KEY,
      `RLM ${phase}: ${formatQuestionLabel(this.state.request.question)} (${this.state.iterationCount}/${this.maxIterations})`,
    );
  }

  private clearState(ctx: ExtensionContext): void {
    this.state = undefined;
    this.updateStatus(ctx);
  }

  private nextRequestId(): string {
    this.requestSequence += 1;
    return `rlm-${this.requestSequence}`;
  }
}

function buildInitialPrompt(metadata: ReturnType<RlmDocumentEnvironment["getMetadata"]>): string {
  return [
    "You are operating inside a Recursive Language Model-style workspace environment.",
    "This run started from a question, and the extension created workspace files for task, scratchpad, final output, and imported sources.",
    "The full workspace snapshot is not in your context window.",
    "Choose exactly one next action and return only a JSON object or a fenced ```json block.",
    ...buildActionContractLines(),
    "Workspace metadata:",
    JSON.stringify(metadata, null, 2),
  ].join("\n\n");
}

function buildObservationPrompt(observation: unknown): string {
  return [
    "Observation from the workspace environment.",
    "Choose exactly one next action and return only a JSON object or a fenced ```json block.",
    ...buildActionContractLines(),
    JSON.stringify(observation, null, 2),
  ].join("\n\n");
}

function buildRepairPrompt(pending: PendingResponse, repairHint: string): string {
  if (pending.kind === "child") {
    return [
      "Your previous child sub-call response was invalid.",
      `Error: ${repairHint}`,
      'Return exactly one JSON object: {"action":"final_result","result":"..."}',
      "Do not include prose or any unsupported keys.",
    ].join("\n\n");
  }

  return [
    "Your previous RLM action was invalid.",
    `Error: ${repairHint}`,
    "Return exactly one corrected JSON action now.",
    ...buildActionContractLines(),
  ].join("\n\n");
}

function buildChildPrompt(prompt: string, storeAs: string): string {
  return [
    "Recursive child sub-call.",
    `Solve the subtask below and return exactly one final_result JSON action. Store target: ${storeAs}.`,
    "Do not call tools or return prose.",
    "Subtask:",
    prompt,
  ].join("\n\n");
}

function buildRlmSystemPrompt(pending: PendingResponse): string {
  if (pending.kind === "child") {
    return [
      "[RLM CHILD SUBCALL ACTIVE]",
      "Return exactly one JSON action of type final_result.",
      'Schema: {"action":"final_result","result":"..."}',
      "Do not return prose or any other action type.",
    ].join("\n");
  }

  return [
    "[RLM MODE ACTIVE]",
    "Operate over the extension-managed workspace environment.",
    "Do not respond with prose.",
    "Return exactly one JSON action at a time.",
    "Do not invent path, startLine, endLine, or any unsupported fields.",
  ].join("\n");
}

function buildActionContractLines(): string[] {
  return [
    "Available actions and exact schemas:",
    '- {"action":"inspect_document"}',
    `- {"action":"read_segment","offset":0,"length":400} (length must be <= ${DEFAULT_RLM_MAX_SLICE_CHARS})`,
    '- {"action":"search_document","query":"your query","maxResults":5}',
    '- {"action":"subcall","prompt":"your subtask","storeAs":"variable_name"}',
    '- {"action":"final_result","result":"your final answer"}',
    "Do not include path, startLine, endLine, file names, or any unsupported keys.",
    "read_segment is character-based and uses offset/length only.",
  ];
}

function formatQuestionLabel(question: string): string {
  const normalized = question.trim().replace(/\s+/g, " ");
  if (normalized.length <= 48) {
    return normalized;
  }

  return `${normalized.slice(0, 45)}...`;
}

function parseSubcallAction(text: string): { ok: true; value: RlmSubcallAction } | { ok: false } {
  const normalized = text.trim();
  if (normalized.length === 0) {
    return { ok: false };
  }

  const payload = extractJsonPayload(normalized);
  if (!payload) {
    return { ok: false };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch {
    return { ok: false };
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return { ok: false };
  }

  const candidate = parsed as { action?: unknown; prompt?: unknown; storeAs?: unknown };
  if (candidate.action !== "subcall") {
    return { ok: false };
  }

  if (typeof candidate.prompt !== "string" || candidate.prompt.trim().length === 0) {
    return { ok: false };
  }

  if (typeof candidate.storeAs !== "string" || candidate.storeAs.trim().length === 0) {
    return { ok: false };
  }

  return {
    ok: true,
    value: {
      kind: "subcall",
      prompt: candidate.prompt.trim(),
      storeAs: candidate.storeAs.trim(),
    },
  };
}

function extractJsonPayload(text: string): string | undefined {
  const fencedMatch = text.match(/^```(?:json)?\s*([\s\S]*?)```$/i);
  if (fencedMatch) {
    return fencedMatch[1]?.trim() || undefined;
  }

  if (text.startsWith("{") && text.endsWith("}")) {
    return text;
  }

  return undefined;
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
