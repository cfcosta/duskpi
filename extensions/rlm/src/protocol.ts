import {
  DEFAULT_RLM_MAX_RESULT_CHARS,
  DEFAULT_RLM_MAX_SLICE_CHARS,
} from "./request";

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
      return { ok: true, value: { kind: "inspect_document" } };
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

function parseReadSegmentAction(payload: Record<string, unknown>): RlmAssistantActionParseResult {
  const offset = payload.offset;
  const length = payload.length;

  if (!isNonNegativeInteger(offset)) {
    return failure(
      "invalid_payload",
      "read_segment requires a non-negative integer 'offset'.",
    );
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

function extractJsonPayload(text: string): RlmAssistantActionParseResult | { ok: true; value: string } {
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

function failure(
  code: RlmAssistantActionParseErrorCode,
  message: string,
): RlmAssistantActionParseResult {
  return {
    ok: false,
    error: { code, message },
  };
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
