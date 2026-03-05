import * as fs from "node:fs";
import * as path from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@anthropic-ai/claude-code";

const PHASE_LABELS = [
  "",
  "Finding bugs...",
  "Reviewing bugs...",
  "Arbitrating...",
  "Fixing bugs",
];

interface BugFinderState {
  phase: 0 | 1 | 2 | 3 | 4;
  scope?: string;
  outputs: string[];
}

export default function bugFinder(pi: ExtensionAPI) {
  let state: BugFinderState = { phase: 0, outputs: [] };

  const promptDir = path.resolve(__dirname, "prompts");
  const PROMPT_FILES = ["finder", "skeptic", "arbiter", "fixer"];
  const prompts = PROMPT_FILES.map((name) =>
    fs.readFileSync(path.join(promptDir, `${name}.md`), "utf-8"),
  );

  function reset() {
    state = { phase: 0, outputs: [] };
  }

  function updateStatus(ctx: ExtensionContext) {
    if (state.phase === 0) {
      ctx.ui.setStatus("bug-finder", undefined);
      ctx.ui.setWidget("bug-finder", undefined);
    } else {
      const icon = state.phase <= 3 ? "🔍" : "🔧";
      ctx.ui.setStatus(
        "bug-finder",
        `${icon} Phase ${state.phase}/4: ${PHASE_LABELS[state.phase]}`,
      );
    }
  }

  pi.registerCommand("bug-finder", {
    description: "Run the adversarial bug-finding workflow (4 phases)",
    handler: async (args, ctx) => {
      state = { phase: 1, scope: args.trim() || undefined, outputs: [] };
      updateStatus(ctx);

      const scope = state.scope ? `\n\nFocus on: ${state.scope}` : "";
      pi.sendUserMessage(`${prompts[0]}${scope}`);
    },
  });

  pi.on("before_agent_start", async () => {
    if (state.phase === 0) return;

    let content = "";
    if (state.phase === 1) {
      content = prompts[0];
    } else if (state.phase === 2) {
      content = `${prompts[1]}\n\n## Bug Report from Phase 1\n\n${state.outputs[0]}`;
    } else if (state.phase === 3) {
      content = `${prompts[2]}\n\n## Bug Report (Phase 1)\n\n${state.outputs[0]}\n\n## Skeptic Review (Phase 2)\n\n${state.outputs[1]}`;
    } else if (state.phase === 4) {
      content = `${prompts[3]}\n\n## Verified Bug List\n\n${state.outputs[2]}`;
    }

    return {
      message: {
        customType: "bug-finder-context",
        content: `[BUG FINDER - Phase ${state.phase}]\n\n${content}`,
        display: false,
      },
    };
  });

  pi.on("tool_call", async (event) => {
    if (state.phase >= 1 && state.phase <= 3) {
      if (["Edit", "Write"].includes(event.toolName)) {
        return {
          block: true,
          reason: "Bug finder analysis phase: writes are disabled",
        };
      }
    }
  });

  pi.on("agent_end", async (event, ctx) => {
    if (state.phase === 0) return;

    const lastAssistant = [...event.messages]
      .reverse()
      .find((m) => m.role === "assistant");
    const text =
      lastAssistant?.content
        ?.filter((b: { type: string }) => b.type === "text")
        ?.map((b: { type: string; text?: string }) => b.text)
        ?.join("\n") || "";

    if (state.phase <= 2) {
      state.outputs.push(text);
      state.phase = (state.phase + 1) as 2 | 3;
      updateStatus(ctx);
      pi.sendUserMessage(prompts[state.phase - 1]);
    } else if (state.phase === 3) {
      state.outputs.push(text);
      updateStatus(ctx);

      const choice = await ctx.ui.select("Bug Finder - Analysis Complete", [
        "Execute fixes (TDD workflow)",
        "Refine the analysis",
        "Cancel",
      ]);

      if (choice?.startsWith("Execute")) {
        state.phase = 4;

        updateStatus(ctx);
        ctx.ui.setWidget(
          "bug-finder",
          `## Verified Bugs\n\n${state.outputs[2]}`,
        );
        pi.sendUserMessage(prompts[3]);
      } else if (choice?.startsWith("Refine")) {
        const refinement = await ctx.ui.editor("Refine analysis:", "");
        if (refinement?.trim()) {
          pi.sendUserMessage(refinement.trim());
        }
      } else {
        reset();

        updateStatus(ctx);
        ctx.ui.notify("Bug finder cancelled.", "info");
      }
    } else if (state.phase === 4) {
      reset();
      updateStatus(ctx);
      ctx.ui.notify("Bug finder workflow complete!", "info");
    }
  });

  pi.on("context", async (event) => {
    if (state.phase !== 0) return;
    return {
      messages: event.messages.filter((m: Record<string, unknown>) => {
        return m.customType !== "bug-finder-context";
      }),
    };
  });
}
