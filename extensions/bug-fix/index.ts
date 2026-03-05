import * as path from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI } from "@anthropic-ai/claude-code";
import { loadPrompts } from "./prompting";
import { BugFinderWorkflow } from "./workflow";

export default function bugFix(api: ExtensionAPI): void {
  const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));
  const promptDirectory = path.resolve(moduleDirectory, "prompts");
  const workflow = new BugFinderWorkflow(api, () => loadPrompts(promptDirectory));

  api.registerCommand("bug-fix", {
    description: "Run the adversarial bug-finding workflow (4 phases)",
    handler: workflow.handleCommand.bind(workflow),
  });

  api.on("tool_call", workflow.handleToolCall.bind(workflow));
  api.on("agent_end", workflow.handleAgentEnd.bind(workflow));
}
