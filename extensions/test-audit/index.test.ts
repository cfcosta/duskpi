import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import testAudit from "./index";
import { TEST_AUDIT_PLAN_JSON_BLOCK_TAG, parseTaggedTestAuditPlan } from "./contract";
import {
  TestAuditWorkflow,
  type TestAuditExecutionManagerLike,
  type TestAuditExecutionSchedulerLike,
} from "./workflow";
import { TEST_AUDIT_WORKER_RESULT_JSON_BLOCK_TAG, parseTaggedWorkerResult } from "./worker-result";
import { buildPrompt, loadPrompts } from "./prompting";

type NotifyLevel = "info" | "warning" | "error";

function assertGuidedWorkflowListenerSurface(
  listeners: Record<string, (...args: unknown[]) => Promise<unknown>>,
) {
  assert.deepEqual(Object.keys(listeners).sort(), [
    "agent_end",
    "before_agent_start",
    "session_compact",
    "session_fork",
    "session_shutdown",
    "session_start",
    "session_switch",
    "tool_call",
    "turn_end",
  ]);
}

function buildApprovedPlanText(
  units?: Array<{
    id: string;
    title: string;
    objective: string;
    targets: string[];
    validations: string[];
    dependsOn: string[];
  }>,
): string {
  return [
    "Approved test-audit plan",
    "",
    `\`\`\`${TEST_AUDIT_PLAN_JSON_BLOCK_TAG}`,
    JSON.stringify(
      {
        version: 1,
        kind: "approved_test_audit_plan",
        summary: "Improve verified test gaps with dependency-aware execution units.",
        executionUnits: units ?? [
          {
            id: "rewrite-tautological-parser-test",
            title: "Rewrite tautological parser test",
            objective:
              "Replace the false-confidence parser test with one that fails on a realistic fault.",
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
  ].join("\n");
}

function buildExecutionResultText(step: number, status: "done" | "skipped"): string {
  return [
    "Execution update",
    "",
    "```pi-plan-json",
    JSON.stringify(
      {
        version: 2,
        kind: "execution_result",
        scope: "plan",
        step,
        status,
        summary: `Step ${step} ${status}`,
        changedTargets: [],
        validationsRun: [],
        checkpointsReached: [],
      },
      null,
      2,
    ),
    "```",
  ].join("\n");
}

function createHarness(options?: {
  selectChoice?: string;
  editorValue?: string;
  failSendCount?: number;
  executionManager?: TestAuditExecutionManagerLike;
  executionScheduler?: TestAuditExecutionSchedulerLike;
}) {
  const sentMessages: string[] = [];
  const sentCustomMessages: Array<{ content?: unknown; customType?: string }> = [];
  const notifications: Array<{ message: string; level: NotifyLevel }> = [];
  const statuses: Array<string | undefined> = [];
  const widgets: Array<string | undefined> = [];
  const executionCalls: Array<{
    id: string;
    step?: number;
    totalSteps?: number;
    summary?: string;
  }> = [];

  let failSendCount = options?.failSendCount ?? 0;

  const executionManager: TestAuditExecutionManagerLike = options?.executionManager ?? {
    async executeUnit(input) {
      executionCalls.push({
        id: input.executionUnit.id,
        step: input.step,
        totalSteps: input.totalSteps,
        summary: input.approvedPlanSummary,
      });
      return {
        unitId: input.executionUnit.id,
        status: "completed",
        summary: `Integrated ${input.executionUnit.id}`,
        changedFiles: [...input.executionUnit.targets],
        validations: input.executionUnit.validations.map((command) => ({
          command,
          outcome: "passed" as const,
        })),
      };
    },
  };

  const api = {
    sendMessage(message: { content?: unknown; customType?: string }) {
      sentCustomMessages.push(message);
    },
    sendUserMessage(message: string) {
      if (failSendCount > 0) {
        failSendCount -= 1;
        throw new Error("send failed");
      }

      sentMessages.push(message);
    },
    async exec() {
      return { stdout: "", stderr: "", code: 0, killed: false };
    },
  };

  const ctx = {
    hasUI: true,
    cwd: "/repo",
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

  const workflow = new TestAuditWorkflow(
    api as never,
    () => ({ ok: true, prompts }),
    executionManager,
    options?.executionScheduler,
  );

  return {
    workflow,
    ctx: ctx as never,
    sentMessages,
    sentCustomMessages,
    notifications,
    statuses,
    widgets,
    executionCalls,
  };
}

test("workflow sends a guided planning prompt with scope and embedded review stages", async () => {
  const { workflow, ctx, sentMessages } = createHarness();

  const result = await workflow.handleCommand("  src  ", ctx);

  assert.deepEqual(result, { kind: "ok" });
  assert.equal(sentMessages.length, 1);
  assert.match(sentMessages[0] ?? "", /FINDER/);
  assert.match(sentMessages[0] ?? "", /SKEPTIC/);
  assert.match(sentMessages[0] ?? "", /ARBITER/);
  assert.match(sentMessages[0] ?? "", /Focus on: src/);
  assert.match(sentMessages[0] ?? "", /Guided Planning Mode/);
});

test("workflow ignores agent_end events that do not match the pending prompt", async () => {
  const { workflow, ctx, sentMessages } = createHarness();

  await workflow.handleCommand("", ctx);
  assert.equal(sentMessages.length, 1);

  const mismatched = await workflow.handleAgentEnd(
    {
      messages: [
        { role: "user", content: [{ type: "text", text: "some other prompt" }] },
        { role: "assistant", content: [{ type: "text", text: buildApprovedPlanText() }] },
      ],
    },
    ctx,
  );

  assert.equal(mismatched.kind, "blocked");
  assert.equal(mismatched.reason, "unmatched_agent_end");
  assert.equal(sentMessages.length, 1);
});

test("workflow stops after bounded invalid-output retries", async () => {
  const { workflow, ctx, sentMessages, notifications } = createHarness();

  await workflow.handleCommand("", ctx);
  assert.equal(sentMessages.length, 1);

  for (let i = 0; i < 3; i += 1) {
    await workflow.handleAgentEnd(
      {
        messages: [
          { role: "user", content: [{ type: "text", text: sentMessages.at(-1) ?? "" }] },
          { role: "assistant", content: [{ type: "tool_result", text: "nope" }] },
        ],
      },
      ctx,
    );
  }

  assert.equal(sentMessages.length, 3);
  assert.equal(notifications[0]?.level, "warning");
  assert.match(notifications[0]?.message ?? "", /Retrying \(1\/2\)/);
  assert.equal(notifications[1]?.level, "warning");
  assert.match(notifications[1]?.message ?? "", /Retrying \(2\/2\)/);
  assert.equal(notifications.at(-1)?.level, "error");
  assert.match(notifications.at(-1)?.message ?? "", /assistant output stayed empty or invalid/i);
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
  assert.match(notifications.at(-1)?.message ?? "", /failed to send planning prompt/i);

  const secondRun = await workflow.handleCommand("", ctx);
  assert.equal(secondRun.kind, "ok");
});

test("workflow sends a refinement planning prompt when the user asks to refine the plan", async () => {
  const { workflow, ctx, sentMessages } = createHarness({
    selectChoice: "Refine the analysis",
    editorValue: "prioritize high-risk gaps",
  });

  await workflow.handleCommand("", ctx);
  await workflow.handleAgentEnd(
    {
      messages: [
        { role: "user", content: [{ type: "text", text: sentMessages[0] ?? "" }] },
        { role: "assistant", content: [{ type: "text", text: buildApprovedPlanText() }] },
      ],
    },
    ctx,
  );

  assert.equal(sentMessages.length, 2);
  assert.match(sentMessages[1] ?? "", /Refinement Request/);
  assert.match(sentMessages[1] ?? "", /prioritize high-risk gaps/);
  assert.match(sentMessages[1] ?? "", /Existing Approved Test-Audit Plan \(Structured Contract\)/);
});

test("workflow executes approved test-audit units through the guided execution runtime", async () => {
  const { workflow, ctx, sentMessages, executionCalls } = createHarness({
    selectChoice: "Execute fixes (test-driven workflow)",
  });

  await workflow.handleCommand("", ctx);
  await workflow.handleAgentEnd(
    {
      messages: [
        { role: "user", content: [{ type: "text", text: sentMessages[0] ?? "" }] },
        { role: "assistant", content: [{ type: "text", text: buildApprovedPlanText() }] },
      ],
    },
    ctx,
  );

  assert.deepEqual(executionCalls, [
    {
      id: "rewrite-tautological-parser-test",
      step: 1,
      totalSteps: 1,
      summary: "Improve verified test gaps with dependency-aware execution units.",
    },
  ]);
  assert.match(
    sentMessages.at(-1) ?? "",
    /Execution manager processed approved test-audit unit 1\/1/,
  );
  assert.match(sentMessages.at(-1) ?? "", /Unit ID: rewrite-tautological-parser-test/);
  assert.match(sentMessages.at(-1) ?? "", /emit an execution_result tagged JSON block/i);
});

test("workflow uses dependency-layer scheduling for independent execution units", async () => {
  const scheduleCalls: Array<{ unitIds: string[]; summary?: string }> = [];
  const scheduler: TestAuditExecutionSchedulerLike = {
    async execute(input) {
      scheduleCalls.push({
        unitIds: input.executionUnits.map((unit) => unit.id),
        summary: input.approvedPlanSummary,
      });
      return {
        status: "completed",
        layers: [
          {
            layer: 1,
            unitIds: ["rewrite-tautological-parser-test", "add-error-path-coverage"],
            results: [
              {
                unitId: "rewrite-tautological-parser-test",
                status: "completed",
                summary: "Rewrote the tautological parser test.",
                changedFiles: ["src/parser.test.ts"],
                validations: [],
              },
              {
                unitId: "add-error-path-coverage",
                status: "completed",
                summary: "Added parser error-path coverage.",
                changedFiles: ["src/parser.test.ts"],
                validations: [],
              },
            ],
          },
        ],
        remainingUnitIds: [],
      };
    },
  };

  const { workflow, ctx, sentMessages, executionCalls } = createHarness({
    selectChoice: "Execute fixes (test-driven workflow)",
    executionScheduler: scheduler,
  });

  await workflow.handleCommand("", ctx);
  await workflow.handleAgentEnd(
    {
      messages: [
        { role: "user", content: [{ type: "text", text: sentMessages[0] ?? "" }] },
        {
          role: "assistant",
          content: [
            {
              type: "text",
              text: buildApprovedPlanText([
                {
                  id: "rewrite-tautological-parser-test",
                  title: "Rewrite tautological parser test",
                  objective:
                    "Replace the false-confidence parser test with one that fails on a realistic fault.",
                  targets: ["src/parser.test.ts"],
                  validations: ["bun test extensions/test-audit/index.test.ts"],
                  dependsOn: [],
                },
                {
                  id: "add-error-path-coverage",
                  title: "Add error-path coverage",
                  objective: "Add a missing regression test for the parser error path.",
                  targets: ["src/parser.test.ts"],
                  validations: ["bun test extensions/test-audit/index.test.ts"],
                  dependsOn: [],
                },
              ]),
            },
          ],
        },
      ],
    },
    ctx,
  );

  assert.deepEqual(executionCalls, []);
  assert.deepEqual(scheduleCalls, [
    {
      unitIds: ["rewrite-tautological-parser-test", "add-error-path-coverage"],
      summary: "Improve verified test gaps with dependency-aware execution units.",
    },
  ]);
  assert.match(
    sentMessages.at(-1) ?? "",
    /Execution scheduler processed 2 approved test-audit units/,
  );
  assert.match(
    sentMessages.at(-1) ?? "",
    /Step 1 \(rewrite-tautological-parser-test\): emit execution_result status "done"/,
  );
  assert.match(
    sentMessages.at(-1) ?? "",
    /Step 2 \(add-error-path-coverage\): emit execution_result status "done"/,
  );
});

test("workflow resets after an execution_result turn update", async () => {
  const { workflow, ctx, sentMessages, notifications } = createHarness({
    selectChoice: "Execute fixes (test-driven workflow)",
  });

  await workflow.handleCommand("", ctx);
  await workflow.handleAgentEnd(
    {
      messages: [
        { role: "user", content: [{ type: "text", text: sentMessages[0] ?? "" }] },
        { role: "assistant", content: [{ type: "text", text: buildApprovedPlanText() }] },
      ],
    },
    ctx,
  );

  await workflow.handleTurnEnd(
    {
      message: {
        role: "assistant",
        content: [{ type: "text", text: buildExecutionResultText(1, "done") }],
      },
    } as never,
    ctx,
  );

  const rerun = await workflow.handleCommand("second run", ctx);
  assert.deepEqual(rerun, { kind: "ok" });
  assert.equal(notifications.length, 0);
});

test("analysis phases block write-capable tools and only allow safe bash", async () => {
  const { workflow, ctx } = createHarness();

  await workflow.handleCommand("", ctx);

  const writeResult = await workflow.handleToolCall({ toolName: "Write" } as never, ctx);
  const lowerEditResult = await workflow.handleToolCall({ toolName: "edit" } as never, ctx);
  const multiEditResult = await workflow.handleToolCall({ toolName: "MultiEdit" } as never, ctx);
  const mutatingBashResult = await workflow.handleToolCall(
    {
      toolName: "Bash",
      input: { command: "rm -rf tmp" },
    } as never,
    ctx,
  );
  const readOnlyBashResult = await workflow.handleToolCall(
    {
      toolName: "Bash",
      input: { command: "ls -la" },
    } as never,
    ctx,
  );

  assert.equal(writeResult?.block, true);
  assert.equal(lowerEditResult?.block, true);
  assert.equal(multiEditResult?.block, true);
  assert.deepEqual(mutatingBashResult, {
    block: true,
    reason:
      "Guided workflow planning phase blocked a potentially mutating bash command: rm -rf tmp",
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
              objective:
                "Replace the false-confidence parser test with one that fails on a realistic fault.",
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
    sendMessage() {},
    sendUserMessage(message: string) {
      sentMessages.push(message);
    },
    async exec() {
      return { stdout: "", stderr: "", code: 0, killed: false };
    },
  };

  const ctx = {
    hasUI: true,
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
  assert.match(sentMessages[0] ?? "", /You are an adversarial test reviewer/);
  assert.match(sentMessages[0] ?? "", /You are the final arbiter in a test-audit workflow/);

  await listeners.agent_end?.(
    {
      messages: [
        { role: "user", content: [{ type: "text", text: sentMessages[0] ?? "" }] },
        { role: "assistant", content: [{ type: "text", text: buildApprovedPlanText() }] },
      ],
    },
    ctx,
  );

  assert.equal(sentMessages.length, 1);
});

test("testAudit registers command and guided workflow event handlers", () => {
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
    sendMessage() {},
    sendUserMessage() {},
    async exec() {
      return { stdout: "", stderr: "", code: 0, killed: false };
    },
  };

  testAudit(api as never);

  assert.ok(commands["test-audit"]);
  assertGuidedWorkflowListenerSurface(listeners);
});
