import {
  registerPhaseWorkflowExtension,
  type ExtensionAPI,
} from "../../packages/workflow-core/src/index";
import { loadPrompts } from "./prompting";
import { OwaspWorkflow } from "./workflow";

export default function owaspFix(api: ExtensionAPI): void {
  registerPhaseWorkflowExtension(api, {
    moduleUrl: import.meta.url,
    commandName: "owasp-fix",
    description: "Run the OWASP Top 10 adversarial security remediation workflow (4 phases)",
    loadPrompts,
    createWorkflow: (extensionApi, promptProvider) => {
      return new OwaspWorkflow(extensionApi, promptProvider);
    },
  });
}
