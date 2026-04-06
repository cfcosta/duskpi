import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import testAudit from "./index";
import { TEST_AUDIT_PLAN_JSON_BLOCK_TAG, parseTaggedTestAuditPlan } from "./contract";
import { TestAuditWorkflow } from "./workflow";
import { TEST_AUDIT_WORKER_RESULT_JSON_BLOCK_TAG, parseTaggedWorkerResult } from "./worker-result";
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
    finder: "FINDER",
    skeptic: "SKEPTIC",
    arbiter: "ARBITER",
    fixer: "FIXER",
  };

  const workflow = new TestAuditWorkflow(api as never, () => ({ ok: true, prompts }));

  return { workflow, ctx: ctx as never, sentMessages, notifications, statuses, widgets };
}

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
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "test-audit-prompts-"));
  fs.writeFileSync(path.join(tempDir, "finder.md"), "finder");
  fs.writeFileSync(path.join(tempDir, "skeptic.md"), "skeptic");
  fs.writeFileSync(path.join(tempDir, "arbiter.md"), "arbiter");
  fs.writeFileSync(path.join(tempDir, "fixer.md"), "fixer");

  const result = loadPrompts(tempDir);

  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.prompts.finder, "finder");
  }
});

test("loadPrompts returns structured error when files are missing", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "test-audit-prompts-missing-"));
  fs.writeFileSync(path.join(tempDir, "finder.md"), "finder");

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
      finder: "FINDER",
      skeptic: "SKEPTIC",
      arbiter: "ARBITER",
      fixer: "FIXER",
    },
    reports: {
      finder: "finder-report",
      skeptic: "skeptic-report",
      arbiter: "arbiter-report",
    },
    refinement: "prioritize high-risk gaps",
  });

  assert.match(prompt, /## Existing Approved Test-Audit Plan \(Structured Contract\)/);
  assert.match(prompt, /arbiter-report/);
  assert.match(prompt, /## Refinement Request/);
  assert.match(prompt, /prioritize high-risk gaps/);
  assert.match(prompt, new RegExp(TEST_AUDIT_PLAN_JSON_BLOCK_TAG, "i"));
  assert.match(prompt, /fully revised test-audit plan in the structured contract format/i);
});

test("buildPrompt passes the approved test-audit plan to fixer mode as a structured contract", () => {
  const prompt = buildPrompt({
    phase: "fixer",
    prompts: {
      finder: "FINDER",
      skeptic: "SKEPTIC",
      arbiter: "ARBITER",
      fixer: "FIXER",
    },
    reports: {
      arbiter: "approved-plan-report",
    },
  });

  assert.match(prompt, /## Approved Test-Audit Plan \(Structured Contract\)/);
  assert.match(prompt, /approved-plan-report/);
});

test("parseTaggedTestAuditPlan parses the approved test-audit structured contract", () => {
  const result = parseTaggedTestAuditPlan(
    [
      `\`\`\`${TEST_AUDIT_PLAN_JSON_BLOCK_TAG}`,
      JSON.stringify(
        {
          version: 1,
          kind: "approved_test_audit_plan",
          summary: "Rewrite defective parser tests and add a regression for the error path.",
          executionUnits: [
            {
              id: "rewrite-tautological-parser-test",
              title: "Rewrite tautological parser test",
              objective: "Replace the false-confidence parser test with one that fails on a realistic fault.",
              targets: ["src/parser.test.ts"],
              validations: ["bun test extensions/test-audit/index.test.ts"],
              dependsOn: [],
            },
          ],
        },
        null,
        2,
      ),
      "\`\`\`",
    ].join("\n"),
  );

  assert.equal(result.ok, true);
  if (!result.ok) {
    return;
  }

  assert.equal(result.value.executionUnits[0]?.id, "rewrite-tautological-parser-test");
});

test("parseTaggedWorkerResult parses the test-audit worker-result structured contract", () => {
  const result = parseTaggedWorkerResult(
    [
      `\`\`\`${TEST_AUDIT_WORKER_RESULT_JSON_BLOCK_TAG}`,
      JSON.stringify(
        {
          version: 1,
          kind: "test_audit_worker_result",
          unitId: "rewrite-tautological-parser-test",
          status: "completed",
          summary: "Rewrote the parser test so it fails on a realistic parser fault.",
          changedFiles: ["src/parser.test.ts"],
          validations: [
            {
              command: "bun test extensions/test-audit/index.test.ts",
              outcome: "passed",
            },
          ],
        },
        null,
        2,
      ),
      "\`\`\`",
    ].join("\n"),
  );

  assert.equal(result.ok, true);
  if (!result.ok) {
    return;
  }

  assert.equal(result.value.unitId, "rewrite-tautological-parser-test");
});

test("real prompt bundle wires arbiter and fixer to the test-audit structured contracts", () => {
  const result = loadPrompts(path.resolve(path.dirname(fileURLToPath(import.meta.url)), "prompts"));

  assert.equal(result.ok, true);
  if (!result.ok) {
    return;
  }

  assert.match(result.prompts.arbiter, /test-audit-plan-json/i);
  assert.match(result.prompts.arbiter, /approved_test_audit_plan/i);
  assert.match(result.prompts.fixer, /test-audit-plan-json/i);
  assert.match(result.prompts.fixer, /test-audit-worker-result-json/i);
  assert.match(result.prompts.fixer, /test_audit_worker_result/i);
});

test("testAudit command wiring uses real prompt files end-to-end", async () => {
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

  testAudit(api as never);

  await commands["test-audit"]?.handler("", ctx as never);
  assert.match(sentMessages[0] ?? "", /You are a test-audit finding agent/);

  await listeners.agent_end?.(
    { messages: [{ role: "assistant", content: [{ type: "text", text: "finder-report" }] }] },
    ctx,
  );
  assert.match(sentMessages[1] ?? "", /You are an adversarial test reviewer/);
});

test("testAudit registers only phase-workflow command and event handlers", () => {
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
  assertPhaseWorkflowListenerSurface(listeners);
});
