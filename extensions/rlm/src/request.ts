import os from "node:os";
import path from "node:path";
import { mkdtemp, writeFile } from "node:fs/promises";
import { parseRlmArgs, type ParsedRlmArgs } from "./args";

export const DEFAULT_RLM_MAX_SLICE_CHARS = 4_000;
export const DEFAULT_RLM_MAX_RESULT_CHARS = 12_000;
export const DEFAULT_RLM_MAX_ITERATIONS = 12;
export const DEFAULT_RLM_MAX_RECURSION_DEPTH = 1;
export const DEFAULT_RLM_MAX_MALFORMED_OUTPUT_RETRIES = 1;

export type RlmRequestErrorCode = "missing_question" | "workspace_init_failed";

export interface RlmRequestError {
  code: RlmRequestErrorCode;
  message: string;
}

export interface RlmRequest {
  raw: string;
  path: string;
  absolutePath: string;
  question: string;
  content: string;
  sizeBytes: number;
  extension: string;
  workspaceDir: string;
  taskFilePath: string;
  scratchpadFilePath: string;
  finalFilePath: string;
}

export type RlmRequestResult =
  | { ok: true; value: RlmRequest }
  | { ok: false; error: RlmRequestError };

export interface ResolveRlmRequestOptions {
  cwd?: string;
  workspaceParentDir?: string;
  mkdtempImpl?: typeof mkdtemp;
  writeFileImpl?: typeof writeFile;
}

export async function resolveRlmRequest(
  args: unknown,
  options: ResolveRlmRequestOptions = {},
): Promise<RlmRequestResult> {
  const parsed = parseRlmArgs(args);
  if (!parsed.ok) {
    return {
      ok: false,
      error: {
        code: parsed.code,
        message: parsed.message,
      },
    };
  }

  return resolveParsedRlmRequest(parsed.value, options);
}

export async function resolveParsedRlmRequest(
  parsed: ParsedRlmArgs,
  options: ResolveRlmRequestOptions = {},
): Promise<RlmRequestResult> {
  const cwd = options.cwd ?? process.cwd();
  const workspaceParentDir = options.workspaceParentDir ?? os.tmpdir();
  const mkdtempImpl = options.mkdtempImpl ?? mkdtemp;
  const writeFileImpl = options.writeFileImpl ?? writeFile;

  let workspaceDir: string;
  try {
    workspaceDir = await mkdtempImpl(path.join(workspaceParentDir, "rlm-workspace-"));
  } catch {
    return failure("workspace_init_failed", "RLM could not create a workspace directory.");
  }

  const taskFilePath = path.join(workspaceDir, "task.md");
  const scratchpadFilePath = path.join(workspaceDir, "scratchpad.md");
  const finalFilePath = path.join(workspaceDir, "final.md");
  const absolutePath = path.join(workspaceDir, "workspace.md");
  const content = buildWorkspaceRootContent({
    question: parsed.question,
    taskFilePath,
    scratchpadFilePath,
    finalFilePath,
    scratchpadEntries: [],
    finalResult: undefined,
    variableNames: [],
  });

  try {
    await Promise.all([
      writeFileImpl(taskFilePath, buildTaskFileContent(parsed.question), "utf8"),
      writeFileImpl(
        scratchpadFilePath,
        buildScratchpadFileContent(parsed.question, [], []),
        "utf8",
      ),
      writeFileImpl(finalFilePath, buildFinalFileContent(parsed.question), "utf8"),
      writeFileImpl(absolutePath, content, "utf8"),
    ]);
  } catch {
    return failure("workspace_init_failed", "RLM could not initialize its workspace files.");
  }

  return {
    ok: true,
    value: {
      raw: parsed.raw,
      path: displayPath(cwd, absolutePath),
      absolutePath,
      question: parsed.question,
      content,
      sizeBytes: Buffer.byteLength(content, "utf8"),
      extension: ".md",
      workspaceDir,
      taskFilePath,
      scratchpadFilePath,
      finalFilePath,
    },
  };
}

export function buildTaskFileContent(question: string): string {
  return ["# RLM Task", "", "## Question", "", question.trim()].join("\n");
}

export function buildScratchpadFileContent(
  question: string,
  scratchpadEntries: Array<{ title: string; content: string }>,
  variableNames: string[],
): string {
  const sections = ["# RLM Scratchpad", "", "## Question", "", question.trim(), ""];

  sections.push("## Variables");
  if (variableNames.length === 0) {
    sections.push("", "- none yet", "");
  } else {
    sections.push("", ...variableNames.map((name) => `- ${name}`), "");
  }

  sections.push("## Notes");
  if (scratchpadEntries.length === 0) {
    sections.push("", "_No notes yet._");
  } else {
    for (const entry of scratchpadEntries) {
      sections.push("", `### ${entry.title}`, "", entry.content.trim());
    }
  }

  return sections.join("\n");
}

export function buildFinalFileContent(question: string, finalResult?: string): string {
  return [
    "# RLM Final Answer",
    "",
    "## Question",
    "",
    question.trim(),
    "",
    "## Answer",
    "",
    typeof finalResult === "string" && finalResult.trim().length > 0
      ? finalResult.trim()
      : "_Pending final answer._",
  ].join("\n");
}

export function buildWorkspaceRootContent(input: {
  question: string;
  taskFilePath: string;
  scratchpadFilePath: string;
  finalFilePath: string;
  scratchpadEntries: Array<{ title: string; content: string }>;
  finalResult?: string;
  variableNames: string[];
}): string {
  const scratchpadState =
    input.scratchpadEntries.length === 0
      ? "No scratchpad entries yet."
      : input.scratchpadEntries
          .map((entry) => `- ${entry.title}: ${entry.content.trim()}`)
          .join("\n");

  return [
    "# RLM Workspace",
    "",
    "This workspace was created by /rlm from a question-first run.",
    "",
    "## Question",
    "",
    input.question.trim(),
    "",
    "## Workspace Files",
    "",
    `- task.md: ${input.taskFilePath}`,
    `- scratchpad.md: ${input.scratchpadFilePath}`,
    `- final.md: ${input.finalFilePath}`,
    "",
    "## Current Scratchpad State",
    "",
    scratchpadState,
    "",
    "## Current Variables",
    "",
    input.variableNames.length === 0
      ? "- none yet"
      : input.variableNames.map((name) => `- ${name}`).join("\n"),
    "",
    "## Current Final Answer State",
    "",
    typeof input.finalResult === "string" && input.finalResult.trim().length > 0
      ? input.finalResult.trim()
      : "Pending final answer.",
  ].join("\n");
}

function displayPath(cwd: string, absolutePath: string): string {
  const relativePath = path.relative(cwd, absolutePath);
  return relativePath.length > 0 && !relativePath.startsWith("..") ? relativePath : absolutePath;
}

function failure(code: RlmRequestErrorCode, message: string): RlmRequestResult {
  return {
    ok: false,
    error: { code, message },
  };
}
