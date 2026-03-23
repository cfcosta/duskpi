import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { parseRlmArgs } from "./args";
import { resolveRlmRequest } from "./request";

test("parseRlmArgs parses a path with an optional question", () => {
  const parsed = parseRlmArgs("notes/plan.md summarize the architecture");
  assert.deepEqual(parsed, {
    ok: true,
    value: {
      raw: "notes/plan.md summarize the architecture",
      path: "notes/plan.md",
      question: "summarize the architecture",
    },
  });
});

test("parseRlmArgs supports quoted paths with spaces", () => {
  const parsed = parseRlmArgs('"~/Notes/Long Note.md" find the main thesis');
  assert.deepEqual(parsed, {
    ok: true,
    value: {
      raw: '"~/Notes/Long Note.md" find the main thesis',
      path: "~/Notes/Long Note.md",
      question: "find the main thesis",
    },
  });
});

test("resolveRlmRequest rejects a missing path", async () => {
  const result = await resolveRlmRequest("   ");
  assert.equal(result.ok, false);
  if (result.ok) {
    throw new Error("expected request parsing to fail");
  }

  assert.equal(result.error.code, "missing_path");
});

test("resolveRlmRequest reports unreadable files", async () => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "rlm-request-unreadable-"));
  const filePath = path.join(tempDir, "note.md");
  writeFileSync(filePath, "# hidden\n", "utf8");

  const result = await resolveRlmRequest(filePath, {
    readFileImpl: async () => {
      const error = new Error("permission denied") as Error & { code?: string };
      error.code = "EACCES";
      throw error;
    },
  });

  assert.equal(result.ok, false);
  if (result.ok) {
    throw new Error("expected unreadable request to fail");
  }

  assert.equal(result.error.code, "unreadable");
});

test("resolveRlmRequest rejects unsupported input types", async () => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "rlm-request-type-"));
  const filePath = path.join(tempDir, "image.png");
  writeFileSync(filePath, "not really a png", "utf8");

  const result = await resolveRlmRequest(filePath);
  assert.equal(result.ok, false);
  if (result.ok) {
    throw new Error("expected unsupported type to fail");
  }

  assert.equal(result.error.code, "unsupported_input_type");
});

test("resolveRlmRequest rejects empty files", async () => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "rlm-request-empty-"));
  const filePath = path.join(tempDir, "empty.md");
  writeFileSync(filePath, "", "utf8");

  const result = await resolveRlmRequest(filePath);
  assert.equal(result.ok, false);
  if (result.ok) {
    throw new Error("expected empty file to fail");
  }

  assert.equal(result.error.code, "empty_input");
});

test("resolveRlmRequest rejects files over the configured size limit", async () => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "rlm-request-size-"));
  const filePath = path.join(tempDir, "large.md");
  writeFileSync(filePath, "1234567890", "utf8");

  const result = await resolveRlmRequest(filePath, { maxBytes: 5 });
  assert.equal(result.ok, false);
  if (result.ok) {
    throw new Error("expected oversized file to fail");
  }

  assert.equal(result.error.code, "too_large");
});

test("resolveRlmRequest returns a normalized request for valid markdown input", async () => {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "rlm-request-valid-"));
  const notesDir = path.join(tempDir, "notes");
  mkdirSync(notesDir);
  const filePath = path.join(notesDir, "example.md");
  writeFileSync(filePath, "# Example\n\nA valid note.\n", "utf8");

  const result = await resolveRlmRequest(`${path.relative(tempDir, filePath)} summarize`, {
    cwd: tempDir,
  });
  assert.equal(result.ok, true);
  if (!result.ok) {
    throw new Error("expected valid request to succeed");
  }

  assert.equal(result.value.path, path.relative(tempDir, filePath));
  assert.equal(result.value.absolutePath, filePath);
  assert.equal(result.value.question, "summarize");
  assert.equal(result.value.extension, ".md");
  assert.match(result.value.content, /A valid note/);
});
