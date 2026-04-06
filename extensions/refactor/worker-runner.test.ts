import test from "node:test";
import assert from "node:assert/strict";
import type { ExecOptions, ExecResult } from "../../packages/workflow-core/src/index";
import { REFACTOR_WORKER_RESULT_JSON_BLOCK_TAG } from "./worker-result";
import { RefactorWorkerRunner } from "./worker-runner";

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

function buildWorkerResultText(): string {
  return [
    "Worker completed the assigned unit.",
    `\`\`\`${REFACTOR_WORKER_RESULT_JSON_BLOCK_TAG}`,
    JSON.stringify(
      {
        version: 1,
        kind: "refactor_worker_result",
        unitId: "guided-shell",
        status: "completed",
        summary: "Moved /refactor planning to GuidedWorkflow.",
        changedFiles: ["extensions/refactor/workflow.ts"],
        validations: [
          {
            command: "bun test extensions/refactor/index.test.ts",
            outcome: "passed",
          },
        ],
      },
      null,
      2,
    ),
    "\`\`\`",
  ].join("\n");
}

test("worker runner launches pi with json mode arguments and the provided prompt", async () => {
  const { exec, calls } = createExecMock({ stdout: buildJsonModeStdout(buildWorkerResultText()) });
  const runner = new RefactorWorkerRunner({ exec });

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
});

test("worker runner parses the structured worker result from assistant output", async () => {
  const { exec } = createExecMock({ stdout: buildJsonModeStdout(buildWorkerResultText()) });
  const runner = new RefactorWorkerRunner({ exec });

  const result = await runner.run({
    workspaceRoot: "/tmp/workspaces/refactor-a",
    prompt: "Run the assigned worker task",
  });

  assert.equal(result.status, "completed");
  assert.equal(result.unitId, "guided-shell");
  assert.deepEqual(result.changedFiles, ["extensions/refactor/workflow.ts"]);
});

test("worker runner reports timeout or killed subprocesses", async () => {
  const { exec } = createExecMock({ killed: true, code: 1 });
  const runner = new RefactorWorkerRunner({ exec });

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
  const runner = new RefactorWorkerRunner({ exec });

  await assert.rejects(
    () =>
      runner.run({
        workspaceRoot: "/tmp/workspaces/refactor-a",
        prompt: "Run the assigned worker task",
      }),
    /worker crashed before emitting a result/i,
  );
});
