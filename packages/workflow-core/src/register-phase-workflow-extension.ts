import * as path from "node:path";
import { fileURLToPath } from "node:url";
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
import type { PromptLoadResult } from "./prompt-loader";

export interface PhaseWorkflowController {
  handleCommand(args: unknown, ctx: ExtensionContext): unknown;
  handleToolCall(event: ToolCallEvent): unknown;
  handleAgentEnd(event: { messages?: unknown[] }, ctx: ExtensionContext): unknown;
  handleSessionStart?(event: SessionStartEvent, ctx: ExtensionContext): unknown;
  handleSessionSwitch?(event: SessionSwitchEvent, ctx: ExtensionContext): unknown;
  handleSessionFork?(event: SessionForkEvent, ctx: ExtensionContext): unknown;
  handleSessionCompact?(event: SessionCompactEvent, ctx: ExtensionContext): unknown;
  handleSessionShutdown?(event: SessionShutdownEvent, ctx: ExtensionContext): unknown;
}

export interface RegisterPhaseWorkflowExtensionOptions<Prompts> {
  moduleUrl: string;
  commandName: string;
  description: string;
  loadPrompts: (promptDirectory: string) => PromptLoadResult<Prompts>;
  createWorkflow: (
    api: ExtensionAPI,
    promptProvider: () => PromptLoadResult<Prompts>,
  ) => PhaseWorkflowController;
  promptSubdirectory?: string;
}

export function registerPhaseWorkflowExtension<Prompts>(
  api: ExtensionAPI,
  options: RegisterPhaseWorkflowExtensionOptions<Prompts>,
): PhaseWorkflowController {
  const moduleDirectory = path.dirname(fileURLToPath(options.moduleUrl));
  const promptDirectory = path.resolve(moduleDirectory, options.promptSubdirectory ?? "prompts");
  const promptProvider = () => options.loadPrompts(promptDirectory);
  const workflow = options.createWorkflow(api, promptProvider);

  api.registerCommand(options.commandName, {
    description: options.description,
    handler: workflow.handleCommand.bind(workflow),
  });

  api.on("tool_call", (event) => {
    return workflow.handleToolCall(event as ToolCallEvent);
  });

  api.on("agent_end", (event, ctx) => {
    if (!ctx) {
      return;
    }

    return workflow.handleAgentEnd(event as { messages?: unknown[] }, ctx);
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
