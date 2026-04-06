export const PLAN_OUTPUT_JSON_BLOCK_TAG = "pi-plan-json";
export const RUNTIME_PLAN_CONTRACT_VERSION = 2;

export const STRUCTURED_TASK_GEOMETRY_VALUES = [
  "shared_artifact",
  "open_ended_reasoning",
  "bounded_delegation",
] as const;
export type StructuredTaskGeometry = (typeof STRUCTURED_TASK_GEOMETRY_VALUES)[number];

export const STRUCTURED_COORDINATION_PATTERN_VALUES = [
  "linear",
  "branch_and_merge",
  "isolated_subtasks",
  "checkpointed_execution",
] as const;
export type StructuredCoordinationPattern = (typeof STRUCTURED_COORDINATION_PATTERN_VALUES)[number];

export const STRUCTURED_PLAN_STEP_KIND_VALUES = [
  "inspect",
  "implement",
  "integrate",
  "validate",
] as const;
export type StructuredPlanStepKind = (typeof STRUCTURED_PLAN_STEP_KIND_VALUES)[number];

export const STRUCTURED_CHECKPOINT_KIND_VALUES = ["checkpoint", "integration"] as const;
export type StructuredCheckpointKind = (typeof STRUCTURED_CHECKPOINT_KIND_VALUES)[number];

export const STRUCTURED_EXECUTION_RESULT_STATUS_VALUES = ["done", "skipped"] as const;
export type StructuredExecutionResultStatus =
  (typeof STRUCTURED_EXECUTION_RESULT_STATUS_VALUES)[number];

export const STRUCTURED_EXECUTION_RESULT_SCOPE_VALUES = ["plan", "autoplan"] as const;
export type StructuredExecutionResultScope =
  (typeof STRUCTURED_EXECUTION_RESULT_SCOPE_VALUES)[number];

export interface StructuredCheckpoint {
  id: string;
  title: string;
  kind: StructuredCheckpointKind;
  step: number;
  why: string;
}

export interface StructuredPlanStep {
  step: number;
  kind: StructuredPlanStepKind;
  objective: string;
  targets: string[];
  validation: string[];
  risks: string[];
  dependsOn: number[];
  checkpointIds: string[];
}

export interface StructuredPlanOutput {
  version: 2;
  kind: "plan";
  taskGeometry: StructuredTaskGeometry;
  coordinationPattern: StructuredCoordinationPattern;
  assumptions: string[];
  escalationTriggers: string[];
  checkpoints: StructuredCheckpoint[];
  steps: StructuredPlanStep[];
}

export interface StructuredReviewContinueOutput {
  version: 2;
  kind: "review";
  status: "continue";
  summary: string;
  taskGeometry: StructuredTaskGeometry;
  coordinationPattern: StructuredCoordinationPattern;
  assumptions: string[];
  checkpoints: StructuredCheckpoint[];
  steps: StructuredPlanStep[];
}

export interface StructuredReviewCompleteOutput {
  version: 2;
  kind: "review";
  status: "complete";
  summary: string;
}

export type StructuredReviewOutput =
  | StructuredReviewContinueOutput
  | StructuredReviewCompleteOutput;

export interface StructuredExecutionResultOutput {
  version: 2;
  kind: "execution_result";
  scope: StructuredExecutionResultScope;
  step: number;
  status: StructuredExecutionResultStatus;
  summary: string;
  changedTargets: string[];
  validationsRun: string[];
  checkpointsReached: string[];
  outerStep?: number;
}

export type StructuredPlanningContract = StructuredPlanOutput | StructuredReviewOutput;
export type StructuredTaggedContract = StructuredPlanningContract | StructuredExecutionResultOutput;

export type PlanningContractParseErrorCode = "missing_block" | "malformed_json" | "invalid_schema";

export interface PlanningContractParseSuccess<T extends StructuredTaggedContract> {
  ok: true;
  value: T;
  rawJson: string;
}

export interface PlanningContractParseError {
  ok: false;
  code: PlanningContractParseErrorCode;
  message: string;
}

export type PlanningContractParseResult<T extends StructuredTaggedContract> =
  | PlanningContractParseSuccess<T>
  | PlanningContractParseError;

type ValidationResult<T> = { ok: true; value: T } | PlanningContractParseError;

const TASK_GEOMETRIES = new Set<StructuredTaskGeometry>(STRUCTURED_TASK_GEOMETRY_VALUES);
const COORDINATION_PATTERNS = new Set<StructuredCoordinationPattern>(
  STRUCTURED_COORDINATION_PATTERN_VALUES,
);
const STEP_KINDS = new Set<StructuredPlanStepKind>(STRUCTURED_PLAN_STEP_KIND_VALUES);
const CHECKPOINT_KINDS = new Set<StructuredCheckpointKind>(STRUCTURED_CHECKPOINT_KIND_VALUES);
const EXECUTION_RESULT_STATUSES = new Set<StructuredExecutionResultStatus>(
  STRUCTURED_EXECUTION_RESULT_STATUS_VALUES,
);
const EXECUTION_RESULT_SCOPES = new Set<StructuredExecutionResultScope>(
  STRUCTURED_EXECUTION_RESULT_SCOPE_VALUES,
);

export function extractTaggedJsonBlock(
  text: string,
  tag: string = PLAN_OUTPUT_JSON_BLOCK_TAG,
): string | undefined {
  const escapedTag = escapeRegExp(tag);
  const pattern = new RegExp(
    "(?:^|\\r?\\n)[ \\t]*```(?:" +
      escapedTag +
      ")[ \\t]*\\r?\\n([\\s\\S]*?)\\r?\\n[ \\t]*```(?=[ \\t]*(?:\\r?\\n|$))",
    "i",
  );
  const match = text.match(pattern);
  const block = match?.[1]?.trim();
  return block && block.length > 0 ? block : undefined;
}

export function parseTaggedOutputContract(
  text: string,
): PlanningContractParseResult<StructuredTaggedContract> {
  const rawJson = extractTaggedJsonBlock(text);
  if (!rawJson) {
    return {
      ok: false,
      code: "missing_block",
      message: `Missing tagged JSON block \`${PLAN_OUTPUT_JSON_BLOCK_TAG}\`.`,
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

  const validated = validateTaggedContract(parsed);
  if (!validated.ok) {
    return validated;
  }

  return {
    ok: true,
    value: validated.value,
    rawJson,
  };
}

export function parseTaggedPlanningContract(
  text: string,
): PlanningContractParseResult<StructuredPlanningContract> {
  const parsed = parseTaggedOutputContract(text);
  if (!parsed.ok) {
    return parsed;
  }

  if (parsed.value.kind === "execution_result") {
    return invalidSchema("Tagged JSON block must contain a plan or review payload.");
  }

  return {
    ok: true,
    value: parsed.value,
    rawJson: parsed.rawJson,
  };
}

export function parseTaggedPlanContract(
  text: string,
): PlanningContractParseResult<StructuredPlanOutput> {
  const parsed = parseTaggedPlanningContract(text);
  if (!parsed.ok) {
    return parsed;
  }

  if (parsed.value.kind !== "plan") {
    return invalidSchema("Tagged JSON block must contain a plan payload.");
  }

  return {
    ok: true,
    value: parsed.value,
    rawJson: parsed.rawJson,
  };
}

export function parseTaggedReviewContract(
  text: string,
): PlanningContractParseResult<StructuredReviewOutput> {
  const parsed = parseTaggedPlanningContract(text);
  if (!parsed.ok) {
    return parsed;
  }

  if (parsed.value.kind !== "review") {
    return invalidSchema("Tagged JSON block must contain a review payload.");
  }

  return {
    ok: true,
    value: parsed.value,
    rawJson: parsed.rawJson,
  };
}

export function parseTaggedExecutionResultContract(
  text: string,
): PlanningContractParseResult<StructuredExecutionResultOutput> {
  const parsed = parseTaggedOutputContract(text);
  if (!parsed.ok) {
    return parsed;
  }

  if (parsed.value.kind !== "execution_result") {
    return invalidSchema("Tagged JSON block must contain an execution_result payload.");
  }

  return {
    ok: true,
    value: parsed.value,
    rawJson: parsed.rawJson,
  };
}

function validateTaggedContract(value: unknown): ValidationResult<StructuredTaggedContract> {
  if (!isRecord(value)) {
    return invalidSchema("Tagged JSON block must be an object.");
  }

  if (value.version !== RUNTIME_PLAN_CONTRACT_VERSION) {
    return invalidSchema(
      `Tagged JSON block must include version: ${RUNTIME_PLAN_CONTRACT_VERSION}.`,
    );
  }

  switch (value.kind) {
    case "plan":
      return validatePlanContract(value);
    case "review":
      return validateReviewContract(value);
    case "execution_result":
      return validateExecutionResultContract(value);
    default:
      return invalidSchema(
        "Tagged JSON block must include kind 'plan', 'review', or 'execution_result'.",
      );
  }
}

function validatePlanContract(
  value: Record<string, unknown>,
): ValidationResult<StructuredPlanOutput> {
  const taskGeometry = validateEnumValue(
    value.taskGeometry,
    TASK_GEOMETRIES,
    `Plan payload must include a valid taskGeometry (${formatAllowedValues(STRUCTURED_TASK_GEOMETRY_VALUES)}).`,
  );
  if (!taskGeometry.ok) {
    return taskGeometry;
  }

  const coordinationPattern = validateEnumValue(
    value.coordinationPattern,
    COORDINATION_PATTERNS,
    `Plan payload must include a valid coordinationPattern (${formatAllowedValues(STRUCTURED_COORDINATION_PATTERN_VALUES)}).`,
  );
  if (!coordinationPattern.ok) {
    return coordinationPattern;
  }

  const assumptions = validateStringArray(value.assumptions, "Plan assumptions");
  if (!assumptions.ok) {
    return assumptions;
  }

  const escalationTriggers = validateStringArray(
    value.escalationTriggers,
    "Plan escalationTriggers",
  );
  if (!escalationTriggers.ok) {
    return escalationTriggers;
  }

  const steps = validateSteps(value.steps, "Plan");
  if (!steps.ok) {
    return steps;
  }

  const checkpoints = validateCheckpoints(value.checkpoints, steps.value, "Plan checkpoints");
  if (!checkpoints.ok) {
    return checkpoints;
  }

  const stepRelationships = validateStepRelationships(steps.value, checkpoints.value);
  if (!stepRelationships.ok) {
    return stepRelationships;
  }

  return {
    ok: true,
    value: {
      version: RUNTIME_PLAN_CONTRACT_VERSION,
      kind: "plan",
      taskGeometry: taskGeometry.value,
      coordinationPattern: coordinationPattern.value,
      assumptions: assumptions.value,
      escalationTriggers: escalationTriggers.value,
      checkpoints: checkpoints.value,
      steps: steps.value,
    },
  };
}

function validateReviewContract(
  value: Record<string, unknown>,
): ValidationResult<StructuredReviewOutput> {
  const status = value.status;
  if (status !== "continue" && status !== "complete") {
    return invalidSchema("Review payload must include status 'complete' or 'continue'.");
  }

  const summary = validateNonEmptyString(value.summary, "Review payload must include a summary.");
  if (!summary.ok) {
    return summary;
  }

  if (status === "complete") {
    return {
      ok: true,
      value: {
        version: RUNTIME_PLAN_CONTRACT_VERSION,
        kind: "review",
        status: "complete",
        summary: summary.value,
      },
    };
  }

  const taskGeometry = validateEnumValue(
    value.taskGeometry,
    TASK_GEOMETRIES,
    `Review continue payload must include a valid taskGeometry (${formatAllowedValues(STRUCTURED_TASK_GEOMETRY_VALUES)}).`,
  );
  if (!taskGeometry.ok) {
    return taskGeometry;
  }

  const coordinationPattern = validateEnumValue(
    value.coordinationPattern,
    COORDINATION_PATTERNS,
    `Review continue payload must include a valid coordinationPattern (${formatAllowedValues(STRUCTURED_COORDINATION_PATTERN_VALUES)}).`,
  );
  if (!coordinationPattern.ok) {
    return coordinationPattern;
  }

  const assumptions = validateStringArray(value.assumptions, "Review assumptions");
  if (!assumptions.ok) {
    return assumptions;
  }

  const steps = validateSteps(value.steps, "Review");
  if (!steps.ok) {
    return steps;
  }

  const checkpoints = validateCheckpoints(value.checkpoints, steps.value, "Review checkpoints");
  if (!checkpoints.ok) {
    return checkpoints;
  }

  const stepRelationships = validateStepRelationships(steps.value, checkpoints.value);
  if (!stepRelationships.ok) {
    return stepRelationships;
  }

  return {
    ok: true,
    value: {
      version: RUNTIME_PLAN_CONTRACT_VERSION,
      kind: "review",
      status: "continue",
      summary: summary.value,
      taskGeometry: taskGeometry.value,
      coordinationPattern: coordinationPattern.value,
      assumptions: assumptions.value,
      checkpoints: checkpoints.value,
      steps: steps.value,
    },
  };
}

function validateExecutionResultContract(
  value: Record<string, unknown>,
): ValidationResult<StructuredExecutionResultOutput> {
  const scope = validateEnumValue(
    value.scope,
    EXECUTION_RESULT_SCOPES,
    `Execution result payload must include a valid scope (${formatAllowedValues(STRUCTURED_EXECUTION_RESULT_SCOPE_VALUES)}).`,
  );
  if (!scope.ok) {
    return scope;
  }

  const step = validatePositiveInteger(
    value.step,
    "Execution result payload must include a positive integer step.",
  );
  if (!step.ok) {
    return step;
  }

  const status = validateEnumValue(
    value.status,
    EXECUTION_RESULT_STATUSES,
    `Execution result payload must include a valid status (${formatAllowedValues(STRUCTURED_EXECUTION_RESULT_STATUS_VALUES)}).`,
  );
  if (!status.ok) {
    return status;
  }

  const summary = validateNonEmptyString(
    value.summary,
    "Execution result payload must include a non-empty summary.",
  );
  if (!summary.ok) {
    return summary;
  }

  const changedTargets = validateStringArray(
    value.changedTargets,
    "Execution result changedTargets",
  );
  if (!changedTargets.ok) {
    return changedTargets;
  }

  const validationsRun = validateStringArray(
    value.validationsRun,
    "Execution result validationsRun",
  );
  if (!validationsRun.ok) {
    return validationsRun;
  }

  const checkpointsReached = validateStringArray(
    value.checkpointsReached,
    "Execution result checkpointsReached",
  );
  if (!checkpointsReached.ok) {
    return checkpointsReached;
  }

  const outerStep = value.outerStep;
  if (typeof outerStep !== "undefined") {
    const validatedOuterStep = validatePositiveInteger(
      outerStep,
      "Execution result outerStep must be a positive integer when provided.",
    );
    if (!validatedOuterStep.ok) {
      return validatedOuterStep;
    }
  }

  return {
    ok: true,
    value: {
      version: RUNTIME_PLAN_CONTRACT_VERSION,
      kind: "execution_result",
      scope: scope.value,
      step: step.value,
      status: status.value,
      summary: summary.value,
      changedTargets: changedTargets.value,
      validationsRun: validationsRun.value,
      checkpointsReached: checkpointsReached.value,
      ...(typeof outerStep === "number" ? { outerStep } : {}),
    },
  };
}

function validateSteps(value: unknown, label: string): ValidationResult<StructuredPlanStep[]> {
  if (!Array.isArray(value) || value.length === 0) {
    return invalidSchema(`${label} steps must be a non-empty array.`);
  }

  const steps: StructuredPlanStep[] = [];
  for (let index = 0; index < value.length; index++) {
    const step = validateStep(value[index], index);
    if (!step.ok) {
      return step;
    }
    steps.push(step.value);
  }

  const uniqueStepNumbers = new Set(steps.map((step) => step.step));
  if (uniqueStepNumbers.size !== steps.length) {
    return invalidSchema(`${label} steps must use unique step numbers.`);
  }

  return {
    ok: true,
    value: steps,
  };
}

function validateStep(value: unknown, index: number): ValidationResult<StructuredPlanStep> {
  if (!isRecord(value)) {
    return invalidSchema(`Step ${index + 1} must be an object.`);
  }

  const stepNumber = validatePositiveInteger(
    value.step,
    `Step ${index + 1} must include a positive integer step number.`,
  );
  if (!stepNumber.ok) {
    return stepNumber;
  }

  const kind = validateEnumValue(
    value.kind,
    STEP_KINDS,
    `Step ${index + 1} must include a valid kind (${formatAllowedValues(STRUCTURED_PLAN_STEP_KIND_VALUES)}).`,
  );
  if (!kind.ok) {
    return kind;
  }

  const objective = validateNonEmptyString(
    value.objective,
    `Step ${index + 1} must include a non-empty objective string.`,
  );
  if (!objective.ok) {
    return objective;
  }

  const targets = validateStringArray(value.targets, `Step ${index + 1} targets`);
  if (!targets.ok) {
    return targets;
  }

  const validation = validateStringArray(value.validation, `Step ${index + 1} validation`);
  if (!validation.ok) {
    return validation;
  }

  const risks = validateStringArray(value.risks, `Step ${index + 1} risks`);
  if (!risks.ok) {
    return risks;
  }

  const dependsOn = validatePositiveIntegerArray(value.dependsOn, `Step ${index + 1} dependsOn`);
  if (!dependsOn.ok) {
    return dependsOn;
  }

  const checkpointIds = validateStringArray(value.checkpointIds, `Step ${index + 1} checkpointIds`);
  if (!checkpointIds.ok) {
    return checkpointIds;
  }

  return {
    ok: true,
    value: {
      step: stepNumber.value,
      kind: kind.value,
      objective: objective.value,
      targets: targets.value,
      validation: validation.value,
      risks: risks.value,
      dependsOn: dedupeIntegers(dependsOn.value),
      checkpointIds: dedupeStrings(checkpointIds.value),
    },
  };
}

function validateCheckpoints(
  value: unknown,
  steps: StructuredPlanStep[],
  label: string,
): ValidationResult<StructuredCheckpoint[]> {
  if (!Array.isArray(value)) {
    return invalidSchema(`${label} must be an array.`);
  }

  const validStepNumbers = new Set(steps.map((step) => step.step));
  const checkpoints: StructuredCheckpoint[] = [];

  for (let index = 0; index < value.length; index++) {
    const checkpoint = validateCheckpoint(value[index], index, validStepNumbers);
    if (!checkpoint.ok) {
      return checkpoint;
    }
    checkpoints.push(checkpoint.value);
  }

  const uniqueIds = new Set(checkpoints.map((checkpoint) => checkpoint.id));
  if (uniqueIds.size !== checkpoints.length) {
    return invalidSchema(`${label} must use unique checkpoint ids.`);
  }

  return {
    ok: true,
    value: checkpoints,
  };
}

function validateCheckpoint(
  value: unknown,
  index: number,
  validStepNumbers: Set<number>,
): ValidationResult<StructuredCheckpoint> {
  if (!isRecord(value)) {
    return invalidSchema(`Checkpoint ${index + 1} must be an object.`);
  }

  const id = validateNonEmptyString(
    value.id,
    `Checkpoint ${index + 1} must include a non-empty id string.`,
  );
  if (!id.ok) {
    return id;
  }

  const title = validateNonEmptyString(
    value.title,
    `Checkpoint ${index + 1} must include a non-empty title string.`,
  );
  if (!title.ok) {
    return title;
  }

  const kind = validateEnumValue(
    value.kind,
    CHECKPOINT_KINDS,
    `Checkpoint ${index + 1} must include a valid kind (${formatAllowedValues(STRUCTURED_CHECKPOINT_KIND_VALUES)}).`,
  );
  if (!kind.ok) {
    return kind;
  }

  const step = validatePositiveInteger(
    value.step,
    `Checkpoint ${index + 1} must include a positive integer step number.`,
  );
  if (!step.ok) {
    return step;
  }

  if (!validStepNumbers.has(step.value)) {
    return invalidSchema(`Checkpoint ${index + 1} step must reference an existing step number.`);
  }

  const why = validateNonEmptyString(
    value.why,
    `Checkpoint ${index + 1} must include a non-empty why string.`,
  );
  if (!why.ok) {
    return why;
  }

  return {
    ok: true,
    value: {
      id: id.value,
      title: title.value,
      kind: kind.value,
      step: step.value,
      why: why.value,
    },
  };
}

function validateStepRelationships(
  steps: StructuredPlanStep[],
  checkpoints: StructuredCheckpoint[],
): ValidationResult<StructuredPlanStep[]> {
  const stepNumbers = new Set(steps.map((step) => step.step));
  const checkpointIds = new Set(checkpoints.map((checkpoint) => checkpoint.id));

  for (const step of steps) {
    for (const dependency of step.dependsOn) {
      if (!stepNumbers.has(dependency)) {
        return invalidSchema(`Step ${step.step} dependsOn must reference existing step numbers.`);
      }
    }

    for (const checkpointId of step.checkpointIds) {
      if (!checkpointIds.has(checkpointId)) {
        return invalidSchema(
          `Step ${step.step} checkpointIds must reference existing checkpoints.`,
        );
      }
    }
  }

  return {
    ok: true,
    value: steps,
  };
}

function validateStringArray(value: unknown, label: string): ValidationResult<string[]> {
  if (!Array.isArray(value)) {
    return invalidSchema(`${label} must be an array of strings.`);
  }

  const normalized: string[] = [];
  for (const item of value) {
    if (typeof item !== "string" || item.trim().length === 0) {
      return invalidSchema(`${label} must contain only non-empty strings.`);
    }
    normalized.push(item.trim());
  }

  return {
    ok: true,
    value: normalized,
  };
}

function validatePositiveIntegerArray(value: unknown, label: string): ValidationResult<number[]> {
  if (!Array.isArray(value)) {
    return invalidSchema(`${label} must be an array of positive integers.`);
  }

  const normalized: number[] = [];
  for (const item of value) {
    if (typeof item !== "number" || !Number.isInteger(item) || item < 1) {
      return invalidSchema(`${label} must contain only positive integers.`);
    }
    normalized.push(item);
  }

  return {
    ok: true,
    value: normalized,
  };
}

function validatePositiveInteger(value: unknown, message: string): ValidationResult<number> {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1) {
    return invalidSchema(message);
  }

  return {
    ok: true,
    value,
  };
}

function validateNonEmptyString(value: unknown, message: string): ValidationResult<string> {
  if (typeof value !== "string" || value.trim().length === 0) {
    return invalidSchema(message);
  }

  return {
    ok: true,
    value: value.trim(),
  };
}

function validateEnumValue<T extends string>(
  value: unknown,
  allowedValues: Set<T>,
  message: string,
): ValidationResult<T> {
  if (typeof value !== "string" || !allowedValues.has(value as T)) {
    return invalidSchema(message);
  }

  return {
    ok: true,
    value: value as T,
  };
}

function formatAllowedValues(values: readonly string[]): string {
  return values.map((value) => `"${value}"`).join(", ");
}

function dedupeStrings(values: string[]): string[] {
  return [...new Set(values)];
}

function dedupeIntegers(values: number[]): number[] {
  return [...new Set(values)];
}

function invalidSchema(message: string): PlanningContractParseError {
  return {
    ok: false,
    code: "invalid_schema",
    message,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
