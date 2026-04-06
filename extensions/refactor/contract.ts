export const REFACTOR_PLAN_JSON_BLOCK_TAG = "refactor-plan-json";
export const REFACTOR_PLAN_CONTRACT_VERSION = 1;

export interface RefactorExecutionUnit {
  id: string;
  title: string;
  objective: string;
  targets: string[];
  validations: string[];
  dependsOn: string[];
}

export interface ApprovedRefactorPlan {
  version: 1;
  kind: "approved_refactor_plan";
  summary: string;
  executionUnits: RefactorExecutionUnit[];
}

export type RefactorPlanParseErrorCode = "missing_block" | "malformed_json" | "invalid_schema";

export interface RefactorPlanParseSuccess {
  ok: true;
  value: ApprovedRefactorPlan;
  rawJson: string;
}

export interface RefactorPlanParseError {
  ok: false;
  code: RefactorPlanParseErrorCode;
  message: string;
}

export type RefactorPlanParseResult = RefactorPlanParseSuccess | RefactorPlanParseError;

type ValidationResult<T> = { ok: true; value: T } | RefactorPlanParseError;

export function extractTaggedJsonBlock(
  text: string,
  tag: string = REFACTOR_PLAN_JSON_BLOCK_TAG,
): string | undefined {
  const escapedTag = escapeRegExp(tag);
  const pattern = new RegExp("```" + `(?:${escapedTag})\\s*\\n([\\s\\S]*?)\\n` + "```", "i");
  const match = text.match(pattern);
  const block = match?.[1]?.trim();
  return block && block.length > 0 ? block : undefined;
}

export function parseTaggedRefactorPlan(text: string): RefactorPlanParseResult {
  const rawJson = extractTaggedJsonBlock(text);
  if (!rawJson) {
    return {
      ok: false,
      code: "missing_block",
      message: `Missing tagged JSON block \`${REFACTOR_PLAN_JSON_BLOCK_TAG}\`.`,
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

  const validated = validateApprovedRefactorPlan(parsed);
  if (!validated.ok) {
    return validated;
  }

  return {
    ok: true,
    value: validated.value,
    rawJson,
  };
}

export function validateApprovedRefactorPlan(
  value: unknown,
): ValidationResult<ApprovedRefactorPlan> {
  if (!isRecord(value)) {
    return invalidSchema("Tagged JSON block must be an object.");
  }

  if (value.version !== REFACTOR_PLAN_CONTRACT_VERSION) {
    return invalidSchema(`Refactor plan version must be ${REFACTOR_PLAN_CONTRACT_VERSION}.`);
  }

  if (value.kind !== "approved_refactor_plan") {
    return invalidSchema("Refactor plan kind must be 'approved_refactor_plan'.");
  }

  if (!isNonEmptyString(value.summary)) {
    return invalidSchema("Refactor plan summary must be a non-empty string.");
  }

  if (!Array.isArray(value.executionUnits) || value.executionUnits.length === 0) {
    return invalidSchema("Refactor plan executionUnits must be a non-empty array.");
  }

  const executionUnits: RefactorExecutionUnit[] = [];
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
      version: REFACTOR_PLAN_CONTRACT_VERSION,
      kind: "approved_refactor_plan",
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

function invalidSchema(message: string): RefactorPlanParseError {
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
