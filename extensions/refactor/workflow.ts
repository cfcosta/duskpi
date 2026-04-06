import {
  GuidedWorkflow,
  isSafeReadOnlyCommand,
  parseTrimmedStringArg as parseScopeArg,
  type ExtensionAPI,
  type GuidedCritiqueVerdict,
  type GuidedWorkflowResult,
  type PromptLoadResult,
} from "../../packages/workflow-core/src/index";
import {
  orderExecutionUnits,
  parseTaggedRefactorPlan,
  type RefactorExecutionUnit,
} from "./contract";
import { buildPrompt, type PromptBundle } from "./prompting";

const VERDICT_PATTERN = /(?:^|\n)\s*(?:1\)\s*)?Verdict:\s*(PASS|REFINE|REJECT)\b/i;

function formatExecutionItemText(executionUnit: RefactorExecutionUnit): string {
  return executionUnit.dependsOn.length > 0
    ? `${executionUnit.id}: ${executionUnit.title} (depends on: ${executionUnit.dependsOn.join(", ")})`
    : `${executionUnit.id}: ${executionUnit.title}`;
}

export class RefactorWorkflow extends GuidedWorkflow {
  private prompts?: PromptBundle;
  private startupError?: Error;

  constructor(
    api: ExtensionAPI,
    private readonly promptProvider: () => PromptLoadResult<PromptBundle>,
  ) {
    super(api, {
      id: "refactor",
      parseGoalArg: parseScopeArg,
      buildPlanningPrompt: ({ goal }) => {
        return buildPrompt({
          phase: "mapper",
          prompts: this.requirePrompts(),
          reports: {},
          scope: goal,
        });
      },
      critique: {
        buildCritiquePrompt: ({ planText }) => {
          return [
            buildPrompt({
              phase: "skeptic",
              prompts: this.requirePrompts(),
              reports: { mapper: planText },
            }),
            "Return your response with a leading line exactly in the form `1) Verdict: PASS`, `1) Verdict: REFINE`, or `1) Verdict: REJECT`.",
          ].join("\n\n");
        },
        buildRevisionPrompt: ({ planText, critiqueText, verdict }) => {
          const verdictInstruction =
            verdict === "REJECT"
              ? "Return the safest possible revised plan only if you can justify it clearly; otherwise minimize the approved execution surface."
              : "Address the skeptic's concerns and return a fully revised refactor plan.";

          return [
            buildPrompt({
              phase: "arbiter",
              prompts: this.requirePrompts(),
              reports: {
                mapper: planText,
                skeptic: critiqueText,
              },
            }),
            verdictInstruction,
          ].join("\n\n");
        },
        parseCritiqueVerdict: (text) => this.parseCritiqueVerdict(text),
      },
      approval: {
        selectAction: async (_args, ctx) => {
          const selection = await ctx.ui.select("Refactor - Plan Ready", [
            "Approve refactor plan",
            "Continue planning",
            "Regenerate plan",
            "Cancel",
          ]);

          if (selection === "Approve refactor plan") {
            return { action: "approve" };
          }

          if (selection === "Continue planning") {
            const note = (await ctx.ui.editor("Continue planning note:", ""))?.trim();
            return note ? { action: "continue", note } : { cancelled: true };
          }

          if (selection === "Regenerate plan") {
            return { action: "regenerate" };
          }

          if (selection === "Cancel") {
            return { action: "exit" };
          }

          return { cancelled: true };
        },
      },
      execution: {
        extractItems: ({ planText }) => {
          const parsed = parseTaggedRefactorPlan(planText);
          if (!parsed.ok) {
            return [];
          }

          return orderExecutionUnits(parsed.value).map((executionUnit, index) => ({
            step: index + 1,
            text: formatExecutionItemText(executionUnit),
          }));
        },
        buildExecutionPrompt: ({ planText, currentStep, items }) => {
          const parsed = parseTaggedRefactorPlan(planText);
          if (!parsed.ok) {
            return "Approved refactor plan could not be parsed into execution units.";
          }

          const orderedUnits = orderExecutionUnits(parsed.value);
          const executionUnit = orderedUnits[currentStep.step - 1];
          if (!executionUnit) {
            return `Execute approved refactor step ${currentStep.step}: ${currentStep.text}`;
          }

          return [
            `Execute approved refactor unit ${currentStep.step}/${items.length}.`,
            `Unit ID: ${executionUnit.id}`,
            `Title: ${executionUnit.title}`,
            `Objective: ${executionUnit.objective}`,
            executionUnit.dependsOn.length > 0
              ? `Dependencies: ${executionUnit.dependsOn.join(", ")}`
              : "Dependencies: none",
            "Targets:",
            ...executionUnit.targets.map((target) => `- ${target}`),
            "Validations:",
            ...executionUnit.validations.map((validation) => `- ${validation}`),
          ].join("\n");
        },
      },
      planningPolicy: {
        isSafeReadOnlyCommand,
        writeBlockedReason: "Refactor analysis phase: writes are disabled",
        bashBlockedReason: (command) =>
          `Guided workflow planning phase blocked a potentially mutating bash command: ${command}`,
      },
      text: {
        alreadyRunning: "Refactor is already running. Finish or cancel the current run first.",
        sendFailed: "Refactor stopped: failed to send planning prompt.",
      },
      maxMissingOutputRetries: 2,
    });
  }

  async handleCommand(
    args: unknown,
    ctx: Parameters<GuidedWorkflow["handleCommand"]>[1],
  ): Promise<GuidedWorkflowResult> {
    this.reloadPrompts();

    if (!this.prompts) {
      ctx.ui.notify(
        `Refactor is unavailable: ${this.startupError?.message ?? "prompt initialization failed."}`,
        "error",
      );
      return { kind: "blocked", reason: "prompts_unavailable" };
    }

    return super.handleCommand(args, ctx);
  }

  private reloadPrompts(): void {
    const result = this.promptProvider();
    if (result.ok) {
      this.prompts = result.prompts;
      this.startupError = undefined;
      return;
    }

    this.prompts = undefined;
    this.startupError = result.error;
  }

  private requirePrompts(): PromptBundle {
    if (!this.prompts) {
      throw this.startupError ?? new Error("prompt initialization failed");
    }

    return this.prompts;
  }

  private parseCritiqueVerdict(text: string): GuidedCritiqueVerdict | undefined {
    const verdict = text.match(VERDICT_PATTERN)?.[1]?.toUpperCase();
    if (verdict === "PASS" || verdict === "REFINE" || verdict === "REJECT") {
      return verdict;
    }

    return undefined;
  }
}
