import test from "node:test";
import assert from "node:assert/strict";
import type { ExecOptions, ExecResult } from "../../packages/workflow-core/src/index";
import { JjWorkspaceManager } from "./workspace-manager";

interface ExecCall {
  command: string;
  args: string[];
  options?: ExecOptions;
}

function createExecMock(results: Array<Partial<ExecResult>>) {
  const calls: ExecCall[] = [];
  let index = 0;

  const exec = async (
    command: string,
    args: string[],
    options?: ExecOptions,
  ): Promise<ExecResult> => {
    calls.push({ command, args, options });
    const next = results[index++] ?? {};
    return {
      stdout: next.stdout ?? "",
      stderr: next.stderr ?? "",
      code: next.code ?? 0,
      killed: next.killed ?? false,
    };
  };

  return { exec, calls };
}

test("createWorkspace adds a workspace and resolves its root", async () => {
  const { exec, calls } = createExecMock([
    { stdout: "" },
    { stdout: "/tmp/workspaces/refactor-a\n" },
  ]);
  const manager = new JjWorkspaceManager({
    repoRoot: "/repo",
    exec,
  });

  const workspace = await manager.createWorkspace("refactor-a", "/tmp/workspaces/refactor-a");

  assert.deepEqual(workspace, {
    name: "refactor-a",
    root: "/tmp/workspaces/refactor-a",
  });
  assert.deepEqual(calls, [
    {
      command: "jj",
      args: ["workspace", "add", "/tmp/workspaces/refactor-a", "--name", "refactor-a"],
      options: { cwd: "/repo", timeout: 15000, signal: undefined, env: undefined },
    },
    {
      command: "jj",
      args: ["workspace", "root", "--name", "refactor-a"],
      options: { cwd: "/repo", timeout: 15000, signal: undefined, env: undefined },
    },
  ]);
});

test("getWorkspaceRoot trims the returned path", async () => {
  const { exec, calls } = createExecMock([{ stdout: "/tmp/workspaces/refactor-b\n" }]);
  const manager = new JjWorkspaceManager({
    repoRoot: "/repo",
    exec,
    timeoutMs: 5000,
  });

  const root = await manager.getWorkspaceRoot("refactor-b");

  assert.equal(root, "/tmp/workspaces/refactor-b");
  assert.deepEqual(calls, [
    {
      command: "jj",
      args: ["workspace", "root", "--name", "refactor-b"],
      options: { cwd: "/repo", timeout: 5000, signal: undefined, env: undefined },
    },
  ]);
});

test("updateStaleWorkspace looks up the workspace root and runs jj workspace update-stale there", async () => {
  const { exec, calls } = createExecMock([
    { stdout: "/tmp/workspaces/refactor-c\n" },
    { stdout: "" },
  ]);
  const manager = new JjWorkspaceManager({
    repoRoot: "/repo",
    exec,
  });

  await manager.updateStaleWorkspace("refactor-c");

  assert.deepEqual(calls, [
    {
      command: "jj",
      args: ["workspace", "root", "--name", "refactor-c"],
      options: { cwd: "/repo", timeout: 15000, signal: undefined, env: undefined },
    },
    {
      command: "jj",
      args: ["workspace", "update-stale"],
      options: {
        cwd: "/tmp/workspaces/refactor-c",
        timeout: 15000,
        signal: undefined,
        env: undefined,
      },
    },
  ]);
});

test("forgetWorkspace cleans up the workspace registration", async () => {
  const { exec, calls } = createExecMock([{ stdout: "" }]);
  const manager = new JjWorkspaceManager({
    repoRoot: "/repo",
    exec,
  });

  await manager.forgetWorkspace("refactor-d");

  assert.deepEqual(calls, [
    {
      command: "jj",
      args: ["workspace", "forget", "refactor-d"],
      options: { cwd: "/repo", timeout: 15000, signal: undefined, env: undefined },
    },
  ]);
});
