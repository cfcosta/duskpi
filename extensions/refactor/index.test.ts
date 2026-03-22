import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import refactor from "./index";
import { RefactorWorkflow } from "./workflow";
import { buildPrompt, loadPrompts } from "./prompting";

type NotifyLevel = "info" | "warning" | "error";

function assertPhaseWorkflowListenerSurface(
  listeners: Record<string, (...args: unknown[]) => Promise<unknown>>,
) {
  assert.deepEqual(Object.keys(listeners).sort(), [
    "agent_end",
    "session_compact",
    "session_fork",
    "session_shutdown",
    "session_start",
    "session_switch",
    "tool_call",
  ]);
  assert.equal(listeners.before_agent_start, undefined);
  assert.equal(listeners.turn_end, undefined);
}

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
    mapper: "MAPPER",
    skeptic: "SKEPTIC",
    arbiter: "ARBITER",
    executor: "EXECUTOR",
  };

  const workflow = new RefactorWorkflow(api as never, () => ({ ok: true, prompts }));

  return { workflow, ctx: ctx as never, sentMessages, notifications, statuses, widgets };
}

test("workflow advances through mapper and skeptic phases", async () => {
  const { workflow, ctx, sentMessages } = createHarness();

  await workflow.handleCommand("  src  ", ctx);
  assert.equal(sentMessages.length, 1);
  assert.match(sentMessages[0], /MAPPER/);
  assert.match(sentMessages[0], /Focus on: src/);

  await workflow.handleAgentEnd(
    {
      messages: [
        { role: "user", content: [{ type: "text", text: sentMessages[0] }] },
        { role: "assistant", content: [{ type: "text", text: "mapper-report" }] },
      ],
    },
    ctx,
  );
  assert.equal(sentMessages.length, 2);
  assert.match(sentMessages[1], /SKEPTIC/);
  assert.match(sentMessages[1], /mapper-report/);

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
        { role: "assistant", content: [{ type: "text", text: "mapper-report" }] },
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

test("workflow executes executor phase with latest arbiter output", async () => {
  const { workflow, ctx, sentMessages, widgets } = createHarness({
    selectChoice: "Execute refactors (test-backed workflow)",
  });

  await workflow.handleCommand("", ctx);
  await workflow.handleAgentEnd(
    { messages: [{ role: "assistant", content: [{ type: "text", text: "mapper-report" }] }] },
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
  assert.match(sentMessages.at(-1) ?? "", /EXECUTOR/);
  assert.match(sentMessages.at(-1) ?? "", /arbiter-v1/);
});

test("workflow limits refinement attempts", async () => {
  const { workflow, ctx, notifications } = createHarness({
    selectChoice: "Refine the analysis",
    editorValue: "make it sharper",
  });

  await workflow.handleCommand("", ctx);
  await workflow.handleAgentEnd(
    { messages: [{ role: "assistant", content: [{ type: "text", text: "mapper-report" }] }] },
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
  assert.match(notifications.at(-1)?.message ?? "", /refactor cancelled/i);
});

test("analysis phases block write-capable tools and only allow safe bash", async () => {
  const { workflow, ctx } = createHarness();

  await workflow.handleCommand("", ctx);

  const writeResult = await workflow.handleToolCall({ toolName: "Write" });
  const lowerEditResult = await workflow.handleToolCall({ toolName: "edit" });
  const multiEditResult = await workflow.handleToolCall({ toolName: "MultiEdit" });
  const mutatingBashResult = await workflow.handleToolCall({
    toolName: "Bash",
    input: { command: "rm -rf tmp" },
  });
  const readOnlyBashResult = await workflow.handleToolCall({
    toolName: "Bash",
    input: { command: "ls -la" },
  });

  assert.equal(writeResult?.block, true);
  assert.equal(lowerEditResult?.block, true);
  assert.equal(multiEditResult?.block, true);
  assert.deepEqual(mutatingBashResult, {
    block: true,
    reason: "Workflow analysis phase blocked a potentially mutating bash command: rm -rf tmp",
  });
  assert.equal(readOnlyBashResult, undefined);
});

test("loadPrompts loads prompt bundle from a valid directory", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "refactor-prompts-"));
  fs.writeFileSync(path.join(tempDir, "mapper.md"), "mapper");
  fs.writeFileSync(path.join(tempDir, "skeptic.md"), "skeptic");
  fs.writeFileSync(path.join(tempDir, "arbiter.md"), "arbiter");
  fs.writeFileSync(path.join(tempDir, "executor.md"), "executor");

  const result = loadPrompts(tempDir);

  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.prompts.mapper, "mapper");
  }
});

test("loadPrompts returns structured error when files are missing", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "refactor-prompts-missing-"));
  fs.writeFileSync(path.join(tempDir, "mapper.md"), "mapper");

  const result = loadPrompts(tempDir);

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.error.code, "PROMPT_READ_FAILED");
    assert.match(result.error.message, /failed to load prompt bundle/);
  }
});

test("buildPrompt includes refinement contract for arbiter mode", () => {
  const prompt = buildPrompt({
    phase: "arbiter",
    prompts: {
      mapper: "MAPPER",
      skeptic: "SKEPTIC",
      arbiter: "ARBITER",
      executor: "EXECUTOR",
    },
    reports: {
      mapper: "mapper-report",
      skeptic: "skeptic-report",
      arbiter: "arbiter-report",
    },
    refinement: "tighten blast radius",
  });

  assert.match(prompt, /## Existing Arbitration/);
  assert.match(prompt, /arbiter-report/);
  assert.match(prompt, /## Refinement Request/);
  assert.match(prompt, /tighten blast radius/);
});

test("real prompt bundle includes a complete canonical refactoring catalog", () => {
  const promptDirectory = path.join(path.dirname(new URL(import.meta.url).pathname), "prompts");
  const loaded = loadPrompts(promptDirectory);

  assert.equal(loaded.ok, true);
  if (!loaded.ok) {
    return;
  }

  assert.match(loaded.prompts.mapper, /Extract Function/i);
  assert.match(loaded.prompts.mapper, /Inline Function/i);
  assert.match(loaded.prompts.mapper, /Rename Variable/i);
  assert.match(loaded.prompts.mapper, /Move Function\s*\/\s*Method/i);
  assert.match(loaded.prompts.mapper, /Change Function Declaration/i);
  assert.match(loaded.prompts.mapper, /Introduce Parameter Object/i);
  assert.match(loaded.prompts.mapper, /Decompose Conditional/i);
  assert.match(loaded.prompts.mapper, /Pattern-directed and composite refactorings/i);
  assert.match(loaded.prompts.mapper, /Legacy-safe change-enabling transformations/i);
  assert.match(loaded.prompts.mapper, /Cross-boundary refactorings/i);
  assert.match(loaded.prompts.arbiter, /Approved refactoring action catalog/i);
  assert.match(loaded.prompts.arbiter, /Canonical replacements for coarse wording/i);
  assert.match(loaded.prompts.executor, /Refactoring action discipline/i);
  assert.match(loaded.prompts.executor, /Change Function Declaration/i);
  assert.match(loaded.prompts.executor, /Decompose Conditional/i);
  assert.match(loaded.prompts.executor, /Cross-boundary refactorings/i);
});

test("real prompt bundle requires precise refactoring labels and tier separation", () => {
  const promptDirectory = path.join(path.dirname(new URL(import.meta.url).pathname), "prompts");
  const loaded = loadPrompts(promptDirectory);

  assert.equal(loaded.ok, true);
  if (!loaded.ok) {
    return;
  }

  assert.match(
    loaded.prompts.mapper,
    /collapse materially different refactors into umbrella labels/i,
  );
  assert.match(loaded.prompts.skeptic, /catalog blur/i);
  assert.match(loaded.prompts.skeptic, /tier confusion/i);
  assert.match(
    loaded.prompts.arbiter,
    /hides materially different work behind umbrella labels such as/i,
  );
  assert.match(loaded.prompts.executor, /prefer precise labels such as/i);
});

test("real prompt bundle enforces responsibility-first naming guidance", () => {
  const promptDirectory = path.join(path.dirname(new URL(import.meta.url).pathname), "prompts");
  const loaded = loadPrompts(promptDirectory);

  assert.equal(loaded.ok, true);
  if (!loaded.ok) {
    return;
  }

  assert.match(
    loaded.prompts.executor,
    /name new and existing touched code by enduring responsibility/i,
  );
  assert.match(
    loaded.prompts.executor,
    /apply this rule to every symbol introduced, extracted, repurposed, or materially modified/i,
  );
  assert.match(loaded.prompts.executor, /do_foo_with_bar|doXForY|newBackendX|oldPath/i);
  assert.match(loaded.prompts.skeptic, /context-bound naming/i);
  assert.match(loaded.prompts.skeptic, /semantic drift/i);
  assert.match(loaded.prompts.arbiter, /semantic naming quality/i);
  assert.match(
    loaded.prompts.arbiter,
    /materially change an existing symbol's responsibility while preserving a misleading old name/i,
  );
  assert.match(loaded.prompts.mapper, /existing names that have become inaccurate/i);
});

test("real prompt bundle treats coverage gaps as execution work instead of a veto", () => {
  const promptDirectory = path.join(path.dirname(new URL(import.meta.url).pathname), "prompts");
  const loaded = loadPrompts(promptDirectory);

  assert.equal(loaded.ok, true);
  if (!loaded.ok) {
    return;
  }

  assert.match(
    loaded.prompts.mapper,
    /do not discard a structurally valuable candidate only because existing coverage is weak/i,
  );
  assert.match(
    loaded.prompts.skeptic,
    /weak current coverage is not by itself a reason to reject a structurally valuable refactor/i,
  );
  assert.match(
    loaded.prompts.arbiter,
    /thin coverage increases execution work; it does not by itself invalidate a good refactor/i,
  );
  assert.match(
    loaded.prompts.executor,
    /missing starting coverage is not a reason to abandon an approved refactor/i,
  );
  assert.match(loaded.prompts.executor, /test-backed workflow/i);
});

test("real mapper prompt includes the five LLM integration smell names", () => {
  const promptDirectory = path.join(path.dirname(new URL(import.meta.url).pathname), "prompts");
  const loaded = loadPrompts(promptDirectory);

  assert.equal(loaded.ok, true);
  if (!loaded.ok) {
    return;
  }

  assert.match(loaded.prompts.mapper, /Unbounded Max Metrics/i);
  assert.match(loaded.prompts.mapper, /No Model Version Pinning/i);
  assert.match(loaded.prompts.mapper, /No System Message/i);
  assert.match(loaded.prompts.mapper, /No Structured Output/i);
  assert.match(loaded.prompts.mapper, /LLM Temperature Not Explicitly Set/i);
});

test("real mapper prompt limits LLM smell reporting to explicit integration code", () => {
  const promptDirectory = path.join(path.dirname(new URL(import.meta.url).pathname), "prompts");
  const loaded = loadPrompts(promptDirectory);

  assert.equal(loaded.ok, true);
  if (!loaded.ok) {
    return;
  }

  assert.match(loaded.prompts.mapper, /explicit LLM inference or integration code/i);
  assert.match(loaded.prompts.mapper, /concrete repository evidence in code/i);
  assert.match(
    loaded.prompts.mapper,
    /provider SDK\/API usage, model identifiers, system\/user message arrays, temperature settings, max token \/ timeout \/ retry settings, or structured-output \/ schema configuration/i,
  );
  assert.match(
    loaded.prompts.mapper,
    /do not infer these smells from prompt templates, docs, comments, configuration names, or generic AI-adjacent language alone/i,
  );
  assert.match(loaded.prompts.mapper, /NOT APPLICABLE/i);
  assert.match(loaded.prompts.mapper, /cite the exact integration code path/i);
});

test("real skeptic prompt rejects LLM smell claims without direct integration evidence", () => {
  const promptDirectory = path.join(path.dirname(new URL(import.meta.url).pathname), "prompts");
  const loaded = loadPrompts(promptDirectory);

  assert.equal(loaded.ok, true);
  if (!loaded.ok) {
    return;
  }

  assert.match(loaded.prompts.skeptic, /direct LLM integration evidence in code/i);
  assert.match(loaded.prompts.skeptic, /Reject LLM smell claims for non-LLM repositories/i);
  assert.match(
    loaded.prompts.skeptic,
    /only mention AI in docs, comments, prompt text, or naming/i,
  );
  assert.match(
    loaded.prompts.skeptic,
    /prompt templates, markdown guidance, README examples, or configuration labels/i,
  );
  assert.match(
    loaded.prompts.skeptic,
    /generic best-practice advice masquerading as a repo-specific smell finding/i,
  );
  assert.match(
    loaded.prompts.skeptic,
    /concrete call site, message construction path, schema expectation, model identifier, or request-setting omission/i,
  );
});

test("workflow reports invalid assistant payload instead of retrying as empty output", async () => {
  const { workflow, ctx, sentMessages, notifications } = createHarness();

  await workflow.handleCommand("", ctx);
  assert.equal(sentMessages.length, 1);

  const result = await workflow.handleAgentEnd(
    { messages: [{ role: "assistant", content: "invalid-payload-shape" }] },
    ctx,
  );

  assert.equal(result.kind, "recoverable_error");
  assert.equal(result.reason, "invalid_agent_payload");
  assert.equal(notifications.at(-1)?.level, "error");
  assert.match(notifications.at(-1)?.message ?? "", /invalid assistant payload/i);
});

test("refactor command wiring uses real prompt files end-to-end", async () => {
  const commands: Record<string, { handler: (args: unknown, ctx: unknown) => Promise<unknown> }> =
    {};
  const listeners: Record<string, (...args: unknown[]) => Promise<unknown>> = {};
  const sentMessages: string[] = [];

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
    sendUserMessage(message: string) {
      sentMessages.push(message);
    },
  };

  const ctx = {
    ui: {
      notify() {},
      setStatus() {},
      setWidget() {},
      async select() {
        return "Cancel";
      },
      async editor() {
        return "";
      },
    },
  };

  refactor(api as never);

  await commands["refactor"]?.handler("", ctx as never);
  assert.match(sentMessages[0] ?? "", /You are a refactor mapping agent/);

  await listeners.agent_end?.(
    { messages: [{ role: "assistant", content: [{ type: "text", text: "mapper-report" }] }] },
    ctx,
  );
  assert.match(sentMessages[1] ?? "", /You are an adversarial refactor reviewer/);
});

test("refactor registers command and event handlers", () => {
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

  refactor(api as never);

  assert.ok(commands["refactor"]);
  assertPhaseWorkflowListenerSurface(listeners);
});
