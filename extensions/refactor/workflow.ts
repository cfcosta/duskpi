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
import { RefactorExecutionManager, type RefactorExecutionRunResult } from "./execution-manager";
import {
  RefactorExecutionScheduler,
  type RefactorExecutionScheduleResult,
} from "./execution-scheduler";
import { buildPrompt, buildWorkerPrompt, type PromptBundle } from "./prompting";
import { RefactorWorkerRunner } from "./worker-runner";
import { JjWorkspaceManager } from "./workspace-manager";

const VERDICT_PATTERN = /(?:^|\n)\s*(?:1\)\s*)?Verdict:\s*(PASS|REFINE|REJECT)\b/i;

function formatExecutionItemText(executionUnit: RefactorExecutionUnit): string {
  return executionUnit.dependsOn.length > 0
    ? `${executionUnit.id}: ${executionUnit.title} (depends on: ${executionUnit.dependsOn.join(", ")})`
    : `${executionUnit.id}: ${executionUnit.title}`;
}

function buildExecutionManagerPrompt(
  result: RefactorExecutionRunResult,
  step: number,
  totalSteps: number,
): string {
  const lines = [
    `Execution manager processed approved refactor unit ${step}/${totalSteps}.`,
    `Unit ID: ${result.unitId}`,
    `Status: ${result.status}`,
    `Summary: ${result.summary}`,
  ];

  if (result.status === "completed") {
    lines.push("Changed files:", ...result.changedFiles.map((file) => `- ${file}`));
  } else {
    lines.push("Blockers:", ...result.blockers.map((blocker) => `- ${blocker}`));
  }

  lines.push(
    "Validations:",
    ...result.validations.map((validation) => {
      const details = validation.details ? ` (${validation.details})` : "";
      return `- ${validation.command}: ${validation.outcome}${details}`;
    }),
    result.status === "completed"
      ? `Respond with an execution_result tagged JSON block for step ${step} using status \"done\".`
      : `Respond with an execution_result tagged JSON block for step ${step} using status \"skipped\" and include the failure summary.`,
  );

  return lines.join("\n");
}

function buildExecutionSchedulerPrompt(
  schedule: RefactorExecutionScheduleResult,
  executionUnits: RefactorExecutionUnit[],
): string {
  const lines = [
    `Execution scheduler processed ${executionUnits.length} approved refactor units.`,
    `Batch status: ${schedule.status}`,
  ];

  const stepByUnitId = new Map(
    executionUnits.map((executionUnit, index) => [executionUnit.id, index + 1]),
  );
  const resultsByUnitId = new Map(
    schedule.layers.flatMap((layer) =>
      layer.results.map((result) => [result.unitId, result] as const),
    ),
  );

  for (const executionUnit of executionUnits) {
    const step = stepByUnitId.get(executionUnit.id) ?? 1;
    const result = resultsByUnitId.get(executionUnit.id);
    if (!result) {
      lines.push(
        `- Step ${step} (${executionUnit.id}): emit execution_result status "skipped" with summary "Not run because dependency-layer execution stopped before this unit."`,
      );
      continue;
    }

    if (result.status === "completed") {
      lines.push(
        `- Step ${step} (${executionUnit.id}): emit execution_result status "done" with summary "${result.summary}"`,
      );
      continue;
    }

    lines.push(
      `- Step ${step} (${executionUnit.id}): emit execution_result status "skipped" with summary "${result.summary}"`,
    );
  }

  if (schedule.remainingUnitIds.length > 0) {
    lines.push(
      "Remaining units were not started:",
      ...schedule.remainingUnitIds.map((unitId) => `- ${unitId}`),
    );
  }

  return lines.join("\n");
}

export class RefactorWorkflow extends GuidedWorkflow {
  private prompts?: PromptBundle;
  private startupError?: Error;
  private repoRoot?: string;
  private latestExecutionRun?: RefactorExecutionRunResult;
  private latestExecutionSchedule?: RefactorExecutionScheduleResult;

  constructor(
    private readonly api: ExtensionAPI,
    private readonly promptProvider: () => PromptLoadResult<PromptBundle>,
    private readonly executionManager?: RefactorExecutionManager,
    private readonly executionScheduler?: RefactorExecutionScheduler,
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
        onApprove: async ({ planText }, ctx) => {
          this.latestExecutionRun = undefined;
          this.latestExecutionSchedule = undefined;
          const parsed = parseTaggedRefactorPlan(planText);
          if (!parsed.ok) {
            return;
          }

          const orderedUnits = orderExecutionUnits(parsed.value);
          if (orderedUnits.length === 1) {
            const executionManager = this.getExecutionManager(ctx.cwd);
            this.latestExecutionRun = await executionManager.executeUnit({
              executionUnit: orderedUnits[0]!,
              approvedPlanSummary: parsed.value.summary,
              step: 1,
              totalSteps: 1,
            });
            return;
          }

          const executionScheduler = this.getExecutionScheduler(ctx.cwd);
          this.latestExecutionSchedule = await executionScheduler.execute({
            executionUnits: orderedUnits,
            approvedPlanSummary: parsed.value.summary,
          });
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

          if (this.latestExecutionSchedule) {
            return buildExecutionSchedulerPrompt(this.latestExecutionSchedule, orderedUnits);
          }

          if (this.latestExecutionRun && this.latestExecutionRun.unitId === executionUnit.id) {
            return buildExecutionManagerPrompt(
              this.latestExecutionRun,
              currentStep.step,
              items.length,
            );
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
    this.repoRoot = ctx.cwd;
    this.latestExecutionRun = undefined;
    this.latestExecutionSchedule = undefined;
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

  private getExecutionManager(repoRootOverride?: string): RefactorExecutionManager {
    if (this.executionManager) {
      return this.executionManager;
    }

    const repoRoot = repoRootOverride ?? this.repoRoot;
    if (!repoRoot) {
      throw new Error("Refactor execution manager requires a repo root.");
    }

    return new RefactorExecutionManager({
      repoRoot,
      workspaceManager: new JjWorkspaceManager({ repoRoot, exec: this.api.exec.bind(this.api) }),
      workerRunner: new RefactorWorkerRunner({ exec: this.api.exec.bind(this.api) }),
      renderWorkerPrompt: (input) =>
        buildWorkerPrompt({ prompts: this.requirePrompts(), ...input }),
      integrate: async ({ workerResult }) => ({
        summary: workerResult.summary,
        changedFiles: workerResult.changedFiles,
      }),
    });
  }

  private getExecutionScheduler(repoRootOverride?: string): RefactorExecutionScheduler {
    if (this.executionScheduler) {
      return this.executionScheduler;
    }

    return new RefactorExecutionScheduler({
      executor: this.getExecutionManager(repoRootOverride),
    });
  }

  private parseCritiqueVerdict(text: string): GuidedCritiqueVerdict | undefined {
    const verdict = text.match(VERDICT_PATTERN)?.[1]?.toUpperCase();
    if (verdict === "PASS" || verdict === "REFINE" || verdict === "REJECT") {
      return verdict;
    }

    return undefined;
  }
}
