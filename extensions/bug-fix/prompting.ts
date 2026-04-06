import {
  PromptLoadError,
  loadPromptFiles,
  type PromptLoadResult,
} from "../../packages/workflow-core/src/index";

import { BUG_FIX_PLAN_JSON_BLOCK_TAG } from "./contract";

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

export function loadPrompts(promptDirectory: string): PromptLoadResult<PromptBundle> {
  const result = loadPromptFiles(promptDirectory, PROMPT_FILE_NAMES);
  if (!result.ok) {
    return { ok: false, error: result.error };
  }

  return { ok: true, prompts: result.prompts };
}

type BuildPromptInput =
  | {
      phase: "finder";
      prompts: PromptBundle;
      reports: WorkflowReports;
      scope?: string;
    }
  | {
      phase: "skeptic";
      prompts: PromptBundle;
      reports: WorkflowReports;
    }
  | {
      phase: "arbiter";
      prompts: PromptBundle;
      reports: WorkflowReports;
      refinement?: string;
    }
  | {
      phase: "fixer";
      prompts: PromptBundle;
      reports: WorkflowReports;
    };

export function buildPrompt(input: BuildPromptInput): string {
  const { phase, prompts, reports } = input;

  if (phase === "finder") {
    const sections = [prompts.finder];
    if (input.scope) {
      sections.push(`Focus on: ${input.scope}`);
    }

    return sections.join("\n\n");
  }

  if (phase === "skeptic") {
    return [prompts.skeptic, "## Bug Report from Phase 1", reports.finder ?? ""].join("\n\n");
  }

  if (phase === "arbiter") {
    const sections = [
      prompts.arbiter,
      "## Bug Report (Phase 1)",
      reports.finder ?? "",
      "## Skeptic Review (Phase 2)",
      reports.skeptic ?? "",
    ];

    if (input.refinement?.trim()) {
      sections.push(
        "## Existing Approved Bug-Fix Plan (Structured Contract)",
        reports.arbiter ?? "",
        "## Refinement Request",
        input.refinement.trim(),
        "Please produce a fully revised bug-fix plan in the structured contract format.",
      );
    }

    sections.push(
      "## Structured Contract Reminder",
      `If you confirm one or more real bugs, include a tagged JSON block named \`${BUG_FIX_PLAN_JSON_BLOCK_TAG}\` using the approved_bug_fix_plan contract.`,
    );

    return sections.join("\n\n");
  }

  return [
    prompts.fixer,
    "## Approved Bug-Fix Plan (Structured Contract)",
    reports.arbiter ?? "",
  ].join("\n\n");
}

export { PromptLoadError };
