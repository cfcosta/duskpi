import type { ExtensionAPI } from "@anthropic-ai/claude-code";
import { PhaseWorkflow, type PromptSnapshot } from "../../packages/workflow-core/src/index";
import { parseScopeArg } from "./messages";
import { buildPrompt, type PromptBundle, type PromptLoadResult } from "./prompting";

const ANALYSIS_PHASES = ["finder", "skeptic", "arbiter"] as const;
const EXECUTION_PHASE = "fixer" as const;

const PHASE_LABELS: Record<(typeof ANALYSIS_PHASES)[number] | typeof EXECUTION_PHASE, string> = {
  finder: "Finding security issues...",
  skeptic: "Reviewing security claims...",
  arbiter: "Arbitrating security findings...",
  fixer: "Implementing security fixes...",
};

export class OwaspWorkflow extends PhaseWorkflow<PromptBundle> {
  constructor(api: ExtensionAPI, promptProvider: () => PromptLoadResult) {
    super(api, {
      id: "owasp-fix",
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
          `OWASP fix is unavailable: ${error?.message ?? "prompt initialization failed."}`,
        alreadyRunning: "OWASP fix is already running. Finish or cancel the current run first.",
        analysisWriteBlocked: "OWASP analysis phase: writes are disabled",
        complete: "OWASP workflow complete!",
        cancelled: "OWASP fix cancelled.",
        selectTitle: "OWASP Review - Analysis Complete",
        executeOption: "Execute fixes (secure TDD workflow)",
        refineOption: "Refine the analysis",
        cancelOption: "Cancel",
        refineEditorLabel: "Refine security analysis:",
        sendFailed: (phase) => `OWASP fix stopped: failed to send prompt for phase '${phase}'.`,
        missingOutputRetry: (phase, retry, maxRetries) =>
          `No assistant output captured for phase '${phase}'. Retrying (${retry}/${maxRetries}).`,
        missingOutputStopped: (attempts) =>
          `OWASP fix stopped: no assistant output captured after ${attempts} attempts.`,
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
