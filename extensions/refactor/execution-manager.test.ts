import test from "node:test";
import assert from "node:assert/strict";
import { RefactorExecutionManager } from "./execution-manager";
import type { RefactorExecutionUnit } from "./contract";
import type { RefactorWorkerResult } from "./worker-result";

function createExecutionUnit(): RefactorExecutionUnit {
  return {
    id: "guided-shell",
    title: "Adopt GuidedWorkflow",
    objective: "Move /refactor planning to GuidedWorkflow.",
    targets: ["extensions/refactor/workflow.ts"],
    validations: ["bun test extensions/refactor/index.test.ts"],
    dependsOn: [],
  };
}

function createWorkspaceManagerMock() {
  const createCalls: Array<{ name: string; destinationPath: string }> = [];
  const forgetCalls: string[] = [];

  return {
    createCalls,
    forgetCalls,
    workspaceManager: {
      async createWorkspace(name: string, destinationPath: string) {
        createCalls.push({ name, destinationPath });
        return { name, root: "/tmp/workspaces/refactor-step-1-guided-shell" };
      },
      async forgetWorkspace(name: string) {
        forgetCalls.push(name);
      },
    },
  };
}

function createWorkerRunnerMock(
  resultOrError: RefactorWorkerResult | Error,
  calls: Array<{ workspaceRoot: string; prompt: string; timeoutMs?: number }>,
) {
  return {
    async run(input: { workspaceRoot: string; prompt: string; timeoutMs?: number }) {
      calls.push(input);
      if (resultOrError instanceof Error) {
        throw resultOrError;
      }
      return resultOrError;
    },
  };
}

test("execution manager runs one unit successfully and returns integrated results", async () => {
  const { workspaceManager, createCalls, forgetCalls } = createWorkspaceManagerMock();
  const workerCalls: Array<{ workspaceRoot: string; prompt: string; timeoutMs?: number }> = [];
  const manager = new RefactorExecutionManager({
    repoRoot: "/repo",
    workspaceManager,
    workerRunner: createWorkerRunnerMock(
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
      workerCalls,
    ),
    renderWorkerPrompt({ executionUnit, step, totalSteps }) {
      return `Worker prompt for ${executionUnit.id} (${step}/${totalSteps})`;
    },
    async integrate({ workerResult }) {
      return {
        summary: `Integrated ${workerResult.unitId}`,
        changedFiles: workerResult.changedFiles,
      };
    },
  });

  const result = await manager.executeUnit({
    executionUnit: createExecutionUnit(),
    approvedPlanSummary: "Approved single-unit refactor plan.",
    step: 1,
    totalSteps: 1,
  });

  assert.deepEqual(result, {
    unitId: "guided-shell",
    status: "completed",
    summary: "Integrated guided-shell",
    changedFiles: ["extensions/refactor/workflow.ts"],
    validations: [
      {
        command: "bun test extensions/refactor/index.test.ts",
        outcome: "passed",
      },
    ],
  });
  assert.equal(createCalls.length, 1);
  assert.equal(workerCalls.length, 1);
  assert.match(workerCalls[0]!.prompt, /Worker prompt for guided-shell \(1\/1\)/);
  assert.deepEqual(forgetCalls, ["refactor-step-1-guided-shell"]);
});

test("execution manager surfaces worker failure results without integration", async () => {
  const { workspaceManager, forgetCalls } = createWorkspaceManagerMock();
  const workerCalls: Array<{ workspaceRoot: string; prompt: string; timeoutMs?: number }> = [];
  let integrateCalled = false;
  const manager = new RefactorExecutionManager({
    repoRoot: "/repo",
    workspaceManager,
    workerRunner: createWorkerRunnerMock(
      {
        version: 1,
        kind: "refactor_worker_result",
        unitId: "guided-shell",
        status: "failed",
        summary: "Validation failed after the refactor.",
        blockers: ["bun test extensions/refactor/index.test.ts failed"],
        validations: [
          {
            command: "bun test extensions/refactor/index.test.ts",
            outcome: "failed",
          },
        ],
      },
      workerCalls,
    ),
    renderWorkerPrompt() {
      return "Worker prompt";
    },
    async integrate() {
      integrateCalled = true;
      return {};
    },
  });

  const result = await manager.executeUnit({ executionUnit: createExecutionUnit(), step: 1 });

  assert.deepEqual(result, {
    unitId: "guided-shell",
    status: "failed",
    summary: "Validation failed after the refactor.",
    blockers: ["bun test extensions/refactor/index.test.ts failed"],
    validations: [
      {
        command: "bun test extensions/refactor/index.test.ts",
        outcome: "failed",
      },
    ],
  });
  assert.equal(integrateCalled, false);
  assert.deepEqual(forgetCalls, ["refactor-step-1-guided-shell"]);
});

test("execution manager escalates worker runner parse failures", async () => {
  const { workspaceManager, forgetCalls } = createWorkspaceManagerMock();
  const workerCalls: Array<{ workspaceRoot: string; prompt: string; timeoutMs?: number }> = [];
  const manager = new RefactorExecutionManager({
    repoRoot: "/repo",
    workspaceManager,
    workerRunner: createWorkerRunnerMock(
      new Error("Worker result parse failed: missing block"),
      workerCalls,
    ),
    renderWorkerPrompt() {
      return "Worker prompt";
    },
  });

  const result = await manager.executeUnit({ executionUnit: createExecutionUnit(), step: 1 });

  assert.equal(result.status, "failed");
  assert.match(result.summary, /Execution manager failed while running 'guided-shell'/);
  assert.deepEqual(result.blockers, ["Worker result parse failed: missing block"]);
  assert.deepEqual(result.validations, []);
  assert.deepEqual(forgetCalls, ["refactor-step-1-guided-shell"]);
});

test("execution manager blocks completion when integration reports merge conflicts", async () => {
  const { workspaceManager, forgetCalls } = createWorkspaceManagerMock();
  const workerCalls: Array<{ workspaceRoot: string; prompt: string; timeoutMs?: number }> = [];
  const manager = new RefactorExecutionManager({
    repoRoot: "/repo",
    workspaceManager,
    workerRunner: createWorkerRunnerMock(
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
      workerCalls,
    ),
    renderWorkerPrompt() {
      return "Worker prompt";
    },
    async integrate() {
      return {
        summary: "Integration blocked due to merge conflicts.",
        conflicts: ["extensions/refactor/workflow.ts conflicted during merge"],
      };
    },
  });

  const result = await manager.executeUnit({ executionUnit: createExecutionUnit(), step: 1 });

  assert.equal(result.status, "failed");
  assert.equal(result.summary, "Integration blocked due to merge conflicts.");
  assert.deepEqual(result.blockers, ["extensions/refactor/workflow.ts conflicted during merge"]);
  assert.deepEqual(result.validations, [
    {
      command: "bun test extensions/refactor/index.test.ts",
      outcome: "passed",
    },
  ]);
  assert.deepEqual(forgetCalls, ["refactor-step-1-guided-shell"]);
});

test("execution manager escalates integration failures after a completed worker run", async () => {
  const { workspaceManager, forgetCalls } = createWorkspaceManagerMock();
  const workerCalls: Array<{ workspaceRoot: string; prompt: string; timeoutMs?: number }> = [];
  const manager = new RefactorExecutionManager({
    repoRoot: "/repo",
    workspaceManager,
    workerRunner: createWorkerRunnerMock(
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
      workerCalls,
    ),
    renderWorkerPrompt() {
      return "Worker prompt";
    },
    async integrate() {
      throw new Error("Integration failed while applying worker changes");
    },
  });

  const result = await manager.executeUnit({ executionUnit: createExecutionUnit(), step: 1 });

  assert.equal(result.status, "failed");
  assert.deepEqual(result.blockers, ["Integration failed while applying worker changes"]);
  assert.deepEqual(result.validations, []);
  assert.deepEqual(forgetCalls, ["refactor-step-1-guided-shell"]);
});
