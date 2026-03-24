import { test } from "bun:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { chmodSync, mkdtempSync, writeFileSync } from "node:fs";
import {
  createDefaultRlmExecutor,
  createDefaultWasmtimeExecutor,
  PersistentWasmtimeExecutor,
  RLM_JAVY_BIN_ENV,
  RLM_WASMTIME_BIN_ENV,
  WasmtimeExecutor,
} from "./executor";
import type { RlmAssistantProgram } from "./protocol";

function createProgram(code = "setFinal('done');"): RlmAssistantProgram {
  return {
    language: "javascript",
    code,
  };
}

function createMockRunner(source: string, extension = ".mjs"): string {
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "rlm-executor-test-"));
  const scriptPath = path.join(tempDir, `runner${extension}`);
  writeFileSync(scriptPath, source, "utf8");
  chmodSync(scriptPath, 0o755);
  return scriptPath;
}

function createMockJavyCompiler(): string {
  return createMockRunner(`
    import fs from "node:fs";
    const args = process.argv.slice(2);
    if (args[0] !== "build") {
      console.error("expected build subcommand");
      process.exit(2);
    }
    const inputPath = args[1];
    const outputIndex = args.indexOf("-o");
    const outputPath = args[outputIndex + 1];
    const source = fs.readFileSync(inputPath, "utf8");
    fs.writeFileSync(outputPath, source, "utf8");
  `);
}

function createMockWasmtimeRuntime(): string {
  return createMockRunner(`
    import fs from "node:fs";

    const modulePath = process.argv[2];
    const source = fs.readFileSync(modulePath, "utf8");

    globalThis.Javy = {
      IO: {
        readSync(fd, buffer) {
          if (fd !== 0) {
            return 0;
          }
          return fs.readSync(0, buffer, 0, buffer.length, null);
        },
        writeSync(fd, buffer) {
          return fs.writeSync(fd === 2 ? 2 : 1, buffer, 0, buffer.length, null);
        },
      },
    };

    new Function(source)();
  `);
}

test("createDefaultRlmExecutor returns a persistent wasmtime executor", () => {
  const executor = createDefaultRlmExecutor();
  assert.equal(executor instanceof PersistentWasmtimeExecutor, true);
  executor.dispose();
});

test("PersistentWasmtimeExecutor keeps a live repl across executions", async () => {
  const compilerPath = createMockJavyCompiler();
  const runtimePath = createMockWasmtimeRuntime();
  const executor = new PersistentWasmtimeExecutor({
    command: process.execPath,
    args: ["run", runtimePath],
    compilerCommand: process.execPath,
    compilerArgs: ["run", compilerPath],
  });

  const first = await executor.execute({
    program: createProgram(
      [
        "const prefix = 'alpha';",
        "function joinWithPrefix(value) { return `${prefix}:${value}`; }",
        "log(joinWithPrefix('one'));",
        "set('stage', joinWithPrefix('ready'));",
      ].join("\n"),
    ),
    bindings: { Prompt: "demo", variables: {} },
  });

  assert.deepEqual(first, {
    kind: "completed",
    finalResult: undefined,
    variables: { stage: "alpha:ready" },
    logs: ["alpha:one"],
    summary: undefined,
  });

  const second = await executor.execute({
    program: createProgram("setFinal(joinWithPrefix('two'));"),
    bindings: { Prompt: "demo", variables: { stage: "alpha:ready" } },
  });

  assert.deepEqual(second, {
    kind: "completed",
    finalResult: "alpha:two",
    variables: { Final: "alpha:two" },
    logs: [],
    summary: undefined,
  });

  executor.dispose();
});

test("PersistentWasmtimeExecutor lets the same program walk multiple subcalls across reruns", async () => {
  const compilerPath = createMockJavyCompiler();
  const runtimePath = createMockWasmtimeRuntime();
  const executor = new PersistentWasmtimeExecutor({
    command: process.execPath,
    args: ["run", runtimePath],
    compilerCommand: process.execPath,
    compilerArgs: ["run", compilerPath],
  });
  const program = createProgram(
    [
      "const intro = subcall('Summarize intro', 'intro_summary');",
      "const body = subcall('Summarize body', 'body_summary');",
      "setFinal(intro + ' | ' + body);",
    ].join("\n"),
  );

  const first = await executor.execute({
    program,
    bindings: { variables: {} },
  });
  assert.deepEqual(first, {
    kind: "subcall",
    subcall: { prompt: "Summarize intro", storeAs: "intro_summary" },
    variables: {},
    logs: [],
    summary: undefined,
  });

  const second = await executor.execute({
    program,
    bindings: { variables: { intro_summary: "Intro" } },
  });
  assert.deepEqual(second, {
    kind: "subcall",
    subcall: { prompt: "Summarize body", storeAs: "body_summary" },
    variables: {},
    logs: [],
    summary: undefined,
  });

  const third = await executor.execute({
    program,
    bindings: { variables: { intro_summary: "Intro", body_summary: "Body" } },
  });
  assert.deepEqual(third, {
    kind: "completed",
    finalResult: "Intro | Body",
    variables: { Final: "Intro | Body" },
    logs: [],
    summary: undefined,
  });

  executor.dispose();
});

test("PersistentWasmtimeExecutor forks isolated child repls", async () => {
  const compilerPath = createMockJavyCompiler();
  const runtimePath = createMockWasmtimeRuntime();
  const parent = new PersistentWasmtimeExecutor({
    command: process.execPath,
    args: ["run", runtimePath],
    compilerCommand: process.execPath,
    compilerArgs: ["run", compilerPath],
  });
  await parent.execute({
    program: createProgram("const shared = 'root';"),
    bindings: { variables: {} },
  });

  const child = parent.fork();
  const result = await child.execute({
    program: createProgram("setFinal(typeof shared);"),
    bindings: { variables: {} },
  });

  assert.deepEqual(result, {
    kind: "completed",
    finalResult: "undefined",
    variables: { Final: "undefined" },
    logs: [],
    summary: undefined,
  });

  child.dispose();
  parent.dispose();
});

test("createDefaultWasmtimeExecutor uses env-configured javy and wasmtime paths", () => {
  const previousWasmtime = process.env[RLM_WASMTIME_BIN_ENV];
  const previousJavy = process.env[RLM_JAVY_BIN_ENV];
  process.env[RLM_WASMTIME_BIN_ENV] = "/tmp/wasmtime";
  process.env[RLM_JAVY_BIN_ENV] = "/tmp/javy";

  try {
    const executor = createDefaultWasmtimeExecutor();
    assert.equal(executor instanceof WasmtimeExecutor, true);
    assert.equal((executor as any).mode, "javy");
    assert.equal((executor as any).command, "/tmp/wasmtime");
    assert.equal((executor as any).compilerCommand, "/tmp/javy");
  } finally {
    if (typeof previousWasmtime === "string") {
      process.env[RLM_WASMTIME_BIN_ENV] = previousWasmtime;
    } else {
      delete process.env[RLM_WASMTIME_BIN_ENV];
    }

    if (typeof previousJavy === "string") {
      process.env[RLM_JAVY_BIN_ENV] = previousJavy;
    } else {
      delete process.env[RLM_JAVY_BIN_ENV];
    }
  }
});

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
    args: ["run", runnerPath],
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
    args: ["run", runnerPath],
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

test("WasmtimeExecutor javy mode compiles and runs JavaScript through the runtime path", async () => {
  const compilerPath = createMockJavyCompiler();
  const runtimePath = createMockWasmtimeRuntime();
  const executor = new WasmtimeExecutor({
    mode: "javy",
    command: process.execPath,
    args: ["run", runtimePath],
    compilerCommand: process.execPath,
    compilerArgs: ["run", compilerPath],
  });

  const result = await executor.execute({
    program: createProgram(
      'log("note", bindings.note); set("cached", { note: bindings.note }); setSummary({ seen: 1 }); setFinal(bindings.note.toUpperCase());',
    ),
    bindings: { note: "hello" },
  });

  assert.deepEqual(result, {
    kind: "completed",
    finalResult: "HELLO",
    variables: { Final: "HELLO", cached: '{"note":"hello"}' },
    logs: ["note hello"],
    summary: { seen: 1 },
  });
});

test("WasmtimeExecutor javy mode surfaces subcall requests from executed JavaScript", async () => {
  const compilerPath = createMockJavyCompiler();
  const runtimePath = createMockWasmtimeRuntime();
  const executor = new WasmtimeExecutor({
    mode: "javy",
    command: process.execPath,
    args: ["run", runtimePath],
    compilerCommand: process.execPath,
    compilerArgs: ["run", compilerPath],
  });

  const result = await executor.execute({
    program: createProgram('set("phase", "child"); subcall("Summarize intro", "intro_summary");'),
  });

  assert.deepEqual(result, {
    kind: "subcall",
    subcall: { prompt: "Summarize intro", storeAs: "intro_summary" },
    variables: { phase: "child" },
    logs: [],
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
    args: ["run", runnerPath],
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
    args: ["run", runnerPath],
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
    args: ["run", runnerPath],
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
