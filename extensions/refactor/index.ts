import {
  registerPhaseWorkflowExtension,
  type ExtensionAPI,
} from "../../packages/workflow-core/src/index";
import { loadPrompts } from "./prompting";
import { RefactorWorkflow } from "./workflow";

export default function refactor(api: ExtensionAPI): void {
  registerPhaseWorkflowExtension(api, {
    moduleUrl: import.meta.url,
    commandName: "refactor",
    description: "Run the refactoring workflow (4 phases)",
    loadPrompts,
    createWorkflow: (extensionApi, promptProvider) => {
      return new RefactorWorkflow(extensionApi, promptProvider);
    },
  });
}
