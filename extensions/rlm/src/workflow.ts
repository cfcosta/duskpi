import type {
  AgentEndEvent,
  BeforeAgentStartEvent,
  ExtensionAPI,
  ExtensionContext,
  SessionCompactEvent,
  SessionForkEvent,
  SessionShutdownEvent,
  SessionStartEvent,
  SessionSwitchEvent,
  ToolCallEvent,
  TurnEndEvent,
} from "../../../packages/workflow-core/src/index";
import { resolveRlmRequest } from "./request";

export const RLM_COMMAND_DESCRIPTION =
  "Run the Recursive Language Model workflow scaffold for long documents and notes";

export class RlmWorkflow {
  constructor(private readonly _api: ExtensionAPI) {}

  async handleCommand(args: unknown, ctx: ExtensionContext): Promise<void> {
    const request = await resolveRlmRequest(args);
    if (!request.ok) {
      ctx.ui.notify(request.error.message, "error");
      return;
    }

    const suffix = request.value.question ? ` Question: ${request.value.question}` : "";
    ctx.ui.notify(
      `RLM scaffold is registered for ${request.value.path}.${suffix}`,
      "info",
    );
  }

  handleToolCall(_event: ToolCallEvent, _ctx: ExtensionContext): void {}

  handleAgentEnd(_event: AgentEndEvent, _ctx: ExtensionContext): void {}

  handleBeforeAgentStart(
    _event: BeforeAgentStartEvent,
    _ctx: ExtensionContext,
  ): void | { systemPrompt: string } {}

  handleTurnEnd(_event: TurnEndEvent, _ctx: ExtensionContext): void {}

  handleSessionStart(_event: SessionStartEvent, _ctx: ExtensionContext): void {}

  handleSessionSwitch(_event: SessionSwitchEvent, _ctx: ExtensionContext): void {}

  handleSessionFork(_event: SessionForkEvent, _ctx: ExtensionContext): void {}

  handleSessionCompact(_event: SessionCompactEvent, _ctx: ExtensionContext): void {}

  handleSessionShutdown(_event: SessionShutdownEvent, _ctx: ExtensionContext): void {}
}
