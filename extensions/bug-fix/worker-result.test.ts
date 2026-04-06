import test from "node:test";
import assert from "node:assert/strict";
import { BUG_FIX_WORKER_RESULT_JSON_BLOCK_TAG, parseTaggedWorkerResult } from "./worker-result";

function wrapTaggedWorkerResult(payload: unknown): string {
  return [
    "Worker execution summary",
    `\`\`\`${BUG_FIX_WORKER_RESULT_JSON_BLOCK_TAG}`,
    JSON.stringify(payload, null, 2),
    "\`\`\`",
  ].join("\n");
}

test("parseTaggedWorkerResult parses a valid completed worker result", () => {
  const text = wrapTaggedWorkerResult({
    version: 1,
    kind: "bug_fix_worker_result",
    unitId: "null-guard",
    status: "completed",
    summary: "Added a null guard before dereferencing the parser token.",
    changedFiles: ["src/parser.ts", "src/parser.test.ts"],
    validations: [
      {
        command: "bun test extensions/bug-fix/index.test.ts",
        outcome: "passed",
        details: "Targeted bug-fix tests passed.",
      },
    ],
  });

  const result = parseTaggedWorkerResult(text);

  assert.equal(result.ok, true);
  if (!result.ok) {
    return;
  }

  assert.equal(result.value.status, "completed");
  assert.deepEqual(result.value.changedFiles, ["src/parser.ts", "src/parser.test.ts"]);
  assert.equal(result.value.validations[0]?.outcome, "passed");
});

test("parseTaggedWorkerResult rejects malformed tagged JSON payloads", () => {
  const text = [
    `\`\`\`${BUG_FIX_WORKER_RESULT_JSON_BLOCK_TAG}`,
    '{"version":1,"kind":"bug_fix_worker_result","unitId":"null-guard"',
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
      kind: "bug_fix_worker_result",
      unitId: "null-guard",
      status: "completed",
      summary: "Added a null guard before dereferencing the parser token.",
      validations: [
        {
          command: "bun test extensions/bug-fix/index.test.ts",
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
      kind: "bug_fix_worker_result",
      unitId: "null-guard",
      status: "failed",
      summary: "Validation failed after applying the parser guard.",
      validations: [
        {
          command: "bun test extensions/bug-fix/index.test.ts",
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
