import { test } from "bun:test";
import assert from "node:assert/strict";
import {
  DEFAULT_SEARCH_MAX_RESULTS,
  RLM_PROTOCOL_ACTIONS,
  parseAssistantAction,
  parseAssistantProgram,
} from "./protocol";
import { DEFAULT_RLM_MAX_RESULT_CHARS, DEFAULT_RLM_MAX_SLICE_CHARS } from "./request";

test("parseAssistantProgram accepts a fenced js block", () => {
  const result = parseAssistantProgram(
    '```js\nconst summary = env.get("intro");\nsetFinal(summary);\n```',
  );
  assert.deepEqual(result, {
    ok: true,
    value: {
      language: "javascript",
      code: 'const summary = env.get("intro");\nsetFinal(summary);',
    },
  });
});

test("parseAssistantProgram accepts a raw JavaScript program", () => {
  const result = parseAssistantProgram(
    'const metadata = inspect();\nset("count", metadata.lineCount);',
  );
  assert.equal(result.ok, true);
  if (!result.ok) {
    throw new Error("expected JavaScript program parsing to succeed");
  }

  assert.equal(result.value.language, "javascript");
  assert.match(result.value.code, /inspect\(\)/);
});

test("parseAssistantProgram accepts prose-wrapped fenced code", () => {
  const result = parseAssistantProgram(
    'Here is the program you asked for:\n```js\nsetFinal("done");\n```',
  );
  assert.deepEqual(result, {
    ok: true,
    value: {
      language: "javascript",
      code: 'setFinal("done");',
    },
  });
});

test("parseAssistantProgram accepts one javascript fence among surrounding markdown", () => {
  const result = parseAssistantProgram(
    [
      "## Plan",
      "- inspect context",
      "```text",
      "scratch note",
      "```",
      "```javascript",
      'setFinal("done");',
      "```",
    ].join("\n"),
  );
  assert.deepEqual(result, {
    ok: true,
    value: {
      language: "javascript",
      code: 'setFinal("done");',
    },
  });
});

test("parseAssistantProgram accepts a typescript fence when the body is valid JavaScript", () => {
  const result = parseAssistantProgram('```typescript\nconst summary = "done";\nsetFinal(summary);\n```');
  assert.deepEqual(result, {
    ok: true,
    value: {
      language: "javascript",
      code: 'const summary = "done";\nsetFinal(summary);',
    },
  });
});

test("parseAssistantProgram accepts an unterminated javascript fence", () => {
  const result = parseAssistantProgram('```js\nsetFinal("done");');
  assert.deepEqual(result, {
    ok: true,
    value: {
      language: "javascript",
      code: 'setFinal("done");',
    },
  });
});

test("parseAssistantProgram extracts raw code from surrounding prose", () => {
  const result = parseAssistantProgram(
    [
      "Here is the program:",
      'const answer = "done";',
      "setFinal(answer);",
      "Hope that helps.",
    ].join("\n"),
  );
  assert.deepEqual(result, {
    ok: true,
    value: {
      language: "javascript",
      code: 'const answer = "done";\nsetFinal(answer);',
    },
  });
});

test("parseAssistantProgram rejects multiple code blocks explicitly", () => {
  const result = parseAssistantProgram('```js\nset("a", 1);\n```\n```js\nset("b", 2);\n```');
  assert.equal(result.ok, false);
  if (result.ok) {
    throw new Error("expected parse failure");
  }

  assert.equal(result.error.code, "multiple_blocks");
});

test("parseAssistantProgram rejects invalid JavaScript explicitly", () => {
  const result = parseAssistantProgram("```js\nconst broken = ;\n```");
  assert.equal(result.ok, false);
  if (result.ok) {
    throw new Error("expected parse failure");
  }

  assert.equal(result.error.code, "invalid_program");
  assert.match(result.error.message, /valid JavaScript/i);
});

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
  const result = parseAssistantAction(
    '```json\n{"action":"final_result","result":"Main thesis"}\n```',
  );
  assert.deepEqual(result, {
    ok: true,
    value: {
      kind: "final_result",
      result: "Main thesis",
    },
  });
});

test("parseAssistantAction rejects inspect_document payloads with unsupported keys", () => {
  const result = parseAssistantAction('{"action":"inspect_document","path":"/tmp/workspace.md"}');
  assert.equal(result.ok, false);
  if (result.ok) {
    throw new Error("expected parse failure");
  }

  assert.equal(result.error.code, "invalid_payload");
  assert.match(result.error.message, /does not accept extra keys/i);
  assert.match(result.error.message, /path/);
});

test("parseAssistantAction rejects read_segment payloads with path or line-based keys", () => {
  const result = parseAssistantAction(
    '{"action":"read_segment","path":"/tmp/workspace.md","startLine":1,"endLine":200,"offset":0,"length":100}',
  );
  assert.equal(result.ok, false);
  if (result.ok) {
    throw new Error("expected parse failure");
  }

  assert.equal(result.error.code, "invalid_payload");
  assert.match(result.error.message, /unsupported keys/i);
  assert.match(result.error.message, /path/);
  assert.match(result.error.message, /startLine/);
  assert.match(result.error.message, /endLine/);
});

test("RLM_PROTOCOL_ACTIONS lists the initial v1 action set", () => {
  assert.deepEqual(
    [...RLM_PROTOCOL_ACTIONS],
    ["inspect_document", "read_segment", "search_document", "final_result"],
  );
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

test("parseAssistantAction rejects read_segment requests above the max slice budget", () => {
  const result = parseAssistantAction(
    `{"action":"read_segment","offset":0,"length":${DEFAULT_RLM_MAX_SLICE_CHARS + 1}}`,
  );
  assert.equal(result.ok, false);
  if (result.ok) {
    throw new Error("expected slice budget failure");
  }

  assert.equal(result.error.code, "invalid_payload");
  assert.match(result.error.message, new RegExp(`${DEFAULT_RLM_MAX_SLICE_CHARS}`));
});

test("parseAssistantAction rejects final_result payloads above the max result budget", () => {
  const oversized = "x".repeat(DEFAULT_RLM_MAX_RESULT_CHARS + 1);
  const result = parseAssistantAction(
    JSON.stringify({ action: "final_result", result: oversized }),
  );
  assert.equal(result.ok, false);
  if (result.ok) {
    throw new Error("expected result budget failure");
  }

  assert.equal(result.error.code, "invalid_payload");
  assert.match(result.error.message, new RegExp(`${DEFAULT_RLM_MAX_RESULT_CHARS}`));
});
