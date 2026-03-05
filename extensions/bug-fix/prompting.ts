import { PromptLoadError, loadPromptFiles } from "../../packages/workflow-core/src/index";

export const PROMPT_FILE_NAMES = {
  finder: "finder.md",
  skeptic: "skeptic.md",
  arbiter: "arbiter.md",
  fixer: "fixer.md",
} as const;

export type PromptKey = keyof typeof PROMPT_FILE_NAMES;
export type PromptBundle = Record<PromptKey, string>;

export interface WorkflowReports {
  finder?: string;
  skeptic?: string;
  arbiter?: string;
}

export interface PromptLoadResult {
  prompts?: PromptBundle;
  error?: PromptLoadError;
}

export function loadPrompts(promptDirectory: string): PromptLoadResult {
  const result = loadPromptFiles(promptDirectory, PROMPT_FILE_NAMES);
  if (!result.ok) {
    return { error: result.error };
  }

  return { prompts: result.prompts };
}

export function buildPrompt(
  phase: "finder" | "skeptic" | "arbiter" | "fixer",
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

export { PromptLoadError };
