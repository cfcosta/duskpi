import test from "node:test";
import assert from "node:assert/strict";
import {
  REFACTOR_PLAN_JSON_BLOCK_TAG,
  parseTaggedRefactorPlan,
  type ApprovedRefactorPlan,
} from "./contract";

function wrapTaggedPlan(payload: unknown): string {
  return [
    "Intro text before the structured plan.",
    `\`\`\`${REFACTOR_PLAN_JSON_BLOCK_TAG}`,
    JSON.stringify(payload, null, 2),
    "\`\`\`",
    "Trailing notes after the structured plan.",
  ].join("\n");
}

function createPlan(overrides?: Partial<ApprovedRefactorPlan>): ApprovedRefactorPlan {
  return {
    version: 1,
    kind: "approved_refactor_plan",
    summary: "Refactor the workflow around explicit execution units.",
    executionUnits: [
      {
        id: "contract-core",
        title: "Add contract parser",
        objective: "Introduce a machine-checkable refactor plan contract.",
        targets: ["extensions/refactor/contract.ts"],
        validations: ["bun test extensions/refactor/contract.test.ts"],
        dependsOn: [],
      },
    ],
    ...overrides,
  };
}

test("parseTaggedRefactorPlan parses a valid approved refactor plan", () => {
  const text = wrapTaggedPlan(
    createPlan({
      executionUnits: [
        {
          id: "contract-core",
          title: "Add contract parser",
          objective: "Introduce a machine-checkable refactor plan contract.",
          targets: ["extensions/refactor/contract.ts", "extensions/refactor/contract.test.ts"],
          validations: ["bun test extensions/refactor/contract.test.ts"],
          dependsOn: [],
        },
        {
          id: "prompt-wiring",
          title: "Wire planning prompts",
          objective: "Make the mapper, skeptic, and arbiter emit the structured contract.",
          targets: ["extensions/refactor/prompting.ts"],
          validations: ["bun test extensions/refactor/index.test.ts"],
          dependsOn: ["contract-core"],
        },
      ],
    }),
  );

  const result = parseTaggedRefactorPlan(text);

  assert.equal(result.ok, true);
  if (!result.ok) {
    return;
  }

  assert.equal(result.value.summary, "Refactor the workflow around explicit execution units.");
  assert.equal(result.value.executionUnits.length, 2);
  assert.deepEqual(result.value.executionUnits[1]?.dependsOn, ["contract-core"]);
  assert.match(result.rawJson, /approved_refactor_plan/);
});

test("parseTaggedRefactorPlan rejects malformed tagged JSON payloads", () => {
  const text = [
    "\`\`\`refactor-plan-json",
    '{"version":1,"kind":"approved_refactor_plan","summary":"broken","executionUnits":[',
    "\`\`\`",
  ].join("\n");

  const result = parseTaggedRefactorPlan(text);

  assert.deepEqual(result.ok, false);
  if (result.ok) {
    return;
  }

  assert.equal(result.code, "malformed_json");
  assert.match(result.message, /json|unterminated|unexpected/i);
});

test("parseTaggedRefactorPlan rejects plans with missing required fields", () => {
  const plan = createPlan({
    executionUnits: [
      {
        id: "contract-core",
        title: "Add contract parser",
        objective: "",
        targets: ["extensions/refactor/contract.ts"],
        validations: ["bun test extensions/refactor/contract.test.ts"],
        dependsOn: [],
      },
    ],
  });

  const result = parseTaggedRefactorPlan(wrapTaggedPlan(plan));

  assert.deepEqual(result.ok, false);
  if (result.ok) {
    return;
  }

  assert.equal(result.code, "invalid_schema");
  assert.match(result.message, /objective must be a non-empty string/i);
});

test("parseTaggedRefactorPlan preserves dependency metadata", () => {
  const plan = createPlan({
    executionUnits: [
      {
        id: "contract-core",
        title: "Add contract parser",
        objective: "Introduce the local contract.",
        targets: ["extensions/refactor/contract.ts"],
        validations: ["bun test extensions/refactor/contract.test.ts"],
        dependsOn: [],
      },
      {
        id: "guided-shell",
        title: "Adopt GuidedWorkflow",
        objective: "Move /refactor planning to GuidedWorkflow.",
        targets: ["extensions/refactor/workflow.ts"],
        validations: ["bun test extensions/refactor/index.test.ts"],
        dependsOn: ["contract-core"],
      },
    ],
  });

  const result = parseTaggedRefactorPlan(wrapTaggedPlan(plan));

  assert.equal(result.ok, true);
  if (!result.ok) {
    return;
  }

  const guidedShellUnit = result.value.executionUnits.find((unit) => unit.id === "guided-shell");
  assert.deepEqual(guidedShellUnit?.dependsOn, ["contract-core"]);
});

test("parseTaggedRefactorPlan rejects unknown dependencies", () => {
  const plan = createPlan({
    executionUnits: [
      {
        id: "guided-shell",
        title: "Adopt GuidedWorkflow",
        objective: "Move /refactor planning to GuidedWorkflow.",
        targets: ["extensions/refactor/workflow.ts"],
        validations: ["bun test extensions/refactor/index.test.ts"],
        dependsOn: ["missing-unit"],
      },
    ],
  });

  const result = parseTaggedRefactorPlan(wrapTaggedPlan(plan));

  assert.deepEqual(result.ok, false);
  if (result.ok) {
    return;
  }

  assert.equal(result.code, "invalid_schema");
  assert.match(result.message, /depends on unknown unit 'missing-unit'/i);
});
