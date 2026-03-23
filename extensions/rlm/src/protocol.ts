import { DEFAULT_RLM_MAX_RESULT_CHARS, DEFAULT_RLM_MAX_SLICE_CHARS } from "./request";

export type RlmAssistantProgramLanguage = "javascript";

export interface RlmAssistantProgram {
  language: RlmAssistantProgramLanguage;
  code: string;
}

export type RlmAssistantProgramParseErrorCode =
  | "empty_output"
  | "invalid_program"
  | "multiple_blocks";

export interface RlmAssistantProgramParseError {
  code: RlmAssistantProgramParseErrorCode;
  message: string;
}

export type RlmAssistantProgramParseResult =
  | { ok: true; value: RlmAssistantProgram }
  | { ok: false; error: RlmAssistantProgramParseError };

export const RLM_PROTOCOL_ACTIONS = [
  "inspect_document",
  "read_segment",
  "search_document",
  "final_result",
] as const;

export type RlmProtocolActionName = (typeof RLM_PROTOCOL_ACTIONS)[number];

export interface InspectDocumentAction {
  kind: "inspect_document";
}

export interface ReadSegmentAction {
  kind: "read_segment";
  offset: number;
  length: number;
}

export interface SearchDocumentAction {
  kind: "search_document";
  query: string;
  maxResults: number;
}

export interface FinalResultAction {
  kind: "final_result";
  result: string;
}

export type RlmAssistantAction =
  | InspectDocumentAction
  | ReadSegmentAction
  | SearchDocumentAction
  | FinalResultAction;

export type RlmAssistantActionParseErrorCode =
  | "empty_output"
  | "invalid_json"
  | "invalid_payload"
  | "unknown_action";

export interface RlmAssistantActionParseError {
  code: RlmAssistantActionParseErrorCode;
  message: string;
}

export type RlmAssistantActionParseResult =
  | { ok: true; value: RlmAssistantAction }
  | { ok: false; error: RlmAssistantActionParseError };

export const DEFAULT_SEARCH_MAX_RESULTS = 5;

export function parseAssistantProgram(text: string): RlmAssistantProgramParseResult {
  const normalized = text.trim();
  if (normalized.length === 0) {
    return programFailure("empty_output", "Assistant program output was empty.");
  }

  const fencedBlocks = [...normalized.matchAll(/```([a-zA-Z]*)\s*([\s\S]*?)```/g)];
  if (fencedBlocks.length > 1) {
    return programFailure(
      "multiple_blocks",
      "Assistant program output must contain exactly one JavaScript code block.",
    );
  }

  if (fencedBlocks.length === 1) {
    const match = fencedBlocks[0]!;
    const language = (match[1] ?? "").trim().toLowerCase();
    const code = (match[2] ?? "").trim();
    const withoutBlock = normalized.replace(match[0], "").trim();

    if (withoutBlock.length > 0) {
      return programFailure(
        "invalid_program",
        "Assistant program output must not include prose outside the JavaScript code block.",
      );
    }

    if (!["", "js", "javascript"].includes(language)) {
      return programFailure(
        "invalid_program",
        `Assistant program block must be fenced as JavaScript; received '${language || "plain"}'.`,
      );
    }

    if (code.length === 0) {
      return programFailure("invalid_program", "Assistant JavaScript code block was empty.");
    }

    return validateJavaScriptProgram(code);
  }

  return validateJavaScriptProgram(normalized);
}

export function parseAssistantAction(text: string): RlmAssistantActionParseResult {
  const normalized = text.trim();
  if (normalized.length === 0) {
    return failure("empty_output", "Assistant action output was empty.");
  }

  const payload = extractJsonPayload(normalized);
  if (!payload.ok) {
    return payload;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(payload.value);
  } catch {
    return failure(
      "invalid_json",
      "Assistant action output must be valid JSON or a fenced ```json block.",
    );
  }

  if (!isRecord(parsed) || Array.isArray(parsed)) {
    return failure("invalid_payload", "Assistant action payload must be a JSON object.");
  }

  const action = parsed.action;
  if (typeof action !== "string" || action.trim().length === 0) {
    return failure("invalid_payload", "Assistant action payload must include a string 'action'.");
  }

  switch (action) {
    case "inspect_document":
      return parseInspectDocumentAction(parsed);
    case "read_segment":
      return parseReadSegmentAction(parsed);
    case "search_document":
      return parseSearchDocumentAction(parsed);
    case "final_result":
      return parseFinalResultAction(parsed);
    default:
      return failure("unknown_action", `Unsupported assistant action '${action}'.`);
  }
}

function parseInspectDocumentAction(
  payload: Record<string, unknown>,
): RlmAssistantActionParseResult {
  const extraKeys = getUnexpectedKeys(payload, ["action"]);
  if (extraKeys.length > 0) {
    return failure(
      "invalid_payload",
      `inspect_document does not accept extra keys: ${extraKeys.join(", ")}. Use exactly {"action":"inspect_document"}.`,
    );
  }

  return { ok: true, value: { kind: "inspect_document" } };
}

function parseReadSegmentAction(payload: Record<string, unknown>): RlmAssistantActionParseResult {
  const extraKeys = getUnexpectedKeys(payload, ["action", "offset", "length"]);
  if (extraKeys.length > 0) {
    return failure(
      "invalid_payload",
      `read_segment only accepts action, offset, and length. Unsupported keys: ${extraKeys.join(", ")}.`,
    );
  }

  const offset = payload.offset;
  const length = payload.length;

  if (!isNonNegativeInteger(offset)) {
    return failure("invalid_payload", "read_segment requires a non-negative integer 'offset'.");
  }

  if (!isPositiveInteger(length)) {
    return failure("invalid_payload", "read_segment requires a positive integer 'length'.");
  }

  if (length > DEFAULT_RLM_MAX_SLICE_CHARS) {
    return failure(
      "invalid_payload",
      `read_segment length must be <= ${DEFAULT_RLM_MAX_SLICE_CHARS} characters.`,
    );
  }

  return {
    ok: true,
    value: {
      kind: "read_segment",
      offset,
      length,
    },
  };
}

function parseSearchDocumentAction(
  payload: Record<string, unknown>,
): RlmAssistantActionParseResult {
  const extraKeys = getUnexpectedKeys(payload, ["action", "query", "maxResults"]);
  if (extraKeys.length > 0) {
    return failure(
      "invalid_payload",
      `search_document only accepts action, query, and optional maxResults. Unsupported keys: ${extraKeys.join(", ")}.`,
    );
  }

  const query = payload.query;
  const maxResults = payload.maxResults;

  if (typeof query !== "string" || query.trim().length === 0) {
    return failure("invalid_payload", "search_document requires a non-empty string 'query'.");
  }

  if (typeof maxResults !== "undefined" && !isPositiveInteger(maxResults)) {
    return failure(
      "invalid_payload",
      "search_document 'maxResults' must be a positive integer when provided.",
    );
  }

  return {
    ok: true,
    value: {
      kind: "search_document",
      query: query.trim(),
      maxResults: maxResults ?? DEFAULT_SEARCH_MAX_RESULTS,
    },
  };
}

function parseFinalResultAction(payload: Record<string, unknown>): RlmAssistantActionParseResult {
  const extraKeys = getUnexpectedKeys(payload, ["action", "result"]);
  if (extraKeys.length > 0) {
    return failure(
      "invalid_payload",
      `final_result only accepts action and result. Unsupported keys: ${extraKeys.join(", ")}.`,
    );
  }

  const result = payload.result;
  if (typeof result !== "string" || result.trim().length === 0) {
    return failure("invalid_payload", "final_result requires a non-empty string 'result'.");
  }

  const normalizedResult = result.trim();
  if (normalizedResult.length > DEFAULT_RLM_MAX_RESULT_CHARS) {
    return failure(
      "invalid_payload",
      `final_result must be <= ${DEFAULT_RLM_MAX_RESULT_CHARS} characters.`,
    );
  }

  return {
    ok: true,
    value: {
      kind: "final_result",
      result: normalizedResult,
    },
  };
}

function validateJavaScriptProgram(code: string): RlmAssistantProgramParseResult {
  try {
    // eslint-disable-next-line no-new-func
    new Function(code);
  } catch (error) {
    const message = error instanceof Error ? error.message : "invalid JavaScript syntax";
    return programFailure(
      "invalid_program",
      `Assistant program output must be valid JavaScript: ${message}`,
    );
  }

  return {
    ok: true,
    value: {
      language: "javascript",
      code,
    },
  };
}

function extractJsonPayload(
  text: string,
): RlmAssistantActionParseResult | { ok: true; value: string } {
  const fencedMatch = text.match(/^```(?:json)?\s*([\s\S]*?)```$/i);
  if (fencedMatch) {
    const fenced = fencedMatch[1]?.trim() ?? "";
    if (fenced.length === 0) {
      return failure("invalid_json", "Assistant action fenced JSON block was empty.");
    }

    return { ok: true, value: fenced };
  }

  if (
    (text.startsWith("{") && text.endsWith("}")) ||
    (text.startsWith("[") && text.endsWith("]"))
  ) {
    return { ok: true, value: text };
  }

  return failure(
    "invalid_json",
    "Assistant action output must be a JSON object or a fenced ```json block.",
  );
}

function programFailure(
  code: RlmAssistantProgramParseErrorCode,
  message: string,
): RlmAssistantProgramParseResult {
  return {
    ok: false,
    error: { code, message },
  };
}

function failure(
  code: RlmAssistantActionParseErrorCode,
  message: string,
): RlmAssistantActionParseResult {
  return {
    ok: false,
    error: { code, message },
  };
}

function getUnexpectedKeys(payload: Record<string, unknown>, allowedKeys: string[]): string[] {
  const allowed = new Set(allowedKeys);
  return Object.keys(payload).filter((key) => !allowed.has(key)).sort();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isNonNegativeInteger(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) >= 0;
}

function isPositiveInteger(value: unknown): value is number {
  return Number.isInteger(value) && (value as number) > 0;
}
