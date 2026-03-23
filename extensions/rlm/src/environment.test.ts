import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtempSync, mkdirSync, readFileSync } from "node:fs";
import type { RlmRequest } from "./request";
import { RlmDocumentEnvironment } from "./environment";

function createRequest(overrides: Partial<RlmRequest> = {}): RlmRequest {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "rlm-environment-"));
  const workspaceDir = path.join(tempDir, "workspace");
  mkdirSync(workspaceDir);
  const absolutePath = path.join(workspaceDir, "workspace.md");
  const taskFilePath = path.join(workspaceDir, "task.md");
  const scratchpadFilePath = path.join(workspaceDir, "scratchpad.md");
  const finalFilePath = path.join(workspaceDir, "final.md");
  const sourcesFilePath = path.join(workspaceDir, "sources.md");

  return {
    raw: "summarize the recursive workflow",
    path: absolutePath,
    absolutePath,
    question: "summarize the recursive workflow",
    content: ["# RLM Workspace", "", "Question: summarize the recursive workflow"].join("\n"),
    sizeBytes: 64,
    extension: ".md",
    workspaceDir,
    taskFilePath,
    scratchpadFilePath,
    finalFilePath,
    sourcesFilePath,
    importedSources: [],
    ...overrides,
  };
}

test("getMetadata returns workspace metadata and a bounded preview", () => {
  const environment = new RlmDocumentEnvironment(createRequest());

  environment.setVariable("chunk_1", "summary");

  const metadata = environment.getMetadata({ previewChars: 48 });
  assert.equal(metadata.path, metadata.absolutePath);
  assert.equal(metadata.extension, ".md");
  assert.equal(metadata.question, "summarize the recursive workflow");
  assert.match(metadata.workspaceDir, /workspace$/);
  assert.match(metadata.taskFilePath, /task\.md$/);
  assert.match(metadata.scratchpadFilePath, /scratchpad\.md$/);
  assert.match(metadata.finalFilePath, /final\.md$/);
  assert.match(metadata.sourcesFilePath, /sources\.md$/);
  assert.equal(metadata.importedSourceCount, 0);
  assert.deepEqual(metadata.importedSourcePaths, []);
  assert.equal(metadata.preview.length, 48);
  assert.equal(metadata.previewTruncated, true);
  assert.equal(metadata.variableCount, 1);
  assert.deepEqual(metadata.variableNames, ["chunk_1"]);
  assert.equal(metadata.hasFinalResult, false);
});

test("readSegment returns bounded slices with before/after hints", () => {
  const environment = new RlmDocumentEnvironment(createRequest());

  const segment = environment.readSegment(10, 20);
  assert.equal(segment.requestedOffset, 10);
  assert.equal(segment.requestedLength, 20);
  assert.equal(segment.offset, 10);
  assert.equal(segment.endOffset, 30);
  assert.equal(segment.text.length, 20);
  assert.equal(segment.truncated, false);
  assert.equal(segment.hasMoreBefore, true);
  assert.equal(segment.hasMoreAfter, true);
});

test("readSegment clamps offsets and reports truncation at document bounds", () => {
  const request = createRequest({ content: "abcdef" });
  const environment = new RlmDocumentEnvironment(request);

  const segment = environment.readSegment(999, 10);
  assert.equal(segment.offset, environment.getMetadata().charLength);
  assert.equal(segment.text, "");
  assert.equal(segment.truncated, true);
  assert.equal(segment.startClamped, true);
  assert.equal(segment.endClamped, true);
});

test("search returns bounded search hits with contexts", () => {
  const environment = new RlmDocumentEnvironment(createRequest());

  const result = environment.search("question-first", { maxResults: 2, contextChars: 12 });
  assert.equal(result.query, "question-first");
  assert.equal(result.totalMatches, 1);
  assert.equal(result.truncated, false);
  assert.equal(result.hits.length, 1);
  assert.equal(result.hits[0]?.match, "question-first");
  assert.match(result.hits[0]?.context ?? "", /question-first run/);
});

test("search truncates hit lists when matches exceed maxResults", () => {
  const environment = new RlmDocumentEnvironment(createRequest());
  environment.appendScratchpadEntry("note a", "recursion recursion");
  environment.appendScratchpadEntry("note b", "recursion");

  const result = environment.search("recursion", { maxResults: 2, contextChars: 5 });
  assert.equal(result.totalMatches >= 3, true);
  assert.equal(result.truncated, true);
  assert.equal(result.hits.length, 2);
  assert.equal(result.hits[0]?.match, "recursion");
  assert.equal(result.hits[1]?.match, "recursion");
});

test("variable storage persists named intermediate values", () => {
  const request = createRequest();
  const environment = new RlmDocumentEnvironment(request);

  environment.setVariable("chunk_1", "first summary");
  environment.setVariable("chunk_2", "second summary");

  assert.equal(environment.getVariable("chunk_1"), "first summary");
  assert.equal(environment.getVariable("chunk_2"), "second summary");
  assert.deepEqual(environment.listVariableNames(), ["chunk_1", "chunk_2"]);
  assert.match(readFileSync(request.scratchpadFilePath, "utf8"), /chunk_1/);
  assert.match(readFileSync(request.scratchpadFilePath, "utf8"), /chunk_2/);
});

test("scratchpad entries are written into the workspace files", () => {
  const request = createRequest();
  const environment = new RlmDocumentEnvironment(request);

  environment.appendScratchpadEntry("child summary", "The runtime stored an intermediate answer.");

  assert.match(readFileSync(request.scratchpadFilePath, "utf8"), /child summary/);
  assert.match(readFileSync(request.absolutePath, "utf8"), /intermediate answer/);
});

test("final result storage persists the final answer separately", () => {
  const request = createRequest();
  const environment = new RlmDocumentEnvironment(request);

  environment.setFinalResult("The workspace answers the question through generated files.");

  assert.equal(
    environment.getFinalResult(),
    "The workspace answers the question through generated files.",
  );
  assert.equal(environment.getMetadata().hasFinalResult, true);
  assert.match(readFileSync(request.finalFilePath, "utf8"), /generated files/);
  assert.match(readFileSync(request.absolutePath, "utf8"), /generated files/);
});
