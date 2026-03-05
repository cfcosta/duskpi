import type { ExtensionAPI } from "@anthropic-ai/claude-code";
import { PhaseWorkflow, type PromptSnapshot } from "../../packages/workflow-core/src/index";
import { parseScopeArg } from "./messages";
import { buildPrompt, type PromptBundle, type PromptLoadResult } from "./prompting";

const ANALYSIS_PHASES = ["finder", "skeptic", "arbiter"] as const;
const EXECUTION_PHASE = "fixer" as const;

const PHASE_LABELS: Record<(typeof ANALYSIS_PHASES)[number] | typeof EXECUTION_PHASE, string> = {
  finder: "Finding test gaps...",
  skeptic: "Reviewing test gap claims...",
  arbiter: "Arbitrating test priorities...",
  fixer: "Implementing test improvements...",
};

export class TestAuditWorkflow extends PhaseWorkflow<PromptBundle> {
  constructor(api: ExtensionAPI, promptProvider: () => PromptLoadResult) {
    super(api, {
      id: "test-audit",
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
          `Test audit is unavailable: ${error?.message ?? "prompt initialization failed."}`,
        alreadyRunning: "Test audit is already running. Finish or cancel the current run first.",
        analysisWriteBlocked: "Test audit analysis phase: writes are disabled",
        complete: "Test audit workflow complete!",
        cancelled: "Test audit cancelled.",
        selectTitle: "Test Audit - Analysis Complete",
        executeOption: "Execute fixes (test-driven workflow)",
        refineOption: "Refine the analysis",
        cancelOption: "Cancel",
        refineEditorLabel: "Refine test-gap analysis:",
        sendFailed: (phase) => `Test audit stopped: failed to send prompt for phase '${phase}'.`,
        missingOutputRetry: (phase, retry, maxRetries) =>
          `No assistant output captured for phase '${phase}'. Retrying (${retry}/${maxRetries}).`,
        missingOutputStopped: (attempts) =>
          `Test audit stopped: no assistant output captured after ${attempts} attempts.`,
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
