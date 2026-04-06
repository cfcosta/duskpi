import test from "node:test";
import assert from "node:assert/strict";
import {
  TEST_AUDIT_PLAN_JSON_BLOCK_TAG,
  orderExecutionUnits,
  parseTaggedTestAuditPlan,
  type ApprovedTestAuditPlan,
} from "./contract";

function wrapTaggedPlan(payload: unknown): string {
  return [
    "Intro text before the structured plan.",
    `\`\`\`${TEST_AUDIT_PLAN_JSON_BLOCK_TAG}`,
    JSON.stringify(payload, null, 2),
    "\`\`\`",
    "Trailing notes after the structured plan.",
  ].join("\n");
}

function createPlan(overrides?: Partial<ApprovedTestAuditPlan>): ApprovedTestAuditPlan {
  return {
    version: 1,
    kind: "approved_test_audit_plan",
    summary: "Improve verified test gaps through explicit execution units.",
    executionUnits: [
      {
        id: "rewrite-tautological-parser-test",
        title: "Rewrite tautological parser test",
        objective:
          "Replace the false-confidence parser test with one that fails on a realistic fault.",
        targets: ["src/parser.test.ts"],
        validations: ["bun test extensions/test-audit/index.test.ts"],
        dependsOn: [],
      },
    ],
    ...overrides,
  };
}

test("parseTaggedTestAuditPlan parses a valid approved test-audit plan", () => {
  const text = wrapTaggedPlan(
    createPlan({
      executionUnits: [
        {
          id: "rewrite-tautological-parser-test",
          title: "Rewrite tautological parser test",
          objective:
            "Replace the false-confidence parser test with one that fails on a realistic fault.",
          targets: ["src/parser.test.ts", "src/parser.ts"],
          validations: ["bun test extensions/test-audit/index.test.ts"],
          dependsOn: [],
        },
        {
          id: "add-error-path-coverage",
          title: "Add error-path coverage",
          objective:
            "Add a missing regression test for parser error propagation after the rewrite lands.",
          targets: ["src/parser.test.ts"],
          validations: ["bun test extensions/test-audit/index.test.ts"],
          dependsOn: ["rewrite-tautological-parser-test"],
        },
      ],
    }),
  );

  const result = parseTaggedTestAuditPlan(text);

  assert.equal(result.ok, true);
  if (!result.ok) {
    return;
  }

  assert.equal(
    result.value.summary,
    "Improve verified test gaps through explicit execution units.",
  );
  assert.equal(result.value.executionUnits.length, 2);
  assert.deepEqual(result.value.executionUnits[1]?.dependsOn, ["rewrite-tautological-parser-test"]);
  assert.match(result.rawJson, /approved_test_audit_plan/);
});

test("parseTaggedTestAuditPlan rejects malformed tagged JSON payloads", () => {
  const text = [
    `\`\`\`${TEST_AUDIT_PLAN_JSON_BLOCK_TAG}`,
    '{"version":1,"kind":"approved_test_audit_plan","summary":"broken","executionUnits":[',
    "\`\`\`",
  ].join("\n");

  const result = parseTaggedTestAuditPlan(text);

  assert.equal(result.ok, false);
  if (result.ok) {
    return;
  }

  assert.equal(result.code, "malformed_json");
  assert.match(result.message, /json|unterminated|unexpected/i);
});

test("parseTaggedTestAuditPlan rejects plans with missing required fields", () => {
  const plan = createPlan({
    executionUnits: [
      {
        id: "rewrite-tautological-parser-test",
        title: "Rewrite tautological parser test",
        objective: "",
        targets: ["src/parser.test.ts"],
        validations: ["bun test extensions/test-audit/index.test.ts"],
        dependsOn: [],
      },
    ],
  });

  const result = parseTaggedTestAuditPlan(wrapTaggedPlan(plan));

  assert.equal(result.ok, false);
  if (result.ok) {
    return;
  }

  assert.equal(result.code, "invalid_schema");
  assert.match(result.message, /objective must be a non-empty string/i);
});

test("orderExecutionUnits preserves dependency order", () => {
  const ordered = orderExecutionUnits(
    createPlan({
      executionUnits: [
        {
          id: "add-error-path-coverage",
          title: "Add error-path coverage",
          objective: "Add a missing regression test for parser error propagation.",
          targets: ["src/parser.test.ts"],
          validations: ["bun test extensions/test-audit/index.test.ts"],
          dependsOn: ["rewrite-tautological-parser-test"],
        },
        {
          id: "rewrite-tautological-parser-test",
          title: "Rewrite tautological parser test",
          objective:
            "Replace the false-confidence parser test with one that fails on a realistic fault.",
          targets: ["src/parser.test.ts"],
          validations: ["bun test extensions/test-audit/index.test.ts"],
          dependsOn: [],
        },
      ],
    }),
  );

  assert.deepEqual(
    ordered.map((unit) => unit.id),
    ["rewrite-tautological-parser-test", "add-error-path-coverage"],
  );
});

test("parseTaggedTestAuditPlan rejects unknown dependencies", () => {
  const plan = createPlan({
    executionUnits: [
      {
        id: "rewrite-tautological-parser-test",
        title: "Rewrite tautological parser test",
        objective:
          "Replace the false-confidence parser test with one that fails on a realistic fault.",
        targets: ["src/parser.test.ts"],
        validations: ["bun test extensions/test-audit/index.test.ts"],
        dependsOn: ["missing-unit"],
      },
    ],
  });

  const result = parseTaggedTestAuditPlan(wrapTaggedPlan(plan));

  assert.equal(result.ok, false);
  if (result.ok) {
    return;
  }

  assert.equal(result.code, "invalid_schema");
  assert.match(result.message, /depends on unknown unit 'missing-unit'/i);
});
