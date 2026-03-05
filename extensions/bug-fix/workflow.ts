import type { ExtensionAPI } from "@anthropic-ai/claude-code";
import { PhaseWorkflow, type PromptSnapshot } from "../../packages/workflow-core/src/index";
import { parseScopeArg } from "./messages";
import { buildPrompt, type PromptBundle, type PromptLoadResult } from "./prompting";

const ANALYSIS_PHASES = ["finder", "skeptic", "arbiter"] as const;
const EXECUTION_PHASE = "fixer" as const;

const PHASE_LABELS: Record<(typeof ANALYSIS_PHASES)[number] | typeof EXECUTION_PHASE, string> = {
  finder: "Finding bugs...",
  skeptic: "Reviewing bugs...",
  arbiter: "Arbitrating...",
  fixer: "Fixing bugs...",
};

export class BugFinderWorkflow extends PhaseWorkflow<PromptBundle> {
  constructor(api: ExtensionAPI, promptProvider: () => PromptLoadResult) {
    super(api, {
      id: "bug-fix",
      analysisPhases: ANALYSIS_PHASES,
      executionPhase: EXECUTION_PHASE,
      phaseLabels: PHASE_LABELS,
      promptProvider: () => mapPromptResult(promptProvider()),
      parseScopeArg,
      buildPrompt: ({ phase, prompts, reports, scope, refinement }) =>
        buildPrompt({
          phase: phase as (typeof ANALYSIS_PHASES)[number] | typeof EXECUTION_PHASE,
          prompts,
          reports: {
            finder: reports.finder,
            skeptic: reports.skeptic,
            arbiter: reports.arbiter,
          },
          scope,
          refinement,
        }),
      text: {
        unavailable: (error) =>
          `Bug fix is unavailable: ${error?.message ?? "prompt initialization failed."}`,
        alreadyRunning: "Bug fix is already running. Finish or cancel the current run first.",
        analysisWriteBlocked: "Bug fix analysis phase: writes are disabled",
        complete: "Bug fix workflow complete!",
        cancelled: "Bug fix cancelled.",
        selectTitle: "Bug Finder - Analysis Complete",
        executeOption: "Execute fixes (TDD workflow)",
        refineOption: "Refine the analysis",
        cancelOption: "Cancel",
        refineEditorLabel: "Refine analysis:",
        sendFailed: (phase) => `Bug fix stopped: failed to send prompt for phase '${phase}'.`,
        missingOutputRetry: (phase, retry, maxRetries) =>
          `No assistant output captured for phase '${phase}'. Retrying (${retry}/${maxRetries}).`,
        missingOutputStopped: (attempts) =>
          `Bug fix stopped: no assistant output captured after ${attempts} attempts.`,
      },
      maxEmptyOutputRetries: 2,
      maxRefinementAttempts: 3,
    });
  }
}

function mapPromptResult(result: PromptLoadResult): PromptSnapshot<PromptBundle> {
  if (result.ok) {
    return { prompts: result.prompts };
  }

  return { error: result.error };
}
