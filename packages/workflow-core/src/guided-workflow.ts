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

export interface GuidedWorkflowOptions {
  id: string;
  parseGoalArg?: (args: unknown) => string | undefined;
  buildPlanningPrompt?: (args: { goal?: string }) => string;
  critique?: GuidedWorkflowCritiqueOptions;
  text: GuidedWorkflowText;
}

export class GuidedWorkflow implements GuidedWorkflowController {
  private state: GuidedWorkflowState = this.createIdleState();
  private requestSequence = 0;
  private pendingResponseKind?: PendingResponseKind;
  private latestPlanText?: string;

  constructor(
    private readonly api: ExtensionAPI,
    private readonly options: GuidedWorkflowOptions,
  ) {}

  getStateSnapshot(): GuidedWorkflowState {
    return { ...this.state };
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
    this.pendingResponseKind = "planning";

    try {
      this.api.sendUserMessage(promptWithRequestId);
      return { kind: "ok" };
    } catch {
      this.state = this.createIdleState();
      this.pendingResponseKind = undefined;
      ctx.ui.notify(
        this.options.text.sendFailed ?? "Guided workflow stopped: failed to send planning prompt.",
        "error",
      );
      return { kind: "recoverable_error", reason: "prompt_send_failed" };
    }
  }

  async handleToolCall(_event: ToolCallEvent, _ctx: ExtensionContext): Promise<void> {
    return undefined;
  }

  async handleAgentEnd(
    event: AgentEndEvent,
    ctx: ExtensionContext,
  ): Promise<GuidedWorkflowResult> {
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
      return { kind: "blocked", reason: "missing_assistant_output" };
    }

    if (this.pendingResponseKind === "critique") {
      return this.handleCritiqueResponse(assistantResult.text, ctx);
    }

    if (this.pendingResponseKind === "revision") {
      this.latestPlanText = assistantResult.text;
      return this.sendCritiquePrompt(assistantResult.text, ctx);
    }

    this.latestPlanText = assistantResult.text;
    if (this.options.critique) {
      return this.sendCritiquePrompt(assistantResult.text, ctx);
    }

    this.markApprovalReady();
    return { kind: "ok" };
  }

  handleBeforeAgentStart(_event: BeforeAgentStartEvent, _ctx: ExtensionContext): void {
    return undefined;
  }

  async handleTurnEnd(_event: TurnEndEvent, _ctx: ExtensionContext): Promise<void> {
    return undefined;
  }

  async handleSessionStart(_event: SessionStartEvent, _ctx: ExtensionContext): Promise<void> {
    return undefined;
  }

  async handleSessionShutdown(
    _event: SessionShutdownEvent,
    _ctx: ExtensionContext,
  ): Promise<void> {
    return undefined;
  }

  private handleCritiqueResponse(
    critiqueText: string,
    ctx: ExtensionContext,
  ): GuidedWorkflowResult {
    const verdict = this.options.critique?.parseCritiqueVerdict(critiqueText) ?? "REJECT";
    if (verdict === "PASS") {
      this.markApprovalReady();
      return { kind: "ok" };
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

  private sendHiddenFollowUp(
    prompt: string,
    nextResponseKind: PendingResponseKind,
    ctx: ExtensionContext,
  ): GuidedWorkflowResult {
    const requestId = this.nextRequestId();
    const promptWithRequestId = `${prompt}\n\n${requestIdMarker(requestId)}`;

    try {
      this.api.sendMessage(
        {
          customType: this.options.critique?.customMessageType ?? `${this.options.id}-internal`,
          content: promptWithRequestId,
          display: false,
        },
        {
          triggerTurn: true,
          deliverAs: "followUp",
        },
      );
    } catch {
      this.state = this.createIdleState();
      this.pendingResponseKind = undefined;
      this.latestPlanText = undefined;
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
  const typedMessages = messages.filter((message): message is { role?: unknown; content?: unknown } => {
    return typeof message === "object" && message !== null;
  });

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
