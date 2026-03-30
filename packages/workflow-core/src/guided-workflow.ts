import type {
  AgentEndEvent,
  BeforeAgentStartEvent,
  ExtensionAPI,
  ExtensionContext,
  SessionShutdownEvent,
  SessionStartEvent,
  ToolCallEvent,
  TurnEndEvent,
} from "./extension-api";
import { getLastAssistantTextResult } from "./message-content";
import type { GuidedWorkflowController } from "./register-guided-workflow-extension";

type GuidedWorkflowResultKind = "ok" | "blocked" | "recoverable_error";

export interface GuidedWorkflowResult {
  kind: GuidedWorkflowResultKind;
  reason?: string;
}

export type GuidedWorkflowPhase = "idle" | "planning" | "approval" | "executing";
export type GuidedCritiqueVerdict = "PASS" | "REFINE" | "REJECT";

type PendingResponseKind = "planning" | "critique" | "revision";

const DEFAULT_MUTATING_TOOL_NAMES = new Set(["edit", "write", "multiedit"]);
const DEFAULT_MUTATION_NAME_FRAGMENTS = ["edit", "write"];

export interface GuidedWorkflowState {
  phase: GuidedWorkflowPhase;
  goal?: string;
  pendingRequestId?: string;
  awaitingResponse: boolean;
}

interface GuidedWorkflowText {
  alreadyRunning: string;
  sendFailed?: string;
}

export type GuidedWorkflowPromptDelivery = "visible" | "hidden";

export interface GuidedWorkflowDeliveryOptions {
  planning?: GuidedWorkflowPromptDelivery;
  execution?: GuidedWorkflowPromptDelivery;
}

type PendingPromptDelivery = GuidedWorkflowPromptDelivery;

export interface GuidedWorkflowCritiqueOptions {
  buildCritiquePrompt: (args: { goal?: string; planText: string }) => string;
  buildRevisionPrompt: (args: {
    goal?: string;
    planText: string;
    critiqueText: string;
    verdict: GuidedCritiqueVerdict;
  }) => string;
  parseCritiqueVerdict: (text: string) => GuidedCritiqueVerdict | undefined;
  customMessageType?: string;
}

export interface GuidedWorkflowPlanningPolicy {
  isWriteCapableTool?: (toolName?: string) => boolean;
  isSafeReadOnlyCommand?: (command: string) => boolean;
  writeBlockedReason?: string;
  bashBlockedReason?: (command: string) => string;
}

export type GuidedWorkflowApprovalAction = "approve" | "continue" | "regenerate" | "exit";

export interface GuidedWorkflowApprovalSelection {
  cancelled?: boolean;
  action?: GuidedWorkflowApprovalAction;
  note?: string;
}

export interface GuidedWorkflowApprovalPromptArgs {
  goal?: string;
  planText: string;
  critiqueText?: string;
  note?: string;
}

export interface GuidedWorkflowApprovalOptions {
  selectAction: (
    args: Omit<GuidedWorkflowApprovalPromptArgs, "note">,
    ctx: ExtensionContext,
  ) => GuidedWorkflowApprovalSelection | Promise<GuidedWorkflowApprovalSelection>;
  buildContinuePrompt?: (args: GuidedWorkflowApprovalPromptArgs) => string;
  buildRegeneratePrompt?: (args: GuidedWorkflowApprovalPromptArgs) => string;
  onApprove?: (args: GuidedWorkflowApprovalPromptArgs, ctx: ExtensionContext) => unknown;
  onExit?: (args: GuidedWorkflowApprovalPromptArgs, ctx: ExtensionContext) => unknown;
}

export interface GuidedWorkflowExecutionItem {
  step: number;
  text: string;
  completed: boolean;
  skipped?: boolean;
}

export interface GuidedWorkflowExecutionPromptArgs extends GuidedWorkflowApprovalPromptArgs {
  currentStep: GuidedWorkflowExecutionItem;
  items: GuidedWorkflowExecutionItem[];
}

export interface GuidedWorkflowExecutionSnapshot {
  note?: string;
  items: GuidedWorkflowExecutionItem[];
}

export interface GuidedWorkflowExecutionOptions {
  extractItems: (
    args: Omit<GuidedWorkflowApprovalPromptArgs, "note">,
  ) => Array<Omit<GuidedWorkflowExecutionItem, "completed"> | GuidedWorkflowExecutionItem>;
  buildExecutionPrompt: (args: GuidedWorkflowExecutionPromptArgs) => string;
  extractDoneStepNumbers?: (text: string) => number[];
  extractSkippedStepNumbers?: (text: string) => number[];
}

export interface GuidedWorkflowOptions {
  id: string;
  parseGoalArg?: (args: unknown) => string | undefined;
  buildPlanningPrompt?: (args: { goal?: string }) => string;
  critique?: GuidedWorkflowCritiqueOptions;
  planningPolicy?: GuidedWorkflowPlanningPolicy;
  delivery?: GuidedWorkflowDeliveryOptions;
  approval?: GuidedWorkflowApprovalOptions;
  execution?: GuidedWorkflowExecutionOptions;
  maxMissingOutputRetries?: number;
  text: GuidedWorkflowText;
}

export class GuidedWorkflow implements GuidedWorkflowController {
  private state: GuidedWorkflowState = this.createIdleState();
  private requestSequence = 0;
  private missingOutputRetries = 0;
  private pendingResponseKind?: PendingResponseKind;
  private pendingPromptText?: string;
  private pendingPromptDelivery?: PendingPromptDelivery;
  private latestPlanText?: string;
  private latestCritiqueText?: string;
  private executionItems: GuidedWorkflowExecutionItem[] = [];
  private executionNote?: string;
  private readonly maxMissingOutputRetries: number;

  constructor(
    private readonly api: ExtensionAPI,
    private readonly options: GuidedWorkflowOptions,
  ) {
    this.maxMissingOutputRetries = options.maxMissingOutputRetries ?? 2;
  }

  getStateSnapshot(): GuidedWorkflowState {
    return { ...this.state };
  }

  getExecutionSnapshot(): GuidedWorkflowExecutionSnapshot {
    return {
      note: this.executionNote,
      items: this.executionItems.map((item) => ({ ...item })),
    };
  }

  protected getLatestPlanText(): string | undefined {
    return this.latestPlanText;
  }

  async handleCommand(args: unknown, ctx: ExtensionContext): Promise<GuidedWorkflowResult> {
    if (this.state.phase !== "idle") {
      ctx.ui.notify(this.options.text.alreadyRunning, "warning");
      return { kind: "blocked", reason: "already_running" };
    }

    const goal = this.options.parseGoalArg?.(args);
    const requestId = this.nextRequestId();
    const prompt = this.buildPlanningPrompt(goal);
    const promptWithRequestId = `${prompt}\n\n${requestIdMarker(requestId)}`;

    this.state = {
      ...this.createIdleState(),
      phase: "planning",
      goal,
      pendingRequestId: requestId,
      awaitingResponse: true,
    };
    const planningDelivery = this.getPlanningPromptDelivery();
    this.pendingResponseKind = "planning";
    this.pendingPromptText = prompt;
    this.pendingPromptDelivery = planningDelivery;
    this.missingOutputRetries = 0;
    this.latestPlanText = undefined;
    this.latestCritiqueText = undefined;

    try {
      this.dispatchPlanningPrompt(promptWithRequestId, planningDelivery);
      return { kind: "ok" };
    } catch {
      this.resetWorkflowState();
      ctx.ui.notify(
        this.options.text.sendFailed ?? "Guided workflow stopped: failed to send planning prompt.",
        "error",
      );
      return { kind: "recoverable_error", reason: "prompt_send_failed" };
    }
  }

  async handleToolCall(
    event: ToolCallEvent,
    _ctx: ExtensionContext,
  ): Promise<{ block: true; reason: string } | void> {
    if (!this.isPlanningPhase(this.state.phase)) {
      return;
    }

    if (this.isWriteCapableTool(event.toolName)) {
      return {
        block: true,
        reason:
          this.options.planningPolicy?.writeBlockedReason ??
          "Guided workflow planning phase: writes are disabled",
      };
    }

    if (isBashTool(event.toolName) && this.options.planningPolicy?.isSafeReadOnlyCommand) {
      const command = extractBashCommand(event.input);
      if (!this.options.planningPolicy.isSafeReadOnlyCommand(command)) {
        return {
          block: true,
          reason:
            this.options.planningPolicy.bashBlockedReason?.(command) ??
            `Guided workflow planning phase blocked a potentially mutating bash command: ${command}`,
        };
      }
    }
  }

  async handleAgentEnd(event: AgentEndEvent, ctx: ExtensionContext): Promise<GuidedWorkflowResult> {
    if (this.state.phase === "idle") {
      return { kind: "blocked", reason: "inactive" };
    }

    if (!this.state.awaitingResponse) {
      return { kind: "blocked", reason: "stale_agent_end" };
    }

    const eventMessages = event.messages ?? [];
    const lastPromptText = extractLastPromptText(eventMessages);
    const observedRequestId = lastPromptText ? extractRequestId(lastPromptText) : undefined;
    if (!this.state.pendingRequestId || observedRequestId !== this.state.pendingRequestId) {
      return { kind: "blocked", reason: "unmatched_agent_end" };
    }

    const assistantResult = getLastAssistantTextResult(eventMessages);
    if (assistantResult.kind !== "ok") {
      return this.handleMissingAssistantOutput(ctx);
    }

    this.missingOutputRetries = 0;
    this.pendingPromptText = undefined;
    this.pendingPromptDelivery = undefined;

    if (this.pendingResponseKind === "critique") {
      return this.handleCritiqueResponse(assistantResult.text, ctx);
    }

    if (this.pendingResponseKind === "revision") {
      this.latestPlanText = assistantResult.text;
      this.latestCritiqueText = undefined;
      return this.sendCritiquePrompt(assistantResult.text, ctx);
    }

    this.latestPlanText = assistantResult.text;
    this.latestCritiqueText = undefined;
    if (this.options.critique) {
      return this.sendCritiquePrompt(assistantResult.text, ctx);
    }

    this.markApprovalReady();
    return this.handleApprovalReady(ctx);
  }

  handleBeforeAgentStart(_event: BeforeAgentStartEvent, _ctx: ExtensionContext): void {
    return undefined;
  }

  async handleTurnEnd(event: TurnEndEvent, ctx: ExtensionContext): Promise<void> {
    if (this.state.phase !== "executing" || this.executionItems.length === 0) {
      return undefined;
    }

    const assistantText = extractTurnMessageText(event.message);
    if (!assistantText) {
      return undefined;
    }

    const currentStepBefore = this.getCurrentExecutionStep();
    const progress = this.syncExecutionProgress(assistantText, currentStepBefore?.step);
    if (progress.completedCount === 0) {
      return undefined;
    }

    if (
      this.executionItems.length > 0 &&
      this.executionItems.every((item) => item.completed || item.skipped)
    ) {
      this.resetWorkflowState();
      return undefined;
    }

    if (!progress.currentStepCompleted) {
      return undefined;
    }

    this.sendExecutionPromptForCurrentStep(ctx);
    return undefined;
  }

  async handleSessionStart(_event: SessionStartEvent, _ctx: ExtensionContext): Promise<void> {
    return undefined;
  }

  async handleSessionShutdown(_event: SessionShutdownEvent, _ctx: ExtensionContext): Promise<void> {
    this.resetWorkflowState();
    return undefined;
  }

  protected beginCritiqueFlow(planText: string, ctx: ExtensionContext): GuidedWorkflowResult {
    this.latestPlanText = planText;
    this.latestCritiqueText = undefined;
    if (this.options.critique) {
      return this.sendCritiquePrompt(planText, ctx);
    }

    this.markApprovalReady();
    return { kind: "ok" };
  }

  private handleMissingAssistantOutput(ctx: ExtensionContext): GuidedWorkflowResult {
    this.missingOutputRetries += 1;

    if (this.missingOutputRetries > this.maxMissingOutputRetries) {
      const attempts = this.maxMissingOutputRetries + 1;
      this.resetWorkflowState();
      ctx.ui.notify(
        `Guided workflow stopped: assistant output stayed empty or invalid after ${attempts} attempts.`,
        "error",
      );
      return { kind: "recoverable_error", reason: "max_missing_output_retries" };
    }

    ctx.ui.notify(
      `Guided workflow response was empty or invalid during ${describePendingResponseKind(this.pendingResponseKind)}. Retrying (${this.missingOutputRetries}/${this.maxMissingOutputRetries}).`,
      "warning",
    );

    const retryResult = this.retryPendingPrompt(ctx);
    return retryResult.kind === "ok"
      ? { kind: "recoverable_error", reason: "empty_output_retry" }
      : retryResult;
  }

  private retryPendingPrompt(ctx: ExtensionContext): GuidedWorkflowResult {
    if (!this.pendingPromptText || !this.pendingPromptDelivery || !this.pendingResponseKind) {
      this.resetWorkflowState();
      ctx.ui.notify("Guided workflow stopped: missing pending prompt state for recovery.", "error");
      return { kind: "recoverable_error", reason: "missing_pending_prompt" };
    }

    if (this.pendingPromptDelivery === "hidden") {
      return this.sendHiddenFollowUp(this.pendingPromptText, this.pendingResponseKind, ctx, {
        preserveMissingOutputRetries: true,
      });
    }

    return this.sendPlanningFollowUp(this.pendingPromptText, ctx, {
      preserveMissingOutputRetries: true,
    });
  }

  private async handleCritiqueResponse(
    critiqueText: string,
    ctx: ExtensionContext,
  ): Promise<GuidedWorkflowResult> {
    this.latestCritiqueText = critiqueText;
    const verdict = this.options.critique?.parseCritiqueVerdict(critiqueText) ?? "REJECT";
    if (verdict === "PASS") {
      this.markApprovalReady();
      return this.handleApprovalReady(ctx);
    }

    return this.sendRevisionPrompt(critiqueText, verdict, ctx);
  }

  private sendCritiquePrompt(planText: string, ctx: ExtensionContext): GuidedWorkflowResult {
    const critique = this.options.critique;
    if (!critique) {
      this.markApprovalReady();
      return { kind: "ok" };
    }

    const prompt = critique.buildCritiquePrompt({
      goal: this.state.goal,
      planText,
    });
    return this.sendHiddenFollowUp(prompt, "critique", ctx);
  }

  private sendRevisionPrompt(
    critiqueText: string,
    verdict: GuidedCritiqueVerdict,
    ctx: ExtensionContext,
  ): GuidedWorkflowResult {
    const critique = this.options.critique;
    if (!critique || !this.latestPlanText) {
      return { kind: "blocked", reason: "revision_unavailable" };
    }

    const prompt = critique.buildRevisionPrompt({
      goal: this.state.goal,
      planText: this.latestPlanText,
      critiqueText,
      verdict,
    });
    return this.sendHiddenFollowUp(prompt, "revision", ctx);
  }

  private getPlanningPromptDelivery(): GuidedWorkflowPromptDelivery {
    return this.options.delivery?.planning ?? "visible";
  }

  private getInternalMessageType(): string {
    return this.options.critique?.customMessageType ?? `${this.options.id}-internal`;
  }

  private dispatchPlanningPrompt(
    promptWithRequestId: string,
    delivery: GuidedWorkflowPromptDelivery,
  ): void {
    if (delivery === "hidden") {
      this.api.sendMessage(
        {
          customType: this.getInternalMessageType(),
          content: promptWithRequestId,
          display: false,
        },
        {
          triggerTurn: true,
          deliverAs: "followUp",
        },
      );
      return;
    }

    this.api.sendUserMessage(promptWithRequestId);
  }

  private sendHiddenFollowUp(
    prompt: string,
    nextResponseKind: PendingResponseKind,
    ctx: ExtensionContext,
    options: { preserveMissingOutputRetries?: boolean } = {},
  ): GuidedWorkflowResult {
    const requestId = this.nextRequestId();
    const promptWithRequestId = `${prompt}\n\n${requestIdMarker(requestId)}`;

    try {
      this.dispatchPlanningPrompt(promptWithRequestId, "hidden");
    } catch {
      this.resetWorkflowState();
      ctx.ui.notify(
        this.options.text.sendFailed ?? "Guided workflow stopped: failed to send planning prompt.",
        "error",
      );
      return { kind: "recoverable_error", reason: "prompt_send_failed" };
    }

    this.state = {
      ...this.state,
      phase: "planning",
      pendingRequestId: requestId,
      awaitingResponse: true,
    };
    this.pendingResponseKind = nextResponseKind;
    this.pendingPromptText = prompt;
    this.pendingPromptDelivery = "hidden";
    if (!options.preserveMissingOutputRetries) {
      this.missingOutputRetries = 0;
    }
    return { kind: "ok" };
  }

  private async handleApprovalReady(ctx: ExtensionContext): Promise<GuidedWorkflowResult> {
    if (!this.options.approval?.selectAction || !this.latestPlanText) {
      return { kind: "ok" };
    }

    const selection = await this.options.approval.selectAction(
      {
        goal: this.state.goal,
        planText: this.latestPlanText,
        critiqueText: this.latestCritiqueText,
      },
      ctx,
    );

    if (selection.cancelled || !selection.action) {
      return { kind: "ok" };
    }

    const args: GuidedWorkflowApprovalPromptArgs = {
      goal: this.state.goal,
      planText: this.latestPlanText,
      critiqueText: this.latestCritiqueText,
      note: normalizeNote(selection.note),
    };

    switch (selection.action) {
      case "approve": {
        await this.options.approval.onApprove?.(args, ctx);
        this.state = {
          ...this.state,
          phase: "executing",
          pendingRequestId: undefined,
          awaitingResponse: false,
        };
        this.pendingResponseKind = undefined;
        this.executionNote = args.note;
        this.executionItems = this.createExecutionItems({
          goal: args.goal,
          planText: args.planText,
          critiqueText: args.critiqueText,
        });

        if (!this.getCurrentExecutionStep()) {
          return { kind: "ok" };
        }

        return this.sendExecutionPromptForCurrentStep(ctx);
      }
      case "continue":
        return this.sendPlanningFollowUp(
          this.options.approval.buildContinuePrompt?.(args) ?? buildDefaultContinuePrompt(args),
          ctx,
        );
      case "regenerate":
        return this.sendPlanningFollowUp(
          this.options.approval.buildRegeneratePrompt?.(args) ?? buildDefaultRegeneratePrompt(args),
          ctx,
          { resetDraftState: true },
        );
      case "exit":
        await this.options.approval.onExit?.(args, ctx);
        this.resetWorkflowState();
        return { kind: "ok" };
    }
  }

  private sendPlanningFollowUp(
    prompt: string,
    ctx: ExtensionContext,
    options: { resetDraftState?: boolean; preserveMissingOutputRetries?: boolean } = {},
  ): GuidedWorkflowResult {
    const requestId = this.nextRequestId();
    const promptWithRequestId = `${prompt}\n\n${requestIdMarker(requestId)}`;
    const planningDelivery = this.getPlanningPromptDelivery();

    try {
      this.dispatchPlanningPrompt(promptWithRequestId, planningDelivery);
    } catch {
      this.resetWorkflowState();
      ctx.ui.notify(
        this.options.text.sendFailed ?? "Guided workflow stopped: failed to send planning prompt.",
        "error",
      );
      return { kind: "recoverable_error", reason: "prompt_send_failed" };
    }

    if (options.resetDraftState) {
      this.latestPlanText = undefined;
      this.latestCritiqueText = undefined;
    }

    this.state = {
      ...this.state,
      phase: "planning",
      pendingRequestId: requestId,
      awaitingResponse: true,
    };
    this.pendingResponseKind = "planning";
    this.pendingPromptText = prompt;
    this.pendingPromptDelivery = planningDelivery;
    if (!options.preserveMissingOutputRetries) {
      this.missingOutputRetries = 0;
    }
    return { kind: "ok" };
  }

  private markApprovalReady() {
    this.state = {
      ...this.state,
      phase: "approval",
      pendingRequestId: undefined,
      awaitingResponse: false,
    };
    this.pendingResponseKind = undefined;
  }

  private buildPlanningPrompt(goal?: string): string {
    if (this.options.buildPlanningPrompt) {
      return this.options.buildPlanningPrompt({ goal });
    }

    return goal
      ? `Create a concrete implementation plan for: ${goal}`
      : "Create a concrete implementation plan for the current task.";
  }

  private createExecutionItems(
    args: Omit<GuidedWorkflowApprovalPromptArgs, "note">,
  ): GuidedWorkflowExecutionItem[] {
    const items = this.options.execution?.extractItems(args) ?? [];
    return items
      .map((item) => ({
        step: item.step,
        text: item.text,
        completed: "completed" in item ? item.completed : false,
        ...("skipped" in item && item.skipped ? { skipped: item.skipped } : {}),
      }))
      .sort((left, right) => {
        return left.step - right.step || left.text.localeCompare(right.text);
      });
  }

  private getCurrentExecutionStep(): GuidedWorkflowExecutionItem | undefined {
    return this.executionItems.find((item) => !item.completed && !item.skipped);
  }

  private sendExecutionPromptForCurrentStep(ctx: ExtensionContext): GuidedWorkflowResult {
    const currentStep = this.getCurrentExecutionStep();
    const planText = this.latestPlanText;
    if (!currentStep || !planText || !this.options.execution) {
      return { kind: "ok" };
    }

    const prompt = this.options.execution.buildExecutionPrompt({
      goal: this.state.goal,
      planText,
      critiqueText: this.latestCritiqueText,
      note: this.executionNote,
      currentStep,
      items: this.executionItems.map((item) => ({ ...item })),
    });

    if (!prompt) {
      return { kind: "ok" };
    }

    try {
      this.api.sendUserMessage(prompt, { deliverAs: "followUp" });
      return { kind: "ok" };
    } catch {
      ctx.ui.notify(
        this.options.text.sendFailed ?? "Guided workflow stopped: failed to send planning prompt.",
        "error",
      );
      return { kind: "recoverable_error", reason: "prompt_send_failed" };
    }
  }

  private syncExecutionProgress(
    text: string,
    currentStepNumber?: number,
  ): { completedCount: number; currentStepCompleted: boolean } {
    const doneSteps =
      this.options.execution?.extractDoneStepNumbers?.(text) ?? extractDoneStepNumbers(text);
    const skippedSteps =
      this.options.execution?.extractSkippedStepNumbers?.(text) ?? extractSkippedStepNumbers(text);
    let completedCount = 0;
    let currentStepCompleted = false;

    for (const step of doneSteps) {
      const item = this.executionItems.find((candidate) => candidate.step === step);
      if (!item || item.completed || item.skipped) {
        continue;
      }

      item.completed = true;
      completedCount += 1;
      if (step === currentStepNumber) {
        currentStepCompleted = true;
      }
    }

    for (const step of skippedSteps) {
      const item = this.executionItems.find((candidate) => candidate.step === step);
      if (!item || item.completed || item.skipped) {
        continue;
      }

      item.skipped = true;
      completedCount += 1;
      if (step === currentStepNumber) {
        currentStepCompleted = true;
      }
    }

    return { completedCount, currentStepCompleted };
  }

  protected abandonPendingResponse(): void {
    this.state = this.createIdleState();
    this.missingOutputRetries = 0;
    this.pendingResponseKind = undefined;
    this.pendingPromptText = undefined;
    this.pendingPromptDelivery = undefined;
  }

  private resetWorkflowState() {
    this.abandonPendingResponse();
    this.latestPlanText = undefined;
    this.latestCritiqueText = undefined;
    this.executionItems = [];
    this.executionNote = undefined;
  }

  private isPlanningPhase(phase: GuidedWorkflowPhase): boolean {
    return phase === "planning" || phase === "approval";
  }

  private isWriteCapableTool(toolName?: string): boolean {
    if (this.options.planningPolicy?.isWriteCapableTool) {
      return this.options.planningPolicy.isWriteCapableTool(toolName);
    }

    return isDefaultMutatingToolName(toolName);
  }

  private createIdleState(): GuidedWorkflowState {
    return {
      phase: "idle",
      goal: undefined,
      pendingRequestId: undefined,
      awaitingResponse: false,
    };
  }

  private nextRequestId(): string {
    this.requestSequence += 1;
    return `${this.options.id}-${this.requestSequence}`;
  }
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

function extractTurnMessageText(message: unknown): string | undefined {
  if (typeof message !== "object" || message === null) {
    return undefined;
  }

  const typedMessage = message as { role?: unknown; content?: unknown };
  if (typedMessage.role !== "assistant") {
    return undefined;
  }

  return extractMessageText(typedMessage.content);
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

function isDefaultMutatingToolName(toolName?: string): boolean {
  const normalizedToolName = (toolName ?? "").trim().toLowerCase();
  if (DEFAULT_MUTATING_TOOL_NAMES.has(normalizedToolName)) {
    return true;
  }

  return DEFAULT_MUTATION_NAME_FRAGMENTS.some((fragment) => {
    return normalizedToolName.includes(fragment);
  });
}

function normalizeNote(note?: string): string | undefined {
  const normalized = note?.replace(/\s+/g, " ").trim();
  return normalized && normalized.length > 0 ? normalized : undefined;
}

function describePendingResponseKind(kind?: PendingResponseKind): string {
  if (kind === "critique") {
    return "the critique review";
  }

  if (kind === "revision") {
    return "the revision draft";
  }

  return "the planning response";
}

function buildDefaultContinuePrompt(args: GuidedWorkflowApprovalPromptArgs): string {
  const note = args.note ? ` User note: ${args.note}.` : "";
  return `Continue planning from the current plan.${note}`;
}

function buildDefaultRegeneratePrompt(args: GuidedWorkflowApprovalPromptArgs): string {
  const note = args.note ? ` User note: ${args.note}.` : "";
  return `Regenerate the full plan from scratch.${note}`;
}

function extractDoneStepNumbers(text: string): number[] {
  const steps: number[] = [];
  for (const match of text.matchAll(/\[DONE:(\d+)\]/gi)) {
    const step = Number(match[1]);
    if (Number.isFinite(step)) {
      steps.push(step);
    }
  }
  return steps;
}

function extractSkippedStepNumbers(text: string): number[] {
  const steps: number[] = [];
  for (const match of text.matchAll(/\[SKIPPED:(\d+)\]/gi)) {
    const step = Number(match[1]);
    if (Number.isFinite(step)) {
      steps.push(step);
    }
  }
  return steps;
}
