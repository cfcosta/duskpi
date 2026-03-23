import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtempSync, mkdirSync, readFileSync } from "node:fs";
import { parseRlmArgs } from "./args";
import { resolveRlmRequest } from "./request";

test("parseRlmArgs treats the full command body as the question", () => {
  const parsed = parseRlmArgs("summarize the architecture tradeoffs");
  assert.deepEqual(parsed, {
    ok: true,
    value: {
      raw: "summarize the architecture tradeoffs",
      question: "summarize the architecture tradeoffs",
    },
  });
});

test("resolveRlmRequest rejects a missing question", async () => {
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

test("resolveRlmRequest creates a normalized workspace-backed request", async () => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "rlm-request-valid-"));
  const workspacesDir = path.join(tempDir, "workspaces");
  mkdirSync(workspacesDir);

  const result = await resolveRlmRequest("summarize the recursive workflow", {
    cwd: tempDir,
    workspaceParentDir: workspacesDir,
  });
  assert.equal(result.ok, true);
  if (!result.ok) {
    throw new Error("expected valid request to succeed");
  }

  assert.equal(result.value.question, "summarize the recursive workflow");
  assert.equal(result.value.extension, ".md");
  assert.match(result.value.absolutePath, /workspace\.md$/);
  assert.match(result.value.taskFilePath, /task\.md$/);
  assert.match(result.value.scratchpadFilePath, /scratchpad\.md$/);
  assert.match(result.value.finalFilePath, /final\.md$/);
  assert.match(result.value.content, /question-first run/);
  assert.match(result.value.content, /summarize the recursive workflow/);

  assert.match(readFileSync(result.value.taskFilePath, "utf8"), /summarize the recursive workflow/);
  assert.match(readFileSync(result.value.scratchpadFilePath, "utf8"), /No notes yet/i);
  assert.match(readFileSync(result.value.finalFilePath, "utf8"), /Pending final answer/i);
  assert.equal(readFileSync(result.value.absolutePath, "utf8"), result.value.content);
});
