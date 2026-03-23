import { writeFileSync } from "node:fs";
import type { RlmRequest } from "./request";
import {
  buildFinalFileContent,
  buildScratchpadFileContent,
  buildWorkspaceRootContent,
} from "./request";

export const DEFAULT_METADATA_PREVIEW_CHARS = 240;
export const DEFAULT_SEARCH_CONTEXT_CHARS = 80;
export const DEFAULT_SEARCH_MAX_RESULTS = 5;

export interface RlmDocumentMetadata {
  path: string;
  absolutePath: string;
  extension: string;
  sizeBytes: number;
  charLength: number;
  lineCount: number;
  question?: string;
  workspaceDir: string;
  taskFilePath: string;
  scratchpadFilePath: string;
  finalFilePath: string;
  preview: string;
  previewTruncated: boolean;
  variableCount: number;
  variableNames: string[];
  hasFinalResult: boolean;
}

export interface RlmDocumentSegment {
  requestedOffset: number;
  requestedLength: number;
  offset: number;
  endOffset: number;
  text: string;
  truncated: boolean;
  startClamped: boolean;
  endClamped: boolean;
  hasMoreBefore: boolean;
  hasMoreAfter: boolean;
}

export interface RlmDocumentSearchHit {
  index: number;
  match: string;
  context: string;
  contextStart: number;
  contextEnd: number;
}

export interface RlmDocumentSearchResult {
  query: string;
  totalMatches: number;
  truncated: boolean;
  hits: RlmDocumentSearchHit[];
}

export interface RlmDocumentSearchOptions {
  maxResults?: number;
  contextChars?: number;
  caseSensitive?: boolean;
}

interface ScratchpadEntry {
  title: string;
  content: string;
}

export class RlmDocumentEnvironment {
  private readonly variables = new Map<string, string>();
  private finalResult?: string;
  private readonly scratchpadEntries: ScratchpadEntry[] = [];

  constructor(private readonly request: RlmRequest) {
    this.syncWorkspaceFiles();
  }

  getMetadata(options: { previewChars?: number } = {}): RlmDocumentMetadata {
    const previewChars = normalizeNonNegativeInteger(
      options.previewChars,
      DEFAULT_METADATA_PREVIEW_CHARS,
    );
    const content = this.getCurrentContent();
    const preview = content.slice(0, previewChars);
    const previewTruncated = preview.length < content.length;

    return {
      path: this.request.path,
      absolutePath: this.request.absolutePath,
      extension: this.request.extension,
      sizeBytes: Buffer.byteLength(content, "utf8"),
      charLength: content.length,
      lineCount: countLines(content),
      question: this.request.question,
      workspaceDir: this.request.workspaceDir,
      taskFilePath: this.request.taskFilePath,
      scratchpadFilePath: this.request.scratchpadFilePath,
      finalFilePath: this.request.finalFilePath,
      preview,
      previewTruncated,
      variableCount: this.variables.size,
      variableNames: [...this.variables.keys()].sort(),
      hasFinalResult: typeof this.finalResult === "string",
    };
  }

  readSegment(offset: number, length: number): RlmDocumentSegment {
    const content = this.getCurrentContent();
    const requestedOffset = normalizeNonNegativeInteger(offset, 0);
    const requestedLength = normalizeNonNegativeInteger(length, 0);
    const maxOffset = content.length;
    const start = Math.min(requestedOffset, maxOffset);
    const requestedEnd = requestedOffset + requestedLength;
    const endOffset = Math.min(requestedEnd, maxOffset);
    const text = content.slice(start, endOffset);

    return {
      requestedOffset,
      requestedLength,
      offset: start,
      endOffset,
      text,
      truncated: requestedEnd > maxOffset,
      startClamped: start !== requestedOffset,
      endClamped: endOffset !== requestedEnd,
      hasMoreBefore: start > 0,
      hasMoreAfter: endOffset < maxOffset,
    };
  }

  search(query: string, options: RlmDocumentSearchOptions = {}): RlmDocumentSearchResult {
    const normalizedQuery = query.trim();
    if (normalizedQuery.length === 0) {
      return {
        query: normalizedQuery,
        totalMatches: 0,
        truncated: false,
        hits: [],
      };
    }

    const caseSensitive = options.caseSensitive ?? false;
    const maxResults = normalizePositiveInteger(options.maxResults, DEFAULT_SEARCH_MAX_RESULTS);
    const contextChars = normalizeNonNegativeInteger(
      options.contextChars,
      DEFAULT_SEARCH_CONTEXT_CHARS,
    );
    const content = this.getCurrentContent();
    const haystack = caseSensitive ? content : content.toLowerCase();
    const needle = caseSensitive ? normalizedQuery : normalizedQuery.toLowerCase();

    const hits: RlmDocumentSearchHit[] = [];
    let totalMatches = 0;
    let fromIndex = 0;

    while (fromIndex <= haystack.length) {
      const index = haystack.indexOf(needle, fromIndex);
      if (index === -1) {
        break;
      }

      totalMatches += 1;
      if (hits.length < maxResults) {
        const contextStart = Math.max(0, index - contextChars);
        const contextEnd = Math.min(content.length, index + normalizedQuery.length + contextChars);
        hits.push({
          index,
          match: content.slice(index, index + normalizedQuery.length),
          context: content.slice(contextStart, contextEnd),
          contextStart,
          contextEnd,
        });
      }

      fromIndex = index + Math.max(needle.length, 1);
    }

    return {
      query: normalizedQuery,
      totalMatches,
      truncated: totalMatches > hits.length,
      hits,
    };
  }

  setVariable(name: string, value: string): void {
    const normalizedName = normalizeVariableName(name);
    this.variables.set(normalizedName, value);
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
    this.syncWorkspaceFiles();
  }

  getFinalResult(): string | undefined {
    return this.finalResult;
  }

  private getCurrentContent(): string {
    return buildWorkspaceRootContent({
      question: this.request.question,
      taskFilePath: this.request.taskFilePath,
      scratchpadFilePath: this.request.scratchpadFilePath,
      finalFilePath: this.request.finalFilePath,
      scratchpadEntries: this.scratchpadEntries,
      finalResult: this.finalResult,
      variableNames: this.listVariableNames(),
    });
  }

  private syncWorkspaceFiles(): void {
    writeFileSync(
      this.request.taskFilePath,
      `# RLM Task\n\n## Question\n\n${this.request.question.trim()}`,
      "utf8",
    );
    writeFileSync(
      this.request.scratchpadFilePath,
      buildScratchpadFileContent(
        this.request.question,
        this.scratchpadEntries,
        this.listVariableNames(),
      ),
      "utf8",
    );
    writeFileSync(
      this.request.finalFilePath,
      buildFinalFileContent(this.request.question, this.finalResult),
      "utf8",
    );
    writeFileSync(this.request.absolutePath, this.getCurrentContent(), "utf8");
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
    throw new Error("RLM document environment variable names must be non-empty.");
  }
  return normalized;
}

function normalizeNonNegativeInteger(value: unknown, fallback: number): number {
  if (!Number.isFinite(value)) {
    return fallback;
  }

  return Math.max(0, Math.trunc(value as number));
}

function normalizePositiveInteger(value: unknown, fallback: number): number {
  const normalized = normalizeNonNegativeInteger(value, fallback);
  return normalized > 0 ? normalized : fallback;
}
