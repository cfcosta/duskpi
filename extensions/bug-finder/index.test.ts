import test from "node:test";
import assert from "node:assert/strict";
import { extractAssistantText, parseScopeArg } from "./index";

test("parseScopeArg trims text arguments", () => {
  assert.equal(parseScopeArg("  src/lib  "), "src/lib");
});

test("parseScopeArg ignores empty and non-string arguments", () => {
  assert.equal(parseScopeArg("   "), undefined);
  assert.equal(parseScopeArg(undefined), undefined);
  assert.equal(parseScopeArg({}), undefined);
});

test("extractAssistantText returns last assistant text block content", () => {
  const result = extractAssistantText([
    { role: "assistant", content: [{ type: "text", text: "first" }] },
    {
      role: "assistant",
      content: [
        { type: "text", text: "second" },
        { type: "text", text: "third" },
      ],
    },
  ]);

  assert.equal(result, "second\nthird");
});

test("extractAssistantText returns undefined when no text is present", () => {
  const result = extractAssistantText([
    { role: "assistant", content: [{ type: "tool_result", text: "ignored" }] },
  ]);

  assert.equal(result, undefined);
});
