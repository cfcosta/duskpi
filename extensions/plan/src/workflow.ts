import {
  GuidedWorkflow,
  type AgentEndEvent,
  type BeforeAgentStartEvent,
  type ExtensionAPI,
  type ExtensionContext,
  type GuidedWorkflowExecutionItem,
  type GuidedWorkflowResult,
  type SessionCompactEvent,
  type SessionForkEvent,
  type SessionShutdownEvent,
  type SessionStartEvent,
  type SessionSwitchEvent,
  type ToolCallEvent,
  type TurnEndEvent,
} from "../../../packages/workflow-core/src/index";
import {
  selectPlanNextActionWithInlineNote,
  type PlanApprovalDetails,
  type PlanApprovalPreviewStep,
} from "./plan-action-ui";
import {
  extractPlanSteps,
  extractTodoItems,
  isSafeReadOnlyCommand,
  markTodoItemsCompleted,
  normalizeArg,
  parseCritiqueVerdict,
  toTodoItems,
  type PlanStep,
  type TodoItem,
} from "./utils";

const STATUS_KEY = "plan";
const TODO_WIDGET_KEY = "plan-todos";
const MAX_VISIBLE_TODO_WIDGET_LINES = 5;

const PLAN_TOOL_CANDIDATES = [
  "read",
  "bash",
  "grep",
  "find",
  "ls",
  "ask_user_question",
  "lsp",
  "ast_search",
  "web_search",
  "web_fetch",
  "get_search_content",
] as const;

const WRITE_LIKE_TOOLS = new Set(["edit", "write", "ast_rewrite"]);
const PLAN_MODE_WRITE_BLOCKED_REASON =
  "Plan mode is read-only. Approve execution first (choose 'Approve and execute now').";

function isPlanWriteCapableTool(toolName?: string): boolean {
  return WRITE_LIKE_TOOLS.has((toolName ?? "").trim().toLowerCase());
}

function isBashToolName(toolName?: string): boolean {
  return (toolName ?? "").trim().toLowerCase() === "bash";
}

function buildPlanModeBashBlockedReason(command: string): string {
  return `Plan mode blocked a potentially mutating bash command: ${command}`;
}

const PLAN_MODE_SYSTEM_PROMPT = `
[PLAN MODE ACTIVE - READ ONLY]
You are in planning mode.

Hard rules:
- Allowed actions: inspection, analysis, and plan creation only.
- Never perform any write/change action.
- Never use edit/write or mutating shell commands.
- Do not implement anything until the user approves the plan.

MANDATORY workflow:
1) Explore first
   - Thoroughly explore the codebase before proposing changes.
   - Read the relevant files, symbols, tests, configs, and adjacent features.
   - Identify existing patterns and architectural constraints.
   - If external behavior matters, gather official docs/reference evidence.
   - Prefer web_search to discover external sources, then use web_fetch on the exact URLs you need to read closely.
2) Consider approaches
   - Identify the most plausible implementation options.
   - Note the important trade-offs when the design could reasonably go multiple ways.
3) Clarify proactively before locking a design
   - While considering changes, actively look for product, UX, API, schema, compatibility, rollout, validation, performance, and migration decisions the user may want to control.
   - If any such decision is not clearly fixed by the request or existing repo patterns, use ask_user_question before finalizing. Prefer asking over guessing when a change could reasonably go multiple ways.
   - Bundle related ambiguities into 1-4 concise questions in one questionnaire.
   - Prefer 2-4 concrete options per question. The user will still be able to type a custom answer.
   - Ask more than one question when multiple independent choices remain.
   - Do not use ask_user_question to ask whether the plan is ready or whether you should proceed. The plan approval UI handles that.
4) Produce an implementation plan for approval
   - Build a concrete execution plan grounded in what you found.
   - Keep steps atomic enough to execute one at a time.

Response contract (use this structure):
1) Task understanding
2) Codebase findings
   - files/paths/symbols/patterns/docs checked
3) Approach options / trade-offs
4) Open questions / assumptions
5) Plan:
   1. step objective
   2. target files/components
   3. validation method
6) End with: "Ready to execute when approved."
`.trim();

const YOLO_MODE_SYSTEM_PROMPT = `
[DEFAULT MODE: YOLO]
- Execute tasks directly unless the user explicitly asks for planning.
- Do NOT force a plan/approval gate in normal mode.
- The read-only plan/approval flow is only active when /plan mode is enabled.
`.trim();

const EXECUTION_TRIGGER_PROMPT =
  "Plan approved. Switch to implementation mode and execute the latest plan now.";

const EXECUTION_COMMIT_RULES = `
Execution rules:
- Execute exactly one todo step per agent turn.
- Work only on the next incomplete step.
- After implementing and validating that step, create one atomic jujutsu commit before ending the turn.
- Use \`jj commit <changed paths> -m <message>\`.
- Use Conventional Commits.
- Include a detailed commit description covering what changed, why, and the intended outcome.
- Never batch multiple plan steps into one commit.
- After the commit succeeds, include a [DONE:n] marker for the completed step and stop.
- Do not start the next step until the extension prompts you again.
`.trim();

const PLAN_CRITIQUE_PROMPT = `
Critique the latest proposed implementation plan for execution quality.

Check for:
- atomicity: each step should be small enough for one commit
- ordering: dependency-safe step order
- specificity: likely files/components are concrete enough
- validation: each step has a concrete validation method
- executability: the agent can perform the step without ambiguity
- noise: metadata-only or duplicate steps should not appear as executable work

Return this exact structure:
1) Verdict: PASS, REFINE, or REJECT
2) Issues:
   - concise bullets
3) Required fixes:
   - concise bullets
4) Summary:
   - one short paragraph

Use PASS only if the plan is executable as-is. Use REFINE if the plan is salvageable with targeted improvements. Use REJECT if the plan is too vague or unsafe and should be replaced.
`.trim();

const AUTOPLAN_SUBTASK_SYSTEM_PROMPT = `
[AUTOPLAN SUBTASK PLANNING - READ ONLY]
You are planning a single approved subtask inside an already-approved long-term goal.

Hard rules:
- Stay read-only while planning.
- Do not ask the user questions.
- Do not request approval.
- Make the best reasonable decisions from the repo, the approved parent goal, and existing patterns.
- Return a concrete executable plan with an explicit Plan: section and numbered steps.
`.trim();

const AUTOPLAN_REVIEW_SYSTEM_PROMPT = `
[AUTOPLAN PROGRESS REVIEW - READ ONLY]
You are reviewing progress against an already-approved long-term goal.

Hard rules:
- Stay read-only.
- Do not ask the user questions.
- Do not request approval.
- Decide whether the long-term goal is complete or what high-level tasks remain.
- If work remains, return an explicit Plan: section with numbered remaining tasks.
`.trim();

export const PLAN_COMMAND_DESCRIPTION =
  "Enable read-only planning mode. Usage: /plan, /plan on, /plan off, /plan status, /plan <task>";
export const AUTOPLAN_COMMAND_DESCRIPTION =
  "Plan a long-term goal, get approval once, then recursively plan and execute each approved subtask";
export const TODOS_COMMAND_DESCRIPTION = "Show current plan execution progress";

type ApprovalReviewState = PlanApprovalDetails;

type PendingPiPlanResponseKind = "planning" | "critique" | "revision";
type AutoPlanMode = "off" | "bootstrap" | "executing";
type AutoPlanReviewOutcome = "continue" | "complete" | "retry";

interface AutoPlanReviewState {
  pendingRequestId?: string;
  awaitingResponse: boolean;
  prompt?: string;
  missingOutputRetries: number;
  parseRecoveryAttempted: boolean;
}

class AutoPlanSubtaskWorkflow extends GuidedWorkflow {
  private parseRecoveryAttempted = false;

  constructor(
    private readonly pi: ExtensionAPI,
    options: ConstructorParameters<typeof GuidedWorkflow>[1],
  ) {
    super(pi, options);
  }

  async handleAgentEnd(event: AgentEndEvent, ctx: ExtensionContext): Promise<GuidedWorkflowResult> {
    const phase = this.getStateSnapshot().phase;
    if (phase === "executing") {
      return { kind: "ok" };
    }

    const messages = event.messages ?? [];
    const pendingResponseKind = getPendingPiPlanResponseKind(messages);
    const lastAssistantText = [...messages]
      .reverse()
      .map(getAssistantTextFromMessage)
      .find((text) => text.length > 0);

    if (this.hasPendingPlanningRequest()) {
      const correlationFailure = validatePendingPlanningResponse(this.getStateSnapshot(), messages);
      if (correlationFailure) {
        return correlationFailure;
      }

      if (
        (pendingResponseKind === "planning" || pendingResponseKind === "revision") &&
        lastAssistantText
      ) {
        const extracted = extractTodoItems(lastAssistantText);
        if (extracted.length === 0) {
          return this.handleUnparseablePlanningDraft(lastAssistantText, ctx);
        }
        this.parseRecoveryAttempted = false;
      }
    }

    return super.handleAgentEnd(event, ctx);
  }

  async handleSessionShutdown(event: SessionShutdownEvent, ctx: ExtensionContext): Promise<void> {
    this.parseRecoveryAttempted = false;
    await super.handleSessionShutdown(event, ctx);
  }

  private hasPendingPlanningRequest(): boolean {
    const state = this.getStateSnapshot();
    return state.phase !== "idle" && state.awaitingResponse;
  }

  private async handleUnparseablePlanningDraft(
    draftText: string,
    ctx: ExtensionContext,
  ): Promise<GuidedWorkflowResult> {
    if (!this.parseRecoveryAttempted) {
      this.parseRecoveryAttempted = true;
      notify(
        this.pi,
        ctx,
        "Autoplan couldn't extract subtask steps. Asking Pi to restate the subtask plan with an explicit Plan: section.",
        "warning",
      );
      await super.handleSessionShutdown({ reason: "autoplan-subtask-parse-retry" }, ctx);
      return super.handleCommand(buildParseRecoveryPrompt(draftText), ctx);
    }

    this.parseRecoveryAttempted = false;
    notify(this.pi, ctx, "Autoplan couldn't extract subtask steps after one retry.", "error");
    await super.handleSessionShutdown({ reason: "autoplan-subtask-parse-failed" }, ctx);
    return { kind: "recoverable_error", reason: "autoplan_subtask_unparseable" };
  }
}

export class PiPlanWorkflow extends GuidedWorkflow {
  private planModeEnabled = false;
  private executionMode = false;
  private restoreTools: string[] | null = null;
  private todoItems: TodoItem[] = [];
  private latestPlanDraft = "";
  private approvalReview: ApprovalReviewState | null = null;
  private latestCritiqueSummary = "";
  private planWasRevised = false;
  private executionConstraintNote = "";
  private parseRecoveryAttempted = false;
  private autoPlanMode: AutoPlanMode = "off";
  private autoPlanGoal = "";
  private autoPlanPendingStart = false;
  private autoPlanOuterStep?: number;
  private autoPlanReview: AutoPlanReviewState = {
    awaitingResponse: false,
    missingOutputRetries: 0,
    parseRecoveryAttempted: false,
  };
  private readonly autoPlanSubtaskWorkflow: AutoPlanSubtaskWorkflow;

  constructor(private readonly pi: ExtensionAPI) {
    let self!: PiPlanWorkflow;

    super(pi, {
      id: STATUS_KEY,
      parseGoalArg: parsePlanGoalArg,
      buildPlanningPrompt: ({ goal }) => {
        return [
          "Plan this implementation task in read-only mode before making any changes.",
          "Explore the codebase, identify existing patterns and similar features, and consider important trade-offs while actively surfacing user-controlled decisions.",
          "Prefer asking over guessing when behavior, UX, API, schema, validation, rollout, compatibility, performance, or migration choices are still open.",
          "Use ask_user_question to bundle the key uncertainties into 1-4 focused multiple-choice questions with 2-4 concrete options each; the user can still type a custom answer.",
          "Then return a concrete implementation plan that follows the required plan-mode response contract.",
          "",
          `Task: ${goal ?? "Create a concrete implementation plan."}`,
        ].join("\n");
      },
      critique: {
        buildCritiquePrompt: ({ planText }) => {
          return `${PLAN_CRITIQUE_PROMPT}\n\nPlan to critique:\n\n${planText}`;
        },
        buildRevisionPrompt: ({ planText, critiqueText }) => {
          return [
            "Revise the latest plan using the critique below.",
            "Keep plan mode read-only and return the full plan again using the required plan output contract.",
            "Make each step atomic, executable, validation-backed, and suitable for one jujutsu commit.",
            "",
            "Original plan:",
            planText,
            "",
            "Critique:",
            critiqueText,
          ].join("\n");
        },
        parseCritiqueVerdict,
        customMessageType: "plan-internal",
      },
      planningPolicy: {
        isWriteCapableTool(toolName) {
          return isPlanWriteCapableTool(toolName);
        },
        isSafeReadOnlyCommand(command) {
          return isSafeReadOnlyCommand(command);
        },
        writeBlockedReason: PLAN_MODE_WRITE_BLOCKED_REASON,
        bashBlockedReason(command) {
          return buildPlanModeBashBlockedReason(command);
        },
      },
      approval: {
        async selectAction(args, ctx) {
          return self.selectApprovalAction(args, ctx);
        },
        buildContinuePrompt(args) {
          return self.buildContinuePrompt(args.note);
        },
        buildRegeneratePrompt() {
          return self.buildRegeneratePrompt();
        },
        onApprove(args, ctx) {
          return self.handleApprovalApprove(args.note, ctx);
        },
        onExit(_args, ctx) {
          return self.handleApprovalExit(ctx);
        },
      },
      execution: {
        extractItems({ planText }) {
          return extractTodoItems(planText).map((item) => ({ ...item }));
        },
        buildExecutionPrompt({ currentStep, note, planText }) {
          return self.buildExecutionPrompt(currentStep, planText, note);
        },
      },
      text: {
        alreadyRunning: "Plan mode is already enabled.",
        sendFailed: "Plan mode stopped: failed to send planning prompt.",
      },
    });

    self = this;
    this.autoPlanSubtaskWorkflow = new AutoPlanSubtaskWorkflow(pi, {
      id: `${STATUS_KEY}-autoplan-subtask`,
      parseGoalArg: parsePlanGoalArg,
      buildPlanningPrompt: ({ goal }) => {
        return [
          "Plan this approved subtask in read-only mode before making any changes.",
          "Do not ask the user questions.",
          "Do not request approval.",
          "Make the best reasonable decisions from the approved parent goal, the repo, and existing patterns.",
          "Return a concrete implementation plan that follows the required plan-mode response contract.",
          "",
          `Task: ${goal ?? "Create a concrete implementation plan."}`,
        ].join("\n");
      },
      critique: {
        buildCritiquePrompt: ({ planText }) => {
          return `${PLAN_CRITIQUE_PROMPT}\n\nPlan to critique:\n\n${planText}`;
        },
        buildRevisionPrompt: ({ planText, critiqueText }) => {
          return [
            "Revise the latest plan using the critique below.",
            "Keep planning read-only, do not ask the user questions, and return the full plan again using the required plan output contract.",
            "Make each step atomic, executable, validation-backed, and suitable for one jujutsu commit.",
            "",
            "Original plan:",
            planText,
            "",
            "Critique:",
            critiqueText,
          ].join("\n");
        },
        parseCritiqueVerdict,
        customMessageType: "autoplan-subtask-internal",
      },
      planningPolicy: {
        isWriteCapableTool(toolName) {
          return isPlanWriteCapableTool(toolName);
        },
        isSafeReadOnlyCommand(command) {
          return isSafeReadOnlyCommand(command);
        },
        writeBlockedReason: PLAN_MODE_WRITE_BLOCKED_REASON,
        bashBlockedReason(command) {
          return buildPlanModeBashBlockedReason(command);
        },
      },
      approval: {
        selectAction() {
          return { action: "approve" };
        },
      },
      execution: {
        extractItems({ planText }) {
          return extractTodoItems(planText).map((item) => ({ ...item }));
        },
        buildExecutionPrompt({ currentStep, note, planText }) {
          return self.buildExecutionPrompt(currentStep, planText, note);
        },
      },
      text: {
        alreadyRunning: "Autoplan is already processing a subtask.",
        sendFailed: "Autoplan stopped: failed to send a subtask prompt.",
      },
    });
  }

  async handleTodosCommand(_args: unknown, ctx: ExtensionContext): Promise<void> {
    const progress = this.getExecutionProgressView();
    if (progress.totalSteps === 0) {
      notify(this.pi, ctx, "No tracked plan steps. Create a plan in /plan mode first.", "info");
      return;
    }

    const visibleItems = selectVisibleTodoItems(progress.todoItems);
    const lines = visibleItems.items.map((item) => {
      return `${item.step}. ${item.completed ? "✓" : "○"} ${item.text}`;
    });
    if (visibleItems.hiddenBefore > 0) {
      lines.unshift(
        `… ${visibleItems.hiddenBefore} earlier item${visibleItems.hiddenBefore === 1 ? "" : "s"} hidden`,
      );
    }
    notify(
      this.pi,
      ctx,
      `Plan progress ${progress.completedSteps}/${progress.totalSteps}\n${lines.join("\n")}`,
      "info",
    );
  }

  async handleAutoPlanCommand(args: unknown, ctx: ExtensionContext): Promise<GuidedWorkflowResult> {
    const raw = typeof args === "string" ? args.trim() : "";

    const nonUiApprovalResult = await this.handleNonUiApprovalCommand(raw, ctx);
    if (nonUiApprovalResult) {
      return nonUiApprovalResult;
    }

    if (raw.length === 0) {
      notify(this.pi, ctx, "Usage: /autoplan <long-term goal>", "info");
      return { kind: "ok" };
    }

    const command = normalizeArg(raw);
    if (["status", "state"].includes(command)) {
      notify(this.pi, ctx, this.getAutoPlanStatusText());
      return { kind: "ok" };
    }

    if (["off", "disable", "stop", "exit"].includes(command)) {
      await this.stopAutoPlan(ctx, "Autoplan stopped.");
      return { kind: "ok" };
    }

    if (this.getStateSnapshot().phase !== "idle" || this.autoPlanMode !== "off") {
      notify(this.pi, ctx, "Plan mode is already enabled.", "warning");
      return { kind: "blocked", reason: "already_running" };
    }

    this.autoPlanMode = "bootstrap";
    this.autoPlanGoal = raw;
    this.autoPlanPendingStart = false;
    this.autoPlanOuterStep = undefined;
    this.resetAutoPlanReviewState();

    if (!this.planModeEnabled) {
      this.enterPlanMode(ctx);
    }

    this.resetParseRecoveryState();
    return this.startPlanningRequest(raw, ctx);
  }

  async handleCommand(args: unknown, ctx: ExtensionContext): Promise<GuidedWorkflowResult> {
    const raw = typeof args === "string" ? args.trim() : "";

    const nonUiApprovalResult = await this.handleNonUiApprovalCommand(raw, ctx);
    if (nonUiApprovalResult) {
      return nonUiApprovalResult;
    }

    if (raw.length === 0) {
      if (this.planModeEnabled) {
        this.exitPlanMode(ctx, "Plan mode disabled. Back to YOLO mode.", {
          resetProgress: true,
        });
      } else {
        this.enterPlanMode(ctx);
      }
      return { kind: "ok" };
    }

    const command = normalizeArg(raw);
    if (["on", "enable", "start"].includes(command)) {
      this.enterPlanMode(ctx);
      return { kind: "ok" };
    }

    if (["off", "disable", "stop", "exit"].includes(command)) {
      this.exitPlanMode(ctx, "Plan mode disabled. Back to YOLO mode.", {
        resetProgress: true,
      });
      return { kind: "ok" };
    }

    if (["status", "state"].includes(command)) {
      notify(this.pi, ctx, this.getPlanStatusText());
      return { kind: "ok" };
    }

    if (!this.planModeEnabled) {
      this.enterPlanMode(ctx);
    }

    this.resetParseRecoveryState();
    return this.startPlanningRequest(raw, ctx);
  }

  async handleToolCall(
    event: ToolCallEvent,
    ctx: ExtensionContext,
  ): Promise<{ block: true; reason: string } | void> {
    if (this.autoPlanReview.awaitingResponse) {
      if ((event.toolName ?? "").trim().toLowerCase() === "ask_user_question") {
        return {
          block: true,
          reason: "Autoplan progress review must not ask the user new questions.",
        };
      }
      if (isPlanWriteCapableTool(event.toolName)) {
        return {
          block: true,
          reason: PLAN_MODE_WRITE_BLOCKED_REASON,
        };
      }
      if (isBashToolName(event.toolName)) {
        const input = event.input as { command?: unknown };
        const command = typeof input.command === "string" ? input.command : "";
        if (!isSafeReadOnlyCommand(command)) {
          return {
            block: true,
            reason: buildPlanModeBashBlockedReason(command),
          };
        }
      }
      return;
    }

    const autoPlanSubtaskPhase = this.autoPlanSubtaskWorkflow.getStateSnapshot().phase;
    if (autoPlanSubtaskPhase !== "idle") {
      if (
        (autoPlanSubtaskPhase === "planning" || autoPlanSubtaskPhase === "approval") &&
        (event.toolName ?? "").trim().toLowerCase() === "ask_user_question"
      ) {
        return {
          block: true,
          reason: "Autoplan subtask planning must not ask the user new questions.",
        };
      }
      return this.autoPlanSubtaskWorkflow.handleToolCall(event, ctx);
    }

    if (!this.planModeEnabled) {
      return;
    }

    if (this.getStateSnapshot().phase !== "idle") {
      return super.handleToolCall(event, ctx);
    }

    if (isPlanWriteCapableTool(event.toolName)) {
      return {
        block: true,
        reason: PLAN_MODE_WRITE_BLOCKED_REASON,
      };
    }

    if (isBashToolName(event.toolName)) {
      const input = event.input as { command?: unknown };
      const command = typeof input.command === "string" ? input.command : "";
      if (!isSafeReadOnlyCommand(command)) {
        return {
          block: true,
          reason: buildPlanModeBashBlockedReason(command),
        };
      }
    }
  }

  async handleBeforeAgentStart(
    event: BeforeAgentStartEvent,
    _ctx: ExtensionContext,
  ): Promise<{ systemPrompt: string }> {
    const autoPlanSubtaskPhase = this.autoPlanSubtaskWorkflow.getStateSnapshot().phase;
    if (this.autoPlanReview.awaitingResponse) {
      return {
        systemPrompt: `${event.systemPrompt}\n\n${AUTOPLAN_REVIEW_SYSTEM_PROMPT}`,
      };
    }

    if (autoPlanSubtaskPhase === "planning" || autoPlanSubtaskPhase === "approval") {
      return {
        systemPrompt: `${event.systemPrompt}\n\n${AUTOPLAN_SUBTASK_SYSTEM_PROMPT}`,
      };
    }

    if (autoPlanSubtaskPhase === "executing") {
      return {
        systemPrompt: `${event.systemPrompt}\n\n${YOLO_MODE_SYSTEM_PROMPT}`,
      };
    }

    if (this.planModeEnabled) {
      return {
        systemPrompt: `${event.systemPrompt}\n\n${PLAN_MODE_SYSTEM_PROMPT}`,
      };
    }

    if (this.executionMode && this.todoItems.length > 0) {
      return {
        systemPrompt: `${event.systemPrompt}\n\n${YOLO_MODE_SYSTEM_PROMPT}\n\n${this.getExecutionPrompt()}`,
      };
    }

    return {
      systemPrompt: `${event.systemPrompt}\n\n${YOLO_MODE_SYSTEM_PROMPT}`,
    };
  }

  async handleTurnEnd(event: TurnEndEvent, ctx: ExtensionContext): Promise<void> {
    const autoPlanSubtaskState = this.autoPlanSubtaskWorkflow.getStateSnapshot();
    if (autoPlanSubtaskState.phase !== "idle") {
      const beforePhase = autoPlanSubtaskState.phase;
      await this.autoPlanSubtaskWorkflow.handleTurnEnd(event, ctx);
      const afterPhase = this.autoPlanSubtaskWorkflow.getStateSnapshot().phase;
      if (beforePhase === "executing" && afterPhase === "idle") {
        await this.handleCompletedAutoPlanSubtask(ctx);
      }
      return;
    }

    const beforeState = this.getStateSnapshot();
    const beforeExecution = this.getExecutionSnapshot();

    await super.handleTurnEnd(event, ctx);

    this.syncExecutionShadowFromGuided(beforeState.phase, beforeExecution, ctx);
  }

  async handleAgentEnd(event: AgentEndEvent, ctx: ExtensionContext): Promise<GuidedWorkflowResult> {
    const messages = event.messages ?? [];
    const lastAssistantText = [...messages]
      .reverse()
      .map(getAssistantTextFromMessage)
      .find((text) => text.length > 0);

    if (this.autoPlanReview.awaitingResponse) {
      return this.handleAutoPlanReviewAgentEnd(event, ctx, messages, lastAssistantText);
    }

    if (this.autoPlanSubtaskWorkflow.getStateSnapshot().phase !== "idle") {
      return this.autoPlanSubtaskWorkflow.handleAgentEnd(event, ctx);
    }

    if (this.getStateSnapshot().phase === "executing") {
      return { kind: "ok" };
    }

    const pendingResponseKind = this.getPendingPiPlanResponseKind(messages);

    if (this.hasPendingPlanningRequest()) {
      const correlationFailure = this.validatePendingPlanningResponse(messages);
      if (correlationFailure) {
        return correlationFailure;
      }

      if (ctx.hasUI && !lastAssistantText) {
        this.abandonPendingResponse();
        this.setStatus(ctx);
        notify(
          this.pi,
          ctx,
          "Planning response interrupted. Send another message to steer the plan and Pi will use it for the next draft.",
          "info",
        );
        return { kind: "ok" };
      }

      if (pendingResponseKind === "planning") {
        if (!lastAssistantText) {
          return super.handleAgentEnd(event, ctx);
        }

        const captured = this.capturePlanDraft(lastAssistantText, ctx);
        await this.resetPlanningRequestState(ctx);
        if (!captured) {
          return this.handleUnparseablePlanningDraft(lastAssistantText, ctx);
        }

        notify(this.pi, ctx, "Reviewing the plan with a critique pass before approval.", "info");
        return this.beginCritiqueFlow(lastAssistantText, ctx);
      }

      if (pendingResponseKind === "revision") {
        if (!lastAssistantText) {
          return super.handleAgentEnd(event, ctx);
        }

        const captured = this.capturePlanDraft(lastAssistantText, ctx);
        if (captured) {
          notify(this.pi, ctx, "Reviewing the plan with a critique pass before approval.", "info");
        }

        const beforeExecution = this.getExecutionSnapshot();
        const beforePhase = this.getStateSnapshot().phase;
        const result = await super.handleAgentEnd(event, ctx);
        this.syncExecutionShadowFromGuided(beforePhase, beforeExecution, ctx);
        await this.maybeStartPendingAutoPlan(ctx, result);
        return result;
      }

      const beforeExecution = this.getExecutionSnapshot();
      const beforePhase = this.getStateSnapshot().phase;
      const result = await super.handleAgentEnd(event, ctx);
      if (result.kind !== "ok") {
        return result;
      }

      this.syncExecutionShadowFromGuided(beforePhase, beforeExecution, ctx);

      if (pendingResponseKind === "critique" && lastAssistantText) {
        const verdict = parseCritiqueVerdict(lastAssistantText);
        if (verdict !== "PASS") {
          this.latestCritiqueSummary =
            extractCritiqueSummary(lastAssistantText) ?? this.latestCritiqueSummary;
          this.planWasRevised = true;
          notify(
            this.pi,
            ctx,
            "The critique requested plan refinement. Regenerating the plan.",
            "warning",
          );
        }
      }

      await this.maybeStartPendingAutoPlan(ctx, result);
      return result;
    }

    if (!this.planModeEnabled || !ctx.hasUI || !lastAssistantText) {
      return { kind: "ok" };
    }

    const captured = this.capturePlanDraft(lastAssistantText, ctx);
    if (!captured) {
      return this.handleUnparseablePlanningDraft(lastAssistantText, ctx);
    }

    notify(this.pi, ctx, "Reviewing the plan with a critique pass before approval.", "info");
    return this.beginCritiqueFlow(lastAssistantText, ctx);
  }

  async handleSessionStart(_event: SessionStartEvent, ctx: ExtensionContext): Promise<void> {
    this.syncLocalLifecycleStateFromGuided();
    this.setStatus(ctx);
  }

  async handleSessionSwitch(_event: SessionSwitchEvent, ctx: ExtensionContext): Promise<void> {
    await this.resetTransientPlanSessionState(ctx);
  }

  async handleSessionFork(_event: SessionForkEvent, ctx: ExtensionContext): Promise<void> {
    await this.resetTransientPlanSessionState(ctx);
  }

  async handleSessionCompact(_event: SessionCompactEvent, ctx: ExtensionContext): Promise<void> {
    await this.resetTransientPlanSessionState(ctx);
  }

  async handleSessionShutdown(_event: SessionShutdownEvent, ctx: ExtensionContext): Promise<void> {
    await this.resetTransientPlanSessionState(ctx);
  }

  private async resetTransientPlanSessionState(ctx: ExtensionContext): Promise<void> {
    if (this.planModeEnabled || this.restoreTools) {
      this.restoreNormalTools();
    }

    await this.autoPlanSubtaskWorkflow.handleSessionShutdown(
      { reason: "autoplan-session-boundary-reset" },
      ctx,
    );
    await super.handleSessionShutdown({ reason: "plan-session-boundary-reset" }, ctx);
    this.resetLocalLifecycleState();
    this.clearPlanUiState(ctx);
  }

  private clearPlanUiState(ctx: ExtensionContext): void {
    if (!ctx.hasUI) {
      return;
    }

    ctx.ui.setStatus(STATUS_KEY, undefined);
    ctx.ui.setWidget(TODO_WIDGET_KEY, undefined);
  }

  private async handleNonUiApprovalCommand(
    raw: string,
    ctx: ExtensionContext,
  ): Promise<GuidedWorkflowResult | undefined> {
    if (ctx.hasUI || this.getStateSnapshot().phase !== "approval") {
      return undefined;
    }

    const [actionToken, ...noteParts] = raw.split(/\s+/).filter((part) => part.length > 0);
    const action = normalizeArg(actionToken ?? "");
    const note = noteParts.join(" ").trim();

    if (action === "approve") {
      return this.executeNonUiApprovalSelection({ action: "approve" }, ctx);
    }

    if (action === "continue") {
      if (note.length === 0) {
        notify(this.pi, ctx, "Usage: /plan continue <note> while approval is pending.", "error");
        return { kind: "ok" };
      }

      this.resetPlanningDraft();
      return this.executeNonUiApprovalSelection({ action: "continue", note }, ctx);
    }

    if (action === "regenerate") {
      this.todoItems = [];
      this.resetExecutionState();
      this.resetPlanningDraft();
      this.setStatus(ctx);
      return this.executeNonUiApprovalSelection({ action: "regenerate" }, ctx);
    }

    if (action === "exit") {
      return this.executeNonUiApprovalSelection({ action: "exit" }, ctx);
    }

    return undefined;
  }

  private async executeNonUiApprovalSelection(
    selection: { action: "approve" | "continue" | "regenerate" | "exit"; note?: string },
    ctx: ExtensionContext,
  ): Promise<GuidedWorkflowResult> {
    const workflow = this as unknown as {
      options?: {
        approval?: {
          selectAction?: (args: unknown, ctx: ExtensionContext) => unknown;
        };
      };
      handleApprovalReady?: (ctx: ExtensionContext) => Promise<GuidedWorkflowResult>;
    };

    const approval = workflow.options?.approval;
    const originalSelectAction = approval?.selectAction;
    if (!approval || !originalSelectAction || !workflow.handleApprovalReady) {
      return { kind: "blocked", reason: "approval_unavailable" };
    }

    approval.selectAction = async () => selection;
    try {
      const result = await workflow.handleApprovalReady(ctx);
      await this.maybeStartPendingAutoPlan(ctx, result);
      return result;
    } finally {
      approval.selectAction = originalSelectAction;
    }
  }

  private getPlanStatusText(): string {
    const state = this.getStateSnapshot();
    const execution = this.getExecutionSnapshot();

    if (state.phase === "planning" || state.phase === "approval") {
      return "Plan mode: ON (read-only planning)";
    }

    if (state.phase === "executing" && execution.items.length > 0) {
      return "Plan mode: OFF (executing approved plan)";
    }

    return "Plan mode: OFF (default YOLO mode)";
  }

  private getAutoPlanStatusText(): string {
    if (this.autoPlanMode === "bootstrap") {
      return "Autoplan: waiting for the top-level plan approval";
    }

    if (this.autoPlanReview.awaitingResponse) {
      return "Autoplan: reviewing progress against the long-term goal";
    }

    const subtaskPhase = this.autoPlanSubtaskWorkflow.getStateSnapshot().phase;
    if (
      this.autoPlanMode === "executing" &&
      (subtaskPhase === "planning" || subtaskPhase === "approval")
    ) {
      return "Autoplan: planning the current approved subtask";
    }

    if (this.autoPlanMode === "executing" && subtaskPhase === "executing") {
      return "Autoplan: executing the current approved subtask";
    }

    if (this.autoPlanMode === "executing") {
      return "Autoplan: ready to start the next approved subtask";
    }

    return "Autoplan: idle";
  }

  private hasPendingPlanningRequest(): boolean {
    const state = this.getStateSnapshot();
    return state.phase !== "idle" && state.awaitingResponse;
  }

  private async startPlanningRequest(
    prompt: string,
    ctx: ExtensionContext,
  ): Promise<GuidedWorkflowResult> {
    return super.handleCommand(prompt, ctx);
  }

  private async resetPlanningRequestState(ctx: ExtensionContext): Promise<void> {
    await super.handleSessionShutdown({ reason: "plan-consumed-planning-response" }, ctx);
  }

  private async handleUnparseablePlanningDraft(
    draftText: string,
    ctx: ExtensionContext,
  ): Promise<GuidedWorkflowResult> {
    if (!this.parseRecoveryAttempted) {
      this.parseRecoveryAttempted = true;
      notify(
        this.pi,
        ctx,
        "Couldn't extract plan steps. Asking Pi to restate the same draft with an explicit Plan: section.",
        "warning",
      );
      return this.startPlanningRequest(this.buildParseRecoveryPrompt(draftText), ctx);
    }

    this.resetParseRecoveryState();
    this.setStatus(ctx);
    notify(
      this.pi,
      ctx,
      "Couldn't extract plan steps after one automatic retry. Still in read-only plan mode.",
      "error",
    );
    return { kind: "ok" };
  }

  private buildParseRecoveryPrompt(draftText: string): string {
    return buildParseRecoveryPrompt(draftText);
  }

  private async selectApprovalAction(
    args: { planText: string; critiqueText?: string; note?: string },
    ctx: ExtensionContext,
  ): Promise<{
    cancelled?: boolean;
    action?: "approve" | "continue" | "regenerate" | "exit";
    note?: string;
  }> {
    this.latestPlanDraft = args.planText;
    this.latestCritiqueSummary = args.critiqueText
      ? (extractCritiqueSummary(args.critiqueText) ?? "ready")
      : this.latestCritiqueSummary;
    this.approvalReview = buildApprovalReviewState(args.planText, {
      critiqueSummary: this.latestCritiqueSummary || undefined,
      wasRevised: this.planWasRevised,
    });
    this.setStatus(ctx);
    notify(this.pi, ctx, "Plan critique passed. Review and approve when ready.", "info");

    if (!ctx.hasUI) {
      return { cancelled: true };
    }

    const selection = await selectPlanNextActionWithInlineNote(
      ctx.ui as never,
      this.approvalReview ??
        buildApprovalReviewState(args.planText, {
          critiqueSummary: this.latestCritiqueSummary || undefined,
          wasRevised: this.planWasRevised,
        }),
    );

    if (selection.action === "continue") {
      this.resetPlanningDraft();
      const continueNote = selection.note?.trim() ?? "";
      if (continueNote.length === 0) {
        notify(
          this.pi,
          ctx,
          "Please enter the requested modifications, then send your message to continue planning. Waiting for your input.",
          "info",
        );
        return { cancelled: true };
      }
    }

    if (selection.action === "regenerate") {
      this.todoItems = [];
      this.resetExecutionState();
      this.resetPlanningDraft();
      this.setStatus(ctx);
    }

    return selection;
  }

  private buildContinuePrompt(note?: string): string {
    const continueNote = note?.trim() ?? "";
    const firstOpenStep = this.todoItems.find((item) => !item.completed);
    if (firstOpenStep) {
      return `Continue planning from the proposed plan. User note: ${continueNote}. Focus on step ${firstOpenStep.step}: ${firstOpenStep.text}. Refine files, validation, and risks in read-only mode.`;
    }

    return `Continue planning from the proposed plan. User note: ${continueNote}. Refine implementation details without regenerating the full plan.`;
  }

  private buildRegeneratePrompt(): string {
    return "Regenerate the full plan from scratch. Re-check context and provide a refreshed Plan: section.";
  }

  private handleApprovalApprove(note: string | undefined, ctx: ExtensionContext): void {
    this.executionMode = this.todoItems.length > 0;
    this.executionConstraintNote = note?.trim() ?? "";
    this.autoPlanPendingStart = this.autoPlanMode === "bootstrap";
    if (this.autoPlanPendingStart) {
      this.autoPlanMode = "executing";
    }
    this.resetPlanningDraft();
    this.exitPlanMode(ctx, "Plan approved. Entering YOLO mode for execution.");
  }

  private handleApprovalExit(ctx: ExtensionContext): void {
    if (this.autoPlanMode === "bootstrap") {
      this.clearAutoPlanState();
    }
    this.exitPlanMode(ctx, "Exited plan mode without execution.", {
      resetProgress: true,
    });
  }

  private capturePlanDraft(planText: string, ctx: ExtensionContext): boolean {
    const extracted = extractTodoItems(planText);
    if (extracted.length === 0) {
      return false;
    }

    this.resetParseRecoveryState();
    this.latestPlanDraft = planText;
    this.todoItems = extracted;
    this.approvalReview = buildApprovalReviewState(planText, {
      critiqueSummary: this.latestCritiqueSummary || undefined,
      wasRevised: this.planWasRevised,
    });
    this.setStatus(ctx);
    return true;
  }

  private validatePendingPlanningResponse(messages: unknown[]): GuidedWorkflowResult | undefined {
    const pendingRequestId = this.getStateSnapshot().pendingRequestId;
    const lastPromptText = extractLastPromptText(messages);
    const observedRequestId = lastPromptText ? extractRequestId(lastPromptText) : undefined;
    if (!pendingRequestId || observedRequestId !== pendingRequestId) {
      return { kind: "blocked", reason: "unmatched_agent_end" };
    }

    return undefined;
  }

  private getPendingPiPlanResponseKind(messages: unknown[]): PendingPiPlanResponseKind | undefined {
    const lastPrompt = extractLastPrompt(messages);
    if (!lastPrompt) {
      return undefined;
    }

    if (lastPrompt.role === "user") {
      return "planning";
    }

    const promptText = extractMessageText(lastPrompt.content);
    if (!promptText) {
      return undefined;
    }

    if (promptText.includes("Revise the latest plan using the critique below.")) {
      return "revision";
    }

    if (
      promptText.includes("Critique the latest proposed implementation plan for execution quality.")
    ) {
      return "critique";
    }

    return undefined;
  }

  private getExecutionProgressView(): {
    todoItems: TodoItem[];
    totalSteps: number;
    completedSteps: number;
  } {
    const executionItems = this.getExecutionSnapshot().items;
    if (executionItems.length === 0) {
      return {
        todoItems: [],
        totalSteps: 0,
        completedSteps: 0,
      };
    }

    return {
      todoItems: this.buildCompactTodoItems(this.getLatestPlanText(), executionItems),
      totalSteps: executionItems.length,
      completedSteps: executionItems.filter((item) => item.completed).length,
    };
  }

  private buildCompactTodoItems(
    planText: string | undefined,
    executionItems: GuidedWorkflowExecutionItem[],
  ): TodoItem[] {
    const structuredTodoItems = planText ? toTodoItems(extractPlanSteps(planText)) : [];
    if (structuredTodoItems.length === 0) {
      return executionItems.map((item) => ({
        step: item.step,
        text: item.text,
        completed: item.completed,
      }));
    }

    const completedSteps = executionItems.filter((item) => item.completed).map((item) => item.step);
    markTodoItemsCompleted(structuredTodoItems, completedSteps);
    return structuredTodoItems;
  }

  private syncLocalLifecycleStateFromGuided(): void {
    const state = this.getStateSnapshot();
    const execution = this.getExecutionSnapshot();

    this.planModeEnabled = state.phase === "planning" || state.phase === "approval";
    this.executionMode = state.phase === "executing" && execution.items.length > 0;
    this.executionConstraintNote = execution.note ?? "";
    this.todoItems = this.buildCompactTodoItems(this.getLatestPlanText(), execution.items);
    this.latestPlanDraft = this.getLatestPlanText() ?? "";
  }

  private resetLocalLifecycleState(): void {
    this.planModeEnabled = false;
    this.restoreTools = null;
    this.todoItems = [];
    this.resetExecutionState();
    this.resetPlanningDraft();
    this.clearAutoPlanState();
  }

  private getAllToolNames(): string[] {
    return this.pi.getAllTools().map((tool) => tool.name);
  }

  private resetApprovalReview(): void {
    this.approvalReview = null;
    this.latestCritiqueSummary = "";
    this.planWasRevised = false;
  }

  private resetPlanningDraft(): void {
    this.latestPlanDraft = "";
    this.resetApprovalReview();
    this.resetParseRecoveryState();
  }

  private resetParseRecoveryState(): void {
    this.parseRecoveryAttempted = false;
  }

  private resetExecutionState(): void {
    this.executionMode = false;
    this.executionConstraintNote = "";
  }

  private async maybeStartPendingAutoPlan(
    ctx: ExtensionContext,
    result: GuidedWorkflowResult,
  ): Promise<void> {
    if (!this.autoPlanPendingStart || result.kind !== "ok") {
      return;
    }

    this.autoPlanPendingStart = false;
    await this.startNextAutoPlanSubtask(ctx);
  }

  private async startNextAutoPlanSubtask(ctx: ExtensionContext): Promise<void> {
    if (this.autoPlanMode !== "executing" || this.autoPlanReview.awaitingResponse) {
      return;
    }

    if (this.autoPlanSubtaskWorkflow.getStateSnapshot().phase !== "idle") {
      return;
    }

    const currentStep = this.getCurrentOuterExecutionItem();
    if (!currentStep) {
      await this.finishAutoPlan(ctx, "Autoplan complete.");
      return;
    }

    this.autoPlanOuterStep = currentStep.step;
    const result = await this.autoPlanSubtaskWorkflow.handleCommand(
      this.buildAutoPlanSubtaskGoal(currentStep),
      ctx,
    );

    if (result.kind !== "ok") {
      notify(this.pi, ctx, "Autoplan couldn't start the next approved subtask.", "error");
    }
  }

  private buildAutoPlanSubtaskGoal(currentStep: GuidedWorkflowExecutionItem): string {
    const remaining = this.getExecutionSnapshot().items.filter((item) => !item.completed);
    const backlog = remaining.map((item) => `${item.step}. ${item.text}`).join("\n");

    return [
      `Long-term goal: ${this.autoPlanGoal}`,
      `Current approved high-level task ${currentStep.step}: ${currentStep.text}`,
      backlog.length > 0 ? "Remaining high-level backlog for context:" : undefined,
      backlog.length > 0 ? backlog : undefined,
      "Plan only the current approved high-level task.",
      "Do not ask the user questions.",
      "Do not ask for approval.",
    ]
      .filter((line): line is string => typeof line === "string" && line.length > 0)
      .join("\n");
  }

  private async handleCompletedAutoPlanSubtask(ctx: ExtensionContext): Promise<void> {
    if (typeof this.autoPlanOuterStep !== "number") {
      return;
    }

    this.markOuterExecutionStepCompleted(this.autoPlanOuterStep);
    this.autoPlanOuterStep = undefined;
    this.todoItems = this.buildCompactTodoItems(
      this.getLatestPlanText(),
      this.getExecutionSnapshot().items,
    );
    this.setStatus(ctx);
    await this.startAutoPlanReview(ctx);
  }

  private async startAutoPlanReview(ctx: ExtensionContext): Promise<void> {
    const prompt = this.buildAutoPlanReviewPrompt();
    const requestId = this.nextAutoPlanReviewRequestId();
    const promptWithRequestId = `${prompt}\n\n${buildWorkflowRequestIdMarker(requestId)}`;

    this.autoPlanReview = {
      pendingRequestId: requestId,
      awaitingResponse: true,
      prompt,
      missingOutputRetries: 0,
      parseRecoveryAttempted: false,
    };

    try {
      this.pi.sendMessage(
        {
          customType: "autoplan-review-internal",
          content: promptWithRequestId,
          display: false,
        },
        {
          triggerTurn: true,
          deliverAs: "followUp",
        },
      );
    } catch {
      await this.continueAutoPlanAfterReviewFallback(
        ctx,
        "Autoplan couldn't start the goal progress review, so it will continue with the existing approved backlog.",
      );
    }
  }

  private buildAutoPlanReviewPrompt(): string {
    const completed = this.getExecutionSnapshot()
      .items.filter((item) => item.completed)
      .map((item) => `${item.step}. ${item.text}`)
      .join("\n");
    const remaining = this.getExecutionSnapshot()
      .items.filter((item) => !item.completed)
      .map((item) => `${item.step}. ${item.text}`)
      .join("\n");

    return [
      "Review progress against the approved long-term goal.",
      `Long-term goal: ${this.autoPlanGoal}`,
      completed ? "Completed high-level tasks:" : undefined,
      completed || undefined,
      remaining ? "Current remaining high-level backlog before review:" : undefined,
      remaining || undefined,
      "Inspect the current repo state if needed.",
      "Do not ask the user questions.",
      "Do not request approval.",
      "Return either exactly 'Status: COMPLETE' if the long-term goal is finished, or return a remaining high-level Plan: section with numbered executable tasks.",
      "If work remains, end with: Continue autoplan.",
    ]
      .filter((line): line is string => typeof line === "string" && line.length > 0)
      .join("\n");
  }

  private async handleAutoPlanReviewAgentEnd(
    _event: AgentEndEvent,
    ctx: ExtensionContext,
    messages: unknown[],
    lastAssistantText: string | undefined,
  ): Promise<GuidedWorkflowResult> {
    const correlationFailure = validateAutoPlanReviewResponse(this.autoPlanReview, messages);
    if (correlationFailure) {
      return correlationFailure;
    }

    if (!lastAssistantText) {
      return this.retryAutoPlanReview(ctx, "Autoplan review returned no usable output.");
    }

    const reviewOutcome = this.applyAutoPlanReviewText(lastAssistantText, ctx);
    if (reviewOutcome === "retry") {
      return this.retryAutoPlanReview(
        ctx,
        "Autoplan couldn't extract a remaining task list. Asking for a stricter restatement.",
        buildAutoPlanReviewParseRecoveryPrompt(lastAssistantText),
        { parseRecovery: true },
      );
    }

    this.resetAutoPlanReviewState();

    if (reviewOutcome === "complete") {
      await this.finishAutoPlan(ctx, "Autoplan complete.");
      return { kind: "ok" };
    }

    this.setStatus(ctx);
    await this.startNextAutoPlanSubtask(ctx);
    return { kind: "ok" };
  }

  private applyAutoPlanReviewText(
    reviewText: string,
    ctx: ExtensionContext,
  ): AutoPlanReviewOutcome {
    const remainingItems = extractTodoItems(reviewText);
    if (remainingItems.length === 0) {
      if (isAutoPlanCompleteResponse(reviewText)) {
        return "complete";
      }

      if (!this.autoPlanReview.parseRecoveryAttempted) {
        return "retry";
      }

      notify(
        this.pi,
        ctx,
        "Autoplan couldn't update the remaining backlog cleanly, so it will continue with the existing tracked tasks.",
        "warning",
      );
      return this.getCurrentOuterExecutionItem() ? "continue" : "complete";
    }

    this.replaceOuterExecutionBacklog(remainingItems);
    return this.getCurrentOuterExecutionItem() ? "continue" : "complete";
  }

  private async retryAutoPlanReview(
    ctx: ExtensionContext,
    message: string,
    promptOverride?: string,
    options: { parseRecovery?: boolean } = {},
  ): Promise<GuidedWorkflowResult> {
    const maxMissingOutputRetries = 2;
    if (!options.parseRecovery) {
      this.autoPlanReview.missingOutputRetries += 1;
      if (this.autoPlanReview.missingOutputRetries > maxMissingOutputRetries) {
        await this.continueAutoPlanAfterReviewFallback(
          ctx,
          `${message} Continuing with the existing approved backlog instead.`,
        );
        return { kind: "recoverable_error", reason: "autoplan_review_failed" };
      }
    }

    if (options.parseRecovery) {
      if (this.autoPlanReview.parseRecoveryAttempted) {
        await this.continueAutoPlanAfterReviewFallback(
          ctx,
          `${message} Continuing with the existing approved backlog instead.`,
        );
        return { kind: "recoverable_error", reason: "autoplan_review_unparseable" };
      }
      this.autoPlanReview.parseRecoveryAttempted = true;
    }

    notify(this.pi, ctx, message, options.parseRecovery ? "warning" : "warning");
    return this.sendAutoPlanReviewPrompt(promptOverride ?? this.autoPlanReview.prompt ?? "", ctx);
  }

  private sendAutoPlanReviewPrompt(prompt: string, ctx: ExtensionContext): GuidedWorkflowResult {
    if (!prompt) {
      return { kind: "recoverable_error", reason: "missing_autoplan_review_prompt" };
    }

    const requestId = this.nextAutoPlanReviewRequestId();
    const promptWithRequestId = `${prompt}\n\n${buildWorkflowRequestIdMarker(requestId)}`;
    this.autoPlanReview.pendingRequestId = requestId;
    this.autoPlanReview.awaitingResponse = true;
    this.autoPlanReview.prompt = prompt;

    try {
      this.pi.sendMessage(
        {
          customType: "autoplan-review-internal",
          content: promptWithRequestId,
          display: false,
        },
        {
          triggerTurn: true,
          deliverAs: "followUp",
        },
      );
      return { kind: "ok" };
    } catch {
      void this.continueAutoPlanAfterReviewFallback(
        ctx,
        "Autoplan couldn't resend the progress review prompt, so it will continue with the existing approved backlog.",
      );
      return { kind: "recoverable_error", reason: "autoplan_review_send_failed" };
    }
  }

  private async continueAutoPlanAfterReviewFallback(
    ctx: ExtensionContext,
    message: string,
  ): Promise<void> {
    this.resetAutoPlanReviewState();
    notify(this.pi, ctx, message, "warning");

    if (this.getCurrentOuterExecutionItem()) {
      this.setStatus(ctx);
      await this.startNextAutoPlanSubtask(ctx);
      return;
    }

    await this.finishAutoPlan(ctx, "Autoplan complete.");
  }

  private replaceOuterExecutionBacklog(remainingItems: TodoItem[]): void {
    const completedItems = this.getExecutionSnapshot().items.filter((item) => item.completed);
    const nextItems = [
      ...completedItems.map((item, index) => ({
        step: index + 1,
        text: item.text,
        completed: true,
      })),
      ...remainingItems.map((item, index) => ({
        step: completedItems.length + index + 1,
        text: item.text,
        completed: false,
      })),
    ];

    this.setOuterExecutionItems(nextItems);
    this.setOuterLatestPlanText(buildSyntheticPlanText(nextItems));
    this.todoItems = nextItems.map((item) => ({ ...item }));
  }

  private markOuterExecutionStepCompleted(step: number): void {
    const internals = this.getOuterGuidedInternals();
    const items = internals.executionItems ?? [];
    const target = items.find((item) => item.step === step);
    if (target) {
      target.completed = true;
    }
  }

  private getCurrentOuterExecutionItem(): GuidedWorkflowExecutionItem | undefined {
    return this.getExecutionSnapshot().items.find((item) => !item.completed);
  }

  private setOuterExecutionItems(items: GuidedWorkflowExecutionItem[]): void {
    const internals = this.getOuterGuidedInternals();
    internals.executionItems = items.map((item) => ({ ...item }));
  }

  private setOuterLatestPlanText(planText: string): void {
    const internals = this.getOuterGuidedInternals();
    internals.latestPlanText = planText;
    this.latestPlanDraft = planText;
  }

  private getOuterGuidedInternals(): {
    executionItems?: GuidedWorkflowExecutionItem[];
    latestPlanText?: string;
  } {
    return this as unknown as {
      executionItems?: GuidedWorkflowExecutionItem[];
      latestPlanText?: string;
    };
  }

  private nextAutoPlanReviewRequestId(): string {
    const current = Number((this.autoPlanReview.pendingRequestId ?? "").match(/(\d+)$/)?.[1] ?? 0);
    return `${STATUS_KEY}-autoplan-review-${current + 1}`;
  }

  private resetAutoPlanReviewState(): void {
    this.autoPlanReview = {
      awaitingResponse: false,
      missingOutputRetries: 0,
      parseRecoveryAttempted: false,
    };
  }

  private clearAutoPlanState(): void {
    this.autoPlanMode = "off";
    this.autoPlanGoal = "";
    this.autoPlanPendingStart = false;
    this.autoPlanOuterStep = undefined;
    this.resetAutoPlanReviewState();
  }

  private async finishAutoPlan(ctx: ExtensionContext, message: string): Promise<void> {
    await this.autoPlanSubtaskWorkflow.handleSessionShutdown({ reason: "autoplan-finished" }, ctx);
    await super.handleSessionShutdown({ reason: "autoplan-finished" }, ctx);
    this.todoItems = [];
    this.resetExecutionState();
    this.resetPlanningDraft();
    this.clearAutoPlanState();
    this.setStatus(ctx);
    notify(this.pi, ctx, message, "info");
  }

  private async stopAutoPlan(ctx: ExtensionContext, message: string): Promise<void> {
    if (this.planModeEnabled || this.restoreTools) {
      this.restoreNormalTools();
    }
    await this.autoPlanSubtaskWorkflow.handleSessionShutdown({ reason: "autoplan-stopped" }, ctx);
    await super.handleSessionShutdown({ reason: "autoplan-stopped" }, ctx);
    this.planModeEnabled = false;
    this.todoItems = [];
    this.resetExecutionState();
    this.resetPlanningDraft();
    this.clearAutoPlanState();
    this.setStatus(ctx);
    notify(this.pi, ctx, message, "info");
  }

  private getExecutionPrompt(): string {
    const remaining = this.todoItems.filter((item) => !item.completed);
    const currentStep = remaining[0];

    if (!currentStep) {
      return "[APPROVED PLAN EXECUTION]\nFinish implementation and verification.";
    }

    const currentDetails = describeExecutionStep(this.getLatestPlanText(), currentStep);
    const backlog = remaining.map((item) => `${item.step}. ${item.text}`).join("\n");
    return [
      "[APPROVED PLAN EXECUTION]",
      `Current step: ${currentStep.step}. ${currentDetails.objective}`,
      currentDetails.targets ? `Target files/components: ${currentDetails.targets}` : undefined,
      currentDetails.validation ? `Validation method: ${currentDetails.validation}` : undefined,
      currentDetails.risks ? `Risks and rollback notes: ${currentDetails.risks}` : undefined,
      this.executionConstraintNote
        ? `User execution note: ${this.executionConstraintNote}`
        : undefined,
      "",
      "Remaining plan backlog (for context only):",
      backlog,
      "",
      EXECUTION_COMMIT_RULES,
    ]
      .filter((line): line is string => typeof line === "string")
      .join("\n");
  }

  private buildExecutionPrompt(
    currentStep: GuidedWorkflowExecutionItem,
    planText: string,
    note?: string,
  ): string {
    if (
      this.autoPlanMode === "executing" &&
      this.getStateSnapshot().phase === "executing" &&
      this.autoPlanSubtaskWorkflow.getStateSnapshot().phase === "idle"
    ) {
      return "";
    }

    const stepDetails = describeExecutionStep(planText, currentStep);

    return [
      EXECUTION_TRIGGER_PROMPT,
      `Complete only step ${currentStep.step}: ${stepDetails.objective}`,
      note ? `Honor this user execution note while implementing the step: ${note}` : undefined,
      stepDetails.targets ? `Target files/components: ${stepDetails.targets}` : undefined,
      stepDetails.validation ? `Validation method: ${stepDetails.validation}` : undefined,
      stepDetails.risks ? `Risks and rollback notes: ${stepDetails.risks}` : undefined,
      "Implement it, validate it, and create one atomic jujutsu commit for that step before ending the turn.",
      "Use `jj commit <changed paths> -m <message>`, follow Conventional Commits, include a detailed description, and finish with the matching [DONE:n] marker after the commit succeeds.",
      "Do not start the following step in the same turn.",
    ]
      .filter((line): line is string => typeof line === "string")
      .join("\n");
  }

  private syncExecutionShadowFromGuided(
    previousPhase: string,
    previousExecution: { note?: string; items: GuidedWorkflowExecutionItem[] },
    ctx: ExtensionContext,
  ): void {
    const currentPhase = this.getStateSnapshot().phase;
    const execution = this.getExecutionSnapshot();

    if (currentPhase === "executing") {
      this.executionMode = execution.items.length > 0;
      this.executionConstraintNote = execution.note ?? this.executionConstraintNote;
      this.todoItems = this.buildCompactTodoItems(this.getLatestPlanText(), execution.items);
      this.setStatus(ctx);
      return;
    }

    if (previousPhase === "executing" && previousExecution.items.length > 0) {
      this.executionMode = false;
      this.executionConstraintNote = "";
      this.setStatus(ctx);
      notify(this.pi, ctx, "All tracked plan steps are complete.", "info");
    }
  }

  private getPlanTools(): string[] {
    const available = new Set(this.getAllToolNames());
    const planTools = PLAN_TOOL_CANDIDATES.filter((tool) => available.has(tool));
    if (planTools.length > 0) {
      return [...planTools];
    }

    const fallback = this.pi.getActiveTools().filter((tool) => !WRITE_LIKE_TOOLS.has(tool));
    return [...new Set(fallback)];
  }

  private restoreNormalTools(): void {
    const toolsToRestore =
      this.restoreTools && this.restoreTools.length > 0
        ? [...this.restoreTools]
        : [...this.getAllToolNames()];
    if (toolsToRestore.length > 0) {
      this.pi.setActiveTools(toolsToRestore);
    }
    this.restoreTools = null;
  }

  private updateTodoWidget(ctx: ExtensionContext): void {
    if (!ctx.hasUI) {
      return;
    }

    const progress = this.getExecutionProgressView();
    if (progress.totalSteps === 0) {
      ctx.ui.setWidget(TODO_WIDGET_KEY, undefined);
      return;
    }

    const widgetItems = selectVisibleTodoItems(progress.todoItems);
    const lines = widgetItems.items.map((item) => {
      if (item.completed) {
        return (
          ctx.ui.theme.fg("success", "☑ ") +
          ctx.ui.theme.fg("muted", ctx.ui.theme.strikethrough(item.text))
        );
      }
      return `${ctx.ui.theme.fg("muted", "☐ ")}${item.text}`;
    });

    if (widgetItems.hiddenBefore > 0) {
      lines.unshift(
        ctx.ui.theme.fg(
          "dim",
          `… ${widgetItems.hiddenBefore} earlier item${widgetItems.hiddenBefore === 1 ? "" : "s"} hidden`,
        ),
      );
    }

    ctx.ui.setWidget(TODO_WIDGET_KEY, lines);
  }

  private setStatus(ctx: ExtensionContext): void {
    if (!ctx.hasUI) {
      return;
    }

    const progress = this.getExecutionProgressView();
    if (progress.totalSteps > 0) {
      ctx.ui.setStatus(
        STATUS_KEY,
        ctx.ui.theme.fg("accent", `📋 ${progress.completedSteps}/${progress.totalSteps}`),
      );
      this.updateTodoWidget(ctx);
      return;
    }

    ctx.ui.setStatus(
      STATUS_KEY,
      this.planModeEnabled ? ctx.ui.theme.fg("warning", "⏸ plan") : undefined,
    );
    this.updateTodoWidget(ctx);
  }

  private enterPlanMode(ctx: ExtensionContext): void {
    if (this.planModeEnabled) {
      notify(this.pi, ctx, "Plan mode is already enabled.");
      return;
    }

    const currentTools = this.pi.getActiveTools();
    this.restoreTools = currentTools.length > 0 ? [...currentTools] : null;

    const planTools = this.getPlanTools();
    if (planTools.length === 0) {
      notify(this.pi, ctx, "No read-only tool set could be resolved.", "error");
      return;
    }

    this.todoItems = [];
    this.resetExecutionState();
    this.resetPlanningDraft();
    this.pi.setActiveTools(planTools);
    this.planModeEnabled = true;
    this.setStatus(ctx);
    notify(this.pi, ctx, `Plan mode enabled (read-only): ${planTools.join(", ")}`);
  }

  private exitPlanMode(
    ctx: ExtensionContext,
    reason?: string,
    options: { resetProgress?: boolean } = {},
  ): void {
    if (!this.planModeEnabled) {
      if (reason) {
        notify(this.pi, ctx, reason);
      }
      if (options.resetProgress) {
        this.resetExecutionState();
        this.todoItems = [];
        this.resetPlanningDraft();
        this.setStatus(ctx);
      }
      return;
    }

    this.planModeEnabled = false;
    this.restoreNormalTools();
    if (options.resetProgress) {
      this.resetExecutionState();
      this.todoItems = [];
      this.resetPlanningDraft();
    }
    this.setStatus(ctx);
    if (reason) {
      notify(this.pi, ctx, reason);
    }
  }
}

function notify(
  pi: ExtensionAPI,
  ctx: ExtensionContext,
  message: string,
  type: "info" | "warning" | "error" = "info",
): void {
  if (ctx.hasUI) {
    ctx.ui.notify(message, type);
    return;
  }

  pi.sendMessage({
    customType: "plan-mode-status",
    content: message,
    display: true,
  });
}

function getAssistantTextFromMessage(message: unknown): string {
  const candidate = message as {
    role?: unknown;
    content?: unknown;
  };

  if (candidate.role !== "assistant") {
    return "";
  }

  return extractMessageText(candidate.content) ?? "";
}

function extractLastPrompt(messages: unknown[]): { role?: unknown; content?: unknown } | undefined {
  const typedMessages = messages.filter(
    (message): message is { role?: unknown; content?: unknown } => {
      return typeof message === "object" && message !== null;
    },
  );

  return [...typedMessages].reverse().find((message) => {
    return message.role === "user" || message.role === "custom";
  });
}

function extractLastPromptText(messages: unknown[]): string | undefined {
  const prompt = extractLastPrompt(messages);
  return prompt ? extractMessageText(prompt.content) : undefined;
}

function extractMessageText(content: unknown): string | undefined {
  if (typeof content === "string") {
    const text = content.trim();
    return text.length > 0 ? text : undefined;
  }

  if (!Array.isArray(content)) {
    return undefined;
  }

  const text = content
    .filter((block): block is { type?: string; text?: string } => {
      return typeof block === "object" && block !== null;
    })
    .filter((block) => block.type === "text" && typeof block.text === "string")
    .map((block) => block.text ?? "")
    .join("\n")
    .trim();

  return text.length > 0 ? text : undefined;
}

function extractRequestId(message: string): string | undefined {
  const match = message.match(/<!--\s*workflow-request-id:([^>]+)\s*-->/i);
  return match?.[1]?.trim();
}

function extractCritiqueSummary(text: string): string | undefined {
  const lines = text.split(/\r?\n/);
  for (let index = 0; index < lines.length; index++) {
    const normalizedLine = lines[index]?.replace(/\*+/g, "").trim() ?? "";
    const sameLineMatch = normalizedLine.match(/(?:^\d+[.)]\s*)?Summary\s*(?::|-|–|—)\s*(.+)$/i);
    if (sameLineMatch?.[1]) {
      return sameLineMatch[1].replace(/^[-•]\s*/, "").trim();
    }

    if (/(?:^\d+[.)]\s*)?Summary\s*(?::)?$/i.test(normalizedLine)) {
      for (let nextIndex = index + 1; nextIndex < lines.length; nextIndex++) {
        const nextLine = lines[nextIndex]?.replace(/\*+/g, "").trim() ?? "";
        if (!nextLine) {
          continue;
        }
        return nextLine.replace(/^[-•]\s*/, "").trim();
      }
    }
  }

  return undefined;
}

function buildReviewBadges(planText: string, steps: PlanStep[]): string[] {
  const badges: string[] = [];
  const normalized = planText.toLowerCase();

  if (steps.length > 0 && steps.length <= 5) {
    badges.push("compact steps");
  }
  if (/validation/i.test(planText) || /test/i.test(planText)) {
    badges.push("validation noted");
  }
  if (/risks? and rollback notes?/i.test(planText) || /rollback/i.test(planText)) {
    badges.push("rollback noted");
  }
  if (/uncertainties?\s*\/\s*assumptions/i.test(planText) || /assum/i.test(normalized)) {
    badges.push("assumptions listed");
  }

  return badges;
}

function summarizePreviewValues(values: string[], limit = 2): string | undefined {
  const normalized = values.map((value) => value.trim()).filter((value) => value.length > 0);
  if (normalized.length === 0) {
    return undefined;
  }

  const visible = normalized.slice(0, limit);
  const remaining = normalized.length - visible.length;
  const summary = visible.join(", ");
  return remaining > 0 ? `${summary} (+${remaining} more)` : summary;
}

function buildApprovalPreviewStep(step: PlanStep): PlanApprovalPreviewStep {
  return {
    step: step.step,
    label: step.label,
    targetsSummary: summarizePreviewValues(step.targets),
    validationSummary: summarizePreviewValues(step.validation),
  };
}

export function buildApprovalReviewState(
  planText: string,
  options: { critiqueSummary?: string; wasRevised?: boolean } = {},
): ApprovalReviewState {
  const steps = extractPlanSteps(planText);

  return {
    stepCount: steps.length,
    previewSteps: steps.slice(0, 3).map(buildApprovalPreviewStep),
    critiqueSummary: options.critiqueSummary,
    badges: buildReviewBadges(planText, steps),
    wasRevised: options.wasRevised ?? false,
  };
}

function summarizeExecutionValues(values: string[]): string | undefined {
  const normalized = values.map((value) => value.trim()).filter((value) => value.length > 0);
  return normalized.length > 0 ? normalized.join("; ") : undefined;
}

function describeExecutionStep(
  planText: string | undefined,
  currentStep: Pick<GuidedWorkflowExecutionItem, "step" | "text">,
): {
  objective: string;
  targets?: string;
  validation?: string;
  risks?: string;
} {
  const structuredStep = planText
    ? extractPlanSteps(planText).find((step) => step.step === currentStep.step)
    : undefined;

  return {
    objective: structuredStep?.objective ?? currentStep.text,
    targets: structuredStep ? summarizeExecutionValues(structuredStep.targets) : undefined,
    validation: structuredStep ? summarizeExecutionValues(structuredStep.validation) : undefined,
    risks: structuredStep ? summarizeExecutionValues(structuredStep.risks) : undefined,
  };
}

function selectVisibleTodoItems(
  todoItems: TodoItem[],
  maxVisibleLines: number = MAX_VISIBLE_TODO_WIDGET_LINES,
): {
  hiddenBefore: number;
  items: TodoItem[];
} {
  if (todoItems.length <= maxVisibleLines) {
    return { hiddenBefore: 0, items: [...todoItems] };
  }

  const currentIndex = todoItems.findIndex((item) => !item.completed);
  if (currentIndex < 0) {
    const start = Math.max(0, todoItems.length - maxVisibleLines);
    return {
      hiddenBefore: start,
      items: todoItems.slice(start),
    };
  }

  if (currentIndex < maxVisibleLines) {
    return {
      hiddenBefore: 0,
      items: todoItems.slice(0, maxVisibleLines),
    };
  }

  const visibleTaskLines = Math.max(1, maxVisibleLines - 1);
  const start = Math.max(0, currentIndex - 1);
  return {
    hiddenBefore: start,
    items: todoItems.slice(start, start + visibleTaskLines),
  };
}

function buildParseRecoveryPrompt(draftText: string): string {
  return [
    "The previous response did not include a parseable plan.",
    "Restate the same proposed implementation plan using the required plan output contract.",
    "Keep the same scope and intent.",
    "Include an explicit Plan: section with numbered executable steps.",
    "End with: Ready to execute when approved.",
    "",
    "Previous draft:",
    draftText,
  ].join("\n");
}

function buildWorkflowRequestIdMarker(requestId: string): string {
  return `<!-- workflow-request-id:${requestId} -->`;
}

function validatePendingPlanningResponse(
  state: { pendingRequestId?: string },
  messages: unknown[],
): GuidedWorkflowResult | undefined {
  const pendingRequestId = state.pendingRequestId;
  const lastPromptText = extractLastPromptText(messages);
  const observedRequestId = lastPromptText ? extractRequestId(lastPromptText) : undefined;
  if (!pendingRequestId || observedRequestId !== pendingRequestId) {
    return { kind: "blocked", reason: "unmatched_agent_end" };
  }

  return undefined;
}

function getPendingPiPlanResponseKind(messages: unknown[]): PendingPiPlanResponseKind | undefined {
  const lastPrompt = extractLastPrompt(messages);
  if (!lastPrompt) {
    return undefined;
  }

  if (lastPrompt.role === "user") {
    return "planning";
  }

  const promptText = extractMessageText(lastPrompt.content);
  if (!promptText) {
    return undefined;
  }

  if (promptText.includes("Revise the latest plan using the critique below.")) {
    return "revision";
  }

  if (
    promptText.includes("Critique the latest proposed implementation plan for execution quality.")
  ) {
    return "critique";
  }

  return undefined;
}

function validateAutoPlanReviewResponse(
  review: AutoPlanReviewState,
  messages: unknown[],
): GuidedWorkflowResult | undefined {
  const pendingRequestId = review.pendingRequestId;
  const lastPromptText = extractLastPromptText(messages);
  const observedRequestId = lastPromptText ? extractRequestId(lastPromptText) : undefined;
  if (!pendingRequestId || observedRequestId !== pendingRequestId) {
    return { kind: "blocked", reason: "unmatched_agent_end" };
  }

  return undefined;
}

function buildAutoPlanReviewParseRecoveryPrompt(reviewText: string): string {
  return [
    "The previous progress review did not clearly say whether the long-term goal is complete or provide a parseable remaining Plan: section.",
    "Restate the review.",
    "If the goal is complete, reply with exactly: Status: COMPLETE",
    "Otherwise include an explicit Plan: section with numbered remaining tasks and end with: Continue autoplan.",
    "",
    "Previous review:",
    reviewText,
  ].join("\n");
}

function isAutoPlanCompleteResponse(text: string): boolean {
  return /^\s*status\s*:\s*complete\s*$/im.test(text) || /^\s*complete\s*$/im.test(text);
}

function buildSyntheticPlanText(items: GuidedWorkflowExecutionItem[]): string {
  return [
    "1) Task understanding",
    "2) Codebase findings",
    "3) Approach options / trade-offs",
    "4) Open questions / assumptions",
    "5) Plan:",
    ...items.map((item) => `${item.step}. ${item.text}`),
    "6) Ready to execute when approved.",
  ].join("\n");
}

function parsePlanGoalArg(args: unknown): string | undefined {
  if (typeof args !== "string") {
    return undefined;
  }

  const normalized = args.trim();
  return normalized.length > 0 ? normalized : undefined;
}
