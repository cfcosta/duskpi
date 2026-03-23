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
} from "../../packages/workflow-core/src/index";
import { RlmWorkflow, RLM_COMMAND_DESCRIPTION } from "./src/workflow";

export interface RlmWorkflowController {
  handleCommand(args: unknown, ctx: ExtensionContext): unknown;
  handleToolCall?(event: ToolCallEvent, ctx: ExtensionContext): unknown;
  handleAgentEnd?(event: AgentEndEvent, ctx: ExtensionContext): unknown;
  handleBeforeAgentStart?(event: BeforeAgentStartEvent, ctx: ExtensionContext): unknown;
  handleTurnEnd?(event: TurnEndEvent, ctx: ExtensionContext): unknown;
  handleSessionStart?(event: SessionStartEvent, ctx: ExtensionContext): unknown;
  handleSessionSwitch?(event: SessionSwitchEvent, ctx: ExtensionContext): unknown;
  handleSessionFork?(event: SessionForkEvent, ctx: ExtensionContext): unknown;
  handleSessionCompact?(event: SessionCompactEvent, ctx: ExtensionContext): unknown;
  handleSessionShutdown?(event: SessionShutdownEvent, ctx: ExtensionContext): unknown;
}

export function registerRlmExtension(
  api: ExtensionAPI,
  workflow: RlmWorkflowController = new RlmWorkflow(api),
): RlmWorkflowController {
  api.registerCommand("rlm", {
    description: RLM_COMMAND_DESCRIPTION,
    handler: workflow.handleCommand.bind(workflow),
  });

  api.on("tool_call", (event, ctx) => {
    return workflow.handleToolCall?.(event as ToolCallEvent, ctx);
  });

  api.on("agent_end", (event, ctx) => {
    return workflow.handleAgentEnd?.(event as AgentEndEvent, ctx);
  });

  api.on("before_agent_start", (event, ctx) => {
    return workflow.handleBeforeAgentStart?.(event as BeforeAgentStartEvent, ctx);
  });

  api.on("turn_end", (event, ctx) => {
    return workflow.handleTurnEnd?.(event as TurnEndEvent, ctx);
  });

  api.on("session_start", (event, ctx) => {
    return workflow.handleSessionStart?.(event as SessionStartEvent, ctx);
  });

  api.on("session_switch", (event, ctx) => {
    return workflow.handleSessionSwitch?.(event as SessionSwitchEvent, ctx);
  });

  api.on("session_fork", (event, ctx) => {
    return workflow.handleSessionFork?.(event as SessionForkEvent, ctx);
  });

  api.on("session_compact", (event, ctx) => {
    return workflow.handleSessionCompact?.(event as SessionCompactEvent, ctx);
  });

  api.on("session_shutdown", (event, ctx) => {
    return workflow.handleSessionShutdown?.(event as SessionShutdownEvent, ctx);
  });

  return workflow;
}

export default function rlmExtension(api: ExtensionAPI): void {
  registerRlmExtension(api);
}
