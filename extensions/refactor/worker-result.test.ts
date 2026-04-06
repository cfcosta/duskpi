import test from "node:test";
import assert from "node:assert/strict";
import { REFACTOR_WORKER_RESULT_JSON_BLOCK_TAG, parseTaggedWorkerResult } from "./worker-result";

function wrapTaggedWorkerResult(payload: unknown): string {
  return [
    "Worker execution summary",
    `\`\`\`${REFACTOR_WORKER_RESULT_JSON_BLOCK_TAG}`,
    JSON.stringify(payload, null, 2),
    "\`\`\`",
  ].join("\n");
}

test("parseTaggedWorkerResult parses a valid completed worker result", () => {
  const text = wrapTaggedWorkerResult({
    version: 1,
    kind: "refactor_worker_result",
    unitId: "guided-shell",
    status: "completed",
    summary: "Moved refactor planning to GuidedWorkflow.",
    changedFiles: ["extensions/refactor/workflow.ts", "extensions/refactor/index.ts"],
    validations: [
      {
        command: "bun test extensions/refactor/index.test.ts",
        outcome: "passed",
        details: "All targeted tests passed.",
      },
    ],
  });

  const result = parseTaggedWorkerResult(text);

  assert.equal(result.ok, true);
  if (!result.ok) {
    return;
  }

  assert.equal(result.value.status, "completed");
  assert.deepEqual(result.value.changedFiles, [
    "extensions/refactor/workflow.ts",
    "extensions/refactor/index.ts",
  ]);
  assert.equal(result.value.validations[0]?.outcome, "passed");
});

test("parseTaggedWorkerResult rejects malformed tagged JSON payloads", () => {
  const text = [
    `\`\`\`${REFACTOR_WORKER_RESULT_JSON_BLOCK_TAG}`,
    '{"version":1,"kind":"refactor_worker_result","unitId":"guided-shell"',
    "\`\`\`",
  ].join("\n");

  const result = parseTaggedWorkerResult(text);

  assert.equal(result.ok, false);
  if (result.ok) {
    return;
  }

  assert.equal(result.code, "malformed_json");
  assert.match(result.message, /json|unterminated|unexpected/i);
});

test("parseTaggedWorkerResult requires changedFiles for completed results", () => {
  const result = parseTaggedWorkerResult(
    wrapTaggedWorkerResult({
      version: 1,
      kind: "refactor_worker_result",
      unitId: "guided-shell",
      status: "completed",
      summary: "Moved refactor planning to GuidedWorkflow.",
      validations: [
        {
          command: "bun test extensions/refactor/index.test.ts",
          outcome: "passed",
        },
      ],
    }),
  );

  assert.equal(result.ok, false);
  if (result.ok) {
    return;
  }

  assert.equal(result.code, "invalid_schema");
  assert.match(result.message, /changedFiles must be an array/i);
});

test("parseTaggedWorkerResult requires blockers for failed results", () => {
  const result = parseTaggedWorkerResult(
    wrapTaggedWorkerResult({
      version: 1,
      kind: "refactor_worker_result",
      unitId: "guided-shell",
      status: "failed",
      summary: "Validation failed after the refactor.",
      validations: [
        {
          command: "bun test extensions/refactor/index.test.ts",
          outcome: "failed",
        },
      ],
    }),
  );

  assert.equal(result.ok, false);
  if (result.ok) {
    return;
  }

  assert.equal(result.code, "invalid_schema");
  assert.match(result.message, /blockers must be an array/i);
});
