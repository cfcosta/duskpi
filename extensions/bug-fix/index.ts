import * as path from "node:path";
import { fileURLToPath } from "node:url";
import {
  registerGuidedWorkflowExtension,
  type ExtensionAPI,
} from "../../packages/workflow-core/src/index";
import { loadPrompts } from "./prompting";
import { BugFinderWorkflow } from "./workflow";

export default function bugFix(api: ExtensionAPI): void {
  const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));
  const promptDirectory = path.resolve(moduleDirectory, "prompts");

  registerGuidedWorkflowExtension(api, {
    commandName: "bug-fix",
    description: "Run the adversarial bug-finding workflow",
    createWorkflow: (extensionApi) => {
      return new BugFinderWorkflow(extensionApi, () => loadPrompts(promptDirectory));
    },
  });
}
