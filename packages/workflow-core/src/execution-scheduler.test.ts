import test from "node:test";
import assert from "node:assert/strict";
import { buildExecutionLayers, ExecutionScheduler } from "./execution-scheduler";

interface TestExecutionUnit {
  id: string;
  title: string;
  dependsOn: string[];
}

function createUnits(): TestExecutionUnit[] {
  return [
    {
      id: "unit-a",
      title: "Unit A",
      dependsOn: [],
    },
    {
      id: "unit-b",
      title: "Unit B",
      dependsOn: [],
    },
    {
      id: "unit-c",
      title: "Unit C",
      dependsOn: ["unit-a", "unit-b"],
    },
  ];
}

test("buildExecutionLayers groups units by dependency layer", () => {
  const layers = buildExecutionLayers(createUnits());

  assert.deepEqual(
    layers.map((layer) => layer.map((unit) => unit.id)),
    [["unit-a", "unit-b"], ["unit-c"]],
  );
});

test("scheduler dispatches independent units in the same layer concurrently", async () => {
  const started: string[] = [];
  let active = 0;
  let maxActive = 0;
  const scheduler = new ExecutionScheduler<TestExecutionUnit>({
    executor: {
      async executeUnit({ executionUnit }) {
        started.push(executionUnit.id);
        active += 1;
        maxActive = Math.max(maxActive, active);
        await new Promise((resolve) => setTimeout(resolve, executionUnit.id === "unit-c" ? 1 : 10));
        active -= 1;
        return {
          unitId: executionUnit.id,
          status: "completed" as const,
          summary: `Completed ${executionUnit.id}`,
          changedFiles: [executionUnit.title],
          validations: [],
        };
      },
    },
  });

  const result = await scheduler.execute({
    executionUnits: createUnits(),
    approvedPlanSummary: "Parallel plan",
  });

  assert.equal(result.status, "completed");
  assert.equal(maxActive >= 2, true);
  assert.deepEqual(started, ["unit-a", "unit-b", "unit-c"]);
  assert.deepEqual(
    result.layers.map((layer) => layer.unitIds),
    [["unit-a", "unit-b"], ["unit-c"]],
  );
});

test("scheduler blocks dependent units until prerequisite layers complete", async () => {
  const callOrder: string[] = [];
  const scheduler = new ExecutionScheduler<TestExecutionUnit>({
    executor: {
      async executeUnit({ executionUnit }) {
        callOrder.push(executionUnit.id);
        return {
          unitId: executionUnit.id,
          status: "completed" as const,
          summary: `Completed ${executionUnit.id}`,
          changedFiles: [executionUnit.title],
          validations: [],
        };
      },
    },
  });

  const result = await scheduler.execute({ executionUnits: createUnits() });

  assert.equal(result.status, "completed");
  assert.deepEqual(callOrder.slice(0, 2).sort(), ["unit-a", "unit-b"]);
  assert.equal(callOrder[2], "unit-c");
});

test("scheduler stops after a failed batch and reports remaining dependent units", async () => {
  const scheduler = new ExecutionScheduler<TestExecutionUnit>({
    executor: {
      async executeUnit({ executionUnit }) {
        if (executionUnit.id === "unit-b") {
          return {
            unitId: executionUnit.id,
            status: "failed" as const,
            summary: "Unit B failed",
            blockers: ["validation failed"],
            validations: [],
          };
        }

        return {
          unitId: executionUnit.id,
          status: "completed" as const,
          summary: `Completed ${executionUnit.id}`,
          changedFiles: [executionUnit.title],
          validations: [],
        };
      },
    },
  });

  const result = await scheduler.execute({ executionUnits: createUnits() });

  assert.equal(result.status, "failed");
  assert.deepEqual(
    result.layers.map((layer) => layer.unitIds),
    [["unit-a", "unit-b"]],
  );
  assert.deepEqual(result.remainingUnitIds, ["unit-c"]);
  assert.equal(result.layers[0]?.results[1]?.status, "failed");
});

test("buildExecutionLayers rejects dependency cycles", () => {
  assert.throws(
    () =>
      buildExecutionLayers([
        { id: "unit-a", title: "Unit A", dependsOn: ["unit-b"] },
        { id: "unit-b", title: "Unit B", dependsOn: ["unit-a"] },
      ]),
    /dependency cycle or missing prerequisite/i,
  );
});
