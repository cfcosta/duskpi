import test from "node:test";
import assert from "node:assert/strict";
import type { ExecOptions, ExecResult } from "./extension-api";
import { WorkerRunner } from "./worker-runner";

interface ExecCall {
  command: string;
  args: string[];
  options?: ExecOptions;
}

function createExecMock(result: Partial<ExecResult>) {
  const calls: ExecCall[] = [];
  const exec = async (
    command: string,
    args: string[],
    options?: ExecOptions,
  ): Promise<ExecResult> => {
    calls.push({ command, args, options });
    return {
      stdout: result.stdout ?? "",
      stderr: result.stderr ?? "",
      code: result.code ?? 0,
      killed: result.killed ?? false,
    };
  };

  return { exec, calls };
}

function buildJsonModeStdout(assistantText: string): string {
  return [
    JSON.stringify({ type: "session", version: 3, cwd: "/tmp/workspaces/refactor-a" }),
    JSON.stringify({
      type: "message_end",
      message: {
        role: "assistant",
        content: [{ type: "text", text: assistantText }],
      },
    }),
  ].join("\n");
}

test("worker runner launches pi with json mode arguments and the provided prompt", async () => {
  const parseInputs: string[] = [];
  const { exec, calls } = createExecMock({ stdout: buildJsonModeStdout("parsed-result") });
  const runner = new WorkerRunner({
    exec,
    parseResult(assistantText) {
      parseInputs.push(assistantText);
      return { ok: true as const, value: assistantText };
    },
  });

  await runner.run({
    workspaceRoot: "/tmp/workspaces/refactor-a",
    prompt: "Run the assigned worker task",
  });

  assert.deepEqual(calls, [
    {
      command: "pi",
      args: ["--mode", "json", "--no-session", "Run the assigned worker task"],
      options: { cwd: "/tmp/workspaces/refactor-a", timeout: 120000 },
    },
  ]);
  assert.deepEqual(parseInputs, ["parsed-result"]);
});

test("worker runner returns the parsed worker result from assistant output", async () => {
  const { exec } = createExecMock({
    stdout: buildJsonModeStdout('```tag\n{"status":"completed"}\n```'),
  });
  const runner = new WorkerRunner({
    exec,
    parseResult() {
      return {
        ok: true as const,
        value: {
          status: "completed",
          unitId: "guided-shell",
        },
      };
    },
  });

  const result = await runner.run({
    workspaceRoot: "/tmp/workspaces/refactor-a",
    prompt: "Run the assigned worker task",
  });

  assert.deepEqual(result, {
    status: "completed",
    unitId: "guided-shell",
  });
});

test("worker runner reports timeout or killed subprocesses", async () => {
  const { exec } = createExecMock({ killed: true, code: 1 });
  const runner = new WorkerRunner({
    exec,
    parseResult() {
      return { ok: true as const, value: "unused" };
    },
  });

  await assert.rejects(
    () =>
      runner.run({
        workspaceRoot: "/tmp/workspaces/refactor-a",
        prompt: "Run the assigned worker task",
        timeoutMs: 5000,
      }),
    /timed out or was killed/i,
  );
});

test("worker runner reports non-zero exit failures", async () => {
  const { exec } = createExecMock({
    code: 1,
    stderr: "worker crashed before emitting a result",
  });
  const runner = new WorkerRunner({
    exec,
    parseResult() {
      return { ok: true as const, value: "unused" };
    },
  });

  await assert.rejects(
    () =>
      runner.run({
        workspaceRoot: "/tmp/workspaces/refactor-a",
        prompt: "Run the assigned worker task",
      }),
    /worker crashed before emitting a result/i,
  );
});

test("worker runner reports missing assistant text output", async () => {
  const { exec } = createExecMock({
    stdout: JSON.stringify({ type: "session", version: 3, cwd: "/tmp/workspaces/refactor-a" }),
  });
  const runner = new WorkerRunner({
    exec,
    parseResult() {
      return { ok: true as const, value: "unused" };
    },
  });

  await assert.rejects(
    () =>
      runner.run({
        workspaceRoot: "/tmp/workspaces/refactor-a",
        prompt: "Run the assigned worker task",
      }),
    /did not produce assistant text output/i,
  );
});

test("worker runner reports parse failures from the extension-local parser", async () => {
  const { exec } = createExecMock({ stdout: buildJsonModeStdout("bad tagged block") });
  const runner = new WorkerRunner({
    exec,
    parseResult() {
      return { ok: false as const, message: "Missing tagged JSON block `worker-result`." };
    },
  });

  await assert.rejects(
    () =>
      runner.run({
        workspaceRoot: "/tmp/workspaces/refactor-a",
        prompt: "Run the assigned worker task",
      }),
    /Worker result parse failed: Missing tagged JSON block `worker-result`\./i,
  );
});
