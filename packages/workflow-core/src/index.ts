export {
  extractLastAssistantText,
  extractLastRoleText,
  extractLastUserText,
  getLastAssistantTextResult,
  parseTrimmedStringArg,
} from "./message-content";
export type { LastAssistantTextResult } from "./message-content";
export type {
  AgentEndEvent,
  BeforeAgentStartEvent,
  BeforeAgentStartResult,
  ExtensionAPI,
  ExtensionContext,
  ExtensionCustomMessage,
  ExtensionEventMap,
  ExtensionTheme,
  ExtensionUI,
  ExtensionUICustomFactory,
  ExtensionUICustomOptions,
  ExtensionUIDialogOptions,
  ExtensionWidgetFactory,
  ExtensionWidgetOptions,
  SendMessageOptions,
  SendUserMessageOptions,
  SessionShutdownEvent,
  SessionStartEvent,
  ThemeActivationResult,
  ToolCallEvent,
  ToolInfo,
  TurnEndEvent,
} from "./extension-api";
export { PromptLoadError, loadPromptFiles } from "./prompt-loader";
export type { PromptLoadResult } from "./prompt-loader";
export { GuidedWorkflow } from "./guided-workflow";
export type {
  GuidedCritiqueVerdict,
  GuidedWorkflowApprovalAction,
  GuidedWorkflowApprovalOptions,
  GuidedWorkflowApprovalPromptArgs,
  GuidedWorkflowApprovalSelection,
  GuidedWorkflowCritiqueOptions,
  GuidedWorkflowExecutionItem,
  GuidedWorkflowExecutionOptions,
  GuidedWorkflowExecutionPromptArgs,
  GuidedWorkflowExecutionSnapshot,
  GuidedWorkflowOptions,
  GuidedWorkflowPhase,
  GuidedWorkflowPlanningPolicy,
  GuidedWorkflowResult,
  GuidedWorkflowState,
} from "./guided-workflow";
export { PhaseWorkflow } from "./phase-workflow";
export type {
  PhaseWorkflowOptions,
  PromptProviderResult,
  PromptSnapshot,
  WorkflowResult,
} from "./phase-workflow";
export { registerGuidedWorkflowExtension } from "./register-guided-workflow-extension";
export type {
  GuidedWorkflowController,
  RegisterGuidedWorkflowExtensionOptions,
} from "./register-guided-workflow-extension";
export { registerPhaseWorkflowExtension } from "./register-phase-workflow-extension";
export type {
  PhaseWorkflowController,
  RegisterPhaseWorkflowExtensionOptions,
} from "./register-phase-workflow-extension";
