export const TEST_AUDIT_PLAN_JSON_BLOCK_TAG = "test-audit-plan-json";
export const TEST_AUDIT_PLAN_CONTRACT_VERSION = 1;

export interface TestAuditExecutionUnit {
  id: string;
  title: string;
  objective: string;
  targets: string[];
  validations: string[];
  dependsOn: string[];
}

export interface ApprovedTestAuditPlan {
  version: 1;
  kind: "approved_test_audit_plan";
  summary: string;
  executionUnits: TestAuditExecutionUnit[];
}

export function orderExecutionUnits(plan: ApprovedTestAuditPlan): TestAuditExecutionUnit[] {
  const remainingDependencies = new Map<string, Set<string>>();
  const dependents = new Map<string, string[]>();
  const originalIndexes = new Map<string, number>();

  for (const [index, executionUnit] of plan.executionUnits.entries()) {
    remainingDependencies.set(executionUnit.id, new Set(executionUnit.dependsOn));
    dependents.set(executionUnit.id, []);
    originalIndexes.set(executionUnit.id, index);
  }

  for (const executionUnit of plan.executionUnits) {
    for (const dependencyId of executionUnit.dependsOn) {
      dependents.get(dependencyId)?.push(executionUnit.id);
    }
  }

  const ready = plan.executionUnits
    .filter((executionUnit) => executionUnit.dependsOn.length === 0)
    .map((executionUnit) => executionUnit.id)
    .sort((left, right) => {
      return (originalIndexes.get(left) ?? 0) - (originalIndexes.get(right) ?? 0);
    });

  const orderedIds: string[] = [];
  while (ready.length > 0) {
    const nextId = ready.shift();
    if (!nextId) {
      break;
    }

    orderedIds.push(nextId);

    for (const dependentId of dependents.get(nextId) ?? []) {
      const dependencies = remainingDependencies.get(dependentId);
      if (!dependencies) {
        continue;
      }

      dependencies.delete(nextId);
      if (
        dependencies.size === 0 &&
        !orderedIds.includes(dependentId) &&
        !ready.includes(dependentId)
      ) {
        ready.push(dependentId);
        ready.sort((left, right) => {
          return (originalIndexes.get(left) ?? 0) - (originalIndexes.get(right) ?? 0);
        });
      }
    }
  }

  if (orderedIds.length !== plan.executionUnits.length) {
    return [...plan.executionUnits];
  }

  return orderedIds
    .map((id) => plan.executionUnits.find((executionUnit) => executionUnit.id === id))
    .filter((executionUnit): executionUnit is TestAuditExecutionUnit => Boolean(executionUnit));
}

export type TestAuditPlanParseErrorCode = "missing_block" | "malformed_json" | "invalid_schema";

export interface TestAuditPlanParseSuccess {
  ok: true;
  value: ApprovedTestAuditPlan;
  rawJson: string;
}

export interface TestAuditPlanParseError {
  ok: false;
  code: TestAuditPlanParseErrorCode;
  message: string;
}

export type TestAuditPlanParseResult = TestAuditPlanParseSuccess | TestAuditPlanParseError;

type ValidationResult<T> = { ok: true; value: T } | TestAuditPlanParseError;

export function extractTaggedJsonBlock(
  text: string,
  tag: string = TEST_AUDIT_PLAN_JSON_BLOCK_TAG,
): string | undefined {
  const escapedTag = escapeRegExp(tag);
  const pattern = new RegExp("```" + `(?:${escapedTag})\\s*\\n([\\s\\S]*?)\\n` + "```", "i");
  const match = text.match(pattern);
  const block = match?.[1]?.trim();
  return block && block.length > 0 ? block : undefined;
}

export function parseTaggedTestAuditPlan(text: string): TestAuditPlanParseResult {
  const rawJson = extractTaggedJsonBlock(text);
  if (!rawJson) {
    return {
      ok: false,
      code: "missing_block",
      message: `Missing tagged JSON block \`${TEST_AUDIT_PLAN_JSON_BLOCK_TAG}\`.`,
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawJson);
  } catch (error) {
    return {
      ok: false,
      code: "malformed_json",
      message: error instanceof Error ? error.message : "Malformed JSON in tagged block.",
    };
  }

  const validated = validateApprovedTestAuditPlan(parsed);
  if (!validated.ok) {
    return validated;
  }

  return {
    ok: true,
    value: validated.value,
    rawJson,
  };
}

export function validateApprovedTestAuditPlan(
  value: unknown,
): ValidationResult<ApprovedTestAuditPlan> {
  if (!isRecord(value)) {
    return invalidSchema("Tagged JSON block must be an object.");
  }

  if (value.version !== TEST_AUDIT_PLAN_CONTRACT_VERSION) {
    return invalidSchema(`Test-audit plan version must be ${TEST_AUDIT_PLAN_CONTRACT_VERSION}.`);
  }

  if (value.kind !== "approved_test_audit_plan") {
    return invalidSchema("Test-audit plan kind must be 'approved_test_audit_plan'.");
  }

  if (!isNonEmptyString(value.summary)) {
    return invalidSchema("Test-audit plan summary must be a non-empty string.");
  }

  if (!Array.isArray(value.executionUnits) || value.executionUnits.length === 0) {
    return invalidSchema("Test-audit plan executionUnits must be a non-empty array.");
  }

  const executionUnits: TestAuditExecutionUnit[] = [];
  const executionUnitIds = new Set<string>();

  for (const [index, rawUnit] of value.executionUnits.entries()) {
    if (!isRecord(rawUnit)) {
      return invalidSchema(`Execution unit ${index + 1} must be an object.`);
    }

    const id = readRequiredString(rawUnit.id, `Execution unit ${index + 1} id`);
    if (!id.ok) {
      return id;
    }

    if (executionUnitIds.has(id.value)) {
      return invalidSchema(`Execution unit id '${id.value}' must be unique.`);
    }

    const title = readRequiredString(rawUnit.title, `Execution unit '${id.value}' title`);
    if (!title.ok) {
      return title;
    }

    const objective = readRequiredString(
      rawUnit.objective,
      `Execution unit '${id.value}' objective`,
    );
    if (!objective.ok) {
      return objective;
    }

    const targets = readStringArray(rawUnit.targets, `Execution unit '${id.value}' targets`, true);
    if (!targets.ok) {
      return targets;
    }

    const validations = readStringArray(
      rawUnit.validations,
      `Execution unit '${id.value}' validations`,
      true,
    );
    if (!validations.ok) {
      return validations;
    }

    const dependsOn = readStringArray(
      rawUnit.dependsOn,
      `Execution unit '${id.value}' dependsOn`,
      false,
    );
    if (!dependsOn.ok) {
      return dependsOn;
    }

    if (dependsOn.value.includes(id.value)) {
      return invalidSchema(`Execution unit '${id.value}' cannot depend on itself.`);
    }

    executionUnitIds.add(id.value);
    executionUnits.push({
      id: id.value,
      title: title.value,
      objective: objective.value,
      targets: targets.value,
      validations: validations.value,
      dependsOn: dependsOn.value,
    });
  }

  for (const executionUnit of executionUnits) {
    for (const dependencyId of executionUnit.dependsOn) {
      if (!executionUnitIds.has(dependencyId)) {
        return invalidSchema(
          `Execution unit '${executionUnit.id}' depends on unknown unit '${dependencyId}'.`,
        );
      }
    }
  }

  return {
    ok: true,
    value: {
      version: TEST_AUDIT_PLAN_CONTRACT_VERSION,
      kind: "approved_test_audit_plan",
      summary: value.summary,
      executionUnits,
    },
  };
}

function readRequiredString(value: unknown, fieldName: string): ValidationResult<string> {
  if (!isNonEmptyString(value)) {
    return invalidSchema(`${fieldName} must be a non-empty string.`);
  }

  return { ok: true, value };
}

function readStringArray(
  value: unknown,
  fieldName: string,
  requireNonEmpty: boolean,
): ValidationResult<string[]> {
  if (!Array.isArray(value)) {
    return invalidSchema(`${fieldName} must be an array of non-empty strings.`);
  }

  const items: string[] = [];
  for (const [index, item] of value.entries()) {
    if (!isNonEmptyString(item)) {
      return invalidSchema(`${fieldName}[${index}] must be a non-empty string.`);
    }

    if (items.includes(item)) {
      return invalidSchema(`${fieldName} must not contain duplicate entries.`);
    }

    items.push(item);
  }

  if (requireNonEmpty && items.length === 0) {
    return invalidSchema(`${fieldName} must not be empty.`);
  }

  return { ok: true, value: items };
}

function invalidSchema(message: string): TestAuditPlanParseError {
  return {
    ok: false,
    code: "invalid_schema",
    message,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
