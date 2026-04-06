import * as path from "node:path";
import { fileURLToPath } from "node:url";
import {
  registerGuidedWorkflowExtension,
  type ExtensionAPI,
} from "../../packages/workflow-core/src/index";
import { loadPrompts } from "./prompting";
import { RefactorWorkflow } from "./workflow";

export default function refactor(api: ExtensionAPI): void {
  const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));
  const promptDirectory = path.resolve(moduleDirectory, "prompts");

  registerGuidedWorkflowExtension(api, {
    commandName: "refactor",
    description: "Run the refactoring workflow",
    createWorkflow: (extensionApi) => {
      return new RefactorWorkflow(extensionApi, () => loadPrompts(promptDirectory));
    },
  });
}
