import * as path from "node:path";
import { fileURLToPath } from "node:url";
import type { ExtensionAPI } from "@anthropic-ai/claude-code";
import { loadPrompts } from "./prompting";
import { TestAuditWorkflow } from "./workflow";

export default function testAudit(api: ExtensionAPI): void {
  const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));
  const promptDirectory = path.resolve(moduleDirectory, "prompts");
  const workflow = new TestAuditWorkflow(api, () => loadPrompts(promptDirectory));

  api.registerCommand("test-audit", {
    description: "Run the adversarial test-gap audit and remediation workflow (4 phases)",
    handler: workflow.handleCommand.bind(workflow),
  });

  api.on("tool_call", workflow.handleToolCall.bind(workflow));
  api.on("agent_end", workflow.handleAgentEnd.bind(workflow));
}
