export {
  extractLastAssistantText,
  extractLastRoleText,
  extractLastUserText,
  getLastAssistantTextResult,
  parseTrimmedStringArg,
} from "./message-content";
export type { LastAssistantTextResult } from "./message-content";
export type {
  ExtensionAPI,
  ExtensionContext,
  ExtensionUI,
  ThemeActivationResult,
} from "./extension-api";
export { PromptLoadError, loadPromptFiles } from "./prompt-loader";
export type { PromptLoadResult } from "./prompt-loader";
export { PhaseWorkflow } from "./phase-workflow";
export type {
  PhaseWorkflowOptions,
  PromptProviderResult,
  PromptSnapshot,
  WorkflowResult,
} from "./phase-workflow";
export { registerPhaseWorkflowExtension } from "./register-phase-workflow-extension";
export type {
  PhaseWorkflowController,
  RegisterPhaseWorkflowExtensionOptions,
} from "./register-phase-workflow-extension";
