import * as fs from "node:fs";
import * as path from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@anthropic-ai/claude-code";

const WORKFLOW_PHASES = ["idle", "finder", "skeptic", "arbiter", "fixer"] as const;
type WorkflowPhase = (typeof WORKFLOW_PHASES)[number];

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

type PromptKey = keyof typeof PROMPT_FILE_NAMES;
type PromptBundle = Record<PromptKey, string>;

interface WorkflowReports {
  finder?: string;
  skeptic?: string;
  arbiter?: string;
}

interface WorkflowState {
  phase: WorkflowPhase;
  scope?: string;
  reports: WorkflowReports;
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
    handler: async (args, ctx) => {
      await workflow.handleCommand(args, ctx);
    },
  });

  api.on("tool_call", async (event) => workflow.handleToolCall(event));
  api.on("agent_end", async (event, ctx) => workflow.handleAgentEnd(event, ctx));
}

class BugFinderWorkflow {
  private state: WorkflowState = { phase: "idle", reports: {} };

  constructor(
    private readonly api: ExtensionAPI,
    private readonly prompts?: PromptBundle,
    private readonly startupError?: string,
  ) {}

  async handleCommand(args: unknown, ctx: ExtensionContext) {
    if (!this.prompts) {
      ctx.ui.notify(
        `Bug finder is unavailable: ${this.startupError ?? "prompt initialization failed."}`,
        "error",
      );
      return;
    }

    if (this.state.phase !== "idle") {
      ctx.ui.notify("Bug finder is already running. Finish or cancel the current run first.", "warning");
      return;
    }

    this.state = {
      phase: "finder",
      scope: parseScopeArg(args),
      reports: {},
    };

    this.updateStatus(ctx);
    this.api.sendUserMessage(buildFinderPrompt(this.prompts.finder, this.state.scope));
  }

  async handleToolCall(event: { toolName?: string }) {
    if (!["finder", "skeptic", "arbiter"].includes(this.state.phase)) {
      return;
    }

    if (["Edit", "Write"].includes(event.toolName ?? "")) {
      return {
        block: true,
        reason: "Bug finder analysis phase: writes are disabled",
      };
    }
  }

  async handleAgentEnd(event: { messages?: unknown[] }, ctx: ExtensionContext) {
    if (this.state.phase === "idle" || !this.prompts) {
      return;
    }

    const assistantText = extractAssistantText(event.messages ?? []);
    if (!assistantText) {
      ctx.ui.notify(
        `No assistant output captured for phase '${this.state.phase}'. Keeping workflow in the same phase.`,
        "warning",
      );
      this.requeueCurrentPhase();
      return;
    }

    if (this.state.phase === "finder") {
      this.state.reports.finder = assistantText;
      this.state.phase = "skeptic";
      this.updateStatus(ctx);
      this.api.sendUserMessage(buildSkepticPrompt(this.prompts, this.state.reports));
      return;
    }

    if (this.state.phase === "skeptic") {
      this.state.reports.skeptic = assistantText;
      this.state.phase = "arbiter";
      this.updateStatus(ctx);
      this.api.sendUserMessage(buildArbiterPrompt(this.prompts, this.state.reports));
      return;
    }

    if (this.state.phase === "arbiter") {
      this.state.reports.arbiter = assistantText;
      await this.handleArbiterComplete(ctx);
      return;
    }

    if (this.state.phase === "fixer") {
      this.finishRun(ctx, "Bug finder workflow complete!");
    }
  }

  private async handleArbiterComplete(ctx: ExtensionContext) {
    this.updateStatus(ctx);

    const choice = await ctx.ui.select("Bug Finder - Analysis Complete", [
      "Execute fixes (TDD workflow)",
      "Refine the analysis",
      "Cancel",
    ]);

    if (choice?.startsWith("Execute")) {
      this.state.phase = "fixer";
      this.updateStatus(ctx);
      ctx.ui.setWidget("bug-finder", `## Verified Bugs\n\n${this.state.reports.arbiter ?? ""}`);
      this.api.sendUserMessage(buildFixerPrompt(this.prompts!, this.state.reports));
      return;
    }

    if (choice?.startsWith("Refine")) {
      const refinement = await ctx.ui.editor("Refine analysis:", "");
      if (!refinement?.trim()) {
        ctx.ui.notify("Refinement cancelled: no refinement text was provided.", "info");
        return;
      }

      this.api.sendUserMessage(buildRefinementPrompt(this.prompts!, this.state.reports, refinement));
      return;
    }

    this.finishRun(ctx, "Bug finder cancelled.");
  }

  private requeueCurrentPhase() {
    if (!this.prompts || this.state.phase === "idle") {
      return;
    }

    if (this.state.phase === "finder") {
      this.api.sendUserMessage(buildFinderPrompt(this.prompts.finder, this.state.scope));
      return;
    }

    if (this.state.phase === "skeptic") {
      this.api.sendUserMessage(buildSkepticPrompt(this.prompts, this.state.reports));
      return;
    }

    if (this.state.phase === "arbiter") {
      this.api.sendUserMessage(buildArbiterPrompt(this.prompts, this.state.reports));
      return;
    }

    if (this.state.phase === "fixer") {
      this.api.sendUserMessage(buildFixerPrompt(this.prompts, this.state.reports));
    }
  }

  private finishRun(ctx: ExtensionContext, message: string) {
    this.state = { phase: "idle", reports: {} };
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
    ctx.ui.setStatus(
      "bug-finder",
      `${icon} Phase ${phaseIndex}/4: ${PHASE_LABELS[this.state.phase]}`,
    );
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
    const reason = error instanceof Error ? error.message : "unknown I/O error";
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

function buildFinderPrompt(finderPrompt: string, scope?: string): string {
  return scope ? `${finderPrompt}\n\nFocus on: ${scope}` : finderPrompt;
}

function buildSkepticPrompt(prompts: PromptBundle, reports: WorkflowReports): string {
  return `${prompts.skeptic}\n\n## Bug Report from Phase 1\n\n${reports.finder ?? ""}`;
}

function buildArbiterPrompt(prompts: PromptBundle, reports: WorkflowReports): string {
  return [
    prompts.arbiter,
    "## Bug Report (Phase 1)",
    reports.finder ?? "",
    "## Skeptic Review (Phase 2)",
    reports.skeptic ?? "",
  ].join("\n\n");
}

function buildRefinementPrompt(
  prompts: PromptBundle,
  reports: WorkflowReports,
  refinement: string,
): string {
  return [
    prompts.arbiter,
    "## Existing Arbitration",
    reports.arbiter ?? "",
    "## Refinement Request",
    refinement.trim(),
    "Please produce a fully revised arbitration report.",
  ].join("\n\n");
}

function buildFixerPrompt(prompts: PromptBundle, reports: WorkflowReports): string {
  return `${prompts.fixer}\n\n## Verified Bug List\n\n${reports.arbiter ?? ""}`;
}
