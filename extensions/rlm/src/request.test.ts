import { test } from "bun:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { parseRlmArgs } from "./args";
import { buildPromptContent, buildPromptContext, resolveRlmRequest } from "./request";

test("parseRlmArgs treats the full command body as the input prompt", () => {
  const parsed = parseRlmArgs("summarize the architecture tradeoffs");
  assert.deepEqual(parsed, {
    ok: true,
    value: {
      raw: "summarize the architecture tradeoffs",
      question: "summarize the architecture tradeoffs",
      promptProfile: "default",
      childPromptProfile: "default",
      subcallPolicy: "enabled",
    },
  });
});

test("parseRlmArgs accepts explicit prompt-profile and subcall flags", () => {
  const parsed = parseRlmArgs(
    "--prompt-profile default --child-prompt-profile qwen3-8b --subcalls off summarize the architecture tradeoffs",
  );
  assert.deepEqual(parsed, {
    ok: true,
    value: {
      raw: "--prompt-profile default --child-prompt-profile qwen3-8b --subcalls off summarize the architecture tradeoffs",
      question: "summarize the architecture tradeoffs",
      promptProfile: "default",
      childPromptProfile: "qwen3-8b",
      subcallPolicy: "disabled",
    },
  });
});

test("resolveRlmRequest rejects a missing prompt", async () => {
  const result = await resolveRlmRequest("   ");
  assert.equal(result.ok, false);
  if (result.ok) {
    throw new Error("expected request parsing to fail");
  }

  assert.equal(result.error.code, "missing_question");
});

test("resolveRlmRequest reports workspace creation failures", async () => {
  const result = await resolveRlmRequest("map the main contradictions", {
    mkdtempImpl: async () => {
      throw new Error("permission denied");
    },
  });

  assert.equal(result.ok, false);
  if (result.ok) {
    throw new Error("expected workspace creation to fail");
  }

  assert.equal(result.error.code, "workspace_init_failed");
});

test("buildPromptContent appends imported source contents into the external prompt", () => {
  const prompt = buildPromptContent("check ./paper.md", [
    {
      path: "./paper.md",
      absolutePath: "/tmp/paper.md",
      extension: ".md",
      sizeBytes: 12,
      content: "Recursive Language Models use recursive calls.",
    },
  ]);

  assert.match(prompt, /RLM Input Prompt/);
  assert.match(prompt, /check \.\/paper\.md/);
  assert.match(prompt, /Imported Sources/);
  assert.match(prompt, /Recursive Language Models use recursive calls/);
});

test("buildPromptContext exposes chunked context metadata for imported sources", () => {
  const prompt = buildPromptContent("check ./paper.md", [
    {
      path: "./paper.md",
      absolutePath: "/tmp/paper.md",
      extension: ".md",
      sizeBytes: 12,
      content: "Recursive Language Models use recursive calls.",
    },
  ]);

  const context = buildPromptContext(
    "check ./paper.md",
    [
      {
        path: "./paper.md",
        absolutePath: "/tmp/paper.md",
        extension: ".md",
        sizeBytes: 12,
        content: "Recursive Language Models use recursive calls.",
      },
    ],
    prompt,
  );

  assert.equal(context.type, "list[str]");
  assert.deepEqual(context.contextLengths, [16, 46]);
  assert.equal(context.chunks[0]?.id, "task");
  assert.equal(context.chunks[1]?.sourcePath, "./paper.md");
});

test("resolveRlmRequest auto-imports referenced local markdown sources into the prompt and workspace", async () => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "rlm-request-source-"));
  const sourcePath = path.join(tempDir, "paper.md");
  writeFileSync(sourcePath, "# Paper\n\nRecursive Language Models use recursive calls.", "utf8");

  const result = await resolveRlmRequest(`check ${sourcePath} and summarize it`, {
    cwd: tempDir,
    workspaceParentDir: tempDir,
  });
  assert.equal(result.ok, true);
  if (!result.ok) {
    throw new Error("expected valid request to succeed");
  }

  assert.equal(result.value.importedSources.length, 1);
  assert.equal(result.value.importedSources[0]?.absolutePath, sourcePath);
  assert.equal(result.value.promptContext.type, "list[str]");
  assert.equal(result.value.subcallPolicy, "enabled");
  assert.deepEqual(result.value.promptContext.contextLengths.length, 2);
  assert.match(result.value.promptContent, /Recursive Language Models use recursive calls/);
  assert.match(result.value.content, /context_type: list\[str\]/);
  assert.match(result.value.content, /context_lengths: \[/);
  assert.match(
    readFileSync(result.value.sourcesFilePath, "utf8"),
    /Recursive Language Models use recursive calls/,
  );
});

test("resolveRlmRequest creates a normalized workspace-backed request", async () => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "rlm-request-valid-"));
  const workspacesDir = path.join(tempDir, "workspaces");
  mkdirSync(workspacesDir);

  const result = await resolveRlmRequest(
    "--prompt-profile default --child-prompt-profile qwen3-8b --no-subcalls summarize the recursive workflow",
    {
      cwd: tempDir,
      workspaceParentDir: workspacesDir,
    },
  );
  assert.equal(result.ok, true);
  if (!result.ok) {
    throw new Error("expected valid request to succeed");
  }

  assert.equal(result.value.question, "summarize the recursive workflow");
  assert.equal(result.value.promptProfile, "default");
  assert.equal(result.value.childPromptProfile, "qwen3-8b");
  assert.equal(result.value.subcallPolicy, "disabled");
  assert.equal(result.value.extension, ".md");
  assert.match(result.value.absolutePath, /workspace\.md$/);
  assert.match(result.value.taskFilePath, /task\.md$/);
  assert.match(result.value.scratchpadFilePath, /scratchpad\.md$/);
  assert.match(result.value.finalFilePath, /final\.md$/);
  assert.match(result.value.sourcesFilePath, /sources\.md$/);
  assert.deepEqual(result.value.importedSources, []);
  assert.equal(result.value.promptContext.type, "string");
  assert.deepEqual(result.value.promptContext.contextLengths, [32]);
  assert.match(result.value.promptContent, /RLM Input Prompt/);
  assert.match(result.value.content, /persistent environment used by \/rlm/i);
  assert.match(result.value.content, /promptProfile: default/);
  assert.match(result.value.content, /childPromptProfile: qwen3-8b/);
  assert.match(result.value.content, /subcallPolicy: disabled/);
  assert.match(result.value.content, /context_lengths: \[32\]/);
  assert.match(result.value.content, /summarize the recursive workflow/);

  assert.match(readFileSync(result.value.taskFilePath, "utf8"), /promptProfile: default/);
  assert.match(readFileSync(result.value.taskFilePath, "utf8"), /childPromptProfile: qwen3-8b/);
  assert.match(readFileSync(result.value.taskFilePath, "utf8"), /subcallPolicy: disabled/);
  assert.match(readFileSync(result.value.taskFilePath, "utf8"), /summarize the recursive workflow/);
  assert.match(readFileSync(result.value.scratchpadFilePath, "utf8"), /No notes yet/i);
  assert.match(readFileSync(result.value.finalFilePath, "utf8"), /Pending final answer/i);
  assert.equal(readFileSync(result.value.absolutePath, "utf8"), result.value.content);
});
