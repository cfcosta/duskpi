import {
  GuidedWorkflow,
  type AgentEndEvent,
  type BeforeAgentStartEvent,
  type ExtensionAPI,
  type ExtensionContext,
  type GuidedWorkflowResult,
  type SessionShutdownEvent,
  type SessionStartEvent,
  type ToolCallEvent,
  type TurnEndEvent,
} from "../../../packages/workflow-core/src/index";
import { selectPlanNextActionWithInlineNote, type PlanApprovalDetails } from "./plan-action-ui";
import {
  extractTodoItems,
  isSafeReadOnlyCommand,
  markCompletedSteps,
  normalizeArg,
  parseCritiqueVerdict,
  type TodoItem,
} from "./utils";

const STATUS_KEY = "pi-plan";
const TODO_WIDGET_KEY = "pi-plan-todos";

const PLAN_TOOL_CANDIDATES = [
  "read",
  "bash",
  "grep",
  "find",
  "ls",
  "lsp",
  "ast_search",
  "web_search",
  "fetch_content",
  "get_search_content",
] as const;

const WRITE_LIKE_TOOLS = new Set(["edit", "write", "ast_rewrite"]);

const PLAN_MODE_SYSTEM_PROMPT = `
[PLAN MODE ACTIVE - READ ONLY]
You are in planning mode.

Hard rules:
- Allowed actions: inspection, analysis, and plan creation only.
- Never perform any write/change action.
- Never use edit/write or mutating shell commands.

MANDATORY workflow:
1) Context gathering first
   - Inspect relevant files/symbols/config/tests before proposing a plan.
   - If external dependency behavior matters, gather official docs/reference evidence.
   - No evidence-free planning.
2) Requirement clarification
   - List uncertainties/assumptions explicitly.
   - If there is a blocking ambiguity, ask concise clarifying question(s) before finalizing.
3) Plan design
   - Build a concrete execution plan grounded in gathered evidence.

Output contract (use this structure):
1) Goal understanding (brief)
2) Evidence gathered
   - files/paths/symbols/docs checked
3) Uncertainties / assumptions
4) Plan:
   1. step objective
   2. target files/components
   3. validation method
5) Risks and rollback notes
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

export const PLAN_COMMAND_DESCRIPTION =
  "Enable read-only planning mode. Usage: /plan, /plan on, /plan off, /plan status, /plan <task>";
export const TODOS_COMMAND_DESCRIPTION = "Show current plan execution progress";

interface ApprovalReviewState {
  stepCount: number;
  previewSteps: string[];
  critiqueSummary?: string;
  badges: string[];
  wasRevised: boolean;
}

export class PiPlanWorkflow extends GuidedWorkflow {
  private planModeEnabled = false;
  private executionMode = false;
  private restoreTools: string[] | null = null;
  private todoItems: TodoItem[] = [];
  private critiqueState: "idle" | "awaiting_critique" | "awaiting_revision" = "idle";
  private latestPlanDraft = "";
  private approvalReview: ApprovalReviewState | null = null;
  private latestCritiqueSummary = "";
  private planWasRevised = false;
  private executionConstraintNote = "";

  constructor(private readonly pi: ExtensionAPI) {
    super(pi, {
      id: STATUS_KEY,
      parseGoalArg: parsePlanGoalArg,
      buildPlanningPrompt: ({ goal }) => goal ?? "Create a concrete implementation plan.",
      text: {
        alreadyRunning: "Plan mode is already enabled.",
        sendFailed: "Plan mode stopped: failed to send planning prompt.",
      },
    });
  }

  async handleTodosCommand(_args: unknown, ctx: ExtensionContext): Promise<void> {
    if (this.todoItems.length === 0) {
      notify(this.pi, ctx, "No tracked plan steps. Create a plan in /plan mode first.", "info");
      return;
    }

    const completed = this.todoItems.filter((item) => item.completed).length;
    const progress = `${completed}/${this.todoItems.length}`;
    const list = this.todoItems
      .map((item) => `${item.step}. ${item.completed ? "✓" : "○"} ${item.text}`)
      .join("\n");
    notify(this.pi, ctx, `Plan progress ${progress}\n${list}`, "info");
  }

  async handleCommand(args: unknown, ctx: ExtensionContext): Promise<GuidedWorkflowResult> {
    const raw = typeof args === "string" ? args.trim() : "";

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
      notify(
        this.pi,
        ctx,
        this.planModeEnabled
          ? "Plan mode: ON (read-only planning)"
          : this.executionMode
            ? "Plan mode: OFF (executing approved plan)"
            : "Plan mode: OFF (default YOLO mode)",
      );
      return { kind: "ok" };
    }

    if (!this.planModeEnabled) {
      this.enterPlanMode(ctx);
    }

    this.pi.sendUserMessage(raw);
    return { kind: "ok" };
  }

  async handleToolCall(
    event: ToolCallEvent,
    _ctx: ExtensionContext,
  ): Promise<{ block: true; reason: string } | void> {
    if (!this.planModeEnabled) {
      return;
    }

    if (WRITE_LIKE_TOOLS.has(event.toolName ?? "")) {
      return {
        block: true,
        reason:
          "Plan mode is read-only. Approve execution first (choose 'Approve and execute now').",
      };
    }

    if (event.toolName === "bash") {
      const input = event.input as { command?: unknown };
      const command = typeof input.command === "string" ? input.command : "";
      if (!isSafeReadOnlyCommand(command)) {
        return {
          block: true,
          reason: `Plan mode blocked a potentially mutating bash command: ${command}`,
        };
      }
    }
  }

  async handleBeforeAgentStart(
    event: BeforeAgentStartEvent,
    _ctx: ExtensionContext,
  ): Promise<{ systemPrompt: string }> {
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
    if (!this.executionMode || this.todoItems.length === 0) {
      return;
    }

    const text = getAssistantTextFromMessage(event.message);
    if (!text) {
      return;
    }

    this.syncTrackedExecutionProgress(text, ctx);
  }

  async handleAgentEnd(
    event: AgentEndEvent,
    ctx: ExtensionContext,
  ): Promise<GuidedWorkflowResult> {
    const lastAssistantText = [...(event.messages ?? [])]
      .reverse()
      .map(getAssistantTextFromMessage)
      .find((text) => text.length > 0);

    if (this.executionMode && this.todoItems.length > 0) {
      const completedCount = lastAssistantText
        ? this.syncTrackedExecutionProgress(lastAssistantText, ctx)
        : 0;

      if (this.executionMode && completedCount > 0) {
        this.sendNextExecutionStep(ctx);
      }
      return { kind: "ok" };
    }

    if (!this.planModeEnabled || !ctx.hasUI || !lastAssistantText) {
      return { kind: "ok" };
    }

    if (this.critiqueState === "awaiting_critique") {
      const verdict = parseCritiqueVerdict(lastAssistantText);
      if (verdict === "PASS") {
        this.critiqueState = "idle";
        this.latestCritiqueSummary = extractCritiqueSummary(lastAssistantText) ?? "ready";
        this.approvalReview = buildApprovalReviewState(this.latestPlanDraft, this.todoItems, {
          critiqueSummary: this.latestCritiqueSummary,
          wasRevised: this.planWasRevised,
        });
        notify(this.pi, ctx, "Plan critique passed. Review and approve when ready.", "info");
      } else {
        this.requestPlanRevision(ctx, lastAssistantText);
        return { kind: "ok" };
      }
    } else {
      const extracted = extractTodoItems(lastAssistantText);
      if (extracted.length === 0) {
        return { kind: "ok" };
      }

      this.todoItems = extracted;
      this.approvalReview = buildApprovalReviewState(lastAssistantText, extracted, {
        critiqueSummary: this.latestCritiqueSummary || undefined,
        wasRevised: this.planWasRevised,
      });
      this.setStatus(ctx);
      this.requestPlanCritique(ctx, lastAssistantText);
      return { kind: "ok" };
    }

    this.setStatus(ctx);

    const selection = await selectPlanNextActionWithInlineNote(
      ctx.ui as never,
      this.approvalReview ??
        ({
          stepCount: this.todoItems.length,
          previewSteps: this.todoItems.slice(0, 3).map((item) => `${item.step}. ${item.text}`),
          critiqueSummary: this.latestCritiqueSummary || undefined,
          badges: [],
          wasRevised: this.planWasRevised,
        } satisfies PlanApprovalDetails),
    );
    if (selection.cancelled || !selection.action) {
      return { kind: "ok" };
    }

    if (selection.action === "approve") {
      this.executionMode = this.todoItems.length > 0;
      this.executionConstraintNote = selection.note?.trim() ?? "";
      this.resetPlanningDraft();
      this.exitPlanMode(ctx, "Plan approved. Entering YOLO mode for execution.");

      this.sendNextExecutionStep(ctx, "Plan approved. Entering YOLO mode for execution.");
      return { kind: "ok" };
    }

    if (selection.action === "regenerate") {
      this.todoItems = [];
      this.resetExecutionState();
      this.resetPlanningDraft();
      this.setStatus(ctx);
      this.pi.sendUserMessage(
        "Regenerate the full plan from scratch. Re-check context and provide a refreshed Plan: section.",
      );
      return { kind: "ok" };
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
        return { kind: "ok" };
      }

      const firstOpenStep = this.todoItems.find((item) => !item.completed);
      if (firstOpenStep) {
        this.pi.sendUserMessage(
          `Continue planning from the proposed plan. User note: ${continueNote}. Focus on step ${firstOpenStep.step}: ${firstOpenStep.text}. Refine files, validation, and risks in read-only mode.`,
        );
      } else {
        this.pi.sendUserMessage(
          `Continue planning from the proposed plan. User note: ${continueNote}. Refine implementation details without regenerating the full plan.`,
        );
      }
      return { kind: "ok" };
    }

    if (selection.action === "exit") {
      this.exitPlanMode(ctx, "Exited plan mode without execution.", {
        resetProgress: true,
      });
    }

    return { kind: "ok" };
  }

  async handleSessionStart(_event: SessionStartEvent, ctx: ExtensionContext): Promise<void> {
    this.setStatus(ctx);
  }

  async handleSessionShutdown(_event: SessionShutdownEvent, ctx: ExtensionContext): Promise<void> {
    this.resetExecutionState();
    if (ctx.hasUI) {
      ctx.ui.setStatus(STATUS_KEY, undefined);
      ctx.ui.setWidget(TODO_WIDGET_KEY, undefined);
    }
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
    this.critiqueState = "idle";
    this.latestPlanDraft = "";
    this.resetApprovalReview();
  }

  private resetExecutionState(): void {
    this.executionMode = false;
    this.executionConstraintNote = "";
  }

  private sendHiddenPlanningMessage(content: string): void {
    this.pi.sendMessage(
      {
        customType: "pi-plan-internal",
        content,
        display: false,
      },
      {
        triggerTurn: true,
        deliverAs: "followUp",
      },
    );
  }

  private requestPlanCritique(ctx: ExtensionContext, planText: string): void {
    this.latestPlanDraft = planText;
    this.critiqueState = "awaiting_critique";
    this.approvalReview = buildApprovalReviewState(planText, this.todoItems, {
      critiqueSummary: this.latestCritiqueSummary || undefined,
      wasRevised: this.planWasRevised,
    });
    notify(this.pi, ctx, "Reviewing the plan with a critique pass before approval.", "info");
    this.sendHiddenPlanningMessage(`${PLAN_CRITIQUE_PROMPT}\n\nPlan to critique:\n\n${planText}`);
  }

  private requestPlanRevision(ctx: ExtensionContext, critiqueText: string): void {
    this.critiqueState = "awaiting_revision";
    this.latestCritiqueSummary = extractCritiqueSummary(critiqueText) ?? this.latestCritiqueSummary;
    this.planWasRevised = true;
    notify(this.pi, ctx, "The critique requested plan refinement. Regenerating the plan.", "warning");
    this.sendHiddenPlanningMessage(
      [
        "Revise the latest plan using the critique below.",
        "Keep plan mode read-only and return the full plan again using the required plan output contract.",
        "Make each step atomic, executable, validation-backed, and suitable for one jujutsu commit.",
        "",
        "Original plan:",
        this.latestPlanDraft,
        "",
        "Critique:",
        critiqueText,
      ].join("\n"),
    );
  }

  private getExecutionPrompt(): string {
    const remaining = this.todoItems.filter((item) => !item.completed);
    const currentStep = remaining[0];

    if (!currentStep) {
      return "[APPROVED PLAN EXECUTION]\nFinish implementation and verification.";
    }

    const backlog = remaining.map((item) => `${item.step}. ${item.text}`).join("\n");
    return [
      "[APPROVED PLAN EXECUTION]",
      `Current step: ${currentStep.step}. ${currentStep.text}`,
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

  private sendNextExecutionStep(ctx: ExtensionContext, reason?: string): void {
    const currentStep = this.todoItems.find((item) => !item.completed);
    if (!currentStep) {
      this.resetExecutionState();
      this.setStatus(ctx);
      if (reason) {
        notify(this.pi, ctx, reason, "info");
      }
      return;
    }

    const prompt = [
      EXECUTION_TRIGGER_PROMPT,
      `Complete only step ${currentStep.step}: ${currentStep.text}`,
      this.executionConstraintNote
        ? `Honor this user execution note while implementing the step: ${this.executionConstraintNote}`
        : undefined,
      "Implement it, validate it, and create one atomic jujutsu commit for that step before ending the turn.",
      "Use `jj commit <changed paths> -m <message>`, follow Conventional Commits, include a detailed description, and finish with the matching [DONE:n] marker after the commit succeeds.",
      "Do not start the following step in the same turn.",
    ]
      .filter((line): line is string => typeof line === "string")
      .join(" ");

    this.pi.sendUserMessage(prompt);
  }

  private syncTrackedExecutionProgress(text: string, ctx: ExtensionContext): number {
    const completedCount = markCompletedSteps(text, this.todoItems);
    if (completedCount > 0) {
      this.setStatus(ctx);
    }

    if (this.todoItems.length > 0 && this.todoItems.every((item) => item.completed)) {
      this.resetExecutionState();
      this.setStatus(ctx);
      notify(this.pi, ctx, "All tracked plan steps are complete.", "info");
    }

    return completedCount;
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

    if (!this.executionMode || this.todoItems.length === 0) {
      ctx.ui.setWidget(TODO_WIDGET_KEY, undefined);
      return;
    }

    const lines = this.todoItems.map((item) => {
      if (item.completed) {
        return (
          ctx.ui.theme.fg("success", "☑ ") +
          ctx.ui.theme.fg("muted", ctx.ui.theme.strikethrough(item.text))
        );
      }
      return `${ctx.ui.theme.fg("muted", "☐ ")}${item.text}`;
    });

    ctx.ui.setWidget(TODO_WIDGET_KEY, lines);
  }

  private setStatus(ctx: ExtensionContext): void {
    if (!ctx.hasUI) {
      return;
    }

    if (this.executionMode && this.todoItems.length > 0) {
      const completed = this.todoItems.filter((item) => item.completed).length;
      ctx.ui.setStatus(
        STATUS_KEY,
        ctx.ui.theme.fg("accent", `📋 ${completed}/${this.todoItems.length}`),
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

  if (typeof candidate.content === "string") {
    return candidate.content;
  }

  if (!Array.isArray(candidate.content)) {
    return "";
  }

  return candidate.content
    .filter(
      (block): block is { type?: string; text?: string } =>
        typeof block === "object" &&
        block !== null &&
        (block as { type?: string }).type === "text" &&
        typeof (block as { text?: string }).text === "string",
    )
    .map((block) => block.text ?? "")
    .join("\n");
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

function buildReviewBadges(planText: string, items: TodoItem[]): string[] {
  const badges: string[] = [];
  const normalized = planText.toLowerCase();

  if (items.length > 0 && items.length <= 5) {
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

function buildApprovalReviewState(
  planText: string,
  items: TodoItem[],
  options: { critiqueSummary?: string; wasRevised?: boolean } = {},
): ApprovalReviewState {
  return {
    stepCount: items.length,
    previewSteps: items.slice(0, 3).map((item) => `${item.step}. ${item.text}`),
    critiqueSummary: options.critiqueSummary,
    badges: buildReviewBadges(planText, items),
    wasRevised: options.wasRevised ?? false,
  };
}

function parsePlanGoalArg(args: unknown): string | undefined {
  if (typeof args !== "string") {
    return undefined;
  }

  const normalized = args.trim();
  return normalized.length > 0 ? normalized : undefined;
}
