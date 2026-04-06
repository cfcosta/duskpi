export const TEST_AUDIT_WORKER_RESULT_JSON_BLOCK_TAG = "test-audit-worker-result-json";
export const TEST_AUDIT_WORKER_RESULT_CONTRACT_VERSION = 1;

export type TestAuditWorkerResultStatus = "completed" | "blocked" | "failed";

export interface TestAuditWorkerValidation {
  command: string;
  outcome: "passed" | "failed" | "not_run";
  details?: string;
}

interface TestAuditWorkerResultBase {
  version: 1;
  kind: "test_audit_worker_result";
  unitId: string;
  status: TestAuditWorkerResultStatus;
  summary: string;
  validations: TestAuditWorkerValidation[];
}

export interface CompletedTestAuditWorkerResult extends TestAuditWorkerResultBase {
  status: "completed";
  changedFiles: string[];
}

export interface BlockedTestAuditWorkerResult extends TestAuditWorkerResultBase {
  status: "blocked";
  blockers: string[];
}

export interface FailedTestAuditWorkerResult extends TestAuditWorkerResultBase {
  status: "failed";
  blockers: string[];
}

export type TestAuditWorkerResult =
  | CompletedTestAuditWorkerResult
  | BlockedTestAuditWorkerResult
  | FailedTestAuditWorkerResult;

export type TestAuditWorkerResultParseErrorCode =
  | "missing_block"
  | "malformed_json"
  | "invalid_schema";

export interface TestAuditWorkerResultParseSuccess {
  ok: true;
  value: TestAuditWorkerResult;
  rawJson: string;
}

export interface TestAuditWorkerResultParseError {
  ok: false;
  code: TestAuditWorkerResultParseErrorCode;
  message: string;
}

export type TestAuditWorkerResultParseResult =
  | TestAuditWorkerResultParseSuccess
  | TestAuditWorkerResultParseError;

type ValidationResult<T> = { ok: true; value: T } | TestAuditWorkerResultParseError;

export function extractTaggedJsonBlock(
  text: string,
  tag: string = TEST_AUDIT_WORKER_RESULT_JSON_BLOCK_TAG,
): string | undefined {
  const escapedTag = escapeRegExp(tag);
  const pattern = new RegExp("```" + `(?:${escapedTag})\\s*\\n([\\s\\S]*?)\\n` + "```", "i");
  const match = text.match(pattern);
  const block = match?.[1]?.trim();
  return block && block.length > 0 ? block : undefined;
}

export function parseTaggedWorkerResult(text: string): TestAuditWorkerResultParseResult {
  const rawJson = extractTaggedJsonBlock(text);
  if (!rawJson) {
    return {
      ok: false,
      code: "missing_block",
      message: `Missing tagged JSON block \`${TEST_AUDIT_WORKER_RESULT_JSON_BLOCK_TAG}\`.`,
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

  const validated = validateWorkerResult(parsed);
  if (!validated.ok) {
    return validated;
  }

  return {
    ok: true,
    value: validated.value,
    rawJson,
  };
}

export function validateWorkerResult(value: unknown): ValidationResult<TestAuditWorkerResult> {
  if (!isRecord(value)) {
    return invalidSchema("Tagged JSON block must be an object.");
  }

  if (value.version !== TEST_AUDIT_WORKER_RESULT_CONTRACT_VERSION) {
    return invalidSchema(
      `Worker result version must be ${TEST_AUDIT_WORKER_RESULT_CONTRACT_VERSION}.`,
    );
  }

  if (value.kind !== "test_audit_worker_result") {
    return invalidSchema("Worker result kind must be 'test_audit_worker_result'.");
  }

  const unitId = readRequiredString(value.unitId, "Worker result unitId");
  if (!unitId.ok) {
    return unitId;
  }

  const summary = readRequiredString(value.summary, "Worker result summary");
  if (!summary.ok) {
    return summary;
  }

  const validations = readValidations(value.validations);
  if (!validations.ok) {
    return validations;
  }

  if (value.status === "completed") {
    const changedFiles = readStringArray(value.changedFiles, "Worker result changedFiles", true);
    if (!changedFiles.ok) {
      return changedFiles;
    }

    return {
      ok: true,
      value: {
        version: TEST_AUDIT_WORKER_RESULT_CONTRACT_VERSION,
        kind: "test_audit_worker_result",
        unitId: unitId.value,
        status: "completed",
        summary: summary.value,
        validations: validations.value,
        changedFiles: changedFiles.value,
      },
    };
  }

  if (value.status === "blocked" || value.status === "failed") {
    const blockers = readStringArray(value.blockers, "Worker result blockers", true);
    if (!blockers.ok) {
      return blockers;
    }

    return {
      ok: true,
      value: {
        version: TEST_AUDIT_WORKER_RESULT_CONTRACT_VERSION,
        kind: "test_audit_worker_result",
        unitId: unitId.value,
        status: value.status,
        summary: summary.value,
        validations: validations.value,
        blockers: blockers.value,
      },
    };
  }

  return invalidSchema("Worker result status must be 'completed', 'blocked', or 'failed'.");
}

function readValidations(value: unknown): ValidationResult<TestAuditWorkerValidation[]> {
  if (!Array.isArray(value)) {
    return invalidSchema("Worker result validations must be an array.");
  }

  const validations: TestAuditWorkerValidation[] = [];
  for (const [index, entry] of value.entries()) {
    if (!isRecord(entry)) {
      return invalidSchema(`Worker result validations[${index}] must be an object.`);
    }

    const command = readRequiredString(
      entry.command,
      `Worker result validations[${index}] command`,
    );
    if (!command.ok) {
      return command;
    }

    if (entry.outcome !== "passed" && entry.outcome !== "failed" && entry.outcome !== "not_run") {
      return invalidSchema(
        `Worker result validations[${index}] outcome must be 'passed', 'failed', or 'not_run'.`,
      );
    }

    if (entry.details !== undefined && !isNonEmptyString(entry.details)) {
      return invalidSchema(
        `Worker result validations[${index}] details must be a non-empty string when present.`,
      );
    }

    validations.push({
      command: command.value,
      outcome: entry.outcome,
      ...(entry.details !== undefined ? { details: entry.details } : {}),
    });
  }

  return { ok: true, value: validations };
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

function invalidSchema(message: string): TestAuditWorkerResultParseError {
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
