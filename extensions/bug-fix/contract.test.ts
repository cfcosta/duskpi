import test from "node:test";
import assert from "node:assert/strict";
import {
  BUG_FIX_PLAN_JSON_BLOCK_TAG,
  orderExecutionUnits,
  parseTaggedBugFixPlan,
  type ApprovedBugFixPlan,
} from "./contract";

function wrapTaggedPlan(payload: unknown): string {
  return [
    "Intro text before the structured plan.",
    `\`\`\`${BUG_FIX_PLAN_JSON_BLOCK_TAG}`,
    JSON.stringify(payload, null, 2),
    "\`\`\`",
    "Trailing notes after the structured plan.",
  ].join("\n");
}

function createPlan(overrides?: Partial<ApprovedBugFixPlan>): ApprovedBugFixPlan {
  return {
    version: 1,
    kind: "approved_bug_fix_plan",
    summary: "Fix verified bugs through explicit execution units.",
    executionUnits: [
      {
        id: "null-guard",
        title: "Guard null dereference",
        objective: "Prevent the crash when the parser receives a null token.",
        targets: ["src/parser.ts"],
        validations: ["bun test extensions/bug-fix/index.test.ts"],
        dependsOn: [],
      },
    ],
    ...overrides,
  };
}

test("parseTaggedBugFixPlan parses a valid approved bug-fix plan", () => {
  const text = wrapTaggedPlan(
    createPlan({
      executionUnits: [
        {
          id: "null-guard",
          title: "Guard null dereference",
          objective: "Prevent the crash when the parser receives a null token.",
          targets: ["src/parser.ts", "src/parser.test.ts"],
          validations: ["bun test extensions/bug-fix/index.test.ts"],
          dependsOn: [],
        },
        {
          id: "error-copy",
          title: "Clarify validation error",
          objective: "Preserve the fix while improving the user-facing validation message.",
          targets: ["src/errors.ts"],
          validations: ["bun test extensions/bug-fix/index.test.ts"],
          dependsOn: ["null-guard"],
        },
      ],
    }),
  );

  const result = parseTaggedBugFixPlan(text);

  assert.equal(result.ok, true);
  if (!result.ok) {
    return;
  }

  assert.equal(result.value.summary, "Fix verified bugs through explicit execution units.");
  assert.equal(result.value.executionUnits.length, 2);
  assert.deepEqual(result.value.executionUnits[1]?.dependsOn, ["null-guard"]);
  assert.match(result.rawJson, /approved_bug_fix_plan/);
});

test("parseTaggedBugFixPlan rejects malformed tagged JSON payloads", () => {
  const text = [
    `\`\`\`${BUG_FIX_PLAN_JSON_BLOCK_TAG}`,
    '{"version":1,"kind":"approved_bug_fix_plan","summary":"broken","executionUnits":[',
    "\`\`\`",
  ].join("\n");

  const result = parseTaggedBugFixPlan(text);

  assert.equal(result.ok, false);
  if (result.ok) {
    return;
  }

  assert.equal(result.code, "malformed_json");
  assert.match(result.message, /json|unterminated|unexpected/i);
});

test("parseTaggedBugFixPlan rejects plans with missing required fields", () => {
  const plan = createPlan({
    executionUnits: [
      {
        id: "null-guard",
        title: "Guard null dereference",
        objective: "",
        targets: ["src/parser.ts"],
        validations: ["bun test extensions/bug-fix/index.test.ts"],
        dependsOn: [],
      },
    ],
  });

  const result = parseTaggedBugFixPlan(wrapTaggedPlan(plan));

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
          id: "error-copy",
          title: "Clarify validation error",
          objective: "Improve the user-facing validation message.",
          targets: ["src/errors.ts"],
          validations: ["bun test extensions/bug-fix/index.test.ts"],
          dependsOn: ["null-guard"],
        },
        {
          id: "null-guard",
          title: "Guard null dereference",
          objective: "Prevent the crash when the parser receives a null token.",
          targets: ["src/parser.ts"],
          validations: ["bun test extensions/bug-fix/index.test.ts"],
          dependsOn: [],
        },
      ],
    }),
  );

  assert.deepEqual(
    ordered.map((unit) => unit.id),
    ["null-guard", "error-copy"],
  );
});

test("parseTaggedBugFixPlan rejects unknown dependencies", () => {
  const plan = createPlan({
    executionUnits: [
      {
        id: "null-guard",
        title: "Guard null dereference",
        objective: "Prevent the crash when the parser receives a null token.",
        targets: ["src/parser.ts"],
        validations: ["bun test extensions/bug-fix/index.test.ts"],
        dependsOn: ["missing-unit"],
      },
    ],
  });

  const result = parseTaggedBugFixPlan(wrapTaggedPlan(plan));

  assert.equal(result.ok, false);
  if (result.ok) {
    return;
  }

  assert.equal(result.code, "invalid_schema");
  assert.match(result.message, /depends on unknown unit 'missing-unit'/i);
});
