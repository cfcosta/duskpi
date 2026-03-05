import type { ExtensionAPI, ExtensionContext } from "@anthropic-ai/claude-code";
import {
  buildPrompt,
  type PromptBundle,
  type PromptLoadResult,
  type WorkflowReports,
} from "./prompting";
import { extractAssistantText, extractLastUserText, parseScopeArg } from "./messages";

const WORKFLOW_PHASES = ["idle", "finder", "skeptic", "arbiter", "fixer"] as const;
type WorkflowPhase = (typeof WORKFLOW_PHASES)[number];
type AnalysisPhase = Exclude<WorkflowPhase, "idle" | "fixer">;

const ANALYSIS_PHASE_ORDER: AnalysisPhase[] = ["finder", "skeptic", "arbiter"];
const NEXT_ANALYSIS_PHASE: Record<Exclude<AnalysisPhase, "arbiter">, AnalysisPhase> = {
  finder: "skeptic",
  skeptic: "arbiter",
};

const PHASE_LABELS: Record<Exclude<WorkflowPhase, "idle">, string> = {
  finder: "Finding bugs...",
  skeptic: "Reviewing bugs...",
  arbiter: "Arbitrating...",
  fixer: "Fixing bugs...",
};

const MAX_EMPTY_OUTPUT_RETRIES = 2;
const MAX_REFINEMENT_ATTEMPTS = 3;
const BLOCKED_TOOLS_IN_ANALYSIS = new Set(["edit", "write", "multiedit"]);

type WorkflowResultKind = "ok" | "blocked" | "recoverable_error";
interface WorkflowResult {
  kind: WorkflowResultKind;
  reason?: string;
}

interface WorkflowState {
  phase: WorkflowPhase;
  scope?: string;
  reports: WorkflowReports;
  refinementAttempts: number;
  emptyOutputRetries: number;
  pendingRefinement?: string;
  awaitingResponse: boolean;
  pendingPrompt?: string;
}

export class BugFinderWorkflow {
  private state: WorkflowState = {
    phase: "idle",
    reports: {},
    refinementAttempts: 0,
    emptyOutputRetries: 0,
    pendingRefinement: undefined,
    awaitingResponse: false,
    pendingPrompt: undefined,
  };

  private prompts?: PromptBundle;
  private startupError?: Error;

  constructor(
    private readonly api: ExtensionAPI,
    private readonly promptProvider: () => PromptLoadResult,
  ) {}

  async handleCommand(args: unknown, ctx: ExtensionContext): Promise<WorkflowResult> {
    this.refreshPromptSnapshot();

    if (!this.prompts) {
      ctx.ui.notify(
        `Bug fix is unavailable: ${this.startupError?.message ?? "prompt initialization failed."}`,
        "error",
      );
      return { kind: "blocked", reason: "prompts_unavailable" };
    }

    if (this.state.phase !== "idle") {
      ctx.ui.notify(
        "Bug fix is already running. Finish or cancel the current run first.",
        "warning",
      );
      return { kind: "blocked", reason: "already_running" };
    }

    this.state = {
      phase: "finder",
      scope: parseScopeArg(args),
      reports: {},
      refinementAttempts: 0,
      emptyOutputRetries: 0,
      pendingRefinement: undefined,
      awaitingResponse: false,
      pendingPrompt: undefined,
    };

    this.updateStatus(ctx);
    this.sendPromptForPhase("finder");
    return { kind: "ok" };
  }

  async handleToolCall(event: {
    toolName?: string;
  }): Promise<{ block: true; reason: string } | void> {
    if (!isAnalysisPhase(this.state.phase)) {
      return;
    }

    if (isWriteCapableTool(event.toolName)) {
      return {
        block: true,
        reason: "Bug fix analysis phase: writes are disabled",
      };
    }
  }

  async handleAgentEnd(
    event: { messages?: unknown[] },
    ctx: ExtensionContext,
  ): Promise<WorkflowResult> {
    if (this.state.phase === "idle" || !this.prompts) {
      return { kind: "blocked", reason: "inactive" };
    }

    if (!this.state.awaitingResponse) {
      return { kind: "blocked", reason: "stale_agent_end" };
    }

    const eventMessages = event.messages ?? [];
    const lastUserText = extractLastUserText(eventMessages);
    if (
      this.state.pendingPrompt &&
      lastUserText &&
      normalizeMessage(lastUserText) !== normalizeMessage(this.state.pendingPrompt)
    ) {
      return { kind: "blocked", reason: "unmatched_agent_end" };
    }

    this.state.awaitingResponse = false;
    const assistantText = extractAssistantText(eventMessages);
    if (!assistantText) {
      return this.handleMissingAssistantOutput(ctx);
    }

    this.state.emptyOutputRetries = 0;
    this.state.pendingPrompt = undefined;

    if (this.state.phase === "fixer") {
      this.finishRun(ctx, "Bug fix workflow complete!");
      return { kind: "ok" };
    }

    if (isAnalysisPhase(this.state.phase)) {
      this.capturePhaseReport(this.state.phase, assistantText);

      if (this.state.phase === "arbiter") {
        await this.handleArbiterComplete(ctx);
        return { kind: "ok" };
      }

      this.state.phase = NEXT_ANALYSIS_PHASE[this.state.phase];
      this.updateStatus(ctx);
      this.sendPromptForPhase(this.state.phase);
      return { kind: "ok" };
    }

    return { kind: "recoverable_error", reason: "unknown_phase" };
  }

  private async handleArbiterComplete(ctx: ExtensionContext): Promise<void> {
    this.updateStatus(ctx);

    const choice = await ctx.ui.select("Bug Finder - Analysis Complete", [
      "Execute fixes (TDD workflow)",
      "Refine the analysis",
      "Cancel",
    ]);

    const decision = await this.decideArbiterAction(choice, ctx);
    this.applyArbiterDecision(decision, ctx);
  }

  private async decideArbiterAction(
    choice: string | undefined,
    ctx: ExtensionContext,
  ): Promise<{ kind: "execute" | "cancel" | "refine"; refinement?: string }> {
    if (choice?.startsWith("Execute")) {
      return { kind: "execute" };
    }

    if (choice?.startsWith("Refine")) {
      if (this.state.refinementAttempts >= MAX_REFINEMENT_ATTEMPTS) {
        return { kind: "cancel" };
      }

      const refinement = await ctx.ui.editor("Refine analysis:", "");
      if (!refinement?.trim()) {
        return { kind: "cancel" };
      }

      return { kind: "refine", refinement: refinement.trim() };
    }

    return { kind: "cancel" };
  }

  private applyArbiterDecision(
    decision: { kind: "execute" | "cancel" | "refine"; refinement?: string },
    ctx: ExtensionContext,
  ) {
    if (decision.kind === "execute") {
      this.state.phase = "fixer";
      this.state.refinementAttempts = 0;
      this.updateStatus(ctx);
      ctx.ui.setWidget("bug-fix", undefined);
      this.sendPromptForPhase("fixer");
      return;
    }

    if (decision.kind === "refine" && decision.refinement) {
      this.state.refinementAttempts += 1;
      this.state.pendingRefinement = decision.refinement;
      this.sendPromptForPhase("arbiter");
      return;
    }

    this.finishRun(ctx, "Bug fix cancelled.");
  }

  private handleMissingAssistantOutput(ctx: ExtensionContext): WorkflowResult {
    this.state.emptyOutputRetries += 1;

    if (this.state.emptyOutputRetries > MAX_EMPTY_OUTPUT_RETRIES) {
      this.finishRun(
        ctx,
        `Bug fix stopped: no assistant output captured after ${MAX_EMPTY_OUTPUT_RETRIES + 1} attempts.`,
      );
      return { kind: "recoverable_error", reason: "max_empty_output_retries" };
    }

    ctx.ui.notify(
      `No assistant output captured for phase '${this.state.phase}'. Retrying (${this.state.emptyOutputRetries}/${MAX_EMPTY_OUTPUT_RETRIES}).`,
      "warning",
    );

    if (isAnalysisPhase(this.state.phase) || this.state.phase === "fixer") {
      this.sendPromptForPhase(this.state.phase);
    }

    return { kind: "recoverable_error", reason: "empty_output_retry" };
  }

  private sendPromptForPhase(phase: AnalysisPhase | "fixer") {
    const prompt = buildPrompt(
      phase,
      this.prompts!,
      this.state.reports,
      this.state.scope,
      phase === "arbiter" ? this.state.pendingRefinement : undefined,
    );

    this.state.pendingPrompt = prompt;
    this.state.awaitingResponse = true;
    this.api.sendUserMessage(prompt);
  }

  private refreshPromptSnapshot() {
    const loadResult = this.promptProvider();
    this.prompts = loadResult.prompts;
    this.startupError = loadResult.error;
  }

  private capturePhaseReport(phase: AnalysisPhase, report: string) {
    this.state.reports[phase] = report;
    if (phase === "arbiter") {
      this.state.pendingRefinement = undefined;
    }
  }

  private finishRun(ctx: ExtensionContext, message: string) {
    this.state = {
      phase: "idle",
      reports: {},
      refinementAttempts: 0,
      emptyOutputRetries: 0,
      pendingRefinement: undefined,
      awaitingResponse: false,
      pendingPrompt: undefined,
    };
    this.updateStatus(ctx);
    ctx.ui.notify(message, "info");
  }

  private updateStatus(ctx: ExtensionContext) {
    if (this.state.phase === "idle") {
      ctx.ui.setStatus("bug-fix", undefined);
      ctx.ui.setWidget("bug-fix", undefined);
      return;
    }

    const phaseIndex = WORKFLOW_PHASES.indexOf(this.state.phase);
    const icon = this.state.phase === "fixer" ? "🔧" : "🔍";
    ctx.ui.setStatus("bug-fix", `${icon} Phase ${phaseIndex}/4: ${PHASE_LABELS[this.state.phase]}`);
  }
}

function isAnalysisPhase(phase: WorkflowPhase): phase is AnalysisPhase {
  return ANALYSIS_PHASE_ORDER.includes(phase as AnalysisPhase);
}

function normalizeMessage(value: string): string {
  return value.trim().replace(/\r\n/g, "\n");
}

function isWriteCapableTool(toolName?: string): boolean {
  const normalized = (toolName ?? "").trim().toLowerCase();
  if (BLOCKED_TOOLS_IN_ANALYSIS.has(normalized)) {
    return true;
  }

  return normalized.includes("edit") || normalized.includes("write");
}
