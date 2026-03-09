import {
  registerPhaseWorkflowExtension,
  type ExtensionAPI,
} from "../../packages/workflow-core/src/index";
import { loadPrompts } from "./prompting";
import { BugFinderWorkflow } from "./workflow";

export default function bugFix(api: ExtensionAPI): void {
  registerPhaseWorkflowExtension(api, {
    moduleUrl: import.meta.url,
    commandName: "bug-fix",
    description: "Run the adversarial bug-finding workflow (4 phases)",
    loadPrompts,
    createWorkflow: (extensionApi, promptProvider) => {
      return new BugFinderWorkflow(extensionApi, promptProvider);
    },
  });
}
