import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_SEARCH_MAX_RESULTS,
  RLM_PROTOCOL_ACTIONS,
  parseAssistantAction,
} from "./protocol";

test("parseAssistantAction accepts inspect_document", () => {
  const result = parseAssistantAction('{"action":"inspect_document"}');
  assert.deepEqual(result, {
    ok: true,
    value: {
      kind: "inspect_document",
    },
  });
});

test("parseAssistantAction accepts read_segment", () => {
  const result = parseAssistantAction('{"action":"read_segment","offset":120,"length":400}');
  assert.deepEqual(result, {
    ok: true,
    value: {
      kind: "read_segment",
      offset: 120,
      length: 400,
    },
  });
});

test("parseAssistantAction accepts search_document and defaults maxResults", () => {
  const result = parseAssistantAction('{"action":"search_document","query":"recursion"}');
  assert.deepEqual(result, {
    ok: true,
    value: {
      kind: "search_document",
      query: "recursion",
      maxResults: DEFAULT_SEARCH_MAX_RESULTS,
    },
  });
});

test("parseAssistantAction accepts final_result from a fenced json block", () => {
  const result = parseAssistantAction('```json\n{"action":"final_result","result":"Main thesis"}\n```');
  assert.deepEqual(result, {
    ok: true,
    value: {
      kind: "final_result",
      result: "Main thesis",
    },
  });
});

test("RLM_PROTOCOL_ACTIONS lists the initial v1 action set", () => {
  assert.deepEqual([...RLM_PROTOCOL_ACTIONS], [
    "inspect_document",
    "read_segment",
    "search_document",
    "final_result",
  ]);
});

test("parseAssistantAction rejects empty output explicitly", () => {
  const result = parseAssistantAction("   ");
  assert.equal(result.ok, false);
  if (result.ok) {
    throw new Error("expected parse failure");
  }

  assert.equal(result.error.code, "empty_output");
  assert.match(result.error.message, /empty/i);
});

test("parseAssistantAction rejects malformed json explicitly", () => {
  const result = parseAssistantAction('{"action":"inspect_document"');
  assert.equal(result.ok, false);
  if (result.ok) {
    throw new Error("expected parse failure");
  }

  assert.equal(result.error.code, "invalid_json");
});

test("parseAssistantAction rejects non-object payloads explicitly", () => {
  const result = parseAssistantAction('[{"action":"inspect_document"}]');
  assert.equal(result.ok, false);
  if (result.ok) {
    throw new Error("expected parse failure");
  }

  assert.equal(result.error.code, "invalid_payload");
});

test("parseAssistantAction rejects unknown actions explicitly", () => {
  const result = parseAssistantAction('{"action":"subcall"}');
  assert.equal(result.ok, false);
  if (result.ok) {
    throw new Error("expected parse failure");
  }

  assert.equal(result.error.code, "unknown_action");
  assert.match(result.error.message, /Unsupported assistant action/);
});

test("parseAssistantAction rejects invalid read_segment arguments explicitly", () => {
  const result = parseAssistantAction('{"action":"read_segment","offset":-1,"length":"200"}');
  assert.equal(result.ok, false);
  if (result.ok) {
    throw new Error("expected parse failure");
  }

  assert.equal(result.error.code, "invalid_payload");
  assert.match(result.error.message, /offset|length/);
});

test("parseAssistantAction rejects prose-wrapped payloads instead of guessing", () => {
  const result = parseAssistantAction('Here is my action: {"action":"inspect_document"}');
  assert.equal(result.ok, false);
  if (result.ok) {
    throw new Error("expected parse failure");
  }

  assert.equal(result.error.code, "invalid_json");
});
