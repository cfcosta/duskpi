import {
  PromptLoadError,
  loadPromptFiles,
  type PromptLoadResult,
} from "../../packages/workflow-core/src/index";

import type { RefactorExecutionUnit } from "./contract";

export const PROMPT_FILE_NAMES = {
  mapper: "mapper.md",
  skeptic: "skeptic.md",
  arbiter: "arbiter.md",
  executor: "executor.md",
  worker: "worker.md",
} as const;

export type PromptKey = keyof typeof PROMPT_FILE_NAMES;
export type PromptBundle = Record<PromptKey, string>;

export interface WorkflowReports {
  mapper?: string;
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
      phase: "mapper";
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
      phase: "executor";
      prompts: PromptBundle;
      reports: WorkflowReports;
    };

export interface WorkerPromptInput {
  prompts: PromptBundle;
  executionUnit: RefactorExecutionUnit;
  approvedPlanSummary?: string;
  step?: number;
  totalSteps?: number;
}

export function buildPrompt(input: BuildPromptInput): string {
  const { phase, prompts, reports } = input;

  if (phase === "mapper") {
    const sections = [prompts.mapper];
    if (input.scope) {
      sections.push(`Focus on: ${input.scope}`);
    }

    return sections.join("\n\n");
  }

  if (phase === "skeptic") {
    return [prompts.skeptic, "## Mapper Proposal (Structured Contract)", reports.mapper ?? ""].join(
      "\n\n",
    );
  }

  if (phase === "arbiter") {
    const sections = [
      prompts.arbiter,
      "## Mapper Proposal (Structured Contract)",
      reports.mapper ?? "",
      "## Skeptic Review (Phase 2)",
      reports.skeptic ?? "",
    ];

    if (input.refinement?.trim()) {
      sections.push(
        "## Existing Approved Plan (Structured Contract)",
        reports.arbiter ?? "",
        "## Refinement Request",
        input.refinement.trim(),
        "Please produce a fully revised refactor plan in the structured contract format.",
      );
    }

    return sections.join("\n\n");
  }

  return [prompts.executor, "## Approved Refactor Plan", reports.arbiter ?? ""].join("\n\n");
}

export function buildWorkerPrompt(input: WorkerPromptInput): string {
  const sections = [input.prompts.worker];

  if (input.approvedPlanSummary?.trim()) {
    sections.push("## Approved Plan Summary", input.approvedPlanSummary.trim());
  }

  if (typeof input.step === "number" && typeof input.totalSteps === "number") {
    sections.push("## Execution Position", `Unit ${input.step}/${input.totalSteps}`);
  }

  sections.push(
    "## Assigned Execution Unit",
    `ID: ${input.executionUnit.id}`,
    `Title: ${input.executionUnit.title}`,
    `Objective: ${input.executionUnit.objective}`,
    input.executionUnit.dependsOn.length > 0
      ? `Depends on: ${input.executionUnit.dependsOn.join(", ")}`
      : "Depends on: none",
    "Targets:",
    ...input.executionUnit.targets.map((target) => `- ${target}`),
    "Validations:",
    ...input.executionUnit.validations.map((validation) => `- ${validation}`),
  );

  return sections.join("\n\n");
}

export { PromptLoadError };
