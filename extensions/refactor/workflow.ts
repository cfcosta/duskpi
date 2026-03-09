import {
  PhaseWorkflow,
  type ExtensionAPI,
  type PromptLoadResult,
} from "../../packages/workflow-core/src/index";
import { parseScopeArg } from "./messages";
import { buildPrompt, type PromptBundle } from "./prompting";

const ANALYSIS_PHASES = ["mapper", "skeptic", "arbiter"] as const;
const EXECUTION_PHASE = "executor" as const;

const PHASE_LABELS: Record<(typeof ANALYSIS_PHASES)[number] | typeof EXECUTION_PHASE, string> = {
  mapper: "Mapping refactor candidates...",
  skeptic: "Reviewing refactors...",
  arbiter: "Arbitrating refactor plan...",
  executor: "Executing refactors...",
};

export class RefactorWorkflow extends PhaseWorkflow<PromptBundle> {
  constructor(api: ExtensionAPI, promptProvider: () => PromptLoadResult<PromptBundle>) {
    super(api, {
      id: "refactor",
      analysisPhases: ANALYSIS_PHASES,
      executionPhase: EXECUTION_PHASE,
      phaseLabels: PHASE_LABELS,
      promptProvider,
      parseScopeArg,
      buildPrompt: ({ phase, prompts, reports, scope, refinement }) =>
        buildPrompt({
          phase: phase as (typeof ANALYSIS_PHASES)[number] | typeof EXECUTION_PHASE,
          prompts,
          reports: {
            mapper: reports.mapper,
            skeptic: reports.skeptic,
            arbiter: reports.arbiter,
          },
          scope,
          refinement,
        }),
      text: {
        unavailable: (error) =>
          `Refactor is unavailable: ${error?.message ?? "prompt initialization failed."}`,
        alreadyRunning: "Refactor is already running. Finish or cancel the current run first.",
        analysisWriteBlocked: "Refactor analysis phase: writes are disabled",
        complete: "Refactor workflow complete!",
        cancelled: "Refactor cancelled.",
        selectTitle: "Refactor - Analysis Complete",
        executeOption: "Execute refactors (test-backed workflow)",
        refineOption: "Refine the analysis",
        cancelOption: "Cancel",
        refineEditorLabel: "Refine analysis:",
        sendFailed: (phase) => `Refactor stopped: failed to send prompt for phase '${phase}'.`,
        missingOutputRetry: (phase, retry, maxRetries) =>
          `No assistant output captured for phase '${phase}'. Retrying (${retry}/${maxRetries}).`,
        missingOutputStopped: (attempts) =>
          `Refactor stopped: no assistant output captured after ${attempts} attempts.`,
      },
      maxEmptyOutputRetries: 2,
      maxRefinementAttempts: 3,
    });
  }
}
