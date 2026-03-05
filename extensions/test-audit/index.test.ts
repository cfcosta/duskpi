import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import testAudit from "./index";
import { TestAuditWorkflow } from "./workflow";
import { extractAssistantText, parseScopeArg } from "./messages";
import { loadPrompts } from "./prompting";

type NotifyLevel = "info" | "warning" | "error";

function createHarness(options?: {
  selectChoice?: string;
  editorValue?: string;
  failSendCount?: number;
}) {
  const sentMessages: string[] = [];
  const notifications: Array<{ message: string; level: NotifyLevel }> = [];
  const statuses: Array<string | undefined> = [];
  const widgets: Array<string | undefined> = [];

  let failSendCount = options?.failSendCount ?? 0;

  const api = {
    sendUserMessage(message: string) {
      if (failSendCount > 0) {
        failSendCount -= 1;
        throw new Error("send failed");
      }

      sentMessages.push(message);
    },
  };

  const ctx = {
    ui: {
      notify(message: string, level: NotifyLevel) {
        notifications.push({ message, level });
      },
      setStatus(_id: string, status: string | undefined) {
        statuses.push(status);
      },
      setWidget(_id: string, widget: string | undefined) {
        widgets.push(widget);
      },
      async select() {
        return options?.selectChoice ?? "Cancel";
      },
      async editor() {
        return options?.editorValue ?? "";
      },
    },
  };

  const prompts = {
    finder: "FINDER",
    skeptic: "SKEPTIC",
    arbiter: "ARBITER",
    fixer: "FIXER",
  };

  const workflow = new TestAuditWorkflow(api as never, () => ({ prompts }));

  return { workflow, ctx: ctx as never, sentMessages, notifications, statuses, widgets };
}

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

test("extractAssistantText does not reuse stale assistant output", () => {
  const result = extractAssistantText([
    { role: "assistant", content: [{ type: "text", text: "stale" }] },
    { role: "user", content: [{ type: "text", text: "new prompt" }] },
  ]);

  assert.equal(result, undefined);
});

test("workflow advances through finder and skeptic phases", async () => {
  const { workflow, ctx, sentMessages } = createHarness();

  await workflow.handleCommand("  src  ", ctx);
  assert.equal(sentMessages.length, 1);
  assert.match(sentMessages[0], /FINDER/);
  assert.match(sentMessages[0], /Focus on: src/);

  await workflow.handleAgentEnd(
    {
      messages: [
        { role: "user", content: [{ type: "text", text: sentMessages[0] }] },
        { role: "assistant", content: [{ type: "text", text: "gaps" }] },
      ],
    },
    ctx,
  );
  assert.equal(sentMessages.length, 2);
  assert.match(sentMessages[1], /SKEPTIC/);
  assert.match(sentMessages[1], /gaps/);

  await workflow.handleAgentEnd(
    {
      messages: [
        { role: "user", content: [{ type: "text", text: sentMessages[1] }] },
        { role: "assistant", content: [{ type: "text", text: "skeptic-notes" }] },
      ],
    },
    ctx,
  );
  assert.equal(sentMessages.length, 3);
  assert.match(sentMessages[2], /ARBITER/);
  assert.match(sentMessages[2], /skeptic-notes/);
});

test("workflow ignores agent_end events that do not match pending prompt", async () => {
  const { workflow, ctx, sentMessages } = createHarness();

  await workflow.handleCommand("", ctx);
  assert.equal(sentMessages.length, 1);

  const mismatched = await workflow.handleAgentEnd(
    {
      messages: [
        { role: "user", content: [{ type: "text", text: "some other prompt" }] },
        { role: "assistant", content: [{ type: "text", text: "wrong response" }] },
      ],
    },
    ctx,
  );

  assert.equal(mismatched.kind, "blocked");
  assert.equal(mismatched.reason, "unmatched_agent_end");
  assert.equal(sentMessages.length, 1);

  await workflow.handleAgentEnd(
    {
      messages: [
        { role: "user", content: [{ type: "text", text: sentMessages[0] }] },
        { role: "assistant", content: [{ type: "text", text: "finder-report" }] },
      ],
    },
    ctx,
  );

  assert.equal(sentMessages.length, 2);
  assert.match(sentMessages[1], /SKEPTIC/);
});

test("workflow stops after bounded empty-output retries", async () => {
  const { workflow, ctx, sentMessages, notifications } = createHarness();

  await workflow.handleCommand("", ctx);
  assert.equal(sentMessages.length, 1);

  for (let i = 0; i < 3; i += 1) {
    await workflow.handleAgentEnd(
      { messages: [{ role: "assistant", content: [{ type: "tool_result", text: "nope" }] }] },
      ctx,
    );
  }

  assert.equal(notifications.at(-1)?.level, "info");
  assert.match(notifications.at(-1)?.message ?? "", /stopped: no assistant output/);
});

test("workflow blocks rerun while active", async () => {
  const { workflow, ctx, notifications } = createHarness();

  await workflow.handleCommand("first", ctx);
  await workflow.handleCommand("second", ctx);

  assert.equal(notifications.at(-1)?.level, "warning");
  assert.match(notifications.at(-1)?.message ?? "", /already running/);
});

test("workflow recovers cleanly when sendUserMessage throws", async () => {
  const { workflow, ctx, notifications } = createHarness({ failSendCount: 1 });

  const firstRun = await workflow.handleCommand("", ctx);
  assert.equal(firstRun.kind, "recoverable_error");
  assert.equal(notifications.at(-1)?.level, "error");
  assert.match(notifications.at(-1)?.message ?? "", /failed to send prompt/i);

  const secondRun = await workflow.handleCommand("", ctx);
  assert.equal(secondRun.kind, "ok");
});

test("workflow executes fixer phase with latest arbiter output", async () => {
  const { workflow, ctx, sentMessages, widgets } = createHarness({
    selectChoice: "Execute fixes (test-driven workflow)",
  });

  await workflow.handleCommand("", ctx);
  await workflow.handleAgentEnd(
    { messages: [{ role: "assistant", content: [{ type: "text", text: "finder-report" }] }] },
    ctx,
  );
  await workflow.handleAgentEnd(
    { messages: [{ role: "assistant", content: [{ type: "text", text: "skeptic-report" }] }] },
    ctx,
  );
  await workflow.handleAgentEnd(
    { messages: [{ role: "assistant", content: [{ type: "text", text: "arbiter-v1" }] }] },
    ctx,
  );

  assert.equal(widgets.at(-1), undefined);
  assert.match(sentMessages.at(-1) ?? "", /FIXER/);
  assert.match(sentMessages.at(-1) ?? "", /arbiter-v1/);
});

test("workflow limits refinement attempts", async () => {
  const { workflow, ctx, notifications } = createHarness({
    selectChoice: "Refine the analysis",
    editorValue: "make it sharper",
  });

  await workflow.handleCommand("", ctx);
  await workflow.handleAgentEnd(
    { messages: [{ role: "assistant", content: [{ type: "text", text: "finder-report" }] }] },
    ctx,
  );
  await workflow.handleAgentEnd(
    { messages: [{ role: "assistant", content: [{ type: "text", text: "skeptic-report" }] }] },
    ctx,
  );

  for (let i = 0; i < 4; i += 1) {
    await workflow.handleAgentEnd(
      { messages: [{ role: "assistant", content: [{ type: "text", text: `arbiter-${i}` }] }] },
      ctx,
    );
  }

  assert.equal(notifications.at(-1)?.level, "info");
  assert.match(notifications.at(-1)?.message ?? "", /cancelled/i);
});

test("analysis phases block write-capable tool variants", async () => {
  const { workflow, ctx } = createHarness();

  await workflow.handleCommand("", ctx);

  const writeResult = await workflow.handleToolCall({ toolName: "Write" });
  const lowerEditResult = await workflow.handleToolCall({ toolName: "edit" });
  const multiEditResult = await workflow.handleToolCall({ toolName: "MultiEdit" });

  assert.equal(writeResult?.block, true);
  assert.equal(lowerEditResult?.block, true);
  assert.equal(multiEditResult?.block, true);
});

test("loadPrompts loads prompt bundle from a valid directory", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "test-audit-prompts-"));
  fs.writeFileSync(path.join(tempDir, "finder.md"), "finder");
  fs.writeFileSync(path.join(tempDir, "skeptic.md"), "skeptic");
  fs.writeFileSync(path.join(tempDir, "arbiter.md"), "arbiter");
  fs.writeFileSync(path.join(tempDir, "fixer.md"), "fixer");

  const result = loadPrompts(tempDir);

  assert.equal(result.error, undefined);
  assert.equal(result.prompts?.finder, "finder");
});

test("loadPrompts returns structured error when files are missing", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "test-audit-prompts-missing-"));
  fs.writeFileSync(path.join(tempDir, "finder.md"), "finder");

  const result = loadPrompts(tempDir);

  assert.equal(result.prompts, undefined);
  assert.equal(result.error?.code, "PROMPT_READ_FAILED");
  assert.match(result.error?.message ?? "", /failed to load prompt bundle/);
});

test("testAudit registers command and event handlers", () => {
  const commands: Record<string, { handler: (args: unknown, ctx: unknown) => Promise<unknown> }> =
    {};
  const listeners: Record<string, (...args: unknown[]) => Promise<unknown>> = {};

  const api = {
    registerCommand(
      name: string,
      config: { handler: (args: unknown, ctx: unknown) => Promise<unknown> },
    ) {
      commands[name] = config;
    },
    on(name: string, handler: (...args: unknown[]) => Promise<unknown>) {
      listeners[name] = handler;
    },
    sendUserMessage() {},
  };

  testAudit(api as never);

  assert.ok(commands["test-audit"]);
  assert.ok(listeners.tool_call);
  assert.ok(listeners.agent_end);
});
