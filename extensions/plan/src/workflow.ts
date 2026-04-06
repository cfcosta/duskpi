import {
  GuidedWorkflow,
  type AgentEndEvent,
  type BeforeAgentStartEvent,
  type ExtensionAPI,
  type ExtensionContext,
  type GuidedWorkflowExecutionItem,
  type GuidedWorkflowPhase,
  type GuidedWorkflowResult,
  type SessionCompactEvent,
  type ToolInfo,
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
  FullscreenPlanDashboardComponent,
  renderPlanDashboardLines,
  type PlanDashboardMode,
  type PlanDashboardSnapshot,
  type PlanDashboardStepView,
} from "./plan-dashboard-ui";
import {
  PLAN_OUTPUT_JSON_BLOCK_TAG,
  RUNTIME_PLAN_CONTRACT_VERSION,
  STRUCTURED_CHECKPOINT_KIND_VALUES,
  STRUCTURED_COORDINATION_PATTERN_VALUES,
  STRUCTURED_PLAN_STEP_KIND_VALUES,
  STRUCTURED_TASK_GEOMETRY_VALUES,
  parseTaggedPlanContract,
  parseTaggedReviewContract,
  type PlanningContractParseError,
  type PlanningContractParseResult,
  type StructuredPlanOutput,
  type StructuredReviewContinueOutput,
  type StructuredReviewOutput,
} from "./output-contract";
import {
  cleanStepText,
  detectAutoPlanOutputComplianceIssues,
  extractDoneSteps,
  extractSkippedSteps,
  findNormalizedPlanStep,
  formatCheckpointLabel,
  getCheckpointLabelsForSteps,
  getStepCheckpointMetadata,
  isSafeReadOnlyCommand,
  markTodoItemsCompleted,
  markTodoItemsSkipped,
  normalizeArg,
  normalizeStructuredPlanMetadata,
  parseCritiqueVerdict,
  type AutoPlanOutputComplianceIssue,
  type NormalizedPlanMetadata,
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

function normalizeToolName(toolName?: string): string {
  return (toolName ?? "").trim().toLowerCase();
}

function toolSupportsPlanMode(tool: ToolInfo): boolean {
  const normalizedName = normalizeToolName(tool.name);
  if (normalizedName.length === 0) {
    return false;
  }

  const capabilities = tool.capabilities;
  if (capabilities) {
    if (capabilities.mutatesWorkspace) {
      return false;
    }

    if (
      capabilities.readOnly ||
      capabilities.readsExternalResources ||
      capabilities.asksUserQuestions ||
      capabilities.executesShell
    ) {
      return true;
    }
  }

  return PLAN_TOOL_CANDIDATES.includes(normalizedName as (typeof PLAN_TOOL_CANDIDATES)[number]);
}

function isPlanWriteCapableTool(toolName?: string, tool?: ToolInfo): boolean {
  if (tool?.capabilities?.mutatesWorkspace) {
    return true;
  }

  return WRITE_LIKE_TOOLS.has(normalizeToolName(toolName));
}

function isBashToolName(toolName?: string): boolean {
  return (toolName ?? "").trim().toLowerCase() === "bash";
}

function buildPlanModeBashBlockedReason(command: string): string {
  return `Plan mode blocked a potentially mutating bash command: ${command}`;
}

const PLAN_TAGGED_JSON_CONTRACT_SUMMARY = [
  "After the human-readable markdown plan, include a fenced tagged JSON block.",
  `Use an unindented fence header exactly like: \`\`\`${PLAN_OUTPUT_JSON_BLOCK_TAG}\` on its own line, then raw JSON, then an unindented closing \`\`\`.`,
  `For planning responses, the JSON must be a runtime v${RUNTIME_PLAN_CONTRACT_VERSION} plan payload.`,
  `Use: { "version": ${RUNTIME_PLAN_CONTRACT_VERSION}, "kind": "plan", "taskGeometry": "...", "coordinationPattern": "...", "assumptions": [...], "escalationTriggers": [...], "checkpoints": [...], "steps": [...] }.`,
  `taskGeometry must be one of: ${STRUCTURED_TASK_GEOMETRY_VALUES.map((value) => `"${value}"`).join(", ")}.`,
  `coordinationPattern must be one of: ${STRUCTURED_COORDINATION_PATTERN_VALUES.map((value) => `"${value}"`).join(", ")}.`,
  `Each step.kind must be one of: ${STRUCTURED_PLAN_STEP_KIND_VALUES.map((value) => `"${value}"`).join(", ")}.`,
  `Each checkpoint.kind must be one of: ${STRUCTURED_CHECKPOINT_KIND_VALUES.map((value) => `"${value}"`).join(", ")}.`,
  "Each step object must include: step, kind, objective, targets, validation, risks, dependsOn, and checkpointIds.",
  "Each checkpoint object must include: id, title, kind, step, and why.",
  "Do not replace enum fields with prose descriptions. Put the detailed explanation in markdown, not inside enum values.",
  "The response is invalid if the tagged JSON block is missing, malformed, or schema-invalid.",
].join("\n");

const REVIEW_TAGGED_JSON_CONTRACT_SUMMARY = [
  `After the human-readable markdown review, include an unindented fenced \`\`\`${PLAN_OUTPUT_JSON_BLOCK_TAG}\` JSON block.`,
  `For review continue responses, the JSON must be a runtime v${RUNTIME_PLAN_CONTRACT_VERSION} review payload with summary, taskGeometry, coordinationPattern, assumptions, checkpoints, and steps.`,
  `Use: { "version": ${RUNTIME_PLAN_CONTRACT_VERSION}, "kind": "review", "status": "continue", "summary": "...", "taskGeometry": "...", "coordinationPattern": "...", "assumptions": [...], "checkpoints": [...], "steps": [...] }.`,
  `taskGeometry must be one of: ${STRUCTURED_TASK_GEOMETRY_VALUES.map((value) => `"${value}"`).join(", ")}.`,
  `coordinationPattern must be one of: ${STRUCTURED_COORDINATION_PATTERN_VALUES.map((value) => `"${value}"`).join(", ")}.`,
  `Each step.kind must be one of: ${STRUCTURED_PLAN_STEP_KIND_VALUES.map((value) => `"${value}"`).join(", ")}.`,
  `Each checkpoint.kind must be one of: ${STRUCTURED_CHECKPOINT_KIND_VALUES.map((value) => `"${value}"`).join(", ")}.`,
  `For review complete responses, use: { "version": ${RUNTIME_PLAN_CONTRACT_VERSION}, "kind": "review", "status": "complete", "summary": "..." }.`,
  "Do not replace enum fields with prose descriptions. Put the detailed explanation in markdown, not inside enum values.",
  "The response is invalid if the tagged JSON block is missing, malformed, or schema-invalid.",
].join("\n");

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
7) ${PLAN_TAGGED_JSON_CONTRACT_SUMMARY}
`.trim();

const YOLO_MODE_SYSTEM_PROMPT = `
[DEFAULT MODE: YOLO]
- Execute tasks directly unless the user explicitly asks for planning.
- Do NOT force a plan/approval gate in normal mode.
- The read-only plan/approval flow is only active when /plan mode is enabled.
`.trim();

const EXECUTION_TRIGGER_PROMPT =
  "Plan approved. Switch to implementation mode and execute the latest plan now.";

const EXECUTION_RESULT_TAGGED_JSON_CONTRACT_SUMMARY = [
  `After implementing or validating the step, include a fenced \`\`\`${PLAN_OUTPUT_JSON_BLOCK_TAG}\` JSON block.`,
  `Use: { "version": ${RUNTIME_PLAN_CONTRACT_VERSION}, "kind": "execution_result", "scope": "plan" | "autoplan", "step": N, "status": "done" | "skipped", "summary": "...", "changedTargets": [...], "validationsRun": [...], "checkpointsReached": [...], "outerStep": N? }.`,
  "Use status 'skipped' when the step is already satisfied or would otherwise require a fake no-op commit.",
].join("\n");

const EXECUTION_COMMIT_RULES = `
Execution rules:
- Execute exactly one todo step per agent turn.
- Work only on the next incomplete step.
- After implementing and validating that step, create one atomic jujutsu commit before ending the turn.
- Use \`jj commit <changed paths> -m <message>\`.
- Use Conventional Commits.
- Include a detailed commit description covering what changed, why, and the intended outcome.
- Never batch multiple plan steps into one commit.
- After the commit, include the required tagged execution_result JSON block for this step and stop.
- Use status "skipped" when the step is already satisfied or would otherwise require a fake no-op commit.
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
- ${PLAN_TAGGED_JSON_CONTRACT_SUMMARY}
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
- ${REVIEW_TAGGED_JSON_CONTRACT_SUMMARY}
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
type ThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh";

type ThinkingLevelAwareExtensionAPI = ExtensionAPI & {
  getThinkingLevel?: () => ThinkingLevel;
  setThinkingLevel?: (level: ThinkingLevel) => void;
};

interface ExecutionThinkingOverride {
  restoreLevel: ThinkingLevel;
  appliedLevel: ThinkingLevel;
}

interface AutoPlanReviewState {
  pendingRequestId?: string;
  awaitingResponse: boolean;
  prompt?: string;
  missingOutputRetries: number;
  parseRecoveryAttempted: boolean;
  complianceRecoveryAttempted: boolean;
  allowsCheckpointInterruptions?: boolean;
}

interface AutoPlanSubtaskExecutionResumeState {
  goal?: string;
  planText?: string;
  note?: string;
  items: GuidedWorkflowExecutionItem[];
}

interface AutoPlanExecutionComplianceState {
  attempted: boolean;
  step?: number;
}

class AutoPlanSubtaskWorkflow extends GuidedWorkflow {
  private parseRecoveryAttempted = false;
  private complianceRecoveryAttempted = false;
  private executionThinkingOverride?: ExecutionThinkingOverride;

  constructor(
    private readonly pi: ExtensionAPI,
    options: ConstructorParameters<typeof GuidedWorkflow>[1],
    private readonly allowsCheckpointInterruptions: () => boolean,
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
        const complianceIssues = detectAutoPlanOutputComplianceIssues(lastAssistantText);
        if (complianceIssues.length > 0 && !this.allowsCheckpointInterruptions()) {
          return this.handlePolicyViolation(lastAssistantText, complianceIssues, ctx);
        }

        const structuredPlan = parseTaggedPlanContract(lastAssistantText);
        if (!structuredPlan.ok) {
          return this.handleUnparseablePlanningDraft(lastAssistantText, structuredPlan, ctx);
        }
        this.parseRecoveryAttempted = false;
        this.complianceRecoveryAttempted = false;
      }
    }

    const result = await super.handleAgentEnd(event, ctx);
    if (this.getStateSnapshot().phase === "executing") {
      this.applyLowerExecutionThinkingLevel();
    }
    return result;
  }

  async handleTurnEnd(event: TurnEndEvent, ctx: ExtensionContext): Promise<void> {
    const previousPhase = this.getStateSnapshot().phase;
    await super.handleTurnEnd(event, ctx);
    if (previousPhase === "executing" && this.getStateSnapshot().phase !== "executing") {
      this.restoreExecutionThinkingLevel();
    }
  }

  async handleSessionShutdown(event: SessionShutdownEvent, ctx: ExtensionContext): Promise<void> {
    this.parseRecoveryAttempted = false;
    this.complianceRecoveryAttempted = false;
    this.restoreExecutionThinkingLevel();
    await super.handleSessionShutdown(event, ctx);
  }

  getExecutionResumeState(): AutoPlanSubtaskExecutionResumeState {
    return {
      goal: this.getStateSnapshot().goal,
      planText: this.getLatestPlanText(),
      note: this.getExecutionSnapshot().note,
      items: this.getExecutionSnapshot().items,
    };
  }

  getDashboardSnapshotState(): {
    phase: GuidedWorkflowPhase;
    planText?: string;
    items: GuidedWorkflowExecutionItem[];
  } {
    return {
      phase: this.getStateSnapshot().phase,
      planText: this.getLatestPlanText(),
      items: this.getExecutionSnapshot().items.map((item) => ({ ...item })),
    };
  }

  restoreRecoveredExecutionState(state: AutoPlanSubtaskExecutionResumeState): void {
    const internals = this as unknown as {
      state: {
        phase: "idle" | "planning" | "approval" | "executing";
        goal?: string;
        pendingRequestId?: string;
        awaitingResponse: boolean;
      };
      latestPlanText?: string;
      latestCritiqueText?: string;
      executionItems?: GuidedWorkflowExecutionItem[];
      executionNote?: string;
    };

    internals.state = {
      phase: "executing",
      goal: state.goal,
      pendingRequestId: undefined,
      awaitingResponse: false,
    };
    internals.latestPlanText = state.planText;
    internals.latestCritiqueText = undefined;
    internals.executionItems = state.items.map((item) => ({ ...item }));
    internals.executionNote = state.note;
    this.applyLowerExecutionThinkingLevel();
  }

  private hasPendingPlanningRequest(): boolean {
    const state = this.getStateSnapshot();
    return state.phase !== "idle" && state.awaitingResponse;
  }

  private applyLowerExecutionThinkingLevel(): void {
    if (this.executionThinkingOverride) {
      return;
    }

    const api = this.pi as ThinkingLevelAwareExtensionAPI;
    const getThinkingLevel = api.getThinkingLevel?.bind(api);
    const setThinkingLevel = api.setThinkingLevel?.bind(api);
    if (!getThinkingLevel || !setThinkingLevel) {
      return;
    }

    const restoreLevel = getThinkingLevel();
    const appliedLevel = lowerThinkingLevel(restoreLevel);
    if (!restoreLevel || appliedLevel === restoreLevel) {
      return;
    }

    setThinkingLevel(appliedLevel);
    this.executionThinkingOverride = {
      restoreLevel,
      appliedLevel,
    };
  }

  private restoreExecutionThinkingLevel(): void {
    const override = this.executionThinkingOverride;
    if (!override) {
      return;
    }

    this.executionThinkingOverride = undefined;

    const api = this.pi as ThinkingLevelAwareExtensionAPI;
    const getThinkingLevel = api.getThinkingLevel?.bind(api);
    const setThinkingLevel = api.setThinkingLevel?.bind(api);
    if (!setThinkingLevel) {
      return;
    }

    if (getThinkingLevel && getThinkingLevel() !== override.appliedLevel) {
      return;
    }

    setThinkingLevel(override.restoreLevel);
  }

  private async handleUnparseablePlanningDraft(
    draftText: string,
    parseError: PlanningContractParseError,
    ctx: ExtensionContext,
  ): Promise<GuidedWorkflowResult> {
    const failureDetail = formatPlanningContractParseFailure(parseError);

    if (!this.parseRecoveryAttempted) {
      this.parseRecoveryAttempted = true;
      notify(
        this.pi,
        ctx,
        `Autoplan couldn't validate the tagged JSON subtask plan contract (${failureDetail}). Asking Pi to restate the subtask plan with the required markdown + JSON format.`,
        "warning",
      );
      await super.handleSessionShutdown({ reason: "autoplan-subtask-parse-retry" }, ctx);
      return super.handleCommand(buildParseRecoveryPrompt(draftText, parseError), ctx);
    }

    this.parseRecoveryAttempted = false;
    notify(
      this.pi,
      ctx,
      `Autoplan couldn't validate the tagged JSON subtask plan contract after one retry (${failureDetail}).`,
      "error",
    );
    await super.handleSessionShutdown({ reason: "autoplan-subtask-parse-failed" }, ctx);
    return { kind: "recoverable_error", reason: "autoplan_subtask_unparseable" };
  }

  private async handlePolicyViolation(
    draftText: string,
    issues: AutoPlanOutputComplianceIssue[],
    ctx: ExtensionContext,
  ): Promise<GuidedWorkflowResult> {
    if (!this.complianceRecoveryAttempted) {
      this.complianceRecoveryAttempted = true;
      notify(
        this.pi,
        ctx,
        "Autoplan subtask planning asked for user input or approval outside a declared checkpoint or integration moment. Asking Pi to restate the subtask plan and infer the missing decisions.",
        "warning",
      );
      await super.handleSessionShutdown({ reason: "autoplan-subtask-policy-retry" }, ctx);
      return super.handleCommand(
        buildAutoPlanSubtaskComplianceRecoveryPrompt(draftText, issues),
        ctx,
      );
    }

    this.complianceRecoveryAttempted = false;
    return { kind: "recoverable_error", reason: "autoplan_subtask_policy_violation" };
  }
}

export class PiPlanWorkflow extends GuidedWorkflow {
  private planModeEnabled = false;
  private executionMode = false;
  private restoreTools: string[] | null = null;
  private todoItems: TodoItem[] = [];
  private latestPlanDraft = "";
  private latestStructuredPlan: StructuredPlanOutput | null = null;
  private latestPlanMetadata: NormalizedPlanMetadata | null = null;
  private approvalReview: ApprovalReviewState | null = null;
  private latestCritiqueSummary = "";
  private planWasRevised = false;
  private executionConstraintNote = "";
  private dashboardExpanded = false;
  private dashboardFullscreenOpen = false;
  private parseRecoveryAttempted = false;
  private executionThinkingOverride?: ExecutionThinkingOverride;
  private autoPlanMode: AutoPlanMode = "off";
  private autoPlanGoal = "";
  private autoPlanApprovedPlanText = "";
  private autoPlanPendingStart = false;
  private autoPlanOuterStep?: number;
  private latestAutoPlanReview: StructuredReviewContinueOutput | null = null;
  private autoPlanExecutionCompliance: AutoPlanExecutionComplianceState = {
    attempted: false,
  };
  private autoPlanReview: AutoPlanReviewState = {
    awaitingResponse: false,
    missingOutputRetries: 0,
    parseRecoveryAttempted: false,
    complianceRecoveryAttempted: false,
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
          PLAN_TAGGED_JSON_CONTRACT_SUMMARY,
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
            PLAN_TAGGED_JSON_CONTRACT_SUMMARY,
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
          return isPlanWriteCapableTool(toolName, self?.getToolInfo(toolName));
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
          return self.buildTopLevelExecutionItems(planText).map((item) => ({ ...item }));
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
    this.autoPlanSubtaskWorkflow = new AutoPlanSubtaskWorkflow(
      pi,
      {
        id: `${STATUS_KEY}-autoplan-subtask`,
        parseGoalArg: parsePlanGoalArg,
        buildPlanningPrompt: ({ goal }) => {
          return [
            "Plan this approved subtask in read-only mode before making any changes.",
            "Do not ask the user questions.",
            "Do not request approval.",
            "Make the best reasonable decisions from the approved parent goal, the repo, and existing patterns.",
            "Return a concrete implementation plan that follows the required plan-mode response contract.",
            PLAN_TAGGED_JSON_CONTRACT_SUMMARY,
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
              PLAN_TAGGED_JSON_CONTRACT_SUMMARY,
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
            return isPlanWriteCapableTool(toolName, self?.getToolInfo(toolName));
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
            const structuredPlan = parseTaggedPlanContract(planText);
            return structuredPlan.ok ? toTodoItemsFromStructuredPlan(structuredPlan.value) : [];
          },
          buildExecutionPrompt({ currentStep, note, planText }) {
            return self.buildExecutionPrompt(currentStep, planText, note);
          },
        },
        text: {
          alreadyRunning: "Autoplan is already processing a subtask.",
          sendFailed: "Autoplan stopped: failed to send a subtask prompt.",
        },
      },
      () => self.isAutoPlanCheckpointMomentForCurrentOuterStep(),
    );
  }

  async handleTodosCommand(_args: unknown, ctx: ExtensionContext): Promise<void> {
    clearInputEditor(ctx);

    const progress = this.getExecutionProgressView();
    if (progress.totalSteps === 0) {
      notify(this.pi, ctx, "No tracked plan steps. Create a plan in /plan mode first.", "info");
      return;
    }

    const visibleItems = selectVisibleTodoItems(progress.todoItems);
    const lines = visibleItems.items.map((item) => {
      const symbol = item.skipped ? "↷" : item.completed ? "✓" : "○";
      return `${item.step}. ${symbol} ${item.text}`;
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
    clearInputEditor(ctx);

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
    this.autoPlanApprovedPlanText = "";
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
    clearInputEditor(ctx);

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
    const toolName = normalizeToolName(event.toolName);
    const toolInfo = this.getToolInfo(event.toolName);
    if (this.isAutoPlanPostApprovalActive() && toolName === "ask_user_question") {
      if (this.autoPlanReview.awaitingResponse && !this.isAutoPlanCheckpointMomentForReview()) {
        return {
          block: true,
          reason:
            "Autoplan progress review must not ask the user new questions outside declared checkpoint or integration moments.",
        };
      }

      const autoPlanSubtaskPhase = this.autoPlanSubtaskWorkflow.getStateSnapshot().phase;
      if (
        (autoPlanSubtaskPhase === "planning" || autoPlanSubtaskPhase === "approval") &&
        !this.isAutoPlanCheckpointMomentForCurrentOuterStep()
      ) {
        return {
          block: true,
          reason:
            "Autoplan subtask planning must not ask the user new questions outside declared checkpoint or integration moments.",
        };
      }

      if (
        autoPlanSubtaskPhase === "executing" &&
        !this.isAutoPlanCheckpointMomentForCurrentOuterStep()
      ) {
        return {
          block: true,
          reason:
            "Autoplan subtask execution must not ask the user new questions outside declared checkpoint or integration moments.",
        };
      }
    }

    if (this.autoPlanReview.awaitingResponse) {
      if (isPlanWriteCapableTool(event.toolName, toolInfo)) {
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
      return this.autoPlanSubtaskWorkflow.handleToolCall(event, ctx);
    }

    if (!this.planModeEnabled) {
      return;
    }

    if (this.getStateSnapshot().phase !== "idle") {
      return super.handleToolCall(event, ctx);
    }

    if (isPlanWriteCapableTool(event.toolName, toolInfo)) {
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
      const resumeState =
        beforePhase === "executing"
          ? this.autoPlanSubtaskWorkflow.getExecutionResumeState()
          : undefined;
      const turnText = getAssistantTextFromMessage(event.message);

      if (beforePhase === "executing" && turnText) {
        const complianceIssues = detectAutoPlanOutputComplianceIssues(turnText);
        if (complianceIssues.length > 0 && !this.isAutoPlanCheckpointMomentForCurrentOuterStep()) {
          await this.handleAutoPlanExecutionPolicyViolation(
            ctx,
            resumeState,
            turnText,
            complianceIssues,
          );
          return;
        }
        this.resetAutoPlanExecutionComplianceState();
      }

      await this.autoPlanSubtaskWorkflow.handleTurnEnd(event, ctx);
      const afterPhase = this.autoPlanSubtaskWorkflow.getStateSnapshot().phase;
      if (beforePhase === "executing" && afterPhase === "idle") {
        await this.handleCompletedAutoPlanSubtask(ctx, { resumeState, turnText });
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
      const result = await this.autoPlanSubtaskWorkflow.handleAgentEnd(event, ctx);
      if (result.reason === "autoplan_subtask_policy_violation") {
        await this.stopAutoPlan(
          ctx,
          "Autoplan subtask planning kept asking for user input or approval outside declared checkpoint or integration moments after one retry. Stopping autoplan.",
          "error",
        );
      } else if (result.reason === "autoplan_subtask_unparseable") {
        await this.stopAutoPlan(
          ctx,
          "Autoplan subtask planning kept returning invalid tagged JSON after one retry. Stopping autoplan.",
          "error",
        );
      } else {
        this.setStatus(ctx);
      }
      return result;
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
        if (!captured.ok) {
          return this.handleUnparseablePlanningDraft(lastAssistantText, captured, ctx);
        }

        notify(this.pi, ctx, "Reviewing the plan with a critique pass before approval.", "info");
        return this.beginCritiqueFlow(lastAssistantText, ctx);
      }

      if (pendingResponseKind === "revision") {
        if (!lastAssistantText) {
          return super.handleAgentEnd(event, ctx);
        }

        const captured = this.capturePlanDraft(lastAssistantText, ctx);
        if (captured.ok) {
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
    if (!captured.ok) {
      return this.handleUnparseablePlanningDraft(lastAssistantText, captured, ctx);
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
    this.syncLocalLifecycleStateFromGuided();
    this.setStatus(ctx);
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
    this.resetDashboardPresentationState();
    if (!ctx.hasUI) {
      return;
    }

    ctx.ui.setStatus(STATUS_KEY, undefined);
    ctx.ui.setWidget(TODO_WIDGET_KEY, undefined);
  }

  async handleDashboardToggleShortcut(ctx: ExtensionContext): Promise<void> {
    this.toggleTopLevelDashboardExpanded(ctx);
  }

  async handleDashboardFullscreenShortcut(ctx: ExtensionContext): Promise<void> {
    if (!ctx.hasUI) {
      return;
    }

    await this.openTopLevelDashboardFullscreen(ctx);
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
    parseError: PlanningContractParseError,
    ctx: ExtensionContext,
  ): Promise<GuidedWorkflowResult> {
    const failureDetail = formatPlanningContractParseFailure(parseError);

    if (!this.parseRecoveryAttempted) {
      this.parseRecoveryAttempted = true;
      notify(
        this.pi,
        ctx,
        `Couldn't validate the tagged JSON plan contract (${failureDetail}). Asking Pi to restate the same draft with the required markdown + JSON format.`,
        "warning",
      );
      return this.startPlanningRequest(this.buildParseRecoveryPrompt(draftText, parseError), ctx);
    }

    this.resetParseRecoveryState();
    this.setStatus(ctx);
    notify(
      this.pi,
      ctx,
      `Couldn't validate the tagged JSON plan contract after one automatic retry (${failureDetail}). Still in read-only plan mode.`,
      "error",
    );
    return { kind: "ok" };
  }

  private buildParseRecoveryPrompt(
    draftText: string,
    parseError?: PlanningContractParseError,
  ): string {
    return buildParseRecoveryPrompt(draftText, parseError);
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
    this.approvalReview = buildApprovalReviewState(
      args.planText,
      {
        critiqueSummary: this.latestCritiqueSummary || undefined,
        wasRevised: this.planWasRevised,
      },
      this.latestStructuredPlan,
      this.latestPlanMetadata,
    );
    this.setStatus(ctx);
    notify(this.pi, ctx, "Plan critique passed. Review and approve when ready.", "info");

    if (!ctx.hasUI) {
      notifyHeadlessApprovalInstructions(this.pi, ctx);
      return { cancelled: true };
    }

    let selection;
    try {
      selection = await selectPlanNextActionWithInlineNote(
        ctx.ui as never,
        this.approvalReview ??
          buildApprovalReviewState(
            args.planText,
            {
              critiqueSummary: this.latestCritiqueSummary || undefined,
              wasRevised: this.planWasRevised,
            },
            this.latestStructuredPlan,
            this.latestPlanMetadata,
          ),
      );
    } catch (error) {
      notify(
        this.pi,
        ctx,
        `Plan approval UI failed to open (${formatUiFailure(error)}). Approval is still pending.`,
        "warning",
      );
      notifyHeadlessApprovalInstructions(this.pi, ctx);
      return { cancelled: true };
    }

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
    const firstOpenStep = this.todoItems.find((item) => !item.completed && !item.skipped);
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
      this.autoPlanApprovedPlanText = this.getLatestPlanText()?.trim() ?? "";
    }
    if (!this.autoPlanPendingStart && this.executionMode) {
      this.applyLowerExecutionThinkingLevel();
    }
    this.resetApprovalReview();
    this.resetParseRecoveryState();
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

  private capturePlanDraft(
    planText: string,
    ctx: ExtensionContext,
  ): PlanningContractParseResult<StructuredPlanOutput> {
    const structuredPlan = parseTaggedPlanContract(planText);
    if (!structuredPlan.ok) {
      return structuredPlan;
    }

    const extracted = toTodoItemsFromStructuredPlan(structuredPlan.value);
    if (extracted.length === 0) {
      return {
        ok: false,
        code: "invalid_schema",
        message: "Plan payload must contain at least one executable step.",
      };
    }

    this.resetParseRecoveryState();
    this.latestPlanDraft = planText;
    this.latestStructuredPlan = structuredPlan.value;
    this.latestPlanMetadata = normalizeStructuredPlanMetadata(structuredPlan.value);
    this.todoItems = extracted;
    this.approvalReview = buildApprovalReviewState(
      planText,
      {
        critiqueSummary: this.latestCritiqueSummary || undefined,
        wasRevised: this.planWasRevised,
      },
      structuredPlan.value,
      this.latestPlanMetadata,
    );
    this.setStatus(ctx);
    return structuredPlan;
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
      completedSteps: executionItems.filter((item) => item.completed || item.skipped).length,
    };
  }

  private buildCompactTodoItems(
    planText: string | undefined,
    executionItems: GuidedWorkflowExecutionItem[],
  ): TodoItem[] {
    const planMetadata = resolvePlanMetadata(
      planText,
      this.latestPlanMetadata,
      this.latestStructuredPlan,
    );
    const metadataTodoItems = planMetadata ? toTodoItemsFromPlanMetadata(planMetadata) : [];
    if (metadataTodoItems.length === 0) {
      return executionItems.map((item) => ({
        step: item.step,
        text: item.text,
        completed: item.completed,
        skipped: item.skipped,
      }));
    }

    const completedSteps = executionItems.filter((item) => item.completed).map((item) => item.step);
    const skippedSteps = executionItems.filter((item) => item.skipped).map((item) => item.step);
    markTodoItemsCompleted(metadataTodoItems, completedSteps);
    markTodoItemsSkipped(metadataTodoItems, skippedSteps);
    return metadataTodoItems;
  }

  private buildTopLevelExecutionItems(planText: string): TodoItem[] {
    const planMetadata = resolvePlanMetadata(
      planText,
      this.latestPlanMetadata,
      this.latestStructuredPlan,
    );
    return planMetadata ? toTodoItemsFromPlanMetadata(planMetadata) : [];
  }

  private syncLocalLifecycleStateFromGuided(): void {
    const state = this.getStateSnapshot();
    const execution = this.getExecutionSnapshot();
    const latestPlanText = this.getLatestPlanText();
    const structuredPlan = resolveStructuredPlan(latestPlanText, this.latestStructuredPlan);

    this.planModeEnabled = state.phase === "planning" || state.phase === "approval";
    this.executionMode = state.phase === "executing" && execution.items.length > 0;
    this.executionConstraintNote = execution.note ?? "";
    this.latestStructuredPlan = structuredPlan ?? null;
    this.latestPlanMetadata = structuredPlan
      ? normalizeStructuredPlanMetadata(structuredPlan)
      : null;
    this.todoItems = this.buildCompactTodoItems(latestPlanText, execution.items);
    this.latestPlanDraft = latestPlanText ?? "";
  }

  private resetLocalLifecycleState(): void {
    this.planModeEnabled = false;
    this.restoreTools = null;
    this.todoItems = [];
    this.resetDashboardPresentationState();
    this.resetExecutionState();
    this.resetPlanningDraft();
    this.clearAutoPlanState();
  }

  private getAllToolInfos(): ToolInfo[] {
    return this.pi.getAllTools().map((tool) => ({ ...tool }));
  }

  private getAllToolNames(): string[] {
    return this.getAllToolInfos().map((tool) => tool.name);
  }

  private getToolInfo(toolName?: string): ToolInfo | undefined {
    const normalizedName = normalizeToolName(toolName);
    return this.getAllToolInfos().find((tool) => normalizeToolName(tool.name) === normalizedName);
  }

  private resetApprovalReview(): void {
    this.approvalReview = null;
    this.latestCritiqueSummary = "";
    this.planWasRevised = false;
  }

  private resetPlanningDraft(): void {
    this.latestPlanDraft = "";
    this.latestStructuredPlan = null;
    this.latestPlanMetadata = null;
    this.resetDashboardPresentationState();
    this.resetApprovalReview();
    this.resetParseRecoveryState();
  }

  private resetParseRecoveryState(): void {
    this.parseRecoveryAttempted = false;
  }

  private resetExecutionState(): void {
    this.executionMode = false;
    this.executionConstraintNote = "";
    this.restoreExecutionThinkingLevel();
  }

  private applyLowerExecutionThinkingLevel(): void {
    const api = this.pi as ThinkingLevelAwareExtensionAPI;
    const getThinkingLevel = api.getThinkingLevel?.bind(api);
    const setThinkingLevel = api.setThinkingLevel?.bind(api);
    if (!getThinkingLevel || !setThinkingLevel) {
      return;
    }

    const restoreLevel = getThinkingLevel();
    const appliedLevel = lowerThinkingLevel(restoreLevel);
    if (!restoreLevel || appliedLevel === restoreLevel) {
      this.executionThinkingOverride = undefined;
      return;
    }

    setThinkingLevel(appliedLevel);
    this.executionThinkingOverride = {
      restoreLevel,
      appliedLevel,
    };
  }

  private restoreExecutionThinkingLevel(): void {
    const override = this.executionThinkingOverride;
    if (!override) {
      return;
    }

    this.executionThinkingOverride = undefined;

    const api = this.pi as ThinkingLevelAwareExtensionAPI;
    const getThinkingLevel = api.getThinkingLevel?.bind(api);
    const setThinkingLevel = api.setThinkingLevel?.bind(api);
    if (!setThinkingLevel) {
      return;
    }

    if (getThinkingLevel && getThinkingLevel() !== override.appliedLevel) {
      return;
    }

    setThinkingLevel(override.restoreLevel);
  }

  private isAutoPlanPostApprovalActive(): boolean {
    return this.autoPlanMode === "executing";
  }

  private getApprovedAutoPlanContextLines(): string[] {
    const approvedPlanText = this.autoPlanApprovedPlanText.trim();
    if (approvedPlanText.length === 0) {
      return [];
    }

    return ["Approved top-level plan context:", approvedPlanText];
  }

  private resetAutoPlanExecutionComplianceState(): void {
    this.autoPlanExecutionCompliance = { attempted: false };
  }

  private hasCheckpointMetadataForOuterStep(step?: number): boolean {
    if (typeof step !== "number") {
      return false;
    }

    return getStepCheckpointMetadata(this.latestPlanMetadata ?? undefined, step).length > 0;
  }

  private isAutoPlanCheckpointMomentForCurrentOuterStep(): boolean {
    if (typeof this.autoPlanOuterStep === "number") {
      return this.hasCheckpointMetadataForOuterStep(this.autoPlanOuterStep);
    }

    return this.hasCheckpointMetadataForOuterStep(this.getCurrentOuterExecutionItem()?.step);
  }

  private isAutoPlanCheckpointMomentForReview(): boolean {
    return this.autoPlanReview.allowsCheckpointInterruptions === true;
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
    this.setStatus(ctx);

    if (result.kind !== "ok") {
      notify(this.pi, ctx, "Autoplan couldn't start the next approved subtask.", "error");
    }
  }

  private buildAutoPlanSubtaskGoal(currentStep: GuidedWorkflowExecutionItem): string {
    const remaining = this.getExecutionSnapshot().items.filter(
      (item) => !item.completed && !item.skipped,
    );
    const backlog = remaining.map((item) => `${item.step}. ${item.text}`).join("\n");
    const currentStepMetadata = findNormalizedPlanStep(
      this.latestPlanMetadata ?? undefined,
      currentStep.step,
    );
    const currentStepCheckpoints = getStepCheckpointMetadata(
      this.latestPlanMetadata ?? undefined,
      currentStep.step,
    );

    return [
      `Long-term goal: ${this.autoPlanGoal}`,
      ...this.getApprovedAutoPlanContextLines(),
      `Current approved high-level task ${currentStep.step}: ${currentStep.text}`,
      currentStepMetadata && currentStepMetadata.dependsOn.length > 0
        ? `This high-level task depends on approved steps: ${currentStepMetadata.dependsOn.join(", ")}`
        : undefined,
      currentStepCheckpoints.length > 0
        ? "Declared checkpoints for this high-level task:"
        : undefined,
      ...currentStepCheckpoints.map(
        (checkpoint) => `- ${formatCheckpointLabel(checkpoint)}: ${checkpoint.why}`,
      ),
      currentStepCheckpoints.length > 0
        ? "Preserve the declared checkpoint or integration boundaries while planning this subtask."
        : undefined,
      backlog.length > 0 ? "Remaining high-level backlog for context:" : undefined,
      backlog.length > 0 ? backlog : undefined,
      "Plan only the current approved high-level task.",
      "Do not ask the user questions.",
      "Do not ask for approval.",
    ]
      .filter((line): line is string => typeof line === "string" && line.length > 0)
      .join("\n");
  }

  private async handleCompletedAutoPlanSubtask(
    ctx: ExtensionContext,
    options: { resumeState?: AutoPlanSubtaskExecutionResumeState; turnText?: string } = {},
  ): Promise<void> {
    if (typeof this.autoPlanOuterStep !== "number") {
      return;
    }

    if (
      options.resumeState &&
      this.tryResumeRecoveredAutoPlanSubtask(options.resumeState, options.turnText ?? "", ctx)
    ) {
      return;
    }

    const completedOuterStep = this.autoPlanOuterStep;
    this.markOuterExecutionStepCompleted(completedOuterStep);
    this.autoPlanOuterStep = undefined;
    this.todoItems = this.buildCompactTodoItems(
      this.getLatestPlanText(),
      this.getExecutionSnapshot().items,
    );
    this.setStatus(ctx);
    await this.startAutoPlanReview(ctx, completedOuterStep);
  }

  private tryResumeRecoveredAutoPlanSubtask(
    resumeState: AutoPlanSubtaskExecutionResumeState,
    turnText: string,
    ctx: ExtensionContext,
  ): boolean {
    const planText = resumeState.planText?.trim();
    if (!planText) {
      return false;
    }

    const recoveredItems = recoverImplicitlyIndentedSubtaskItems(planText, resumeState.items);
    if (recoveredItems.length <= resumeState.items.length) {
      return false;
    }

    const completedSteps = new Set(
      resumeState.items.filter((item) => item.completed).map((item) => item.step),
    );
    const skippedSteps = new Set(
      resumeState.items.filter((item) => item.skipped).map((item) => item.step),
    );
    for (const step of extractDoneSteps(turnText)) {
      completedSteps.add(step);
    }
    for (const step of extractSkippedSteps(turnText)) {
      skippedSteps.add(step);
    }
    markTodoItemsCompleted(recoveredItems, [...completedSteps]);
    markTodoItemsSkipped(recoveredItems, [...skippedSteps]);

    const currentStep = recoveredItems.find((item) => !item.completed && !item.skipped);
    if (!currentStep) {
      return false;
    }

    this.autoPlanSubtaskWorkflow.restoreRecoveredExecutionState({
      ...resumeState,
      planText,
      items: recoveredItems.map((item) => ({ ...item })),
    });

    const prompt = this.buildExecutionPrompt(currentStep, planText, resumeState.note);
    if (!prompt) {
      return false;
    }

    this.pi.sendUserMessage(prompt, { deliverAs: "followUp" });
    this.setStatus(ctx);
    return true;
  }

  private async startAutoPlanReview(
    ctx: ExtensionContext,
    completedOuterStep?: number,
  ): Promise<void> {
    const prompt = this.buildAutoPlanReviewPrompt();
    const requestId = this.nextAutoPlanReviewRequestId();
    const promptWithRequestId = `${prompt}\n\n${buildWorkflowRequestIdMarker(requestId)}`;

    this.autoPlanReview = {
      pendingRequestId: requestId,
      awaitingResponse: true,
      prompt,
      missingOutputRetries: 0,
      parseRecoveryAttempted: false,
      complianceRecoveryAttempted: false,
      allowsCheckpointInterruptions: this.hasCheckpointMetadataForOuterStep(completedOuterStep),
    };
    this.setStatus(ctx);

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
    const completedItems = this.getExecutionSnapshot().items.filter((item) => item.completed);
    const remainingItems = this.getExecutionSnapshot().items.filter(
      (item) => !item.completed && !item.skipped,
    );
    const completed = completedItems.map((item) => `${item.step}. ${item.text}`).join("\n");
    const remaining = remainingItems.map((item) => `${item.step}. ${item.text}`).join("\n");
    const completedCheckpointLabels = getCheckpointLabelsForSteps(
      this.latestPlanMetadata ?? undefined,
      completedItems.map((item) => item.step),
    );
    const remainingCheckpointLabels = getCheckpointLabelsForSteps(
      this.latestPlanMetadata ?? undefined,
      remainingItems.map((item) => item.step),
    );

    return [
      "Review progress against the approved long-term goal.",
      `Long-term goal: ${this.autoPlanGoal}`,
      ...this.getApprovedAutoPlanContextLines(),
      completed ? "Completed high-level tasks:" : undefined,
      completed || undefined,
      completedCheckpointLabels.length > 0 ? "Completed declared checkpoints:" : undefined,
      completedCheckpointLabels.length > 0 ? completedCheckpointLabels.join("; ") : undefined,
      remaining ? "Current remaining high-level backlog before review:" : undefined,
      remaining || undefined,
      remainingCheckpointLabels.length > 0 ? "Remaining declared checkpoints:" : undefined,
      remainingCheckpointLabels.length > 0 ? remainingCheckpointLabels.join("; ") : undefined,
      remainingCheckpointLabels.length > 0
        ? "Preserve the declared checkpoint or integration boundaries in the remaining backlog."
        : undefined,
      "Inspect the current repo state if needed.",
      "Do not ask the user questions.",
      "Do not request approval.",
      "Return either exactly 'Status: COMPLETE' if the long-term goal is finished, or return a remaining high-level Plan: section with numbered executable tasks.",
      REVIEW_TAGGED_JSON_CONTRACT_SUMMARY,
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

    const complianceIssues = detectAutoPlanOutputComplianceIssues(lastAssistantText);
    if (complianceIssues.length > 0 && !this.isAutoPlanCheckpointMomentForReview()) {
      return this.retryAutoPlanReview(
        ctx,
        "Autoplan review asked for user input or approval outside a declared checkpoint or integration moment. Asking for a stricter restatement.",
        buildAutoPlanReviewComplianceRecoveryPrompt(lastAssistantText, complianceIssues),
        { complianceRecovery: true },
      );
    }

    const reviewOutcome = this.applyAutoPlanReviewText(lastAssistantText, ctx);
    if (reviewOutcome === "retry") {
      return this.retryAutoPlanReview(
        ctx,
        "Autoplan couldn't validate the tagged JSON review contract. Asking for a stricter restatement.",
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
    const hasTrackedBacklog = Boolean(this.getCurrentOuterExecutionItem());

    if (isAutoPlanCompleteResponse(reviewText)) {
      this.latestAutoPlanReview = null;
      if (hasTrackedBacklog) {
        notify(
          this.pi,
          ctx,
          "Autoplan review reported completion, but tracked backlog still remains. Continuing with the existing tracked tasks.",
          "warning",
        );
        return "continue";
      }
      return "complete";
    }

    const structuredReview = parseTaggedReviewContract(reviewText);
    if (!structuredReview.ok) {
      if (!this.autoPlanReview.parseRecoveryAttempted) {
        return "retry";
      }

      this.latestAutoPlanReview = null;
      notify(
        this.pi,
        ctx,
        "Autoplan couldn't update the remaining backlog cleanly, so it will continue with the existing tracked tasks.",
        "warning",
      );
      return hasTrackedBacklog ? "continue" : "complete";
    }

    if (structuredReview.value.status === "complete") {
      this.latestAutoPlanReview = null;
      if (hasTrackedBacklog) {
        notify(
          this.pi,
          ctx,
          "Autoplan review reported completion, but tracked backlog still remains. Continuing with the existing tracked tasks.",
          "warning",
        );
        return "continue";
      }
      return "complete";
    }

    this.latestAutoPlanReview = structuredReview.value;
    const remainingItems = toTodoItemsFromStructuredReview(structuredReview.value);
    this.replaceOuterExecutionBacklog(remainingItems);
    return this.getCurrentOuterExecutionItem() ? "continue" : "complete";
  }

  private async retryAutoPlanReview(
    ctx: ExtensionContext,
    message: string,
    promptOverride?: string,
    options: { parseRecovery?: boolean; complianceRecovery?: boolean } = {},
  ): Promise<GuidedWorkflowResult> {
    const maxMissingOutputRetries = 2;
    if (!options.parseRecovery && !options.complianceRecovery) {
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

    if (options.complianceRecovery) {
      if (this.autoPlanReview.complianceRecoveryAttempted) {
        await this.stopAutoPlan(
          ctx,
          "Autoplan review kept asking for user input or approval outside declared checkpoint or integration moments after one retry. Stopping autoplan.",
          "error",
        );
        return { kind: "recoverable_error", reason: "autoplan_review_policy_violation" };
      }
      this.autoPlanReview.complianceRecoveryAttempted = true;
    }

    notify(this.pi, ctx, message, "warning");
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
    this.setStatus(ctx);

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
    return this.getExecutionSnapshot().items.find((item) => !item.completed && !item.skipped);
  }

  private setOuterExecutionItems(items: GuidedWorkflowExecutionItem[]): void {
    const internals = this.getOuterGuidedInternals();
    internals.executionItems = items.map((item) => ({ ...item }));
  }

  private setOuterLatestPlanText(planText: string): void {
    const internals = this.getOuterGuidedInternals();
    internals.latestPlanText = planText;
    this.latestPlanDraft = planText;
    this.latestStructuredPlan = null;
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
      complianceRecoveryAttempted: false,
    };
  }

  private clearAutoPlanState(): void {
    this.autoPlanMode = "off";
    this.autoPlanGoal = "";
    this.autoPlanApprovedPlanText = "";
    this.autoPlanPendingStart = false;
    this.autoPlanOuterStep = undefined;
    this.latestAutoPlanReview = null;
    this.resetAutoPlanExecutionComplianceState();
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

  private async stopAutoPlan(
    ctx: ExtensionContext,
    message: string,
    type: "info" | "warning" | "error" = "info",
  ): Promise<void> {
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
    notify(this.pi, ctx, message, type);
  }

  private getExecutionPrompt(): string {
    const remaining = this.todoItems.filter((item) => !item.completed && !item.skipped);
    const currentStep = remaining[0];

    if (!currentStep) {
      return "[APPROVED PLAN EXECUTION]\nFinish implementation and verification.";
    }

    const currentDetails = describeExecutionStep(
      currentStep,
      resolvePlanMetadata(
        this.getLatestPlanText(),
        this.latestPlanMetadata,
        this.latestStructuredPlan,
      ),
    );
    const backlog = remaining.map((item) => `${item.step}. ${item.text}`).join("\n");
    return [
      "[APPROVED PLAN EXECUTION]",
      `Current step: ${currentStep.step}. ${currentDetails.objective}`,
      currentDetails.taskGeometry ? `Task geometry: ${currentDetails.taskGeometry}` : undefined,
      currentDetails.coordinationPattern
        ? `Coordination pattern: ${currentDetails.coordinationPattern}`
        : undefined,
      currentDetails.dependsOn ? `Depends on steps: ${currentDetails.dependsOn}` : undefined,
      currentDetails.checkpoints
        ? `Relevant checkpoints: ${currentDetails.checkpoints}`
        : undefined,
      currentDetails.assumptions
        ? `Approved assumptions: ${currentDetails.assumptions}`
        : undefined,
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

  private async handleAutoPlanExecutionPolicyViolation(
    ctx: ExtensionContext,
    resumeState: AutoPlanSubtaskExecutionResumeState | undefined,
    turnText: string,
    issues: AutoPlanOutputComplianceIssue[],
  ): Promise<void> {
    const currentStep = resumeState?.items.find((item) => !item.completed && !item.skipped);
    const planText = resumeState?.planText?.trim();
    if (!currentStep || !planText) {
      await this.stopAutoPlan(
        ctx,
        "Autoplan execution produced a non-compliant response and the current inner step could not be recovered. Stopping autoplan.",
        "error",
      );
      return;
    }

    if (
      this.autoPlanExecutionCompliance.attempted &&
      this.autoPlanExecutionCompliance.step === currentStep.step
    ) {
      await this.stopAutoPlan(
        ctx,
        "Autoplan execution kept asking for user input or approval outside declared checkpoint or integration moments after one retry. Stopping autoplan.",
        "error",
      );
      return;
    }

    this.autoPlanExecutionCompliance = {
      attempted: true,
      step: currentStep.step,
    };

    const prompt = buildAutoPlanExecutionComplianceRecoveryPrompt({
      currentStep,
      planText,
      note: resumeState?.note,
      approvedContextLines: this.getApprovedAutoPlanContextLines(),
      previousResponse: turnText,
      issues,
    });

    notify(
      this.pi,
      ctx,
      "Autoplan execution asked for user input or approval outside a declared checkpoint or integration moment. Asking Pi to retry the same inner step and infer the missing decisions.",
      "warning",
    );
    this.pi.sendUserMessage(prompt, { deliverAs: "followUp" });
    this.setStatus(ctx);
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

    const stepDetails = describeExecutionStep(
      currentStep,
      resolvePlanMetadata(planText, this.latestPlanMetadata, this.latestStructuredPlan),
    );
    const autoPlanInnerExecutionActive =
      this.autoPlanMode === "executing" &&
      this.autoPlanSubtaskWorkflow.getStateSnapshot().phase === "executing";

    return [
      EXECUTION_TRIGGER_PROMPT,
      `Complete only step ${currentStep.step}: ${stepDetails.objective}`,
      note ? `Honor this user execution note while implementing the step: ${note}` : undefined,
      ...(autoPlanInnerExecutionActive ? this.getApprovedAutoPlanContextLines() : []),
      stepDetails.taskGeometry ? `Task geometry: ${stepDetails.taskGeometry}` : undefined,
      stepDetails.coordinationPattern
        ? `Coordination pattern: ${stepDetails.coordinationPattern}`
        : undefined,
      stepDetails.dependsOn ? `Depends on steps: ${stepDetails.dependsOn}` : undefined,
      stepDetails.checkpoints ? `Relevant checkpoints: ${stepDetails.checkpoints}` : undefined,
      stepDetails.assumptions ? `Approved assumptions: ${stepDetails.assumptions}` : undefined,
      stepDetails.targets ? `Target files/components: ${stepDetails.targets}` : undefined,
      stepDetails.validation ? `Validation method: ${stepDetails.validation}` : undefined,
      stepDetails.risks ? `Risks and rollback notes: ${stepDetails.risks}` : undefined,
      autoPlanInnerExecutionActive ? "Do not ask the user questions." : undefined,
      autoPlanInnerExecutionActive
        ? "Infer the best repo-consistent choice and continue."
        : undefined,
      "Implement it, validate it, and create one atomic jujutsu commit for that step before ending the turn.",
      "Use `jj commit <changed paths> -m <message>`, follow Conventional Commits, and include a detailed description.",
      EXECUTION_RESULT_TAGGED_JSON_CONTRACT_SUMMARY,
      `For this execution turn, use scope: ${autoPlanInnerExecutionActive ? "autoplan" : "plan"}.`,
      autoPlanInnerExecutionActive && typeof this.autoPlanOuterStep === "number"
        ? `When present, set outerStep to ${this.autoPlanOuterStep}.`
        : undefined,
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
      this.resetExecutionState();
      this.setStatus(ctx);
      const skippedAny = previousExecution.items.some((item) => item.skipped);
      notify(
        this.pi,
        ctx,
        skippedAny
          ? "All tracked plan steps are resolved (completed or skipped)."
          : "All tracked plan steps are complete.",
        "info",
      );
    }
  }

  private getPlanTools(): string[] {
    const planTools = this.getAllToolInfos()
      .filter((tool) => toolSupportsPlanMode(tool))
      .map((tool) => tool.name);
    if (planTools.length > 0) {
      return [...new Set(planTools)];
    }

    const fallback = this.pi
      .getActiveTools()
      .filter((tool) => !WRITE_LIKE_TOOLS.has(normalizeToolName(tool)));
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

  private refreshPlanWidget(ctx: ExtensionContext): void {
    if (!ctx.hasUI) {
      return;
    }

    const dashboardSnapshot = this.buildPlanDashboardSnapshot();
    if (dashboardSnapshot) {
      const dashboardMode = this.getTopLevelDashboardMode();
      ctx.ui.setWidget(TODO_WIDGET_KEY, (_tui, theme) => {
        return {
          render: (width: number) => {
            return renderPlanDashboardLines(dashboardSnapshot, dashboardMode, width, theme);
          },
        };
      });
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
      if (item.skipped) {
        return `${ctx.ui.theme.fg("warning", "↷ ")}${item.text}`;
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

    const dashboardSnapshot = this.buildPlanDashboardSnapshot();
    if (dashboardSnapshot) {
      const completedDashboardSteps = dashboardSnapshot.steps.filter(
        (step) => step.status === "done" || step.status === "skipped",
      ).length;
      ctx.ui.setStatus(
        STATUS_KEY,
        ctx.ui.theme.fg(
          "accent",
          `📋 ${completedDashboardSteps}/${dashboardSnapshot.steps.length}`,
        ),
      );
      this.refreshPlanWidget(ctx);
      return;
    }

    const progress = this.getExecutionProgressView();
    if (progress.totalSteps > 0) {
      ctx.ui.setStatus(
        STATUS_KEY,
        ctx.ui.theme.fg("accent", `📋 ${progress.completedSteps}/${progress.totalSteps}`),
      );
      this.refreshPlanWidget(ctx);
      return;
    }

    ctx.ui.setStatus(
      STATUS_KEY,
      this.planModeEnabled ? ctx.ui.theme.fg("warning", "⏸ plan") : undefined,
    );
    this.refreshPlanWidget(ctx);
  }

  private getTopLevelDashboardMode(): PlanDashboardMode {
    return this.dashboardExpanded ? "expanded" : "compact";
  }

  private resetDashboardPresentationState(): void {
    this.dashboardExpanded = false;
    this.cleanupDashboardOverlay();
  }

  private cleanupDashboardOverlay(): void {
    this.dashboardFullscreenOpen = false;
  }

  private toggleTopLevelDashboardExpanded(ctx: ExtensionContext): void {
    const dashboardSnapshot = this.buildPlanDashboardSnapshot();
    if (!dashboardSnapshot) {
      this.dashboardExpanded = false;
      this.refreshPlanWidget(ctx);
      notify(this.pi, ctx, "No structured top-level planning dashboard is available yet.", "info");
      return;
    }

    this.dashboardExpanded = !this.dashboardExpanded;
    this.refreshPlanWidget(ctx);
  }

  private async openTopLevelDashboardFullscreen(ctx: ExtensionContext): Promise<void> {
    const dashboardSnapshot = this.buildPlanDashboardSnapshot();
    if (!dashboardSnapshot) {
      notify(this.pi, ctx, "No structured top-level planning dashboard is available yet.", "info");
      return;
    }

    this.dashboardFullscreenOpen = true;
    try {
      await ctx.ui.custom<void>(
        (tui, theme, _keybindings, done) => {
          return new FullscreenPlanDashboardComponent(tui as never, theme, dashboardSnapshot, {
            onClose: () => done(undefined),
          });
        },
        {
          overlay: true,
          overlayOptions: {
            width: "95%",
            maxHeight: "90%",
            anchor: "center",
          },
        },
      );
    } finally {
      this.cleanupDashboardOverlay();
      this.refreshPlanWidget(ctx);
    }
  }

  private buildPlanDashboardSnapshot(): PlanDashboardSnapshot | undefined {
    return (
      this.buildTopLevelPlanDashboardSnapshot() ??
      this.buildInnerAutoPlanDashboardSnapshot() ??
      this.buildAutoPlanReviewDashboardSnapshot()
    );
  }

  private buildTopLevelPlanDashboardSnapshot(): PlanDashboardSnapshot | undefined {
    const state = this.getStateSnapshot();
    const isTopLevelAutoPlan = this.autoPlanMode === "bootstrap";
    if (!this.planModeEnabled || this.executionMode) {
      return undefined;
    }

    if (!isTopLevelAutoPlan && this.autoPlanMode !== "off") {
      return undefined;
    }

    if (state.phase !== "planning" && state.phase !== "approval") {
      return undefined;
    }

    const planMetadata = this.latestPlanMetadata;
    if (!planMetadata || planMetadata.steps.length === 0) {
      return undefined;
    }

    const critiqueSummary = this.latestCritiqueSummary || this.approvalReview?.critiqueSummary;
    const summary = isTopLevelAutoPlan
      ? state.phase === "approval"
        ? "Structured top-level autoplan is ready for approval."
        : "Structured top-level autoplan captured from valid pi-plan-json output."
      : state.phase === "approval"
        ? "Structured plan ready for approval."
        : "Structured plan captured from valid pi-plan-json output.";

    return this.buildDashboardSnapshotFromMetadata(planMetadata, {
      title:
        isTopLevelAutoPlan && this.autoPlanGoal.trim().length > 0
          ? `autoplan: ${this.autoPlanGoal}`
          : "plan",
      scopeLabel: isTopLevelAutoPlan ? "/autoplan" : "/plan",
      stateLabel: state.phase,
      summary,
      badges: [...(this.approvalReview?.badges ?? [])],
      critiqueSummary,
    });
  }

  private buildInnerAutoPlanDashboardSnapshot(): PlanDashboardSnapshot | undefined {
    if (this.autoPlanMode !== "executing" || this.autoPlanReview.awaitingResponse) {
      return undefined;
    }

    const subtaskState = this.autoPlanSubtaskWorkflow.getDashboardSnapshotState();
    if (subtaskState.phase === "idle") {
      return undefined;
    }

    const structuredPlan = resolveStructuredPlan(subtaskState.planText);
    if (!structuredPlan) {
      return undefined;
    }

    const planMetadata = normalizeStructuredPlanMetadata(structuredPlan);
    const currentOuterStep = this.getCurrentOuterExecutionItem();
    const currentOuterLabel = currentOuterStep
      ? `Current approved high-level task ${currentOuterStep.step}: ${currentOuterStep.text}`
      : undefined;
    const statusByStep = new Map<number, PlanDashboardStepView["status"]>(
      subtaskState.items.map((item) => [
        item.step,
        item.skipped ? "skipped" : item.completed ? "done" : "pending",
      ]),
    );

    return this.buildDashboardSnapshotFromMetadata(planMetadata, {
      title: this.autoPlanGoal.trim().length > 0 ? `autoplan: ${this.autoPlanGoal}` : "autoplan",
      scopeLabel: "/autoplan",
      stateLabel: subtaskState.phase === "executing" ? "subtask" : `subtask ${subtaskState.phase}`,
      summary: currentOuterLabel ?? "Planning the current approved high-level task.",
      badges: ["inner autoplan"],
      statusByStep,
    });
  }

  private buildAutoPlanReviewDashboardSnapshot(): PlanDashboardSnapshot | undefined {
    if (!this.autoPlanReview.awaitingResponse || this.autoPlanMode !== "executing") {
      return undefined;
    }

    const reviewMetadata =
      this.latestAutoPlanReview?.status === "continue"
        ? normalizeStructuredReviewMetadata(this.latestAutoPlanReview)
        : this.latestPlanMetadata;
    if (!reviewMetadata || reviewMetadata.steps.length === 0) {
      return undefined;
    }

    const statusByStep = new Map<number, PlanDashboardStepView["status"]>(
      this.getExecutionSnapshot().items.map((item) => [
        item.step,
        item.skipped ? "skipped" : item.completed ? "done" : "pending",
      ]),
    );

    return this.buildDashboardSnapshotFromMetadata(reviewMetadata, {
      title: this.autoPlanGoal.trim().length > 0 ? `autoplan: ${this.autoPlanGoal}` : "autoplan",
      scopeLabel: "/autoplan",
      stateLabel: "review",
      summary: "Reviewing progress against the long-term goal.",
      badges: ["reviewing progress"],
      statusByStep,
    });
  }

  private buildDashboardSnapshotFromMetadata(
    planMetadata: NormalizedPlanMetadata,
    options: {
      title: string;
      scopeLabel: string;
      stateLabel: string;
      summary: string;
      badges?: string[];
      critiqueSummary?: string;
      statusByStep?: Map<number, PlanDashboardStepView["status"]>;
    },
  ): PlanDashboardSnapshot {
    const dependencyEdges = planMetadata.steps.flatMap((step) =>
      step.dependsOn.map((dependency) => `${step.step} ← ${dependency}`),
    );
    const checkpoints = planMetadata.checkpoints.map((checkpoint) =>
      formatCheckpointLabel(checkpoint),
    );

    return {
      title: options.title,
      scopeLabel: options.scopeLabel,
      stateLabel: options.stateLabel,
      summary: options.summary,
      taskGeometry: planMetadata.taskGeometry,
      coordinationPattern: planMetadata.coordinationPattern,
      assumptions: [...planMetadata.assumptions],
      checkpoints,
      dependencies: dependencyEdges,
      badges: [...(options.badges ?? [])],
      critiqueSummary: options.critiqueSummary,
      steps: planMetadata.steps.map<PlanDashboardStepView>((step) => ({
        step: step.step,
        label: step.label,
        kind: step.kind,
        status: options.statusByStep?.get(step.step) ?? "pending",
        targets: [...step.targets],
        validation: [...step.validation],
        risks: [...step.risks],
        dependsOn: [...step.dependsOn],
        checkpoints: step.checkpointIds
          .map((checkpointId) => {
            const checkpoint = planMetadata.checkpoints.find(
              (candidate) => candidate.id === checkpointId,
            );
            return checkpoint ? formatCheckpointLabel(checkpoint) : checkpointId;
          })
          .filter((value) => value.length > 0),
      })),
    };
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
    this.resetDashboardPresentationState();
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

function lowerThinkingLevel(level: ThinkingLevel): ThinkingLevel {
  switch (level) {
    case "xhigh":
      return "high";
    case "high":
      return "medium";
    case "medium":
      return "low";
    case "low":
      return "minimal";
    case "minimal":
      return "off";
    default:
      return "off";
  }
}

function clearInputEditor(ctx: ExtensionContext): void {
  if (!ctx.hasUI) {
    return;
  }

  // Extension slash commands execute immediately, so proactively clear the composer
  // the same way built-in interactive commands do.

  const ui = ctx.ui as ExtensionContext["ui"] & {
    setEditorText?: (text: string) => void;
  };
  ui.setEditorText?.("");
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

function notifyHeadlessApprovalInstructions(pi: ExtensionAPI, ctx: ExtensionContext): void {
  notify(
    pi,
    ctx,
    "Approval is pending. If the interactive approval menu is unavailable, use one of: /plan approve, /plan continue <note>, /plan regenerate, /plan exit.",
    "info",
  );
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

function toPlanStep(
  step: NormalizedPlanMetadata["steps"][number],
  planMetadata: NormalizedPlanMetadata,
): StructuredStepView {
  return {
    step: step.step,
    objective: step.objective,
    label: step.label,
    targets: [...step.targets],
    validation: [...step.validation],
    risks: [...step.risks],
    dependsOn: [...step.dependsOn],
    checkpoints: step.checkpointIds
      .map((checkpointId) => {
        const checkpoint = planMetadata.checkpoints.find(
          (candidate) => candidate.id === checkpointId,
        );
        return checkpoint ? `${checkpoint.title} (${checkpoint.kind})` : checkpointId;
      })
      .filter((value) => value.length > 0),
  };
}

function toTodoItemsFromStructuredPlan(structuredPlan: StructuredPlanOutput): TodoItem[] {
  return toTodoItemsFromPlanMetadata(normalizeStructuredPlanMetadata(structuredPlan));
}

function toTodoItemsFromPlanMetadata(planMetadata: NormalizedPlanMetadata): TodoItem[] {
  return planMetadata.steps.map((step) => ({
    step: step.step,
    text: step.label,
    completed: false,
  }));
}

function toTodoItemsFromStructuredReview(structuredReview: StructuredReviewOutput): TodoItem[] {
  if (structuredReview.status !== "continue") {
    return [];
  }

  return structuredReview.steps.map((step) => ({
    step: step.step,
    text: cleanStepText(step.objective),
    completed: false,
  }));
}

function resolveStructuredPlan(
  planText: string | undefined,
  structuredPlan?: StructuredPlanOutput | null,
): StructuredPlanOutput | undefined {
  if (structuredPlan) {
    return structuredPlan;
  }

  if (!planText) {
    return undefined;
  }

  const parsed = parseTaggedPlanContract(planText);
  return parsed.ok ? parsed.value : undefined;
}

interface StructuredStepView {
  step: number;
  objective: string;
  label: string;
  targets: string[];
  validation: string[];
  risks: string[];
  dependsOn: number[];
  checkpoints: string[];
}

function buildReviewBadges(
  planText: string,
  steps: StructuredStepView[],
  planMetadata?: NormalizedPlanMetadata,
): string[] {
  const badges: string[] = [];

  if (steps.length > 0 && steps.length <= 5) {
    badges.push("compact steps");
  }
  if (steps.some((step) => step.validation.length > 0)) {
    badges.push("validation noted");
  }
  if (steps.some((step) => step.risks.length > 0)) {
    badges.push("rollback noted");
  }
  if ((planMetadata?.assumptions.length ?? 0) > 0) {
    badges.push("assumptions listed");
  }
  if ((planMetadata?.checkpoints.length ?? 0) > 0) {
    badges.push("checkpoints noted");
  }
  if (steps.some((step) => step.dependsOn.length > 0)) {
    badges.push("dependencies tracked");
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

function buildApprovalPreviewStep(step: StructuredStepView): PlanApprovalPreviewStep {
  return {
    step: step.step,
    label: step.label,
    targetsSummary: summarizePreviewValues(step.targets),
    validationSummary: summarizePreviewValues(step.validation),
    dependsOnSummary:
      step.dependsOn.length > 0
        ? step.dependsOn.map((value) => String(value)).join(", ")
        : undefined,
    checkpointsSummary: summarizePreviewValues(step.checkpoints),
  };
}

function summarizeDependencyEdges(planMetadata: NormalizedPlanMetadata): string | undefined {
  const edges = planMetadata.steps
    .flatMap((step) => step.dependsOn.map((dependency) => `${step.step} ← ${dependency}`))
    .filter((value) => value.length > 0);
  return summarizePreviewValues(edges, 3);
}

export function buildApprovalReviewState(
  planText: string,
  options: { critiqueSummary?: string; wasRevised?: boolean } = {},
  structuredPlan?: StructuredPlanOutput | null,
  planMetadata?: NormalizedPlanMetadata | null,
): ApprovalReviewState {
  const resolvedPlanMetadata = resolvePlanMetadata(planText, planMetadata, structuredPlan);
  const steps = resolvedPlanMetadata
    ? resolvedPlanMetadata.steps.map((step) => toPlanStep(step, resolvedPlanMetadata))
    : [];

  return {
    stepCount: steps.length,
    strategySummary: resolvedPlanMetadata
      ? `${resolvedPlanMetadata.taskGeometry} • ${resolvedPlanMetadata.coordinationPattern}`
      : undefined,
    assumptionsSummary: resolvedPlanMetadata
      ? summarizePreviewValues(resolvedPlanMetadata.assumptions, 2)
      : undefined,
    dependenciesSummary: resolvedPlanMetadata
      ? summarizeDependencyEdges(resolvedPlanMetadata)
      : undefined,
    checkpointsSummary: resolvedPlanMetadata
      ? summarizePreviewValues(
          resolvedPlanMetadata.checkpoints.map(
            (checkpoint) => `${checkpoint.title} (${checkpoint.kind})`,
          ),
          2,
        )
      : undefined,
    previewSteps: steps.slice(0, 3).map(buildApprovalPreviewStep),
    critiqueSummary: options.critiqueSummary,
    badges: buildReviewBadges(planText, steps, resolvedPlanMetadata),
    wasRevised: options.wasRevised ?? false,
  };
}

export function getApprovedAutoPlanTextForTesting(workflow: PiPlanWorkflow): string {
  return (
    (workflow as unknown as { autoPlanApprovedPlanText?: string }).autoPlanApprovedPlanText ?? ""
  );
}

export function getStoredPlanMetadataForTesting(
  workflow: PiPlanWorkflow,
): NormalizedPlanMetadata | null {
  const metadata = (workflow as unknown as { latestPlanMetadata?: NormalizedPlanMetadata | null })
    .latestPlanMetadata;
  return metadata
    ? {
        taskGeometry: metadata.taskGeometry,
        coordinationPattern: metadata.coordinationPattern,
        assumptions: [...metadata.assumptions],
        escalationTriggers: [...metadata.escalationTriggers],
        checkpoints: metadata.checkpoints.map((checkpoint) => ({ ...checkpoint })),
        steps: metadata.steps.map((step) => ({
          ...step,
          targets: [...step.targets],
          validation: [...step.validation],
          risks: [...step.risks],
          dependsOn: [...step.dependsOn],
          checkpointIds: [...step.checkpointIds],
        })),
      }
    : null;
}

function summarizeExecutionValues(values: string[]): string | undefined {
  const normalized = values.map((value) => value.trim()).filter((value) => value.length > 0);
  return normalized.length > 0 ? normalized.join("; ") : undefined;
}

function describeExecutionStep(
  currentStep: Pick<GuidedWorkflowExecutionItem, "step" | "text">,
  planMetadata?: NormalizedPlanMetadata,
): {
  objective: string;
  taskGeometry?: string;
  coordinationPattern?: string;
  dependsOn?: string;
  checkpoints?: string;
  assumptions?: string;
  targets?: string;
  validation?: string;
  risks?: string;
} {
  const metadataStep = planMetadata?.steps.find((step) => step.step === currentStep.step);
  const checkpointTitles = metadataStep
    ? metadataStep.checkpointIds
        .map((checkpointId) => {
          const checkpoint = planMetadata?.checkpoints.find(
            (candidate) => candidate.id === checkpointId,
          );
          return checkpoint ? `${checkpoint.title} (${checkpoint.kind})` : checkpointId;
        })
        .filter((value) => value.length > 0)
    : [];

  return {
    objective: metadataStep?.objective ?? currentStep.text,
    taskGeometry: planMetadata?.taskGeometry,
    coordinationPattern: planMetadata?.coordinationPattern,
    dependsOn:
      metadataStep && metadataStep.dependsOn.length > 0
        ? metadataStep.dependsOn.join(", ")
        : undefined,
    checkpoints: summarizeExecutionValues(checkpointTitles),
    assumptions: planMetadata ? summarizeExecutionValues(planMetadata.assumptions) : undefined,
    targets: metadataStep ? summarizeExecutionValues(metadataStep.targets) : undefined,
    validation: metadataStep ? summarizeExecutionValues(metadataStep.validation) : undefined,
    risks: metadataStep ? summarizeExecutionValues(metadataStep.risks) : undefined,
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

  const currentIndex = todoItems.findIndex((item) => !item.completed && !item.skipped);
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

function recoverImplicitlyIndentedSubtaskItems(
  planText: string,
  existingItems: GuidedWorkflowExecutionItem[],
): TodoItem[] {
  const planMetadata = resolvePlanMetadata(planText);
  if (!planMetadata) {
    return existingItems.map((item) => ({
      step: item.step,
      text: item.text,
      completed: item.completed,
    }));
  }

  return toTodoItemsFromPlanMetadata(planMetadata).sort(
    (left, right) => left.step - right.step || left.text.localeCompare(right.text),
  );
}

function buildParseRecoveryPrompt(
  draftText: string,
  parseError?: PlanningContractParseError,
): string {
  return [
    "The previous response did not include a valid tagged JSON planning contract.",
    parseError
      ? `Validation failure: ${formatPlanningContractParseFailure(parseError)}.`
      : undefined,
    "Restate the same proposed implementation plan using the required plan output contract.",
    "Keep the same scope and intent.",
    "Include an explicit Plan: section with numbered executable steps.",
    PLAN_TAGGED_JSON_CONTRACT_SUMMARY,
    "End with: Ready to execute when approved.",
    "",
    "Previous draft:",
    draftText,
  ]
    .filter((line): line is string => Boolean(line))
    .join("\n");
}

function formatPlanningContractParseFailure(parseError: PlanningContractParseError): string {
  return parseError.message.replace(/\s+/g, " ").trim().replace(/[.]+$/, "");
}

function formatUiFailure(error: unknown): string {
  if (error instanceof Error && error.message.trim().length > 0) {
    return error.message.trim();
  }

  return "unknown UI error";
}

function buildWorkflowRequestIdMarker(requestId: string): string {
  return `<!-- workflow-request-id:${requestId} -->`;
}

function normalizeStructuredReviewMetadata(
  structuredReview: StructuredReviewContinueOutput,
): NormalizedPlanMetadata {
  return {
    taskGeometry: structuredReview.taskGeometry,
    coordinationPattern: structuredReview.coordinationPattern,
    assumptions: [...structuredReview.assumptions],
    escalationTriggers: [],
    checkpoints: structuredReview.checkpoints.map((checkpoint) => ({ ...checkpoint })),
    steps: structuredReview.steps.map((step) => ({
      step: step.step,
      kind: step.kind,
      objective: step.objective,
      label: cleanStepText(step.objective),
      targets: [...step.targets],
      validation: [...step.validation],
      risks: [...step.risks],
      dependsOn: [...step.dependsOn],
      checkpointIds: [...step.checkpointIds],
    })),
  };
}

function resolvePlanMetadata(
  planText: string | undefined,
  planMetadata?: NormalizedPlanMetadata | null,
  structuredPlan?: StructuredPlanOutput | null,
): NormalizedPlanMetadata | undefined {
  if (planMetadata) {
    return planMetadata;
  }

  if (structuredPlan) {
    return normalizeStructuredPlanMetadata(structuredPlan);
  }

  if (!planText) {
    return undefined;
  }

  const parsed = parseTaggedPlanContract(planText);
  return parsed.ok ? normalizeStructuredPlanMetadata(parsed.value) : undefined;
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
    "The previous progress review did not include a valid tagged JSON review contract for remaining work.",
    "Restate the review.",
    REVIEW_TAGGED_JSON_CONTRACT_SUMMARY,
    "Otherwise include an explicit Plan: section with numbered remaining tasks and end with: Continue autoplan.",
    "",
    "Previous review:",
    reviewText,
  ].join("\n");
}

function formatAutoPlanComplianceIssues(issues: AutoPlanOutputComplianceIssue[]): string {
  return issues
    .map((issue) => {
      switch (issue) {
        case "asks_user_decision":
          return "asked the user for a decision";
        case "requests_approval":
          return "requested approval";
        case "defers_instead_of_inferring":
          return "deferred instead of inferring and continuing";
      }
    })
    .join(", ");
}

function buildAutoPlanSubtaskComplianceRecoveryPrompt(
  draftText: string,
  issues: AutoPlanOutputComplianceIssue[],
): string {
  const issueSummary = formatAutoPlanComplianceIssues(issues);
  return [
    "The previous approved-subtask planning response violated the post-approval autoplan policy.",
    "No declared checkpoint or integration moment is active for this high-level task.",
    issueSummary ? `Problem: it ${issueSummary}.` : undefined,
    "Restate the same subtask plan.",
    "Do not ask the user questions.",
    "Do not request approval.",
    "Infer the best repo-consistent choice and continue.",
    "Return the required plan output contract with an explicit Plan: section and numbered executable steps.",
    PLAN_TAGGED_JSON_CONTRACT_SUMMARY,
    "End with: Ready to execute when approved.",
    "",
    "Previous response:",
    draftText,
  ]
    .filter((line): line is string => typeof line === "string" && line.length > 0)
    .join("\n");
}

function buildAutoPlanReviewComplianceRecoveryPrompt(
  reviewText: string,
  issues: AutoPlanOutputComplianceIssue[],
): string {
  const issueSummary = formatAutoPlanComplianceIssues(issues);
  return [
    "The previous autoplan progress review violated the post-approval autoplan policy.",
    "No declared checkpoint or integration moment is active for this review turn.",
    issueSummary ? `Problem: it ${issueSummary}.` : undefined,
    "Restate the review.",
    "Do not ask the user questions.",
    "Do not request approval.",
    "Infer the best repo-consistent choice and continue.",
    REVIEW_TAGGED_JSON_CONTRACT_SUMMARY,
    "Otherwise include an explicit Plan: section with numbered remaining tasks and end with: Continue autoplan.",
    "",
    "Previous review:",
    reviewText,
  ]
    .filter((line): line is string => typeof line === "string" && line.length > 0)
    .join("\n");
}

function buildAutoPlanExecutionComplianceRecoveryPrompt(args: {
  currentStep: GuidedWorkflowExecutionItem;
  planText: string;
  note?: string;
  approvedContextLines: string[];
  previousResponse: string;
  issues: AutoPlanOutputComplianceIssue[];
}): string {
  const issueSummary = formatAutoPlanComplianceIssues(args.issues);
  const stepDetails = describeExecutionStep(args.currentStep, resolvePlanMetadata(args.planText));

  return [
    "The previous inner execution response violated the post-approval autoplan policy.",
    "No declared checkpoint or integration moment is active for this inner execution step.",
    issueSummary ? `Problem: it ${issueSummary}.` : undefined,
    EXECUTION_TRIGGER_PROMPT,
    `Retry only step ${args.currentStep.step}: ${stepDetails.objective}`,
    args.note
      ? `Honor this user execution note while implementing the step: ${args.note}`
      : undefined,
    ...args.approvedContextLines,
    stepDetails.taskGeometry ? `Task geometry: ${stepDetails.taskGeometry}` : undefined,
    stepDetails.coordinationPattern
      ? `Coordination pattern: ${stepDetails.coordinationPattern}`
      : undefined,
    stepDetails.dependsOn ? `Depends on steps: ${stepDetails.dependsOn}` : undefined,
    stepDetails.checkpoints ? `Relevant checkpoints: ${stepDetails.checkpoints}` : undefined,
    stepDetails.assumptions ? `Approved assumptions: ${stepDetails.assumptions}` : undefined,
    stepDetails.targets ? `Target files/components: ${stepDetails.targets}` : undefined,
    stepDetails.validation ? `Validation method: ${stepDetails.validation}` : undefined,
    stepDetails.risks ? `Risks and rollback notes: ${stepDetails.risks}` : undefined,
    "Do not ask the user questions.",
    "Do not request approval.",
    "Infer the best repo-consistent choice and continue.",
    "Implement it, validate it, and create one atomic jujutsu commit for that step before ending the turn.",
    "Use `jj commit <changed paths> -m <message>`, follow Conventional Commits, and include a detailed description.",
    EXECUTION_RESULT_TAGGED_JSON_CONTRACT_SUMMARY,
    "For this execution turn, use scope: autoplan.",
    "Do not start the following step in the same turn.",
    "",
    "Previous response:",
    args.previousResponse,
  ]
    .filter((line): line is string => typeof line === "string" && line.length > 0)
    .join("\n");
}

function isAutoPlanCompleteResponse(text: string): boolean {
  return /^\s*status\s*:\s*complete\s*$/i.test(text) || /^\s*complete\s*$/i.test(text);
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
