import { isSafeReadOnlyCommand as defaultIsSafeReadOnlyCommand } from "./command-safety";
import type {
  ExtensionAPI,
  ExtensionContext,
  SessionCompactEvent,
  SessionForkEvent,
  SessionShutdownEvent,
  SessionStartEvent,
  SessionSwitchEvent,
  ToolCallEvent,
} from "./extension-api";
import { extractLastUserText, getLastAssistantTextResult } from "./message-content";
import type { PromptLoadResult } from "./prompt-loader";

type WorkflowResultKind = "ok" | "blocked" | "recoverable_error";

export interface WorkflowResult {
  kind: WorkflowResultKind;
  reason?: string;
}

interface WorkflowState {
  phase: string;
  scope?: string;
  reports: Record<string, string>;
  refinementAttempts: number;
  emptyOutputRetries: number;
  pendingRefinement?: string;
  awaitingResponse: boolean;
  pendingPrompt?: string;
  pendingRequestId?: string;
}

export interface PromptSnapshot<Prompts> {
  prompts?: Prompts;
  error?: Error;
}

export type PromptProviderResult<Prompts> = PromptSnapshot<Prompts> | PromptLoadResult<Prompts>;

interface WorkflowText {
  unavailable: (error?: Error) => string;
  alreadyRunning: string;
  analysisWriteBlocked: string;
  complete: string;
  cancelled: string;
  selectTitle: string;
  executeOption: string;
  refineOption: string;
  cancelOption: string;
  refineEditorLabel: string;
  sendFailed: (phase: string) => string;
  missingOutputRetry: (phase: string, retry: number, maxRetries: number) => string;
  missingOutputStopped: (attempts: number) => string;
}

export interface PhaseWorkflowOptions<Prompts> {
  id: string;
  analysisPhases: readonly string[];
  executionPhase: string;
  phaseLabels: Record<string, string>;
  promptProvider: () => PromptProviderResult<Prompts>;
  parseScopeArg: (args: unknown) => string | undefined;
  buildPrompt: (args: {
    phase: string;
    prompts: Prompts;
    reports: Record<string, string>;
    scope?: string;
    refinement?: string;
  }) => string;
  text: WorkflowText;
  maxEmptyOutputRetries?: number;
  maxRefinementAttempts?: number;
  isWriteCapableTool?: (toolName?: string) => boolean;
  isSafeReadOnlyCommand?: (command: string) => boolean;
  bashBlockedReason?: (command: string) => string;
}

const DEFAULT_MUTATING_TOOL_NAMES = new Set(["edit", "write", "multiedit"]);
const DEFAULT_MUTATION_NAME_FRAGMENTS = ["edit", "write"];

export class PhaseWorkflow<Prompts> {
  private readonly maxEmptyOutputRetries: number;
  private readonly maxRefinementAttempts: number;
  private readonly analysisPhaseSet: Set<string>;
  private readonly nextAnalysisPhase: Map<string, string>;
  private readonly lastAnalysisPhase: string;

  private state: WorkflowState = this.createIdleState();
  private prompts?: Prompts;
  private startupError?: Error;
  private requestSequence = 0;

  constructor(
    private readonly api: ExtensionAPI,
    private readonly options: PhaseWorkflowOptions<Prompts>,
  ) {
    if (options.analysisPhases.length === 0) {
      throw new Error("analysisPhases must contain at least one phase");
    }

    this.maxEmptyOutputRetries = options.maxEmptyOutputRetries ?? 2;
    this.maxRefinementAttempts = options.maxRefinementAttempts ?? 3;
    this.analysisPhaseSet = new Set(options.analysisPhases);
    this.lastAnalysisPhase = options.analysisPhases[options.analysisPhases.length - 1]!;

    this.nextAnalysisPhase = new Map(
      options.analysisPhases
        .slice(0, -1)
        .map((phase, index) => [phase, options.analysisPhases[index + 1]!] as const),
    );
  }

  async handleCommand(args: unknown, ctx: ExtensionContext): Promise<WorkflowResult> {
    this.reloadPrompts();

    if (!this.prompts) {
      ctx.ui.notify(this.options.text.unavailable(this.startupError), "error");
      return { kind: "blocked", reason: "prompts_unavailable" };
    }

    if (this.state.phase !== "idle") {
      ctx.ui.notify(this.options.text.alreadyRunning, "warning");
      return { kind: "blocked", reason: "already_running" };
    }

    this.state = this.createState({
      phase: this.options.analysisPhases[0]!,
      scope: this.options.parseScopeArg(args),
    });

    this.updateStatus(ctx);
    if (!this.sendPromptForPhase(this.options.analysisPhases[0]!, ctx)) {
      return { kind: "recoverable_error", reason: "prompt_send_failed" };
    }

    return { kind: "ok" };
  }

  async handleToolCall(event: ToolCallEvent): Promise<{ block: true; reason: string } | void> {
    if (!this.isAnalysisPhase(this.state.phase)) {
      return;
    }

    if (this.isWriteCapableTool(event.toolName)) {
      return {
        block: true,
        reason: this.options.text.analysisWriteBlocked,
      };
    }

    if (isBashTool(event.toolName)) {
      const command = extractBashCommand(event.input);
      const isSafeReadOnlyCommand =
        this.options.isSafeReadOnlyCommand ?? defaultIsSafeReadOnlyCommand;

      if (!isSafeReadOnlyCommand(command)) {
        return {
          block: true,
          reason:
            this.options.bashBlockedReason?.(command) ??
            `Workflow analysis phase blocked a potentially mutating bash command: ${command}`,
        };
      }
    }
  }

  async handleAgentEnd(
    event: { messages?: unknown[] },
    ctx: ExtensionContext,
  ): Promise<WorkflowResult> {
    if (this.state.phase === "idle" || !this.prompts) {
      return { kind: "blocked", reason: "inactive" };
    }

    if (!this.state.awaitingResponse) {
      return { kind: "blocked", reason: "stale_agent_end" };
    }

    const eventMessages = event.messages ?? [];
    const lastUserText = extractLastUserText(eventMessages);
    const observedRequestId = lastUserText ? extractRequestId(lastUserText) : undefined;
    if (
      this.state.pendingRequestId &&
      observedRequestId &&
      observedRequestId !== this.state.pendingRequestId
    ) {
      return { kind: "blocked", reason: "unmatched_agent_end" };
    }

    if (
      this.state.pendingPrompt &&
      lastUserText &&
      normalizeMessage(lastUserText) !== normalizeMessage(this.state.pendingPrompt)
    ) {
      return { kind: "blocked", reason: "unmatched_agent_end" };
    }

    this.state.awaitingResponse = false;
    const assistantResult = getLastAssistantTextResult(eventMessages);
    if (assistantResult.kind === "invalid_payload") {
      this.finishRun(ctx, this.options.text.cancelled);
      ctx.ui.notify("Workflow stopped: invalid assistant payload shape received.", "error");
      return { kind: "recoverable_error", reason: "invalid_agent_payload" };
    }

    if (assistantResult.kind !== "ok") {
      return this.handleMissingAssistantOutput(ctx);
    }

    const assistantText = assistantResult.text;
    this.state.emptyOutputRetries = 0;
    this.state.pendingPrompt = undefined;
    this.state.pendingRequestId = undefined;

    if (this.state.phase === this.options.executionPhase) {
      this.finishRun(ctx, this.options.text.complete);
      return { kind: "ok" };
    }

    if (!this.isAnalysisPhase(this.state.phase)) {
      throw new Error(`Unreachable workflow phase '${this.state.phase}' in handleAgentEnd`);
    }

    this.capturePhaseReport(this.state.phase, assistantText);

    if (this.state.phase === this.lastAnalysisPhase) {
      await this.handleAnalysisComplete(ctx);
      return { kind: "ok" };
    }

    const nextPhase = this.nextAnalysisPhase.get(this.state.phase);
    if (!nextPhase) {
      return { kind: "recoverable_error", reason: "unknown_phase_transition" };
    }

    this.state.phase = nextPhase;
    this.updateStatus(ctx);
    this.sendPromptForPhase(nextPhase, ctx);
    return { kind: "ok" };
  }

  async handleSessionStart(_event: SessionStartEvent, _ctx: ExtensionContext): Promise<void> {
    return undefined;
  }

  async handleSessionSwitch(_event: SessionSwitchEvent, ctx: ExtensionContext): Promise<void> {
    this.resetForSessionBoundary(ctx);
    return undefined;
  }

  async handleSessionFork(_event: SessionForkEvent, ctx: ExtensionContext): Promise<void> {
    this.resetForSessionBoundary(ctx);
    return undefined;
  }

  async handleSessionCompact(_event: SessionCompactEvent, ctx: ExtensionContext): Promise<void> {
    this.resetForSessionBoundary(ctx);
    return undefined;
  }

  async handleSessionShutdown(_event: SessionShutdownEvent, ctx: ExtensionContext): Promise<void> {
    this.resetForSessionBoundary(ctx);
    return undefined;
  }

  private async handleAnalysisComplete(ctx: ExtensionContext): Promise<void> {
    this.updateStatus(ctx);

    let choice: string | undefined;
    try {
      choice = await ctx.ui.select(this.options.text.selectTitle, [
        this.options.text.executeOption,
        this.options.text.refineOption,
        this.options.text.cancelOption,
      ]);
    } catch {
      this.finishRun(ctx, this.options.text.cancelled);
      ctx.ui.notify("Workflow stopped: failed while reading UI selection.", "error");
      return;
    }

    if (choice?.startsWith(this.options.text.executeOption)) {
      this.state.phase = this.options.executionPhase;
      this.state.refinementAttempts = 0;
      this.updateStatus(ctx);
      ctx.ui.setWidget(this.options.id, undefined);
      this.sendPromptForPhase(this.options.executionPhase, ctx);
      return;
    }

    if (choice?.startsWith(this.options.text.refineOption)) {
      if (this.state.refinementAttempts >= this.maxRefinementAttempts) {
        this.finishRun(ctx, this.options.text.cancelled);
        return;
      }

      let refinement: string | undefined;
      try {
        refinement = await ctx.ui.editor(this.options.text.refineEditorLabel, "");
      } catch {
        this.finishRun(ctx, this.options.text.cancelled);
        ctx.ui.notify("Workflow stopped: failed while collecting refinement input.", "error");
        return;
      }

      if (!refinement?.trim()) {
        this.finishRun(ctx, this.options.text.cancelled);
        return;
      }

      this.state.refinementAttempts += 1;
      this.state.pendingRefinement = refinement.trim();
      this.sendPromptForPhase(this.lastAnalysisPhase, ctx);
      return;
    }

    this.finishRun(ctx, this.options.text.cancelled);
  }

  private handleMissingAssistantOutput(ctx: ExtensionContext): WorkflowResult {
    this.state.emptyOutputRetries += 1;

    if (this.state.emptyOutputRetries > this.maxEmptyOutputRetries) {
      this.finishRun(ctx, this.options.text.missingOutputStopped(this.maxEmptyOutputRetries + 1));
      return { kind: "recoverable_error", reason: "max_empty_output_retries" };
    }

    ctx.ui.notify(
      this.options.text.missingOutputRetry(
        this.state.phase,
        this.state.emptyOutputRetries,
        this.maxEmptyOutputRetries,
      ),
      "warning",
    );

    this.sendPromptForPhase(this.state.phase, ctx);

    return { kind: "recoverable_error", reason: "empty_output_retry" };
  }

  private sendPromptForPhase(phase: string, ctx: ExtensionContext): boolean {
    const prompt = this.options.buildPrompt({
      phase,
      prompts: this.prompts!,
      reports: this.state.reports,
      scope: this.state.scope,
      refinement: phase === this.lastAnalysisPhase ? this.state.pendingRefinement : undefined,
    });

    const requestId = this.nextRequestId();
    const promptWithRequestId = `${prompt}\n\n${requestIdMarker(requestId)}`;

    this.state.pendingPrompt = promptWithRequestId;
    this.state.pendingRequestId = requestId;
    this.state.awaitingResponse = true;

    try {
      this.api.sendUserMessage(promptWithRequestId);
      return true;
    } catch {
      this.state = this.createIdleState();
      this.updateStatus(ctx);
      ctx.ui.notify(this.options.text.sendFailed(phase), "error");
      return false;
    }
  }

  private reloadPrompts() {
    const loadResult = normalizePromptProviderResult(this.options.promptProvider());
    this.prompts = loadResult.prompts;
    this.startupError = loadResult.error;
  }

  private capturePhaseReport(phase: string, report: string) {
    this.state.reports[phase] = report;
    if (phase === this.lastAnalysisPhase) {
      this.state.pendingRefinement = undefined;
    }
  }

  private resetForSessionBoundary(ctx: ExtensionContext) {
    this.state = this.createIdleState();
    this.updateStatus(ctx);
  }

  private finishRun(ctx: ExtensionContext, message: string) {
    this.state = this.createIdleState();
    this.updateStatus(ctx);
    ctx.ui.notify(message, "info");
  }

  private updateStatus(ctx: ExtensionContext) {
    if (this.state.phase === "idle") {
      ctx.ui.setStatus(this.options.id, undefined);
      ctx.ui.setWidget(this.options.id, undefined);
      return;
    }

    const allPhases = [...this.options.analysisPhases, this.options.executionPhase];
    const phaseIndex = allPhases.indexOf(this.state.phase) + 1;
    const icon = this.state.phase === this.options.executionPhase ? "🔧" : "🔍";
    const label = this.options.phaseLabels[this.state.phase] ?? this.state.phase;
    ctx.ui.setStatus(this.options.id, `${icon} Phase ${phaseIndex}/${allPhases.length}: ${label}`);
  }

  private createIdleState(): WorkflowState {
    return this.createState({ phase: "idle" });
  }

  private createState(overrides: Partial<WorkflowState>): WorkflowState {
    return {
      phase: "idle",
      reports: {},
      refinementAttempts: 0,
      emptyOutputRetries: 0,
      pendingRefinement: undefined,
      awaitingResponse: false,
      pendingPrompt: undefined,
      pendingRequestId: undefined,
      ...overrides,
    };
  }

  private nextRequestId(): string {
    this.requestSequence += 1;
    return `${this.options.id}-${this.requestSequence}`;
  }

  private isAnalysisPhase(phase: string): boolean {
    return this.analysisPhaseSet.has(phase);
  }

  private isWriteCapableTool(toolName?: string): boolean {
    if (this.options.isWriteCapableTool) {
      return this.options.isWriteCapableTool(toolName);
    }

    return isDefaultMutatingToolName(toolName);
  }
}

function normalizePromptProviderResult<Prompts>(
  result: PromptProviderResult<Prompts>,
): PromptSnapshot<Prompts> {
  if (!("ok" in result)) {
    return result;
  }

  if (result.ok) {
    return { prompts: result.prompts };
  }

  return { error: result.error };
}

function isDefaultMutatingToolName(toolName?: string): boolean {
  const normalizedToolName = (toolName ?? "").trim().toLowerCase();
  if (DEFAULT_MUTATING_TOOL_NAMES.has(normalizedToolName)) {
    return true;
  }

  return DEFAULT_MUTATION_NAME_FRAGMENTS.some((fragment) => {
    return normalizedToolName.includes(fragment);
  });
}

function isBashTool(toolName?: string): boolean {
  return (toolName ?? "").trim().toLowerCase() === "bash";
}

function extractBashCommand(input: unknown): string {
  if (typeof input !== "object" || input === null) {
    return "";
  }

  const command = (input as { command?: unknown }).command;
  return typeof command === "string" ? command : "";
}

function normalizeMessage(value: string): string {
  return value.trim().replace(/\r\n/g, "\n");
}

function requestIdMarker(requestId: string): string {
  return `<!-- workflow-request-id:${requestId} -->`;
}

function extractRequestId(message: string): string | undefined {
  const markerMatch = message.match(/<!--\s*workflow-request-id:([^>]+)\s*-->/i);
  return markerMatch?.[1]?.trim();
}
