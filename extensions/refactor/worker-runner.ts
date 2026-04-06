import type { ExecOptions, ExecResult } from "../../packages/workflow-core/src/index";
import { parseTaggedWorkerResult, type RefactorWorkerResult } from "./worker-result";

const DEFAULT_WORKER_TIMEOUT_MS = 120_000;

export interface WorkerRunnerExec {
  (command: string, args: string[], options?: ExecOptions): Promise<ExecResult>;
}

export interface RefactorWorkerRunnerOptions {
  exec: WorkerRunnerExec;
  command?: string;
  timeoutMs?: number;
}

export interface RefactorWorkerRunInput {
  workspaceRoot: string;
  prompt: string;
  timeoutMs?: number;
}

export class RefactorWorkerRunner {
  private readonly command: string;
  private readonly timeoutMs: number;

  constructor(private readonly options: RefactorWorkerRunnerOptions) {
    this.command = options.command ?? "pi";
    this.timeoutMs = options.timeoutMs ?? DEFAULT_WORKER_TIMEOUT_MS;
  }

  async run(input: RefactorWorkerRunInput): Promise<RefactorWorkerResult> {
    const result = await this.options.exec(
      this.command,
      ["--mode", "json", "--no-session", input.prompt],
      {
        cwd: input.workspaceRoot,
        timeout: input.timeoutMs ?? this.timeoutMs,
      },
    );

    if (result.killed) {
      throw new Error(`Worker process timed out or was killed in '${input.workspaceRoot}'.`);
    }

    if (result.code !== 0) {
      const details = result.stderr.trim() || result.stdout.trim();
      throw new Error(
        details.length > 0
          ? `Worker process failed: ${details}`
          : `Worker process failed with exit code ${result.code}.`,
      );
    }

    const assistantText = extractLastAssistantTextFromJsonEvents(result.stdout);
    if (!assistantText) {
      throw new Error("Worker process did not produce assistant text output.");
    }

    const parsed = parseTaggedWorkerResult(assistantText);
    if (!parsed.ok) {
      throw new Error(`Worker result parse failed: ${parsed.message}`);
    }

    return parsed.value;
  }
}

function extractLastAssistantTextFromJsonEvents(stdout: string): string | undefined {
  let lastAssistantText: string | undefined;

  for (const rawLine of stdout.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.length === 0) {
      continue;
    }

    let event: unknown;
    try {
      event = JSON.parse(line);
    } catch {
      continue;
    }

    if (!isRecord(event)) {
      continue;
    }

    if (event.type === "message_end") {
      const text = extractAssistantTextFromMessage(event.message);
      if (text) {
        lastAssistantText = text;
      }
      continue;
    }

    if (event.type === "agent_end" && Array.isArray(event.messages)) {
      for (const message of event.messages) {
        const text = extractAssistantTextFromMessage(message);
        if (text) {
          lastAssistantText = text;
        }
      }
    }
  }

  return lastAssistantText;
}

function extractAssistantTextFromMessage(message: unknown): string | undefined {
  if (!isRecord(message) || message.role !== "assistant") {
    return undefined;
  }

  const content = message.content;
  if (!Array.isArray(content)) {
    return undefined;
  }

  const text = content
    .filter((entry): entry is { type?: unknown; text?: unknown } => isRecord(entry))
    .filter((entry) => entry.type === "text" && typeof entry.text === "string")
    .map((entry) => entry.text)
    .join("\n")
    .trim();

  return text.length > 0 ? text : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
