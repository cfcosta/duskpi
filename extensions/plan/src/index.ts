import {
  registerGuidedWorkflowExtension,
  type ExtensionAPI,
} from "../../../packages/workflow-core/src/index";
import { registerAskUserQuestionTool } from "./ask-user-question-tool";
import {
  AUTOPLAN_COMMAND_DESCRIPTION,
  PLAN_COMMAND_DESCRIPTION,
  PiPlanWorkflow,
  TODOS_COMMAND_DESCRIPTION,
} from "./workflow";

export default function planExtension(api: ExtensionAPI): void {
  registerAskUserQuestionTool(api);

  const workflow = new PiPlanWorkflow(api);

  registerGuidedWorkflowExtension(api, {
    commandName: "plan",
    description: PLAN_COMMAND_DESCRIPTION,
    createWorkflow: () => workflow,
  });

  api.registerCommand("autoplan", {
    description: AUTOPLAN_COMMAND_DESCRIPTION,
    handler: workflow.handleAutoPlanCommand.bind(workflow),
  });

  api.registerCommand("todos", {
    description: TODOS_COMMAND_DESCRIPTION,
    handler: workflow.handleTodosCommand.bind(workflow),
  });
}
