import {
  registerPhaseWorkflowExtension,
  type ExtensionAPI,
} from "../../packages/workflow-core/src/index";
import { loadPrompts } from "./prompting";
import { TestAuditWorkflow } from "./workflow";

export default function testAudit(api: ExtensionAPI): void {
  registerPhaseWorkflowExtension(api, {
    moduleUrl: import.meta.url,
    commandName: "test-audit",
    description: "Run the adversarial test-gap audit and remediation workflow (4 phases)",
    loadPrompts,
    createWorkflow: (extensionApi, promptProvider) => {
      return new TestAuditWorkflow(extensionApi, promptProvider);
    },
  });
}
