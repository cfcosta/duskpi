import test from "node:test";
import assert from "node:assert/strict";
import type { RlmRequest } from "./request";
import { RlmDocumentEnvironment } from "./environment";

function createRequest(overrides: Partial<RlmRequest> = {}): RlmRequest {
  return {
    raw: "notes/example.md summarize",
    path: "notes/example.md",
    absolutePath: "/tmp/notes/example.md",
    question: "summarize",
    content: [
      "Recursive language models keep the prompt outside the root context.",
      "The controller can read bounded slices and search the document.",
      "Recursion happens through structured sub-calls.",
      "A final answer is stored separately from intermediate variables.",
    ].join("\n"),
    sizeBytes: 220,
    extension: ".md",
    ...overrides,
  };
}

test("getMetadata returns document metadata and a bounded preview", () => {
  const environment = new RlmDocumentEnvironment(createRequest());

  environment.setVariable("chunk_1", "summary");

  const metadata = environment.getMetadata({ previewChars: 32 });
  assert.equal(metadata.path, "notes/example.md");
  assert.equal(metadata.absolutePath, "/tmp/notes/example.md");
  assert.equal(metadata.extension, ".md");
  assert.equal(metadata.sizeBytes, 220);
  assert.equal(metadata.question, "summarize");
  assert.equal(metadata.charLength, createRequest().content.length);
  assert.equal(metadata.lineCount, 4);
  assert.equal(metadata.preview.length, 32);
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
  assert.equal(segment.text, createRequest().content.slice(10, 30));
  assert.equal(segment.truncated, false);
  assert.equal(segment.hasMoreBefore, true);
  assert.equal(segment.hasMoreAfter, true);
});

test("readSegment clamps offsets and reports truncation at document bounds", () => {
  const request = createRequest({ content: "abcdef" });
  const environment = new RlmDocumentEnvironment(request);

  const segment = environment.readSegment(4, 10);
  assert.equal(segment.offset, 4);
  assert.equal(segment.endOffset, 6);
  assert.equal(segment.text, "ef");
  assert.equal(segment.truncated, true);
  assert.equal(segment.startClamped, false);
  assert.equal(segment.endClamped, true);
  assert.equal(segment.hasMoreBefore, true);
  assert.equal(segment.hasMoreAfter, false);
});

test("readSegment clamps offsets beyond the end of the document", () => {
  const request = createRequest({ content: "abcdef" });
  const environment = new RlmDocumentEnvironment(request);

  const segment = environment.readSegment(99, 5);
  assert.equal(segment.offset, 6);
  assert.equal(segment.endOffset, 6);
  assert.equal(segment.text, "");
  assert.equal(segment.truncated, true);
  assert.equal(segment.startClamped, true);
  assert.equal(segment.endClamped, true);
});

test("search returns bounded search hits with contexts", () => {
  const environment = new RlmDocumentEnvironment(createRequest());

  const result = environment.search("document", { maxResults: 2, contextChars: 12 });
  assert.equal(result.query, "document");
  assert.equal(result.totalMatches, 1);
  assert.equal(result.truncated, false);
  assert.equal(result.hits.length, 1);
  assert.equal(result.hits[0]?.match, "document");
  assert.match(result.hits[0]?.context ?? "", /search the document/);
});

test("search truncates hit lists when matches exceed maxResults", () => {
  const environment = new RlmDocumentEnvironment(
    createRequest({ content: "alpha recursion beta recursion gamma recursion" }),
  );

  const result = environment.search("recursion", { maxResults: 2, contextChars: 5 });
  assert.equal(result.totalMatches, 3);
  assert.equal(result.truncated, true);
  assert.equal(result.hits.length, 2);
  assert.equal(result.hits[0]?.match, "recursion");
  assert.equal(result.hits[1]?.match, "recursion");
});

test("variable storage persists named intermediate values", () => {
  const environment = new RlmDocumentEnvironment(createRequest());

  environment.setVariable("chunk_1", "first summary");
  environment.setVariable("chunk_2", "second summary");

  assert.equal(environment.getVariable("chunk_1"), "first summary");
  assert.equal(environment.getVariable("chunk_2"), "second summary");
  assert.deepEqual(environment.listVariableNames(), ["chunk_1", "chunk_2"]);
});

test("final result storage persists the final answer separately", () => {
  const environment = new RlmDocumentEnvironment(createRequest());

  environment.setFinalResult("The note argues for environment-backed recursion.");

  assert.equal(
    environment.getFinalResult(),
    "The note argues for environment-backed recursion.",
  );
  assert.equal(environment.getMetadata().hasFinalResult, true);
});
