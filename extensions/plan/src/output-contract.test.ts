import { expect, test } from "bun:test";
import {
  PLAN_OUTPUT_JSON_BLOCK_TAG,
  parseTaggedExecutionResultContract,
  parseTaggedOutputContract,
  parseTaggedPlanContract,
  parseTaggedReviewContract,
  type StructuredExecutionResultOutput,
  type StructuredPlanOutput,
  type StructuredReviewCompleteOutput,
  type StructuredReviewContinueOutput,
} from "./output-contract";

function buildTaggedJsonBlock(payload: unknown): string {
  return [
    `\`\`\`${PLAN_OUTPUT_JSON_BLOCK_TAG}`,
    JSON.stringify(payload, null, 2),
    "```",
  ].join("\n");
}

function buildPlanPayload(): StructuredPlanOutput {
  return {
    version: 2,
    kind: "plan" as const,
    taskGeometry: "shared_artifact" as const,
    coordinationPattern: "checkpointed_execution" as const,
    assumptions: ["Existing plan-mode UI can render compact metadata."],
    escalationTriggers: ["Checkpoint validation fails after integration."],
    checkpoints: [
      {
        id: "checkpoint-1",
        title: "Review structured contract changes",
        kind: "checkpoint" as const,
        step: 1,
        why: "Lock the runtime contract before downstream workflow changes.",
      },
      {
        id: "integration-1",
        title: "Integrate execution-result parsing",
        kind: "integration" as const,
        step: 2,
        why: "Structured execution results must line up with guided workflow state.",
      },
    ],
    steps: [
      {
        step: 1,
        kind: "inspect" as const,
        objective: "Define the runtime v2 contract in the parser surface.",
        targets: ["extensions/plan/src/output-contract.ts"],
        validation: ["bun test src/output-contract.test.ts"],
        risks: ["Weak validation would make downstream workflow logic brittle."],
        dependsOn: [],
        checkpointIds: ["checkpoint-1"],
      },
      {
        step: 2,
        kind: "integrate" as const,
        objective: "Wire execution-result parsing into workflow-core.",
        targets: ["packages/workflow-core/src/guided-workflow.ts"],
        validation: ["bun test ../packages/workflow-core/src/guided-workflow.test.ts"],
        risks: ["Autoplan and normal plan flows must share the same result shape."],
        dependsOn: [1],
        checkpointIds: ["integration-1"],
      },
    ],
  };
}

test("parseTaggedPlanContract parses a valid v2 plan payload", () => {
  const payload = buildPlanPayload();

  const result = parseTaggedPlanContract(buildTaggedJsonBlock(payload));

  expect(result).toEqual({
    ok: true,
    rawJson: JSON.stringify(payload, null, 2),
    value: payload,
  });
});

test("parseTaggedReviewContract parses a valid v2 continue review payload", () => {
  const payload: StructuredReviewContinueOutput = {
    version: 2,
    kind: "review",
    status: "continue",
    summary: "One integration task remains after the parser landing.",
    taskGeometry: "shared_artifact" as const,
    coordinationPattern: "checkpointed_execution" as const,
    assumptions: ["The contract step has already landed."],
    checkpoints: [
      {
        id: "integration-1",
        title: "Integrate execution-result parsing",
        kind: "integration" as const,
        step: 1,
        why: "Keep guided workflow state aligned with the new contract.",
      },
    ],
    steps: [
      {
        step: 1,
        kind: "integrate" as const,
        objective: "Adopt structured execution-result parsing in guided workflow.",
        targets: ["packages/workflow-core/src/guided-workflow.ts"],
        validation: ["bun test ../packages/workflow-core/src/guided-workflow.test.ts"],
        risks: ["Execution state must stay consistent across retries."],
        dependsOn: [],
        checkpointIds: ["integration-1"],
      },
    ],
  };

  const result = parseTaggedReviewContract(buildTaggedJsonBlock(payload));

  expect(result).toEqual({
    ok: true,
    rawJson: JSON.stringify(payload, null, 2),
    value: payload,
  });
});

test("parseTaggedReviewContract parses a valid v2 complete review payload", () => {
  const payload: StructuredReviewCompleteOutput = {
    version: 2,
    kind: "review",
    status: "complete",
    summary: "The approved backlog is complete.",
  };

  const result = parseTaggedReviewContract(buildTaggedJsonBlock(payload));

  expect(result).toEqual({
    ok: true,
    rawJson: JSON.stringify(payload, null, 2),
    value: payload,
  });
});

test("parseTaggedExecutionResultContract parses a valid v2 execution result payload", () => {
  const payload: StructuredExecutionResultOutput = {
    version: 2,
    kind: "execution_result",
    scope: "autoplan",
    outerStep: 3,
    step: 2,
    status: "done" as const,
    summary: "Integrated structured execution-result parsing for the current subtask.",
    changedTargets: ["packages/workflow-core/src/guided-workflow.ts"],
    validationsRun: ["bun test ../packages/workflow-core/src/guided-workflow.test.ts"],
    checkpointsReached: ["integration-1"],
  };

  const result = parseTaggedExecutionResultContract(buildTaggedJsonBlock(payload));

  expect(result).toEqual({
    ok: true,
    rawJson: JSON.stringify(payload, null, 2),
    value: payload,
  });
});

test("parseTaggedOutputContract rejects responses without the tagged JSON block", () => {
  expect(parseTaggedOutputContract("1) Task understanding\n2) Codebase findings")).toEqual({
    ok: false,
    code: "missing_block",
    message: "Missing tagged JSON block `pi-plan-json`.",
  });
});

test("parseTaggedOutputContract rejects malformed tagged JSON blocks", () => {
  const result = parseTaggedOutputContract([`\`\`\`${PLAN_OUTPUT_JSON_BLOCK_TAG}`, '{"version": 2,', "```"].join("\n"));

  expect(result.ok).toBe(false);
  if (result.ok) {
    return;
  }

  expect(result.code).toBe("malformed_json");
});

test("parseTaggedOutputContract rejects unsupported kinds", () => {
  const result = parseTaggedOutputContract(
    buildTaggedJsonBlock({
      version: 2,
      kind: "mystery",
    }),
  );

  expect(result).toEqual({
    ok: false,
    code: "invalid_schema",
    message: "Tagged JSON block must include kind 'plan', 'review', or 'execution_result'.",
  });
});

test("parseTaggedPlanContract rejects invalid-schema fields in v2 payloads", () => {
  const payload = buildPlanPayload();
  payload.steps[0].checkpointIds = ["missing-checkpoint"];

  const result = parseTaggedPlanContract(buildTaggedJsonBlock(payload));

  expect(result).toEqual({
    ok: false,
    code: "invalid_schema",
    message: "Step 1 checkpointIds must reference existing checkpoints.",
  });
});
