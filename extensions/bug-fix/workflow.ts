import {
  ExecutionManager,
  ExecutionScheduler,
  GuidedExecutionWorkflow,
  JjWorkspaceManager,
  WorkerRunner,
  isSafeReadOnlyCommand,
  parseTrimmedStringArg as parseScopeArg,
  type ExecutePlanInput,
  type ExecuteUnitInput,
  type ExecutionRunResult,
  type ExecutionScheduleResult,
  type ExtensionAPI,
  type ExtensionContext,
  type GuidedWorkflowResult,
  type PromptLoadResult,
} from "../../packages/workflow-core/src/index";
import {
  orderExecutionUnits,
  parseTaggedBugFixPlan,
  type BugFixExecutionUnit,
} from "./contract";
import { buildPrompt, type PromptBundle } from "./prompting";
import {
  parseTaggedWorkerResult,
  type BugFixWorkerResult,
  type BugFixWorkerValidation,
} from "./worker-result";

export type BugFixExecutionRunResult = ExecutionRunResult<BugFixWorkerValidation>;

export interface BugFixExecutionManagerLike {
  executeUnit(input: ExecuteUnitInput<BugFixExecutionUnit>): Promise<BugFixExecutionRunResult>;
}

export interface BugFixExecutionSchedulerLike {
  execute(
    input: ExecutePlanInput<BugFixExecutionUnit>,
  ): Promise<ExecutionScheduleResult<BugFixWorkerValidation>>;
}

function formatExecutionItemText(executionUnit: BugFixExecutionUnit): string {
  return executionUnit.dependsOn.length > 0
    ? `${executionUnit.id}: ${executionUnit.title} (depends on: ${executionUnit.dependsOn.join(", ")})`
    : `${executionUnit.id}: ${executionUnit.title}`;
}

function buildPlanningPrompt(prompts: PromptBundle, goal?: string): string {
  return [
    buildPrompt({ phase: "finder", prompts, reports: {}, scope: goal }),
    "## Guided Planning Mode",
    "Work through the bug-fix workflow internally before you answer.",
    "1. Run the finder pass against the requested scope.",
    "2. Challenge your own candidate bugs with the skeptic instructions below.",
    "3. Produce the final arbiter output only, including the structured contract when real bugs are approved.",
    "## Skeptic Instructions (run internally)",
    prompts.skeptic,
    buildPrompt({
      phase: "arbiter",
      prompts,
      reports: {
        finder: "Use the findings from your internal finder pass for this request.",
        skeptic: "Use the findings from your internal skeptic pass for this request.",
      },
    }),
    "Return only the final arbiter report for this request. If you confirm real bugs, include the required tagged JSON block named `bug-fix-plan-json`.",
  ].join("\n\n");
}

function buildRefinementPrompt(prompts: PromptBundle, planText: string, note?: string): string {
  return buildPrompt({
    phase: "arbiter",
    prompts,
    reports: {
      finder: "Preserve the approved finder findings unless the refinement requires changing them.",
      skeptic: "Preserve or revise the skeptic objections only as needed to satisfy the refinement.",
      arbiter: planText,
    },
    refinement:
      note?.trim() ||
      "Revise the approved bug-fix plan, keep the structured contract valid, and return the full updated plan.",
  });
}

function buildWorkerPrompt(args: {
  prompts: PromptBundle;
  executionUnit: BugFixExecutionUnit;
  approvedPlanSummary?: string;
  step?: number;
  totalSteps?: number;
}): string {
  const sections = [args.prompts.fixer];

  if (args.approvedPlanSummary?.trim()) {
    sections.push("## Approved Plan Summary", args.approvedPlanSummary.trim());
  }

  if (typeof args.step === "number" && typeof args.totalSteps === "number") {
    sections.push("## Execution Position", `Unit ${args.step}/${args.totalSteps}`);
  }

  sections.push(
    "## Assigned Bug-Fix Execution Unit",
    `ID: ${args.executionUnit.id}`,
    `Title: ${args.executionUnit.title}`,
    `Objective: ${args.executionUnit.objective}`,
    args.executionUnit.dependsOn.length > 0
      ? `Depends on: ${args.executionUnit.dependsOn.join(", ")}`
      : "Depends on: none",
    "Targets:",
    ...args.executionUnit.targets.map((target) => `- ${target}`),
    "Validations:",
    ...args.executionUnit.validations.map((validation) => `- ${validation}`),
  );

  return sections.join("\n\n");
}

function buildExecutionManagerPrompt(
  result: BugFixExecutionRunResult,
  step: number,
  totalSteps: number,
): string {
  const lines = [
    `Execution manager processed approved bug-fix unit ${step}/${totalSteps}.`,
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
      ? `Emit an execution_result tagged JSON block for step ${step} using status \"done\".`
      : `Emit an execution_result tagged JSON block for step ${step} using status \"skipped\" and summarize why execution stopped.`,
  );

  return lines.join("\n");
}

function buildExecutionSchedulerPrompt(
  schedule: ExecutionScheduleResult<BugFixWorkerValidation>,
  executionUnits: BugFixExecutionUnit[],
): string {
  const lines = [
    `Execution scheduler processed ${executionUnits.length} approved bug-fix units.`,
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
        `- Step ${step} (${executionUnit.id}): emit execution_result status \"skipped\" with summary \"Not run because dependency-layer execution stopped before this unit.\"`,
      );
      continue;
    }

    if (result.status === "completed") {
      lines.push(
        `- Step ${step} (${executionUnit.id}): emit execution_result status \"done\" with summary \"${result.summary}\"`,
      );
      continue;
    }

    lines.push(
      `- Step ${step} (${executionUnit.id}): emit execution_result status \"skipped\" with summary \"${result.summary}\"`,
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

export class BugFinderWorkflow extends GuidedExecutionWorkflow<
  BugFixExecutionUnit,
  BugFixWorkerValidation
> {
  private prompts?: PromptBundle;
  private startupError?: Error;
  private repoRoot?: string;

  constructor(
    private readonly api: ExtensionAPI,
    private readonly promptProvider: () => PromptLoadResult<PromptBundle>,
    private readonly executionManager?: BugFixExecutionManagerLike,
    private readonly executionScheduler?: BugFixExecutionSchedulerLike,
  ) {
    super(api, {
      id: "bug-fix",
      parseGoalArg: parseScopeArg,
      buildPlanningPrompt: ({ goal }) => buildPlanningPrompt(this.requirePrompts(), goal),
      approval: {
        selectAction: async (_args, ctx) => {
          const selection = await ctx.ui.select("Bug Fix - Plan Ready", [
            "Execute fixes (TDD workflow)",
            "Refine the analysis",
            "Cancel",
          ]);

          if (selection === "Execute fixes (TDD workflow)") {
            return { action: "approve" };
          }

          if (selection === "Refine the analysis") {
            const note = (await ctx.ui.editor("Refine analysis:", ""))?.trim();
            return note ? { action: "continue", note } : { cancelled: true };
          }

          if (selection === "Cancel") {
            return { action: "exit" };
          }

          return { cancelled: true };
        },
        buildContinuePrompt: ({ planText, note }) => {
          return buildRefinementPrompt(this.requirePrompts(), planText, note);
        },
      },
      execution: {
        parseApprovedPlan: (planText) => {
          const parsed = parseTaggedBugFixPlan(planText);
          if (!parsed.ok) {
            return {
              ok: false as const,
              message: "Approved bug-fix plan could not be parsed into execution units.",
            };
          }

          return {
            ok: true as const,
            approvedPlanSummary: parsed.value.summary,
            executionUnits: orderExecutionUnits(parsed.value),
          };
        },
        formatExecutionItemText: (executionUnit) => formatExecutionItemText(executionUnit),
        buildExecutionUnitPrompt: ({ currentStep, items, executionUnit }) => {
          return [
            `Execute approved bug-fix unit ${currentStep.step}/${items.length}.`,
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
        buildExecutionRunResultPrompt: ({ result, step, totalSteps }) => {
          return buildExecutionManagerPrompt(result, step, totalSteps);
        },
        buildExecutionSchedulePrompt: ({ schedule, executionUnits }) => {
          return buildExecutionSchedulerPrompt(schedule, executionUnits);
        },
        executor: {
          executeUnit: (input) => this.getExecutionManager(this.repoRoot).executeUnit(input),
        },
        scheduler: {
          execute: (input) => this.getExecutionScheduler(this.repoRoot).execute(input),
        },
      },
      planningPolicy: {
        isSafeReadOnlyCommand,
        writeBlockedReason: "Bug fix analysis phase: writes are disabled",
        bashBlockedReason: (command) =>
          `Guided workflow planning phase blocked a potentially mutating bash command: ${command}`,
      },
      text: {
        alreadyRunning: "Bug fix is already running. Finish or cancel the current run first.",
        sendFailed: "Bug fix stopped: failed to send planning prompt.",
      },
      maxMissingOutputRetries: 2,
    });
  }

  async handleCommand(args: unknown, ctx: ExtensionContext): Promise<GuidedWorkflowResult> {
    this.repoRoot = (ctx as ExtensionContext & { cwd?: string }).cwd ?? process.cwd();
    this.reloadPrompts();

    if (!this.prompts) {
      ctx.ui.notify(
        `Bug fix is unavailable: ${this.startupError?.message ?? "prompt initialization failed."}`,
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

  private getExecutionManager(repoRootOverride?: string): BugFixExecutionManagerLike {
    if (this.executionManager) {
      return this.executionManager;
    }

    const repoRoot = repoRootOverride ?? this.repoRoot ?? process.cwd();
    return new ExecutionManager<BugFixExecutionUnit, BugFixWorkerValidation>({
      repoRoot,
      workspaceManager: new JjWorkspaceManager({ repoRoot, exec: this.api.exec.bind(this.api) }),
      workerRunner: new WorkerRunner<BugFixWorkerResult>({
        exec: this.api.exec.bind(this.api),
        parseResult: (assistantText) => {
          const parsed = parseTaggedWorkerResult(assistantText);
          return parsed.ok
            ? { ok: true as const, value: parsed.value }
            : { ok: false as const, message: parsed.message };
        },
      }),
      renderWorkerPrompt: (input) => buildWorkerPrompt({ prompts: this.requirePrompts(), ...input }),
      integrate: async ({ workerResult }) => ({
        summary: workerResult.summary,
        changedFiles: workerResult.changedFiles,
      }),
      workspaceBaseDir: `${repoRoot}/.bug-fix-workspaces`,
      buildWorkspaceName: (executionUnit, step) => {
        const safeId = executionUnit.id.replace(/[^a-zA-Z0-9._-]+/g, "-");
        return `bug-fix-step-${step}-${safeId}`;
      },
    });
  }

  private getExecutionScheduler(repoRootOverride?: string): BugFixExecutionSchedulerLike {
    if (this.executionScheduler) {
      return this.executionScheduler;
    }

    return new ExecutionScheduler<BugFixExecutionUnit, BugFixWorkerValidation>({
      executor: this.getExecutionManager(repoRootOverride),
    });
  }
}
