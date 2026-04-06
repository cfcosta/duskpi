import test from "node:test";
import assert from "node:assert/strict";
import { ExecutionManager, type CompletedExecutionWorkerResult } from "./execution-manager";

interface TestExecutionUnit {
  id: string;
  title: string;
  dependsOn: string[];
}

interface TestValidation {
  command: string;
  outcome: "passed" | "failed";
}

function createExecutionUnit(): TestExecutionUnit {
  return {
    id: "guided-shell",
    title: "Adopt GuidedWorkflow",
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
        return { name, root: "/tmp/workspaces/execution-step-1-guided-shell" };
      },
      async forgetWorkspace(name: string) {
        forgetCalls.push(name);
      },
    },
  };
}

function createWorkerRunnerMock(
  resultOrError: CompletedExecutionWorkerResult<TestValidation> | {
    unitId: string;
    status: "blocked" | "failed";
    summary: string;
    blockers: string[];
    validations: TestValidation[];
  } | Error,
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
  const manager = new ExecutionManager<TestExecutionUnit, TestValidation>({
    repoRoot: "/repo",
    workspaceManager,
    workerRunner: createWorkerRunnerMock(
      {
        unitId: "guided-shell",
        status: "completed",
        summary: "Moved planning to GuidedWorkflow.",
        changedFiles: ["workflow.ts"],
        validations: [
          {
            command: "bun test workflow.test.ts",
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
    approvedPlanSummary: "Approved single-unit execution plan.",
    step: 1,
    totalSteps: 1,
  });

  assert.deepEqual(result, {
    unitId: "guided-shell",
    status: "completed",
    summary: "Integrated guided-shell",
    changedFiles: ["workflow.ts"],
    validations: [
      {
        command: "bun test workflow.test.ts",
        outcome: "passed",
      },
    ],
  });
  assert.equal(createCalls.length, 1);
  assert.equal(workerCalls.length, 1);
  assert.match(workerCalls[0]!.prompt, /Worker prompt for guided-shell \(1\/1\)/);
  assert.deepEqual(forgetCalls, ["execution-step-1-guided-shell"]);
});

test("execution manager surfaces worker failure results without integration", async () => {
  const { workspaceManager, forgetCalls } = createWorkspaceManagerMock();
  let integrateCalled = false;
  const manager = new ExecutionManager<TestExecutionUnit, TestValidation>({
    repoRoot: "/repo",
    workspaceManager,
    workerRunner: createWorkerRunnerMock(
      {
        unitId: "guided-shell",
        status: "failed",
        summary: "Validation failed after the execution.",
        blockers: ["bun test workflow.test.ts failed"],
        validations: [
          {
            command: "bun test workflow.test.ts",
            outcome: "failed",
          },
        ],
      },
      [],
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
    summary: "Validation failed after the execution.",
    blockers: ["bun test workflow.test.ts failed"],
    validations: [
      {
        command: "bun test workflow.test.ts",
        outcome: "failed",
      },
    ],
  });
  assert.equal(integrateCalled, false);
  assert.deepEqual(forgetCalls, ["execution-step-1-guided-shell"]);
});

test("execution manager escalates worker runner failures", async () => {
  const { workspaceManager, forgetCalls } = createWorkspaceManagerMock();
  const manager = new ExecutionManager<TestExecutionUnit, TestValidation>({
    repoRoot: "/repo",
    workspaceManager,
    workerRunner: createWorkerRunnerMock(new Error("Worker result parse failed: missing block"), []),
    renderWorkerPrompt() {
      return "Worker prompt";
    },
  });

  const result = await manager.executeUnit({ executionUnit: createExecutionUnit(), step: 1 });

  assert.equal(result.status, "failed");
  assert.match(result.summary, /Execution manager failed while running 'guided-shell'/);
  assert.deepEqual(result.blockers, ["Worker result parse failed: missing block"]);
  assert.deepEqual(result.validations, []);
  assert.deepEqual(forgetCalls, ["execution-step-1-guided-shell"]);
});

test("execution manager blocks completion when integration reports conflicts", async () => {
  const { workspaceManager, forgetCalls } = createWorkspaceManagerMock();
  const manager = new ExecutionManager<TestExecutionUnit, TestValidation>({
    repoRoot: "/repo",
    workspaceManager,
    workerRunner: createWorkerRunnerMock(
      {
        unitId: "guided-shell",
        status: "completed",
        summary: "Moved planning to GuidedWorkflow.",
        changedFiles: ["workflow.ts"],
        validations: [
          {
            command: "bun test workflow.test.ts",
            outcome: "passed",
          },
        ],
      },
      [],
    ),
    renderWorkerPrompt() {
      return "Worker prompt";
    },
    async integrate() {
      return {
        summary: "Integration blocked due to merge conflicts.",
        conflicts: ["workflow.ts conflicted during merge"],
      };
    },
  });

  const result = await manager.executeUnit({ executionUnit: createExecutionUnit(), step: 1 });

  assert.equal(result.status, "failed");
  assert.equal(result.summary, "Integration blocked due to merge conflicts.");
  assert.deepEqual(result.blockers, ["workflow.ts conflicted during merge"]);
  assert.deepEqual(result.validations, [
    {
      command: "bun test workflow.test.ts",
      outcome: "passed",
    },
  ]);
  assert.deepEqual(forgetCalls, ["execution-step-1-guided-shell"]);
});

test("execution manager uses a custom workspace name builder when provided", async () => {
  const { workspaceManager, createCalls, forgetCalls } = createWorkspaceManagerMock();
  const manager = new ExecutionManager<TestExecutionUnit, TestValidation>({
    repoRoot: "/repo",
    workspaceManager,
    workerRunner: createWorkerRunnerMock(
      {
        unitId: "guided-shell",
        status: "completed",
        summary: "Completed execution.",
        changedFiles: ["workflow.ts"],
        validations: [],
      },
      [],
    ),
    renderWorkerPrompt() {
      return "Worker prompt";
    },
    buildWorkspaceName(executionUnit, step) {
      return `custom-${step}-${executionUnit.id}`;
    },
  });

  await manager.executeUnit({ executionUnit: createExecutionUnit(), step: 1 });

  assert.deepEqual(createCalls, [
    {
      name: "custom-1-guided-shell",
      destinationPath: "/repo/.workflow-workspaces/custom-1-guided-shell",
    },
  ]);
  assert.deepEqual(forgetCalls, ["custom-1-guided-shell"]);
});
