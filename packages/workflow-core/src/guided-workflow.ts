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
import { extractLastUserText, getLastAssistantTextResult } from "./message-content";
import type { GuidedWorkflowController } from "./register-guided-workflow-extension";

type GuidedWorkflowResultKind = "ok" | "blocked" | "recoverable_error";

export interface GuidedWorkflowResult {
  kind: GuidedWorkflowResultKind;
  reason?: string;
}

export type GuidedWorkflowPhase = "idle" | "planning" | "approval" | "executing";

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

export interface GuidedWorkflowOptions {
  id: string;
  parseGoalArg?: (args: unknown) => string | undefined;
  buildPlanningPrompt?: (args: { goal?: string }) => string;
  text: GuidedWorkflowText;
}

export class GuidedWorkflow implements GuidedWorkflowController {
  private state: GuidedWorkflowState = this.createIdleState();
  private requestSequence = 0;

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
    try {
      this.api.sendUserMessage(promptWithRequestId);
      return { kind: "ok" };
    } catch {
      this.state = this.createIdleState();
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
    _ctx: ExtensionContext,
  ): Promise<GuidedWorkflowResult> {
    if (this.state.phase === "idle") {
      return { kind: "blocked", reason: "inactive" };
    }

    if (!this.state.awaitingResponse) {
      return { kind: "blocked", reason: "stale_agent_end" };
    }

    const eventMessages = event.messages ?? [];
    const lastUserText = extractLastUserText(eventMessages);
    const observedRequestId = lastUserText ? extractRequestId(lastUserText) : undefined;
    if (!this.state.pendingRequestId || observedRequestId !== this.state.pendingRequestId) {
      return { kind: "blocked", reason: "unmatched_agent_end" };
    }

    const assistantResult = getLastAssistantTextResult(eventMessages);
    if (assistantResult.kind !== "ok") {
      return { kind: "blocked", reason: "missing_assistant_output" };
    }

    this.state = {
      ...this.state,
      phase: "approval",
      pendingRequestId: undefined,
      awaitingResponse: false,
    };
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
