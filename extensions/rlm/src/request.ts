import os from "node:os";
import path from "node:path";
import { mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { parseRlmArgs, type ParsedRlmArgs, type RlmPromptProfile } from "./args";

export const DEFAULT_RLM_MAX_BYTES = 8 * 1024 * 1024;
export const DEFAULT_RLM_MAX_SLICE_CHARS = 4_000;
export const DEFAULT_RLM_MAX_RESULT_CHARS = 12_000;
export const DEFAULT_RLM_MAX_ITERATIONS = 24;
export const DEFAULT_RLM_MAX_RECURSION_DEPTH = 1;
export const DEFAULT_RLM_MAX_MALFORMED_OUTPUT_RETRIES = 1;
export const DEFAULT_SUPPORTED_EXTENSIONS = [".md", ".markdown", ".mdx", ".txt", ".rst"];

export type RlmRequestErrorCode =
  | "missing_question"
  | "invalid_prompt_profile"
  | "workspace_init_failed";

export interface RlmRequestError {
  code: RlmRequestErrorCode;
  message: string;
}

export interface RlmImportedSource {
  path: string;
  absolutePath: string;
  extension: string;
  sizeBytes: number;
  content: string;
}

export interface RlmPromptContextChunk {
  id: string;
  kind: "task" | "source";
  label: string;
  sourcePath?: string;
  charLength: number;
  lineCount: number;
  content: string;
}

export interface RlmPromptContext {
  type: "string" | "list[str]";
  question: string;
  prompt: string;
  chunks: RlmPromptContextChunk[];
  contextLengths: number[];
  importedSourceCount: number;
}

export interface RlmRequest {
  raw: string;
  path: string;
  absolutePath: string;
  question: string;
  promptProfile: RlmPromptProfile;
  promptContext: RlmPromptContext;
  promptContent: string;
  content: string;
  sizeBytes: number;
  extension: string;
  workspaceDir: string;
  taskFilePath: string;
  scratchpadFilePath: string;
  finalFilePath: string;
  sourcesFilePath: string;
  importedSources: RlmImportedSource[];
}

export type RlmRequestResult =
  | { ok: true; value: RlmRequest }
  | { ok: false; error: RlmRequestError };

export interface ResolveRlmRequestOptions {
  cwd?: string;
  workspaceParentDir?: string;
  maxImportedBytes?: number;
  mkdtempImpl?: typeof mkdtemp;
  writeFileImpl?: typeof writeFile;
  readFileImpl?: typeof readFile;
  statImpl?: typeof stat;
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
  const maxImportedBytes = options.maxImportedBytes ?? DEFAULT_RLM_MAX_BYTES;
  const mkdtempImpl = options.mkdtempImpl ?? mkdtemp;
  const writeFileImpl = options.writeFileImpl ?? writeFile;
  const readFileImpl = options.readFileImpl ?? readFile;
  const statImpl = options.statImpl ?? stat;

  let workspaceDir: string;
  try {
    workspaceDir = await mkdtempImpl(path.join(workspaceParentDir, "rlm-workspace-"));
  } catch {
    return failure("workspace_init_failed", "RLM could not create a workspace directory.");
  }

  const importedSources = await detectImportedSources(parsed.question, {
    cwd,
    maxImportedBytes,
    readFileImpl,
    statImpl,
  });

  const promptContent = buildPromptContent(parsed.question, importedSources);
  const promptContext = buildPromptContext(parsed.question, importedSources, promptContent);
  const taskFilePath = path.join(workspaceDir, "task.md");
  const scratchpadFilePath = path.join(workspaceDir, "scratchpad.md");
  const finalFilePath = path.join(workspaceDir, "final.md");
  const sourcesFilePath = path.join(workspaceDir, "sources.md");
  const absolutePath = path.join(workspaceDir, "workspace.md");
  const content = buildWorkspaceRootContent({
    question: parsed.question,
    promptProfile: parsed.promptProfile,
    promptContext,
    promptContent,
    taskFilePath,
    scratchpadFilePath,
    finalFilePath,
    sourcesFilePath,
    importedSources,
    scratchpadEntries: [],
    finalResult: undefined,
    variableNames: [],
  });

  try {
    await Promise.all([
      writeFileImpl(taskFilePath, buildTaskFileContent(parsed.question, parsed.promptProfile), "utf8"),
      writeFileImpl(
        scratchpadFilePath,
        buildScratchpadFileContent(parsed.question, [], []),
        "utf8",
      ),
      writeFileImpl(finalFilePath, buildFinalFileContent(parsed.question), "utf8"),
      writeFileImpl(sourcesFilePath, buildSourcesFileContent(importedSources), "utf8"),
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
      promptProfile: parsed.promptProfile,
      promptContext,
      promptContent,
      content,
      sizeBytes: Buffer.byteLength(content, "utf8"),
      extension: ".md",
      workspaceDir,
      taskFilePath,
      scratchpadFilePath,
      finalFilePath,
      sourcesFilePath,
      importedSources,
    },
  };
}

export function buildPromptContext(
  question: string,
  importedSources: RlmImportedSource[],
  promptContent = buildPromptContent(question, importedSources),
): RlmPromptContext {
  const trimmedQuestion = question.trim();
  const chunks: RlmPromptContextChunk[] = [
    {
      id: "task",
      kind: "task",
      label: "Task prompt",
      charLength: trimmedQuestion.length,
      lineCount: countLines(trimmedQuestion),
      content: trimmedQuestion,
    },
    ...importedSources.map((source, index) => ({
      id: `source_${index + 1}`,
      kind: "source" as const,
      label: source.path,
      sourcePath: source.path,
      charLength: source.content.length,
      lineCount: countLines(source.content),
      content: source.content,
    })),
  ];

  return {
    type: chunks.length <= 1 ? "string" : "list[str]",
    question: trimmedQuestion,
    prompt: promptContent,
    chunks,
    contextLengths: chunks.map((chunk) => chunk.charLength),
    importedSourceCount: importedSources.length,
  };
}

export function buildPromptContent(question: string, importedSources: RlmImportedSource[]): string {
  const sections = ["# RLM Input Prompt", "", question.trim()];

  if (importedSources.length === 0) {
    return sections.join("\n");
  }

  sections.push("", "## Imported Sources");
  for (const source of importedSources) {
    sections.push("", `### ${source.path}`, "", source.content);
  }

  return sections.join("\n");
}

export function buildTaskFileContent(question: string, promptProfile: RlmPromptProfile): string {
  return [
    "# RLM Prompt",
    "",
    `- promptProfile: ${promptProfile}`,
    "",
    "## Input Prompt",
    "",
    question.trim(),
  ].join("\n");
}

export function buildScratchpadFileContent(
  question: string,
  scratchpadEntries: Array<{ title: string; content: string }>,
  variableNames: string[],
): string {
  const sections = ["# RLM Scratchpad", "", "## Input Prompt", "", question.trim(), ""];

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
    "## Input Prompt",
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

export function buildSourcesFileContent(importedSources: RlmImportedSource[]): string {
  if (importedSources.length === 0) {
    return [
      "# RLM Sources",
      "",
      "No external source files were auto-imported from the input prompt.",
    ].join("\n");
  }

  const sections = ["# RLM Sources"];
  for (const source of importedSources) {
    sections.push(
      "",
      `## ${source.path}`,
      "",
      `- absolutePath: ${source.absolutePath}`,
      `- extension: ${source.extension}`,
      `- sizeBytes: ${source.sizeBytes}`,
      `- charLength: ${source.content.length}`,
      `- lineCount: ${countLines(source.content)}`,
      "",
      "### Content",
      "",
      source.content,
    );
  }

  return sections.join("\n");
}

export function buildWorkspaceRootContent(input: {
  question: string;
  promptProfile: RlmPromptProfile;
  promptContext: RlmPromptContext;
  promptContent: string;
  taskFilePath: string;
  scratchpadFilePath: string;
  finalFilePath: string;
  sourcesFilePath: string;
  importedSources: RlmImportedSource[];
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

  const importedSourceSummary =
    input.importedSources.length === 0
      ? "No external source files were imported from the input prompt."
      : input.importedSources
          .map(
            (source) =>
              `- ${source.path} (${source.extension}, ${source.sizeBytes} bytes, ${source.content.length} chars)`,
          )
          .join("\n");

  const contextChunkSummary = input.promptContext.chunks
    .map((chunk, index) => {
      const origin = chunk.sourcePath ? `, sourcePath: ${chunk.sourcePath}` : "";
      return `- [${index}] ${chunk.id} (${chunk.kind}) — ${chunk.label}; ${chunk.charLength} chars; ${chunk.lineCount} lines${origin}`;
    })
    .join("\n");

  const contextChunkContents = input.promptContext.chunks
    .map((chunk, index) => {
      const header = [`### Chunk ${index}: ${chunk.label}`, "", `- id: ${chunk.id}`, `- kind: ${chunk.kind}`];
      if (chunk.sourcePath) {
        header.push(`- sourcePath: ${chunk.sourcePath}`);
      }
      header.push(`- charLength: ${chunk.charLength}`, `- lineCount: ${chunk.lineCount}`, "", chunk.content);
      return header.join("\n");
    })
    .join("\n\n");

  const promptPreview = input.promptContent.slice(0, 400);
  const promptPreviewTruncated = promptPreview.length < input.promptContent.length;

  return [
    "# RLM Workspace",
    "",
    "This workspace mirrors the persistent environment used by /rlm.",
    "",
    "## Input Prompt",
    "",
    input.question.trim(),
    "",
    "## Prompt Profile",
    "",
    `- promptProfile: ${input.promptProfile}`,
    "",
    "## Root Prompt Metadata",
    "",
    `- charLength: ${input.promptContent.length}`,
    `- lineCount: ${countLines(input.promptContent)}`,
    `- importedSourceCount: ${input.importedSources.length}`,
    `- context_type: ${input.promptContext.type}`,
    `- context_lengths: [${input.promptContext.contextLengths.join(", ")}]`,
    `- contextChunkCount: ${input.promptContext.chunks.length}`,
    `- previewTruncated: ${promptPreviewTruncated}`,
    "",
    "### Prompt Preview",
    "",
    promptPreview,
    "",
    "## Workspace Files",
    "",
    `- task.md: ${input.taskFilePath}`,
    `- scratchpad.md: ${input.scratchpadFilePath}`,
    `- final.md: ${input.finalFilePath}`,
    `- sources.md: ${input.sourcesFilePath}`,
    "",
    "## Imported Sources",
    "",
    importedSourceSummary,
    "",
    "## Context Chunks",
    "",
    contextChunkSummary,
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
    "",
    "## Context Chunk Contents",
    "",
    contextChunkContents,
  ].join("\n");
}

async function detectImportedSources(
  question: string,
  options: {
    cwd: string;
    maxImportedBytes: number;
    readFileImpl: typeof readFile;
    statImpl: typeof stat;
  },
): Promise<RlmImportedSource[]> {
  const supportedExtensions = new Set(DEFAULT_SUPPORTED_EXTENSIONS);
  const seen = new Set<string>();
  const importedSources: RlmImportedSource[] = [];

  for (const candidate of extractPathCandidates(question)) {
    const normalizedCandidate = normalizeQuestionPathCandidate(candidate);
    const absolutePath = path.resolve(options.cwd, expandHomeDirectory(normalizedCandidate));
    const extension = path.extname(absolutePath).toLowerCase();

    if (!supportedExtensions.has(extension) || seen.has(absolutePath)) {
      continue;
    }

    try {
      const fileStat = await options.statImpl(absolutePath);
      if (!fileStat.isFile() || fileStat.size === 0 || fileStat.size > options.maxImportedBytes) {
        continue;
      }

      const content = await options.readFileImpl(absolutePath, "utf8");
      if (content.trim().length === 0) {
        continue;
      }

      importedSources.push({
        path: normalizedCandidate,
        absolutePath,
        extension,
        sizeBytes: fileStat.size,
        content,
      });
      seen.add(absolutePath);
    } catch {
      continue;
    }
  }

  return importedSources;
}

function extractPathCandidates(question: string): string[] {
  const matches = question.match(/(?:~|\.{1,2}|\/)[^\n"',;:!?]+?\.(?:md|markdown|mdx|txt|rst)/gi);
  return matches ?? [];
}

function normalizeQuestionPathCandidate(candidate: string): string {
  return candidate.trim().replace(/\\ /g, " ");
}

function expandHomeDirectory(inputPath: string): string {
  if (inputPath === "~") {
    return os.homedir();
  }

  if (inputPath.startsWith("~/") || inputPath.startsWith("~\\")) {
    return path.join(os.homedir(), inputPath.slice(2));
  }

  return inputPath;
}

function displayPath(cwd: string, absolutePath: string): string {
  const relativePath = path.relative(cwd, absolutePath);
  return relativePath.length > 0 && !relativePath.startsWith("..") ? relativePath : absolutePath;
}

function countLines(content: string): number {
  if (content.length === 0) {
    return 0;
  }

  return content.split(/\r?\n/).length;
}

function failure(code: RlmRequestErrorCode, message: string): RlmRequestResult {
  return {
    ok: false,
    error: { code, message },
  };
}
