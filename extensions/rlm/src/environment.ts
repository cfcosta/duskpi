import { writeFileSync } from "node:fs";
import type { RlmRequest } from "./request";
import {
  buildFinalFileContent,
  buildPromptContent,
  buildScratchpadFileContent,
  buildSourcesFileContent,
  buildTaskFileContent,
  buildWorkspaceRootContent,
} from "./request";

export const DEFAULT_METADATA_PREVIEW_CHARS = 240;

export interface RlmPromptMetadata {
  label?: string;
  promptCharLength: number;
  promptLineCount: number;
  promptPreview: string;
  promptPreviewTruncated: boolean;
  importedSourceCount: number;
  importedSourcePaths: string[];
  variableCount: number;
  variableNames: string[];
  hasFinalResult: boolean;
  workspaceDir?: string;
  taskFilePath?: string;
  scratchpadFilePath?: string;
  finalFilePath?: string;
  sourcesFilePath?: string;
}

interface ScratchpadEntry {
  title: string;
  content: string;
}

export class RlmPromptEnvironment {
  private readonly variables = new Map<string, string>();
  private finalResult?: string;
  private readonly scratchpadEntries: ScratchpadEntry[] = [];

  constructor(
    private readonly input: {
      prompt: string;
      label?: string;
      request?: RlmRequest;
    },
  ) {
    this.syncWorkspaceFiles();
  }

  static fromRequest(request: RlmRequest): RlmPromptEnvironment {
    return new RlmPromptEnvironment({
      prompt: request.promptContent,
      request,
    });
  }

  static fromPrompt(prompt: string, label?: string): RlmPromptEnvironment {
    return new RlmPromptEnvironment({ prompt, label });
  }

  getPrompt(): string {
    return this.input.prompt;
  }

  getLabel(): string | undefined {
    return this.input.label;
  }

  getPromptMetadata(options: { previewChars?: number } = {}): RlmPromptMetadata {
    const previewChars = normalizeNonNegativeInteger(
      options.previewChars,
      DEFAULT_METADATA_PREVIEW_CHARS,
    );
    const promptPreview = this.input.prompt.slice(0, previewChars);
    const promptPreviewTruncated = promptPreview.length < this.input.prompt.length;

    return {
      label: this.input.label,
      promptCharLength: this.input.prompt.length,
      promptLineCount: countLines(this.input.prompt),
      promptPreview,
      promptPreviewTruncated,
      importedSourceCount: this.input.request?.importedSources.length ?? 0,
      importedSourcePaths: this.input.request?.importedSources.map((source) => source.path) ?? [],
      variableCount: this.variables.size,
      variableNames: this.listVariableNames(),
      hasFinalResult: typeof this.finalResult === "string",
      workspaceDir: this.input.request?.workspaceDir,
      taskFilePath: this.input.request?.taskFilePath,
      scratchpadFilePath: this.input.request?.scratchpadFilePath,
      finalFilePath: this.input.request?.finalFilePath,
      sourcesFilePath: this.input.request?.sourcesFilePath,
    };
  }

  getExecutionBindings(): Record<string, unknown> {
    return {
      Prompt: this.input.prompt,
      prompt: this.input.prompt,
      label: this.input.label,
      variables: Object.fromEntries(this.variables),
      metadata: this.getPromptMetadata({ previewChars: 0 }),
      workspace: this.input.request
        ? {
            workspaceDir: this.input.request.workspaceDir,
            taskFilePath: this.input.request.taskFilePath,
            scratchpadFilePath: this.input.request.scratchpadFilePath,
            finalFilePath: this.input.request.finalFilePath,
            sourcesFilePath: this.input.request.sourcesFilePath,
          }
        : undefined,
    };
  }

  applyVariableUpdates(values: Record<string, string>): { updatedVariableNames: string[] } {
    const updatedVariableNames: string[] = [];
    for (const [name, value] of Object.entries(values)) {
      const normalizedName = normalizeVariableName(name);
      this.variables.set(normalizedName, value);
      if (normalizedName === "Final") {
        this.finalResult = value;
      }
      updatedVariableNames.push(normalizedName);
    }

    if (updatedVariableNames.length > 0) {
      this.syncWorkspaceFiles();
    }

    return {
      updatedVariableNames: updatedVariableNames.sort(),
    };
  }

  setVariable(name: string, value: string): void {
    const normalizedName = normalizeVariableName(name);
    this.variables.set(normalizedName, value);
    if (normalizedName === "Final") {
      this.finalResult = value;
    }
    this.syncWorkspaceFiles();
  }

  getVariable(name: string): string | undefined {
    return this.variables.get(normalizeVariableName(name));
  }

  listVariableNames(): string[] {
    return [...this.variables.keys()].sort();
  }

  appendScratchpadEntry(title: string, content: string): void {
    const normalizedTitle = title.trim();
    const normalizedContent = content.trim();
    if (normalizedTitle.length === 0 || normalizedContent.length === 0) {
      throw new Error("RLM scratchpad entries require a non-empty title and content.");
    }

    this.scratchpadEntries.push({
      title: normalizedTitle,
      content: normalizedContent,
    });
    this.syncWorkspaceFiles();
  }

  setFinalResult(value: string): void {
    this.finalResult = value;
    this.variables.set("Final", value);
    this.syncWorkspaceFiles();
  }

  getFinalResult(): string | undefined {
    return this.finalResult ?? this.variables.get("Final");
  }

  private syncWorkspaceFiles(): void {
    if (!this.input.request) {
      return;
    }

    writeFileSync(
      this.input.request.taskFilePath,
      buildTaskFileContent(this.input.request.question),
      "utf8",
    );
    writeFileSync(
      this.input.request.scratchpadFilePath,
      buildScratchpadFileContent(
        this.input.request.question,
        this.scratchpadEntries,
        this.listVariableNames(),
      ),
      "utf8",
    );
    writeFileSync(
      this.input.request.finalFilePath,
      buildFinalFileContent(this.input.request.question, this.getFinalResult()),
      "utf8",
    );
    writeFileSync(
      this.input.request.sourcesFilePath,
      buildSourcesFileContent(this.input.request.importedSources),
      "utf8",
    );
    writeFileSync(
      this.input.request.absolutePath,
      buildWorkspaceRootContent({
        question: this.input.request.question,
        promptContent: buildPromptContent(
          this.input.request.question,
          this.input.request.importedSources,
        ),
        taskFilePath: this.input.request.taskFilePath,
        scratchpadFilePath: this.input.request.scratchpadFilePath,
        finalFilePath: this.input.request.finalFilePath,
        sourcesFilePath: this.input.request.sourcesFilePath,
        importedSources: this.input.request.importedSources,
        scratchpadEntries: this.scratchpadEntries,
        finalResult: this.getFinalResult(),
        variableNames: this.listVariableNames(),
      }),
      "utf8",
    );
  }
}

function countLines(content: string): number {
  if (content.length === 0) {
    return 0;
  }

  return content.split(/\r?\n/).length;
}

function normalizeVariableName(name: string): string {
  const normalized = name.trim();
  if (normalized.length === 0) {
    throw new Error("RLM environment variable names must be non-empty.");
  }
  return normalized;
}

function normalizeNonNegativeInteger(value: unknown, fallback: number): number {
  if (!Number.isFinite(value)) {
    return fallback;
  }

  return Math.max(0, Math.trunc(value as number));
}
