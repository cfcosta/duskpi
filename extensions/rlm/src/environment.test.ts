import { test } from "bun:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtempSync, mkdirSync, readFileSync } from "node:fs";
import type { RlmRequest } from "./request";
import { buildPromptContext } from "./request";
import { RlmPromptEnvironment } from "./environment";

function createRequest(overrides: Partial<RlmRequest> = {}): RlmRequest {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "rlm-environment-"));
  const workspaceDir = path.join(tempDir, "workspace");
  mkdirSync(workspaceDir);
  const absolutePath = path.join(workspaceDir, "workspace.md");
  const taskFilePath = path.join(workspaceDir, "task.md");
  const scratchpadFilePath = path.join(workspaceDir, "scratchpad.md");
  const finalFilePath = path.join(workspaceDir, "final.md");
  const sourcesFilePath = path.join(workspaceDir, "sources.md");
  const question = "summarize the recursive workflow";
  const promptContent = ["# RLM Input Prompt", "", question].join("\n");

  return {
    raw: question,
    path: absolutePath,
    absolutePath,
    question,
    promptProfile: "default",
    promptContext: buildPromptContext(question, [], promptContent),
    promptContent,
    content: ["# RLM Workspace", "", "Input Prompt: summarize the recursive workflow"].join("\n"),
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

test("getPromptMetadata returns prompt metadata and bounded previews", () => {
  const environment = RlmPromptEnvironment.fromRequest(createRequest());

  environment.setVariable("chunk_1", "summary");

  const metadata = environment.getPromptMetadata({ previewChars: 32 });
  assert.equal(metadata.label, undefined);
  assert.equal(metadata.promptProfile, "default");
  assert.equal(metadata.promptPreview.length, 32);
  assert.equal(metadata.promptPreviewTruncated, true);
  assert.equal(metadata.importedSourceCount, 0);
  assert.deepEqual(metadata.importedSourcePaths, []);
  assert.equal(metadata.contextType, "string");
  assert.equal(metadata.contextChunkCount, 1);
  assert.deepEqual(metadata.contextLengths, [32]);
  assert.deepEqual(metadata.contextLabels, ["Task prompt"]);
  assert.equal(metadata.variableCount, 1);
  assert.deepEqual(metadata.variableNames, ["chunk_1"]);
  assert.equal(metadata.hasFinalResult, false);
  assert.match(metadata.workspaceDir ?? "", /workspace$/);
  assert.match(metadata.taskFilePath ?? "", /task\.md$/);
  assert.match(metadata.finalFilePath ?? "", /final\.md$/);
});

test("getExecutionBindings exposes Prompt, Context, and persisted variables symbolically", () => {
  const environment = RlmPromptEnvironment.fromRequest(createRequest());
  environment.setVariable("intro_summary", "cached summary");

  const bindings = environment.getExecutionBindings();
  assert.equal(bindings.Prompt, environment.getPrompt());
  assert.equal(bindings.prompt, environment.getPrompt());
  assert.equal(bindings.Question, "summarize the recursive workflow");
  assert.equal(bindings.question, "summarize the recursive workflow");
  assert.equal(bindings.context_type, "string");
  assert.deepEqual(bindings.context_lengths, [32]);
  assert.equal(bindings.context, "summarize the recursive workflow");
  assert.equal((bindings.Context as { contextType: string }).contextType, "string");
  assert.deepEqual(bindings.variables, { intro_summary: "cached summary" });
});

test("applyVariableUpdates persists intermediate values and Final", () => {
  const request = createRequest();
  const environment = RlmPromptEnvironment.fromRequest(request);

  const applied = environment.applyVariableUpdates({
    chunk_1: "first summary",
    Final: "done",
  });

  assert.deepEqual(applied.updatedVariableNames, ["Final", "chunk_1"]);
  assert.equal(environment.getVariable("chunk_1"), "first summary");
  assert.equal(environment.getFinalResult(), "done");
  assert.match(readFileSync(request.scratchpadFilePath, "utf8"), /chunk_1/);
  assert.match(readFileSync(request.finalFilePath, "utf8"), /done/);
});

test("scratchpad entries are written into workspace-backed environments", () => {
  const request = createRequest();
  const environment = RlmPromptEnvironment.fromRequest(request);

  environment.appendScratchpadEntry("iter-1", "logPreview: scanned prefix");

  assert.match(readFileSync(request.scratchpadFilePath, "utf8"), /iter-1/);
  assert.match(readFileSync(request.absolutePath, "utf8"), /scanned prefix/);
});

test("child-only environments keep prompt state in memory without workspace files", () => {
  const environment = RlmPromptEnvironment.fromPrompt("child prompt", "child:chunk_1", {
    promptProfile: "qwen3-8b",
  });

  environment.setVariable("note", "done");
  environment.setFinalResult("child answer");

  assert.equal(environment.getPrompt(), "child prompt");
  assert.equal(environment.getVariable("note"), "done");
  assert.equal(environment.getFinalResult(), "child answer");
  assert.equal(environment.getPromptMetadata().promptProfile, "qwen3-8b");
  assert.equal(environment.getPromptMetadata().workspaceDir, undefined);
});
