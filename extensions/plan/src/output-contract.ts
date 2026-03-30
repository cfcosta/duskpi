export const PLAN_OUTPUT_JSON_BLOCK_TAG = "pi-plan-json";

export interface StructuredPlanStep {
  step: number;
  objective: string;
  targets: string[];
  validation: string[];
  risks: string[];
}

export interface StructuredPlanOutput {
  version: 1;
  kind: "plan";
  steps: StructuredPlanStep[];
}

export interface StructuredReviewContinueOutput {
  version: 1;
  kind: "review";
  status: "continue";
  steps: StructuredPlanStep[];
}

export interface StructuredReviewCompleteOutput {
  version: 1;
  kind: "review";
  status: "complete";
}

export type StructuredReviewOutput =
  | StructuredReviewContinueOutput
  | StructuredReviewCompleteOutput;

export type StructuredPlanningContract = StructuredPlanOutput | StructuredReviewOutput;

export type PlanningContractParseErrorCode = "missing_block" | "malformed_json" | "invalid_schema";

export interface PlanningContractParseSuccess<T extends StructuredPlanningContract> {
  ok: true;
  value: T;
  rawJson: string;
}

export interface PlanningContractParseError {
  ok: false;
  code: PlanningContractParseErrorCode;
  message: string;
}

export type PlanningContractParseResult<T extends StructuredPlanningContract> =
  | PlanningContractParseSuccess<T>
  | PlanningContractParseError;

type ValidationResult<T> = { ok: true; value: T } | PlanningContractParseError;

export function extractTaggedJsonBlock(
  text: string,
  tag: string = PLAN_OUTPUT_JSON_BLOCK_TAG,
): string | undefined {
  const escapedTag = escapeRegExp(tag);
  const pattern = new RegExp("```" + `(?:${escapedTag})\\s*\\n([\\s\\S]*?)\\n` + "```", "i");
  const match = text.match(pattern);
  const block = match?.[1]?.trim();
  return block && block.length > 0 ? block : undefined;
}

export function parseTaggedPlanningContract(
  text: string,
): PlanningContractParseResult<StructuredPlanningContract> {
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

  const validated = validatePlanningContract(parsed);
  if (!validated.ok) {
    return validated;
  }

  return {
    ok: true,
    value: validated.value,
    rawJson,
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
    return {
      ok: false,
      code: "invalid_schema",
      message: "Tagged JSON block must contain a plan payload.",
    };
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
    return {
      ok: false,
      code: "invalid_schema",
      message: "Tagged JSON block must contain a review payload.",
    };
  }

  return {
    ok: true,
    value: parsed.value,
    rawJson: parsed.rawJson,
  };
}

function validatePlanningContract(value: unknown): ValidationResult<StructuredPlanningContract> {
  if (!isRecord(value)) {
    return invalidSchema("Tagged JSON block must be an object.");
  }

  if (value.version !== 1) {
    return invalidSchema("Tagged JSON block must include version: 1.");
  }

  if (value.kind === "plan") {
    const steps = validateSteps(value.steps);
    if (!steps.ok) {
      return steps;
    }

    return {
      ok: true,
      value: {
        version: 1,
        kind: "plan",
        steps: steps.value,
      },
    };
  }

  if (value.kind === "review") {
    if (value.status === "complete") {
      return {
        ok: true,
        value: {
          version: 1,
          kind: "review",
          status: "complete",
        },
      };
    }

    if (value.status === "continue") {
      const steps = validateSteps(value.steps);
      if (!steps.ok) {
        return steps;
      }

      return {
        ok: true,
        value: {
          version: 1,
          kind: "review",
          status: "continue",
          steps: steps.value,
        },
      };
    }

    return invalidSchema("Review payload must include status 'complete' or 'continue'.");
  }

  return invalidSchema("Tagged JSON block must include kind 'plan' or 'review'.");
}

function validateSteps(value: unknown): ValidationResult<StructuredPlanStep[]> {
  if (!Array.isArray(value)) {
    return invalidSchema("Plan steps must be an array.");
  }

  const steps: StructuredPlanStep[] = [];
  for (let index = 0; index < value.length; index++) {
    const step = validateStep(value[index], index);
    if (!step.ok) {
      return step;
    }
    steps.push(step.value);
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

  const stepNumber = value.step;
  if (typeof stepNumber !== "number" || !Number.isInteger(stepNumber) || stepNumber < 1) {
    return invalidSchema(`Step ${index + 1} must include a positive integer step number.`);
  }

  const objective = value.objective;
  if (typeof objective !== "string" || objective.trim().length === 0) {
    return invalidSchema(`Step ${index + 1} must include a non-empty objective string.`);
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

  return {
    ok: true,
    value: {
      step: stepNumber,
      objective: objective.trim(),
      targets: targets.value,
      validation: validation.value,
      risks: risks.value,
    },
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
