import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { RlmAssistantProgram } from "./protocol";

export const RLM_WASMTIME_BIN_ENV = "RLM_WASMTIME_BIN";
export const RLM_JAVY_BIN_ENV = "RLM_JAVY_BIN";

export interface RlmExecutorInput {
  program: RlmAssistantProgram;
  bindings?: Record<string, unknown>;
  timeoutMs?: number;
}

export interface RlmExecutorSubcallRequest {
  prompt: string;
  storeAs: string;
}

interface RlmExecutorBaseResult {
  logs: string[];
  variables: Record<string, string>;
  summary?: unknown;
}

export interface RlmExecutorCompletedResult extends RlmExecutorBaseResult {
  kind: "completed";
  finalResult?: string;
}

export interface RlmExecutorSubcallResult extends RlmExecutorBaseResult {
  kind: "subcall";
  subcall: RlmExecutorSubcallRequest;
}

export interface RlmExecutorRuntimeErrorResult {
  kind: "runtime_error";
  message: string;
  exitCode?: number | null;
  stderr?: string;
  stdout?: string;
}

export interface RlmExecutorInvalidOutputResult {
  kind: "invalid_output";
  message: string;
  stderr?: string;
  stdout?: string;
}

export type RlmExecutorResult =
  | RlmExecutorCompletedResult
  | RlmExecutorSubcallResult
  | RlmExecutorRuntimeErrorResult
  | RlmExecutorInvalidOutputResult;

export type WasmtimeExecutorMode = "module" | "javy";

export interface WasmtimeExecutorOptions {
  mode?: WasmtimeExecutorMode;
  command?: string;
  args?: string[];
  modulePath?: string;
  compilerCommand?: string;
  compilerArgs?: string[];
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
  tempDir?: string;
}

interface ProcessResult {
  ok: boolean;
  code: number | null;
  stdout: string;
  stderr: string;
  error?: Error;
}

export class WasmtimeExecutor {
  private readonly mode: WasmtimeExecutorMode;
  private readonly command: string;
  private readonly args: string[];
  private readonly modulePath?: string;
  private readonly compilerCommand?: string;
  private readonly compilerArgs: string[];
  private readonly env?: NodeJS.ProcessEnv;
  private readonly timeoutMs: number;
  private readonly tempDir: string;

  constructor(options: WasmtimeExecutorOptions = {}) {
    this.mode = options.mode ?? "module";
    this.command = options.command ?? "wasmtime";
    this.args = options.args ?? [];
    this.modulePath = options.modulePath;
    this.compilerCommand = options.compilerCommand;
    this.compilerArgs = options.compilerArgs ?? [];
    this.env = options.env;
    this.timeoutMs = options.timeoutMs ?? 10_000;
    this.tempDir = options.tempDir ?? os.tmpdir();
  }

  async execute(input: RlmExecutorInput): Promise<RlmExecutorResult> {
    if (this.mode === "javy") {
      return await this.executeViaJavy(input);
    }

    return await this.executePrecompiledModule(input);
  }

  private async executePrecompiledModule(input: RlmExecutorInput): Promise<RlmExecutorResult> {
    const payload = JSON.stringify({
      program: input.program,
      bindings: input.bindings ?? {},
    });
    const timeoutMs = input.timeoutMs ?? this.timeoutMs;

    const result = await this.runProcess(
      this.command,
      this.buildRuntimeArgs(this.modulePath),
      payload,
      timeoutMs,
    );
    if (!result.ok) {
      return processFailure(
        `Executor process ${result.error ? "failed" : "exited"}.`,
        result,
        timeoutMs,
      );
    }

    return normalizeExecutorOutput(result.stdout, result.stderr);
  }

  private async executeViaJavy(input: RlmExecutorInput): Promise<RlmExecutorResult> {
    if (!this.compilerCommand) {
      return {
        kind: "runtime_error",
        message: "Javy executor mode requires a compilerCommand.",
        exitCode: null,
      };
    }

    const tempRoot = await mkdtemp(path.join(this.tempDir, "rlm-javy-"));
    const sourcePath = path.join(tempRoot, "program.js");
    const modulePath = path.join(tempRoot, "program.wasm");
    const timeoutMs = input.timeoutMs ?? this.timeoutMs;

    try {
      await writeFile(sourcePath, buildJavyRuntimeSource(input.program.code), "utf8");

      const compileResult = await this.runProcess(
        this.compilerCommand,
        [...this.compilerArgs, "build", sourcePath, "-o", modulePath],
        undefined,
        timeoutMs,
      );
      if (!compileResult.ok) {
        return {
          kind: "runtime_error",
          message: compileResult.error
            ? `Javy compilation failed: ${compileResult.error.message}`
            : `Javy compilation exited with code ${compileResult.code}.`,
          exitCode: compileResult.code,
          stdout: compileResult.stdout,
          stderr: compileResult.stderr,
        };
      }

      const runtimePayload = JSON.stringify({
        program: input.program,
        bindings: input.bindings ?? {},
      });
      const runtimeResult = await this.runProcess(
        this.command,
        this.buildRuntimeArgs(modulePath),
        runtimePayload,
        timeoutMs,
      );
      if (!runtimeResult.ok) {
        return processFailure(
          `Wasmtime runtime ${runtimeResult.error ? "failed" : "exited"}.`,
          runtimeResult,
          timeoutMs,
        );
      }

      return normalizeExecutorOutput(runtimeResult.stdout, runtimeResult.stderr);
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  }

  private buildRuntimeArgs(modulePath?: string): string[] {
    return modulePath ? [...this.args, modulePath] : [...this.args];
  }

  private async runProcess(
    command: string,
    args: string[],
    stdin: string | undefined,
    timeoutMs: number,
  ): Promise<ProcessResult> {
    return await new Promise<ProcessResult>((resolve) => {
      const child = spawn(command, args, {
        env: this.env,
        stdio: ["pipe", "pipe", "pipe"],
      });

      let stdout = "";
      let stderr = "";
      let settled = false;
      const timeout = setTimeout(() => {
        if (settled) return;
        settled = true;
        child.kill();
        resolve({
          ok: false,
          code: null,
          stdout,
          stderr,
        });
      }, timeoutMs);

      child.stdout.setEncoding("utf8");
      child.stderr.setEncoding("utf8");
      child.stdout.on("data", (chunk) => {
        stdout += chunk;
      });
      child.stderr.on("data", (chunk) => {
        stderr += chunk;
      });

      child.on("error", (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        resolve({
          ok: false,
          code: null,
          stdout,
          stderr,
          error,
        });
      });

      child.on("close", (code) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        resolve({
          ok: code === 0,
          code,
          stdout,
          stderr,
        });
      });

      if (typeof stdin === "string") {
        child.stdin.write(stdin);
      }
      child.stdin.end();
    });
  }
}

export function createDefaultWasmtimeExecutor(
  options: Omit<WasmtimeExecutorOptions, "mode" | "command" | "compilerCommand"> = {},
): WasmtimeExecutor {
  return new WasmtimeExecutor({
    mode: "javy",
    command: process.env[RLM_WASMTIME_BIN_ENV] ?? "wasmtime",
    compilerCommand: process.env[RLM_JAVY_BIN_ENV] ?? "javy",
    env: process.env,
    ...options,
  });
}

function buildJavyRuntimeSource(code: string): string {
  return `
function readInput() {
  const chunkSize = 1024;
  const inputChunks = [];
  let totalBytes = 0;

  while (true) {
    const buffer = new Uint8Array(chunkSize);
    const bytesRead = Javy.IO.readSync(0, buffer);
    totalBytes += bytesRead;
    if (bytesRead === 0) {
      break;
    }
    inputChunks.push(buffer.subarray(0, bytesRead));
  }

  const finalBuffer = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of inputChunks) {
    finalBuffer.set(chunk, offset);
    offset += chunk.length;
  }

  if (finalBuffer.length === 0) {
    return {};
  }

  return JSON.parse(new TextDecoder().decode(finalBuffer));
}

function writeOutput(output) {
  const encoded = new TextEncoder().encode(JSON.stringify(output));
  Javy.IO.writeSync(1, encoded);
}

function writeError(message) {
  const encoded = new TextEncoder().encode(String(message));
  Javy.IO.writeSync(2, encoded);
}

function stringifyValue(value) {
  if (typeof value === "string") {
    return value;
  }

  const json = JSON.stringify(value);
  return typeof json === "string" ? json : String(value);
}

const input = readInput();
const bindings = input.bindings && typeof input.bindings === "object" ? input.bindings : {};
const persistedVariables =
  bindings.variables && typeof bindings.variables === "object" ? bindings.variables : {};
const state = {
  kind: "completed",
  variables: {},
  logs: [],
};

globalThis.bindings = bindings;
globalThis.get = function get(name) {
  const key = String(name);
  if (Object.prototype.hasOwnProperty.call(state.variables, key)) {
    return state.variables[key];
  }
  if (Object.prototype.hasOwnProperty.call(persistedVariables, key)) {
    return persistedVariables[key];
  }
  return bindings[key];
};
globalThis.set = function set(name, value) {
  const key = String(name);
  state.variables[key] = stringifyValue(value);
  if (key === "Final") {
    state.finalResult = state.variables[key];
  }
  return state.variables[key];
};
globalThis.setFinal = function setFinal(value) {
  state.kind = "completed";
  const finalValue = stringifyValue(value);
  state.variables.Final = finalValue;
  state.finalResult = finalValue;
  delete state.subcall;
  return finalValue;
};
globalThis.setSummary = function setSummary(value) {
  state.summary = value;
  return state.summary;
};
globalThis.subcall = function subcall(prompt, storeAs) {
  state.kind = "subcall";
  delete state.finalResult;
  delete state.variables.Final;
  state.subcall = {
    prompt: stringifyValue(prompt),
    storeAs: stringifyValue(storeAs),
  };
  return state.subcall;
};
globalThis.log = function log(...values) {
  state.logs.push(values.map((value) => stringifyValue(value)).join(" "));
};

try {
  const userProgram = new Function(
    "bindings",
    "get",
    "set",
    "setFinal",
    "setSummary",
    "subcall",
    "log",
    ${JSON.stringify(code)},
  );
  userProgram(bindings, globalThis.get, globalThis.set, globalThis.setFinal, globalThis.setSummary, globalThis.subcall, globalThis.log);
  writeOutput(state);
} catch (error) {
  writeError(error instanceof Error ? error.stack ?? error.message : String(error));
  throw error;
}
`;
}

function processFailure(
  message: string,
  result: ProcessResult,
  timeoutMs: number,
): RlmExecutorResult {
  if (result.code === null && !result.error) {
    return {
      kind: "runtime_error",
      message: `Executor timed out after ${timeoutMs}ms.`,
      exitCode: null,
      stdout: result.stdout,
      stderr: result.stderr,
    };
  }

  return {
    kind: "runtime_error",
    message: result.error
      ? `${message} ${result.error.message}`
      : `${message} code ${result.code}.`,
    exitCode: result.code,
    stdout: result.stdout,
    stderr: result.stderr,
  };
}

function normalizeExecutorOutput(stdout: string, stderr: string): RlmExecutorResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    return {
      kind: "invalid_output",
      message: "Executor output was not valid JSON.",
      stdout,
      stderr,
    };
  }

  if (!isRecord(parsed)) {
    return {
      kind: "invalid_output",
      message: "Executor output must be a JSON object.",
      stdout,
      stderr,
    };
  }

  const kind = parsed.kind;
  if (kind !== "completed" && kind !== "subcall") {
    return {
      kind: "invalid_output",
      message: "Executor output must declare kind 'completed' or 'subcall'.",
      stdout,
      stderr,
    };
  }

  const variablesResult = normalizeVariables(parsed.variables);
  if (!variablesResult.ok) {
    return {
      kind: "invalid_output",
      message: variablesResult.message,
      stdout,
      stderr,
    };
  }

  const logsResult = normalizeLogs(parsed.logs);
  if (!logsResult.ok) {
    return {
      kind: "invalid_output",
      message: logsResult.message,
      stdout,
      stderr,
    };
  }

  if (kind === "completed") {
    if (typeof parsed.finalResult !== "undefined" && typeof parsed.finalResult !== "string") {
      return {
        kind: "invalid_output",
        message: "Executor completed output must use a string finalResult when provided.",
        stdout,
        stderr,
      };
    }

    return {
      kind: "completed",
      finalResult: parsed.finalResult,
      variables: variablesResult.value,
      logs: logsResult.value,
      summary: parsed.summary,
    };
  }

  if (!isRecord(parsed.subcall)) {
    return {
      kind: "invalid_output",
      message: "Executor subcall output must include a subcall object.",
      stdout,
      stderr,
    };
  }

  const prompt = parsed.subcall.prompt;
  const storeAs = parsed.subcall.storeAs;
  if (typeof prompt !== "string" || prompt.trim().length === 0) {
    return {
      kind: "invalid_output",
      message: "Executor subcall output requires a non-empty string prompt.",
      stdout,
      stderr,
    };
  }
  if (typeof storeAs !== "string" || storeAs.trim().length === 0) {
    return {
      kind: "invalid_output",
      message: "Executor subcall output requires a non-empty string storeAs.",
      stdout,
      stderr,
    };
  }

  return {
    kind: "subcall",
    subcall: {
      prompt: prompt.trim(),
      storeAs: storeAs.trim(),
    },
    variables: variablesResult.value,
    logs: logsResult.value,
    summary: parsed.summary,
  };
}

function normalizeVariables(
  value: unknown,
): { ok: true; value: Record<string, string> } | { ok: false; message: string } {
  if (typeof value === "undefined") {
    return { ok: true, value: {} };
  }

  if (!isRecord(value)) {
    return { ok: false, message: "Executor output variables must be a JSON object." };
  }

  const variables: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry !== "string") {
      return { ok: false, message: `Executor variable '${key}' must be a string.` };
    }
    variables[key] = entry;
  }

  return { ok: true, value: variables };
}

function normalizeLogs(
  value: unknown,
): { ok: true; value: string[] } | { ok: false; message: string } {
  if (typeof value === "undefined") {
    return { ok: true, value: [] };
  }

  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) {
    return { ok: false, message: "Executor output logs must be an array of strings." };
  }

  return { ok: true, value };
}

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
