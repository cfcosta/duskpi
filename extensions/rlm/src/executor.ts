import { spawn } from "node:child_process";
import type { RlmAssistantProgram } from "./protocol";

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

export interface WasmtimeExecutorOptions {
  command?: string;
  args?: string[];
  modulePath?: string;
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
}

export class WasmtimeExecutor {
  private readonly command: string;
  private readonly args: string[];
  private readonly modulePath?: string;
  private readonly env?: NodeJS.ProcessEnv;
  private readonly timeoutMs: number;

  constructor(options: WasmtimeExecutorOptions = {}) {
    this.command = options.command ?? "wasmtime";
    this.args = options.args ?? [];
    this.modulePath = options.modulePath;
    this.env = options.env;
    this.timeoutMs = options.timeoutMs ?? 10_000;
  }

  async execute(input: RlmExecutorInput): Promise<RlmExecutorResult> {
    const payload = JSON.stringify({
      program: input.program,
      bindings: input.bindings ?? {},
    });

    return await new Promise<RlmExecutorResult>((resolve) => {
      const child = spawn(this.command, this.buildArgs(), {
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
          kind: "runtime_error",
          message: `Executor timed out after ${input.timeoutMs ?? this.timeoutMs}ms.`,
          exitCode: null,
          stdout,
          stderr,
        });
      }, input.timeoutMs ?? this.timeoutMs);

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
          kind: "runtime_error",
          message: error.message,
          exitCode: null,
          stdout,
          stderr,
        });
      });

      child.on("close", (code) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        if (code !== 0) {
          resolve({
            kind: "runtime_error",
            message: `Executor process exited with code ${code}.`,
            exitCode: code,
            stdout,
            stderr,
          });
          return;
        }

        resolve(normalizeExecutorOutput(stdout, stderr));
      });

      child.stdin.write(payload);
      child.stdin.end();
    });
  }

  private buildArgs(): string[] {
    return this.modulePath ? [...this.args, this.modulePath] : [...this.args];
  }
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
