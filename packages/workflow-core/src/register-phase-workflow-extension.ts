import * as path from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI, ExtensionContext } from "./extension-api";
import type { PromptLoadResult } from "./prompt-loader";

export interface PhaseWorkflowController {
  handleCommand(args: unknown, ctx: ExtensionContext): unknown;
  handleToolCall(event: { toolName?: string }): unknown;
  handleAgentEnd(event: { messages?: unknown[] }, ctx: ExtensionContext): unknown;
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
    return workflow.handleToolCall(event as { toolName?: string });
  });

  api.on("agent_end", (event, ctx) => {
    if (!ctx) {
      return;
    }

    return workflow.handleAgentEnd(event as { messages?: unknown[] }, ctx);
  });

  return workflow;
}
