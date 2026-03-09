import {
  registerGuidedWorkflowExtension,
  type ExtensionAPI,
} from "../../../packages/workflow-core/src/index";
import {
  PLAN_COMMAND_DESCRIPTION,
  PiPlanWorkflow,
  TODOS_COMMAND_DESCRIPTION,
} from "./workflow";

export default function planExtension(api: ExtensionAPI): void {
  const workflow = new PiPlanWorkflow(api);

  registerGuidedWorkflowExtension(api, {
    commandName: "plan",
    description: PLAN_COMMAND_DESCRIPTION,
    createWorkflow: () => workflow,
  });

  api.registerCommand("todos", {
    description: TODOS_COMMAND_DESCRIPTION,
    handler: workflow.handleTodosCommand.bind(workflow),
  });
}
