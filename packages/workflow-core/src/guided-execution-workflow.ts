import {
  ExecutionScheduler,
  type ExecutePlanInput,
  type ExecutionScheduleResult,
} from "./execution-scheduler";
import type {
  ExecutionRunResult,
  ExecutionUnitExecutor,
  ExecutionUnitLike,
} from "./execution-manager";
import type {
  AgentEndEvent,
  BeforeAgentStartEvent,
  ExtensionAPI,
  ExtensionContext,
  SessionShutdownEvent,
  SessionStartEvent,
  ToolCallEvent,
  TurnEndEvent,
} from "./extension-api";
import {
  GuidedWorkflow,
  type GuidedWorkflowApprovalOptions,
  type GuidedWorkflowCritiqueOptions,
  type GuidedWorkflowDeliveryOptions,
  type GuidedWorkflowExecutionItem,
  type GuidedWorkflowExecutionResult,
  type GuidedWorkflowPlanningPolicy,
  type GuidedWorkflowResult,
  type GuidedWorkflowState,
} from "./guided-workflow";
import type { GuidedWorkflowController } from "./register-guided-workflow-extension";

export type ExecutionPlanParseResult<Unit> =
  | {
      ok: true;
      approvedPlanSummary?: string;
      executionUnits: Unit[];
    }
  | {
      ok: false;
      message: string;
    };

export interface GuidedExecutionApprovalOptions extends Omit<
  GuidedWorkflowApprovalOptions,
  "onApprove"
> {
  onApprove?: GuidedWorkflowApprovalOptions["onApprove"];
}

export interface GuidedExecutionOptions<Unit extends ExecutionUnitLike, Validation = unknown> {
  parseApprovedPlan: (planText: string) => ExecutionPlanParseResult<Unit>;
  formatExecutionItemText: (executionUnit: Unit, index: number, executionUnits: Unit[]) => string;
  buildExecutionUnitPrompt: (args: {
    goal?: string;
    planText: string;
    critiqueText?: string;
    currentStep: GuidedWorkflowExecutionItem;
    items: GuidedWorkflowExecutionItem[];
    executionUnit: Unit;
    executionUnits: Unit[];
    approvedPlanSummary?: string;
  }) => string;
  buildExecutionRunResultPrompt: (args: {
    result: ExecutionRunResult<Validation>;
    step: number;
    totalSteps: number;
    executionUnit: Unit;
    executionUnits: Unit[];
    approvedPlanSummary?: string;
  }) => string;
  buildExecutionSchedulePrompt: (args: {
    schedule: ExecutionScheduleResult<Validation>;
    executionUnits: Unit[];
    approvedPlanSummary?: string;
  }) => string;
  executor: ExecutionUnitExecutor<Unit, Validation>;
  scheduler?: {
    execute(input: ExecutePlanInput<Unit>): Promise<ExecutionScheduleResult<Validation>>;
  };
  timeoutMs?: number;
  extractExecutionResults?: (text: string) => GuidedWorkflowExecutionResult[];
}

export interface GuidedExecutionWorkflowOptions<
  Unit extends ExecutionUnitLike,
  Validation = unknown,
> {
  id: string;
  parseGoalArg?: (args: unknown) => string | undefined;
  buildPlanningPrompt?: (args: { goal?: string }) => string;
  critique?: GuidedWorkflowCritiqueOptions;
  planningPolicy?: GuidedWorkflowPlanningPolicy;
  delivery?: GuidedWorkflowDeliveryOptions;
  approval: GuidedExecutionApprovalOptions;
  execution: GuidedExecutionOptions<Unit, Validation>;
  maxMissingOutputRetries?: number;
  text: {
    alreadyRunning: string;
    sendFailed?: string;
  };
}

export class GuidedExecutionWorkflow<
  Unit extends ExecutionUnitLike,
  Validation = unknown,
> implements GuidedWorkflowController {
  private readonly workflow: GuidedWorkflow;
  private latestExecutionRun?: ExecutionRunResult<Validation>;
  private latestExecutionSchedule?: ExecutionScheduleResult<Validation>;

  constructor(
    api: ExtensionAPI,
    private readonly options: GuidedExecutionWorkflowOptions<Unit, Validation>,
  ) {
    this.workflow = new GuidedWorkflow(api, {
      id: options.id,
      parseGoalArg: options.parseGoalArg,
      buildPlanningPrompt: options.buildPlanningPrompt,
      critique: options.critique,
      planningPolicy: options.planningPolicy,
      delivery: options.delivery,
      approval: {
        ...options.approval,
        onApprove: async (args, ctx) => {
          this.clearLatestExecutionState();
          await options.approval.onApprove?.(args, ctx);

          const parsed = this.options.execution.parseApprovedPlan(args.planText);
          if (!parsed.ok) {
            return;
          }

          if (parsed.executionUnits.length === 0) {
            return;
          }

          if (parsed.executionUnits.length === 1) {
            this.latestExecutionRun = await this.options.execution.executor.executeUnit({
              executionUnit: parsed.executionUnits[0]!,
              approvedPlanSummary: parsed.approvedPlanSummary,
              step: 1,
              totalSteps: 1,
              timeoutMs: this.options.execution.timeoutMs,
            });
            return;
          }

          const scheduler =
            this.options.execution.scheduler ??
            new ExecutionScheduler({ executor: this.options.execution.executor });
          this.latestExecutionSchedule = await scheduler.execute({
            executionUnits: parsed.executionUnits,
            approvedPlanSummary: parsed.approvedPlanSummary,
            timeoutMs: this.options.execution.timeoutMs,
          });
        },
      },
      execution: {
        extractItems: ({ planText }) => {
          const parsed = this.options.execution.parseApprovedPlan(planText);
          if (!parsed.ok) {
            return [];
          }

          return parsed.executionUnits.map((executionUnit, index) => ({
            step: index + 1,
            text: this.options.execution.formatExecutionItemText(
              executionUnit,
              index,
              parsed.executionUnits,
            ),
          }));
        },
        buildExecutionPrompt: ({ goal, planText, critiqueText, currentStep, items }) => {
          const parsed = this.options.execution.parseApprovedPlan(planText);
          if (!parsed.ok) {
            return parsed.message;
          }

          const executionUnit = parsed.executionUnits[currentStep.step - 1];
          if (!executionUnit) {
            return currentStep.text;
          }

          if (this.latestExecutionSchedule) {
            return this.options.execution.buildExecutionSchedulePrompt({
              schedule: this.latestExecutionSchedule,
              executionUnits: parsed.executionUnits,
              approvedPlanSummary: parsed.approvedPlanSummary,
            });
          }

          if (this.latestExecutionRun && this.latestExecutionRun.unitId === executionUnit.id) {
            return this.options.execution.buildExecutionRunResultPrompt({
              result: this.latestExecutionRun,
              step: currentStep.step,
              totalSteps: items.length,
              executionUnit,
              executionUnits: parsed.executionUnits,
              approvedPlanSummary: parsed.approvedPlanSummary,
            });
          }

          return this.options.execution.buildExecutionUnitPrompt({
            goal,
            planText,
            critiqueText,
            currentStep,
            items,
            executionUnit,
            executionUnits: parsed.executionUnits,
            approvedPlanSummary: parsed.approvedPlanSummary,
          });
        },
        extractExecutionResults: options.execution.extractExecutionResults,
      },
      maxMissingOutputRetries: options.maxMissingOutputRetries,
      text: options.text,
    });
  }

  getStateSnapshot(): GuidedWorkflowState {
    return this.workflow.getStateSnapshot();
  }

  getExecutionSnapshot() {
    return this.workflow.getExecutionSnapshot();
  }

  handleCommand(args: unknown, ctx: ExtensionContext): Promise<GuidedWorkflowResult> {
    this.clearLatestExecutionState();
    return this.workflow.handleCommand(args, ctx);
  }

  handleToolCall(event: ToolCallEvent, ctx: ExtensionContext) {
    return this.workflow.handleToolCall(event, ctx);
  }

  handleAgentEnd(event: AgentEndEvent, ctx: ExtensionContext) {
    return this.workflow.handleAgentEnd(event, ctx);
  }

  handleBeforeAgentStart(event: BeforeAgentStartEvent, ctx: ExtensionContext) {
    return this.workflow.handleBeforeAgentStart(event, ctx);
  }

  handleTurnEnd(event: TurnEndEvent, ctx: ExtensionContext) {
    return this.workflow.handleTurnEnd(event, ctx);
  }

  handleSessionStart(event: SessionStartEvent, ctx: ExtensionContext) {
    return this.workflow.handleSessionStart(event, ctx);
  }

  async handleSessionShutdown(event: SessionShutdownEvent, ctx: ExtensionContext) {
    this.clearLatestExecutionState();
    return this.workflow.handleSessionShutdown(event, ctx);
  }

  private clearLatestExecutionState(): void {
    this.latestExecutionRun = undefined;
    this.latestExecutionSchedule = undefined;
  }
}
