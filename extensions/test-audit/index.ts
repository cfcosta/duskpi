import * as path from "node:path";
import { fileURLToPath } from "node:url";
import {
  registerGuidedWorkflowExtension,
  type ExtensionAPI,
} from "../../packages/workflow-core/src/index";
import { loadPrompts } from "./prompting";
import { TestAuditWorkflow } from "./workflow";

export default function testAudit(api: ExtensionAPI): void {
  const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));
  const promptDirectory = path.resolve(moduleDirectory, "prompts");

  registerGuidedWorkflowExtension(api, {
    commandName: "test-audit",
    description: "Run the adversarial test-gap audit and remediation workflow",
    createWorkflow: (extensionApi) => {
      return new TestAuditWorkflow(extensionApi, () => loadPrompts(promptDirectory));
    },
  });
}
