import * as fs from "node:fs";
import * as path from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@anthropic-ai/claude-code";

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

const PROMPT_FILE_NAMES = {
  finder: "finder.md",
  skeptic: "skeptic.md",
  arbiter: "arbiter.md",
  fixer: "fixer.md",
} as const;

const MAX_EMPTY_OUTPUT_RETRIES = 2;
const MAX_REFINEMENT_ATTEMPTS = 3;
const BLOCKED_TOOLS_IN_ANALYSIS = new Set(["Edit", "Write"]);

type PromptKey = keyof typeof PROMPT_FILE_NAMES;
type PromptBundle = Record<PromptKey, string>;

type WorkflowResultKind = "ok" | "blocked" | "recoverable_error";
interface WorkflowResult {
  kind: WorkflowResultKind;
  reason?: string;
}

interface WorkflowReports {
  finder?: string;
  skeptic?: string;
  arbiter?: string;
}

interface WorkflowState {
  phase: WorkflowPhase;
  scope?: string;
  reports: WorkflowReports;
  refinementAttempts: number;
  emptyOutputRetries: number;
}

interface TextBlock {
  type?: unknown;
  text?: unknown;
}

interface MessageLike {
  role?: unknown;
  content?: unknown;
}

interface PromptLoadResult {
  prompts?: PromptBundle;
  error?: string;
}

/**
 * Public extension entrypoint. Prompt initialization errors are handled gracefully:
 * the command remains registered and reports a clear startup error instead of throwing.
 */
export default function bugFinder(api: ExtensionAPI) {
  const promptLoadResult = loadPrompts(path.resolve(__dirname, "prompts"));
  const workflow = new BugFinderWorkflow(api, promptLoadResult.prompts, promptLoadResult.error);

  api.registerCommand("bug-finder", {
    description: "Run the adversarial bug-finding workflow (4 phases)",
    handler: workflow.handleCommand.bind(workflow),
  });

  api.on("tool_call", workflow.handleToolCall.bind(workflow));
  api.on("agent_end", workflow.handleAgentEnd.bind(workflow));
}

export class BugFinderWorkflow {
  private state: WorkflowState = {
    phase: "idle",
    reports: {},
    refinementAttempts: 0,
    emptyOutputRetries: 0,
  };

  constructor(
    private readonly api: ExtensionAPI,
    private readonly prompts?: PromptBundle,
    private readonly startupError?: string,
  ) {}

  /**
   * Command contract:
   * - {kind:"ok"}: run started
   * - {kind:"blocked"}: workflow already active or prompts unavailable
   */
  async handleCommand(args: unknown, ctx: ExtensionContext): Promise<WorkflowResult> {
    if (!this.prompts) {
      ctx.ui.notify(
        `Bug finder is unavailable: ${this.startupError ?? "prompt initialization failed."}`,
        "error",
      );
      return { kind: "blocked", reason: "prompts_unavailable" };
    }

    if (this.state.phase !== "idle") {
      ctx.ui.notify("Bug finder is already running. Finish or cancel the current run first.", "warning");
      return { kind: "blocked", reason: "already_running" };
    }

    this.state = {
      phase: "finder",
      scope: parseScopeArg(args),
      reports: {},
      refinementAttempts: 0,
      emptyOutputRetries: 0,
    };

    this.updateStatus(ctx);
    this.sendPromptForPhase("finder");
    return { kind: "ok" };
  }

  /**
   * Tool-policy contract:
   * - returns undefined when tool is allowed
   * - returns block payload for disallowed mutating tools during analysis phases
   */
  async handleToolCall(event: { toolName?: string }) {
    if (!isAnalysisPhase(this.state.phase)) {
      return;
    }

    if (BLOCKED_TOOLS_IN_ANALYSIS.has(event.toolName ?? "")) {
      return {
        block: true,
        reason: "Bug finder analysis phase: writes are disabled",
      };
    }
  }

  /**
   * Agent-end contract:
   * - advances deterministic phase flow when assistant text exists
   * - bounded retries for empty output to avoid infinite churn
   */
  async handleAgentEnd(event: { messages?: unknown[] }, ctx: ExtensionContext): Promise<WorkflowResult> {
    if (this.state.phase === "idle" || !this.prompts) {
      return { kind: "blocked", reason: "inactive" };
    }

    const assistantText = extractAssistantText(event.messages ?? []);
    if (!assistantText) {
      return this.handleMissingAssistantOutput(ctx);
    }

    this.state.emptyOutputRetries = 0;

    if (this.state.phase === "fixer") {
      this.finishRun(ctx, "Bug finder workflow complete!");
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

    if (choice?.startsWith("Execute")) {
      this.state.phase = "fixer";
      this.state.refinementAttempts = 0;
      this.updateStatus(ctx);
      ctx.ui.setWidget("bug-finder", [
        "## Verified Bugs",
        "",
        ...(this.state.reports.arbiter ?? "").split("\n"),
      ]);
      this.sendPromptForPhase("fixer");
      return;
    }

    if (choice?.startsWith("Refine")) {
      if (this.state.refinementAttempts >= MAX_REFINEMENT_ATTEMPTS) {
        ctx.ui.notify(
          `Maximum refinement attempts reached (${MAX_REFINEMENT_ATTEMPTS}). Execute fixes or cancel.`,
          "warning",
        );
        return;
      }

      const refinement = await ctx.ui.editor("Refine analysis:", "");
      if (!refinement?.trim()) {
        ctx.ui.notify("Refinement cancelled: no refinement text was provided.", "info");
        return;
      }

      this.state.refinementAttempts += 1;
      this.api.sendUserMessage(buildPrompt("arbiter", this.prompts!, this.state.reports, this.state.scope, refinement));
      return;
    }

    this.finishRun(ctx, "Bug finder cancelled.");
  }

  private handleMissingAssistantOutput(ctx: ExtensionContext): WorkflowResult {
    this.state.emptyOutputRetries += 1;

    if (this.state.emptyOutputRetries > MAX_EMPTY_OUTPUT_RETRIES) {
      this.finishRun(
        ctx,
        `Bug finder stopped: no assistant output captured after ${MAX_EMPTY_OUTPUT_RETRIES + 1} attempts.`,
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
    this.api.sendUserMessage(
      buildPrompt(phase, this.prompts!, this.state.reports, this.state.scope),
    );
  }

  private capturePhaseReport(phase: AnalysisPhase, report: string) {
    this.state.reports[phase] = report;
  }

  private finishRun(ctx: ExtensionContext, message: string) {
    this.state = {
      phase: "idle",
      reports: {},
      refinementAttempts: 0,
      emptyOutputRetries: 0,
    };
    this.updateStatus(ctx);
    ctx.ui.notify(message, "info");
  }

  private updateStatus(ctx: ExtensionContext) {
    if (this.state.phase === "idle") {
      ctx.ui.setStatus("bug-finder", undefined);
      ctx.ui.setWidget("bug-finder", undefined);
      return;
    }

    const phaseIndex = WORKFLOW_PHASES.indexOf(this.state.phase);
    const icon = this.state.phase === "fixer" ? "🔧" : "🔍";
    ctx.ui.setStatus("bug-finder", `${icon} Phase ${phaseIndex}/4: ${PHASE_LABELS[this.state.phase]}`);
  }
}

export function parseScopeArg(args: unknown): string | undefined {
  if (typeof args !== "string") {
    return undefined;
  }

  const scope = args.trim();
  return scope.length > 0 ? scope : undefined;
}

export function extractAssistantText(messages: unknown[]): string | undefined {
  const typedMessages = messages.filter((message): message is MessageLike => {
    return typeof message === "object" && message !== null;
  });

  const lastAssistantMessage = [...typedMessages]
    .reverse()
    .find((message) => message.role === "assistant");

  if (!lastAssistantMessage || !Array.isArray(lastAssistantMessage.content)) {
    return undefined;
  }

  const text = lastAssistantMessage.content
    .filter((block): block is TextBlock => typeof block === "object" && block !== null)
    .filter((block) => block.type === "text" && typeof block.text === "string")
    .map((block) => block.text as string)
    .join("\n")
    .trim();

  return text.length > 0 ? text : undefined;
}

function isAnalysisPhase(phase: WorkflowPhase): phase is AnalysisPhase {
  return ANALYSIS_PHASE_ORDER.includes(phase as AnalysisPhase);
}

function loadPrompts(promptDirectory: string): PromptLoadResult {
  try {
    const prompts = {
      finder: readPromptFile(promptDirectory, PROMPT_FILE_NAMES.finder),
      skeptic: readPromptFile(promptDirectory, PROMPT_FILE_NAMES.skeptic),
      arbiter: readPromptFile(promptDirectory, PROMPT_FILE_NAMES.arbiter),
      fixer: readPromptFile(promptDirectory, PROMPT_FILE_NAMES.fixer),
    };

    return { prompts };
  } catch (error) {
    const reason = error instanceof Error ? `${error.name}: ${error.message}` : "unknown I/O error";
    return {
      error: `failed to load prompt bundle from '${promptDirectory}': ${reason}`,
    };
  }
}

function readPromptFile(promptDirectory: string, fileName: string): string {
  const filePath = path.join(promptDirectory, fileName);
  const content = fs.readFileSync(filePath, "utf-8").trim();

  if (!content) {
    throw new Error(`prompt file '${filePath}' is empty`);
  }

  return content;
}

function buildPrompt(
  phase: AnalysisPhase | "fixer",
  prompts: PromptBundle,
  reports: WorkflowReports,
  scope?: string,
  refinement?: string,
): string {
  const sections: string[] = [];

  if (phase === "finder") {
    sections.push(prompts.finder);
    if (scope) {
      sections.push(`Focus on: ${scope}`);
    }
  }

  if (phase === "skeptic") {
    sections.push(prompts.skeptic, "## Bug Report from Phase 1", reports.finder ?? "");
  }

  if (phase === "arbiter") {
    sections.push(
      prompts.arbiter,
      "## Bug Report (Phase 1)",
      reports.finder ?? "",
      "## Skeptic Review (Phase 2)",
      reports.skeptic ?? "",
    );

    if (refinement?.trim()) {
      sections.push(
        "## Existing Arbitration",
        reports.arbiter ?? "",
        "## Refinement Request",
        refinement.trim(),
        "Please produce a fully revised arbitration report.",
      );
    }
  }

  if (phase === "fixer") {
    sections.push(prompts.fixer, "## Verified Bug List", reports.arbiter ?? "");
  }

  return sections.join("\n\n");
}
