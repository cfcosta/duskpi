import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import { WasmtimeExecutor } from "./executor";
import type { RlmAssistantProgram } from "./protocol";

function createProgram(code = "setFinal('done');"): RlmAssistantProgram {
  return {
    language: "javascript",
    code,
  };
}

function createMockRunner(source: string): string {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "rlm-executor-test-"));
  const scriptPath = path.join(tempDir, "runner.mjs");
  writeFileSync(scriptPath, source, "utf8");
  chmodSync(scriptPath, 0o755);
  return scriptPath;
}

test("WasmtimeExecutor normalizes completed results", async () => {
  const runnerPath = createMockRunner(`
    import fs from "node:fs";
    const input = JSON.parse(fs.readFileSync(0, "utf8"));
    console.log(JSON.stringify({
      kind: "completed",
      finalResult: "done",
      variables: { note: "summary" },
      logs: [input.program.code],
      summary: { bindingCount: Object.keys(input.bindings).length },
    }));
  `);

  const executor = new WasmtimeExecutor({
    command: process.execPath,
    args: [runnerPath],
  });

  const result = await executor.execute({
    program: createProgram("setFinal('done');"),
    bindings: { a: 1, b: 2 },
  });

  assert.deepEqual(result, {
    kind: "completed",
    finalResult: "done",
    variables: { note: "summary" },
    logs: ["setFinal('done');"],
    summary: { bindingCount: 2 },
  });
});

test("WasmtimeExecutor normalizes subcall requests", async () => {
  const runnerPath = createMockRunner(`
    console.log(JSON.stringify({
      kind: "subcall",
      subcall: { prompt: "Summarize chunk 1", storeAs: "chunk_1" },
      variables: { stage: "search" },
      logs: ["subcall"],
    }));
  `);

  const executor = new WasmtimeExecutor({
    command: process.execPath,
    args: [runnerPath],
  });

  const result = await executor.execute({
    program: createProgram("subcall('Summarize chunk 1', 'chunk_1');"),
  });

  assert.deepEqual(result, {
    kind: "subcall",
    subcall: { prompt: "Summarize chunk 1", storeAs: "chunk_1" },
    variables: { stage: "search" },
    logs: ["subcall"],
    summary: undefined,
  });
});

test("WasmtimeExecutor reports runtime errors from non-zero exits", async () => {
  const runnerPath = createMockRunner(`
    console.error("boom");
    process.exit(4);
  `);

  const executor = new WasmtimeExecutor({
    command: process.execPath,
    args: [runnerPath],
  });

  const result = await executor.execute({
    program: createProgram(),
  });

  assert.equal(result.kind, "runtime_error");
  if (result.kind !== "runtime_error") {
    throw new Error("expected runtime_error");
  }

  assert.equal(result.exitCode, 4);
  assert.match(result.stderr ?? "", /boom/);
});

test("WasmtimeExecutor reports invalid JSON output explicitly", async () => {
  const runnerPath = createMockRunner(`
    console.log("not-json");
  `);

  const executor = new WasmtimeExecutor({
    command: process.execPath,
    args: [runnerPath],
  });

  const result = await executor.execute({
    program: createProgram(),
  });

  assert.deepEqual(result, {
    kind: "invalid_output",
    message: "Executor output was not valid JSON.",
    stdout: "not-json\n",
    stderr: "",
  });
});

test("WasmtimeExecutor rejects malformed structured output", async () => {
  const runnerPath = createMockRunner(`
    console.log(JSON.stringify({ kind: "completed", variables: { note: 1 } }));
  `);

  const executor = new WasmtimeExecutor({
    command: process.execPath,
    args: [runnerPath],
  });

  const result = await executor.execute({
    program: createProgram(),
  });

  assert.deepEqual(result, {
    kind: "invalid_output",
    message: "Executor variable 'note' must be a string.",
    stdout: '{"kind":"completed","variables":{"note":1}}\n',
    stderr: "",
  });
});
