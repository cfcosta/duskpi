import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import refactor from "./index";
import { REFACTOR_PLAN_JSON_BLOCK_TAG } from "./contract";
import type { RefactorExecutionManager } from "./execution-manager";
import type { RefactorExecutionScheduler } from "./execution-scheduler";
import { RefactorWorkflow } from "./workflow";
import { buildPrompt, buildWorkerPrompt, loadPrompts } from "./prompting";

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

function createHarness(options?: {
  failSendCount?: number;
  selectChoice?: string;
  editorValue?: string;
  executionManager?: RefactorExecutionManager;
  executionScheduler?: RefactorExecutionScheduler;
}) {
  const sentMessages: string[] = [];
  const sentCustomMessages: Array<{ customType?: string; content?: unknown; display?: boolean }> =
    [];
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
    sendMessage(message: { customType?: string; content?: unknown; display?: boolean }) {
      sentCustomMessages.push(message);
    },
    async exec() {
      return { stdout: "", stderr: "", code: 0, killed: false };
    },
  };

  const ctx = {
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
        return options?.selectChoice;
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
    worker: "WORKER",
  };

  const workflow = new RefactorWorkflow(
    api as never,
    () => ({ ok: true, prompts }),
    options?.executionManager,
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
  };
}

function textMessage(text: string) {
  return { role: "assistant", content: [{ type: "text", text }] };
}

function buildApprovedPlanText() {
  return [
    "Approved refactor program",
    "",
    `\`\`\`${REFACTOR_PLAN_JSON_BLOCK_TAG}`,
    JSON.stringify(
      {
        version: 1,
        kind: "approved_refactor_plan",
        summary: "Split the refactor workflow into explicit execution units.",
        executionUnits: [
          {
            id: "guided-shell",
            title: "Adopt GuidedWorkflow",
            objective: "Move /refactor planning to GuidedWorkflow.",
            targets: ["extensions/refactor/workflow.ts"],
            validations: ["bun test extensions/refactor/index.test.ts"],
            dependsOn: ["contract-core"],
          },
          {
            id: "contract-core",
            title: "Add contract parser",
            objective: "Introduce a machine-checkable refactor plan contract.",
            targets: ["extensions/refactor/contract.ts"],
            validations: ["bun test extensions/refactor/contract.test.ts"],
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

function buildSingleUnitApprovedPlanText() {
  return [
    "Approved refactor program",
    "",
    `\`\`\`${REFACTOR_PLAN_JSON_BLOCK_TAG}`,
    JSON.stringify(
      {
        version: 1,
        kind: "approved_refactor_plan",
        summary: "Execute one approved refactor unit.",
        executionUnits: [
          {
            id: "guided-shell",
            title: "Adopt GuidedWorkflow",
            objective: "Move /refactor planning to GuidedWorkflow.",
            targets: ["extensions/refactor/workflow.ts"],
            validations: ["bun test extensions/refactor/index.test.ts"],
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

test("workflow starts by sending the mapper planning prompt", async () => {
  const { workflow, ctx, sentMessages } = createHarness();

  await workflow.handleCommand("  src  ", ctx);

  assert.equal(sentMessages.length, 1);
  assert.match(sentMessages[0], /MAPPER/);
  assert.match(sentMessages[0], /Focus on: src/);
});

test("workflow ignores agent_end events that do not match the active planning request", async () => {
  const { workflow, ctx, sentMessages } = createHarness();

  await workflow.handleCommand("", ctx);

  const mismatched = await workflow.handleAgentEnd(
    {
      messages: [
        { role: "user", content: [{ type: "text", text: "some other prompt" }] },
        textMessage("wrong response"),
      ],
    },
    ctx,
  );

  assert.equal(mismatched.kind, "blocked");
  assert.equal(mismatched.reason, "unmatched_agent_end");
  assert.equal(sentMessages.length, 1);
});

test("workflow sends a hidden skeptic critique after the mapper response", async () => {
  const { workflow, ctx, sentMessages, sentCustomMessages } = createHarness();

  await workflow.handleCommand("", ctx);
  await workflow.handleAgentEnd(
    {
      messages: [
        { role: "user", content: [{ type: "text", text: sentMessages[0]! }] },
        textMessage("mapper-report"),
      ],
    },
    ctx,
  );

  assert.equal(sentCustomMessages.length, 1);
  assert.match(String(sentCustomMessages[0]?.content ?? ""), /SKEPTIC/);
  assert.match(String(sentCustomMessages[0]?.content ?? ""), /mapper-report/);
  assert.match(String(sentCustomMessages[0]?.content ?? ""), /Verdict: PASS/);
});

test("workflow sends a hidden arbiter revision after a REFINE critique", async () => {
  const { workflow, ctx, sentMessages, sentCustomMessages } = createHarness();

  await workflow.handleCommand("", ctx);
  await workflow.handleAgentEnd(
    {
      messages: [
        { role: "user", content: [{ type: "text", text: sentMessages[0]! }] },
        textMessage("mapper-report"),
      ],
    },
    ctx,
  );

  const critiquePrompt = String(sentCustomMessages[0]?.content ?? "");
  await workflow.handleAgentEnd(
    {
      messages: [
        { role: "custom", content: critiquePrompt },
        textMessage(`1) Verdict: REFINE
2) Issues:
- split a step`),
      ],
    },
    ctx,
  );

  assert.equal(sentCustomMessages.length, 2);
  assert.match(String(sentCustomMessages[1]?.content ?? ""), /ARBITER/);
  assert.match(String(sentCustomMessages[1]?.content ?? ""), /mapper-report/);
  assert.match(String(sentCustomMessages[1]?.content ?? ""), /split a step/);
});

test("workflow reaches approval after arbiter revision and a PASS critique", async () => {
  const { workflow, ctx, sentMessages, sentCustomMessages } = createHarness();

  await workflow.handleCommand("", ctx);
  await workflow.handleAgentEnd(
    {
      messages: [
        { role: "user", content: [{ type: "text", text: sentMessages[0]! }] },
        textMessage("mapper-report"),
      ],
    },
    ctx,
  );

  await workflow.handleAgentEnd(
    {
      messages: [
        { role: "custom", content: String(sentCustomMessages[0]?.content ?? "") },
        textMessage(`1) Verdict: REFINE
2) Issues:
- split a step`),
      ],
    },
    ctx,
  );

  await workflow.handleAgentEnd(
    {
      messages: [
        { role: "custom", content: String(sentCustomMessages[1]?.content ?? "") },
        textMessage(buildApprovedPlanText()),
      ],
    },
    ctx,
  );

  const result = await workflow.handleAgentEnd(
    {
      messages: [
        { role: "custom", content: String(sentCustomMessages[2]?.content ?? "") },
        textMessage(`1) Verdict: PASS
2) Issues:
- none`),
      ],
    },
    ctx,
  );

  assert.deepEqual(result, { kind: "ok" });
  assert.deepEqual(workflow.getStateSnapshot(), {
    phase: "approval",
    goal: undefined,
    pendingRequestId: undefined,
    awaitingResponse: false,
  });
});

test("workflow approval hands off ordered execution items and surfaces scheduler output for multi-unit plans", async () => {
  const executionScheduler = {
    async execute() {
      return {
        status: "completed" as const,
        layers: [
          {
            layer: 1,
            unitIds: ["contract-core"],
            results: [
              {
                unitId: "contract-core",
                status: "completed" as const,
                summary: "Integrated contract-core",
                changedFiles: ["extensions/refactor/contract.ts"],
                validations: [],
              },
            ],
          },
          {
            layer: 2,
            unitIds: ["guided-shell"],
            results: [
              {
                unitId: "guided-shell",
                status: "completed" as const,
                summary: "Integrated guided-shell",
                changedFiles: ["extensions/refactor/workflow.ts"],
                validations: [],
              },
            ],
          },
        ],
        remainingUnitIds: [],
      };
    },
  };
  const { workflow, ctx, sentMessages, sentCustomMessages } = createHarness({
    selectChoice: "Approve refactor plan",
    executionScheduler: executionScheduler as never,
  });

  await workflow.handleCommand("", ctx);
  await workflow.handleAgentEnd(
    {
      messages: [
        { role: "user", content: [{ type: "text", text: sentMessages[0]! }] },
        textMessage("mapper-report"),
      ],
    },
    ctx,
  );

  await workflow.handleAgentEnd(
    {
      messages: [
        { role: "custom", content: String(sentCustomMessages[0]?.content ?? "") },
        textMessage(`1) Verdict: REFINE
2) Issues:
- split a step`),
      ],
    },
    ctx,
  );

  await workflow.handleAgentEnd(
    {
      messages: [
        { role: "custom", content: String(sentCustomMessages[1]?.content ?? "") },
        textMessage(buildApprovedPlanText()),
      ],
    },
    ctx,
  );

  const result = await workflow.handleAgentEnd(
    {
      messages: [
        { role: "custom", content: String(sentCustomMessages[2]?.content ?? "") },
        textMessage(`1) Verdict: PASS
2) Issues:
- none`),
      ],
    },
    ctx,
  );

  assert.deepEqual(result, { kind: "ok" });
  assert.deepEqual(workflow.getStateSnapshot(), {
    phase: "executing",
    goal: undefined,
    pendingRequestId: undefined,
    awaitingResponse: false,
  });
  assert.deepEqual(
    workflow.getExecutionSnapshot().items.map((item) => item.text),
    [
      "contract-core: Add contract parser",
      "guided-shell: Adopt GuidedWorkflow (depends on: contract-core)",
    ],
  );
  assert.match(
    sentMessages.at(-1) ?? "",
    /Execution scheduler processed 2 approved refactor units\./,
  );
  assert.match(sentMessages.at(-1) ?? "", /Batch status: completed/);
  assert.match(
    sentMessages.at(-1) ?? "",
    /Step 1 \(contract-core\): emit execution_result status "done" with summary "Integrated contract-core"/,
  );
  assert.match(
    sentMessages.at(-1) ?? "",
    /Step 2 \(guided-shell\): emit execution_result status "done" with summary "Integrated guided-shell"/,
  );
});

test("workflow surfaces single-unit execution manager success through the first execution prompt", async () => {
  const executionManager = {
    async executeUnit() {
      return {
        unitId: "guided-shell",
        status: "completed" as const,
        summary: "Integrated guided-shell",
        changedFiles: ["extensions/refactor/workflow.ts"],
        validations: [
          {
            command: "bun test extensions/refactor/index.test.ts",
            outcome: "passed" as const,
          },
        ],
      };
    },
  };
  const { workflow, ctx, sentMessages, sentCustomMessages } = createHarness({
    selectChoice: "Approve refactor plan",
    executionManager: executionManager as never,
  });

  await workflow.handleCommand("", ctx);
  await workflow.handleAgentEnd(
    {
      messages: [
        { role: "user", content: [{ type: "text", text: sentMessages[0]! }] },
        textMessage("mapper-report"),
      ],
    },
    ctx,
  );

  await workflow.handleAgentEnd(
    {
      messages: [
        { role: "custom", content: String(sentCustomMessages[0]?.content ?? "") },
        textMessage(`1) Verdict: REFINE
2) Issues:
- split a step`),
      ],
    },
    ctx,
  );

  await workflow.handleAgentEnd(
    {
      messages: [
        { role: "custom", content: String(sentCustomMessages[1]?.content ?? "") },
        textMessage(buildSingleUnitApprovedPlanText()),
      ],
    },
    ctx,
  );

  const result = await workflow.handleAgentEnd(
    {
      messages: [
        { role: "custom", content: String(sentCustomMessages[2]?.content ?? "") },
        textMessage(`1) Verdict: PASS
2) Issues:
- none`),
      ],
    },
    ctx,
  );

  assert.deepEqual(result, { kind: "ok" });
  assert.match(
    sentMessages.at(-1) ?? "",
    /Execution manager processed approved refactor unit 1\/1\./,
  );
  assert.match(sentMessages.at(-1) ?? "", /Status: completed/);
  assert.match(sentMessages.at(-1) ?? "", /Integrated guided-shell/);
  assert.match(
    sentMessages.at(-1) ?? "",
    /Respond with an execution_result tagged JSON block for step 1 using status "done"/,
  );
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

test("planning shell blocks write-capable tools and only allows safe bash", async () => {
  const { workflow, ctx } = createHarness();

  await workflow.handleCommand("", ctx);

  const writeResult = await workflow.handleToolCall({ toolName: "Write" }, ctx);
  const lowerEditResult = await workflow.handleToolCall({ toolName: "edit" }, ctx);
  const multiEditResult = await workflow.handleToolCall({ toolName: "MultiEdit" }, ctx);
  const mutatingBashResult = await workflow.handleToolCall(
    {
      toolName: "Bash",
      input: { command: "rm -rf tmp" },
    },
    ctx,
  );
  const readOnlyBashResult = await workflow.handleToolCall(
    {
      toolName: "Bash",
      input: { command: "ls -la" },
    },
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
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "refactor-prompts-"));
  fs.writeFileSync(path.join(tempDir, "mapper.md"), "mapper");
  fs.writeFileSync(path.join(tempDir, "skeptic.md"), "skeptic");
  fs.writeFileSync(path.join(tempDir, "arbiter.md"), "arbiter");
  fs.writeFileSync(path.join(tempDir, "executor.md"), "executor");
  fs.writeFileSync(path.join(tempDir, "worker.md"), "worker");

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

test("buildPrompt labels structured contract inputs for skeptic and arbiter phases", () => {
  const skepticPrompt = buildPrompt({
    phase: "skeptic",
    prompts: {
      mapper: "MAPPER",
      skeptic: "SKEPTIC",
      arbiter: "ARBITER",
      executor: "EXECUTOR",
      worker: "WORKER",
    },
    reports: {
      mapper: "mapper-report",
    },
  });

  const arbiterPrompt = buildPrompt({
    phase: "arbiter",
    prompts: {
      mapper: "MAPPER",
      skeptic: "SKEPTIC",
      arbiter: "ARBITER",
      executor: "EXECUTOR",
      worker: "WORKER",
    },
    reports: {
      mapper: "mapper-report",
      skeptic: "skeptic-report",
      arbiter: "arbiter-report",
    },
    refinement: "tighten blast radius",
  });

  assert.match(skepticPrompt, /## Mapper Proposal \(Structured Contract\)/);
  assert.match(arbiterPrompt, /## Mapper Proposal \(Structured Contract\)/);
  assert.match(arbiterPrompt, /## Existing Approved Plan \(Structured Contract\)/);
  assert.match(arbiterPrompt, /fully revised refactor plan in the structured contract format/i);
  assert.match(arbiterPrompt, /tighten blast radius/);
});

test("buildWorkerPrompt renders the assigned execution unit", () => {
  const prompt = buildWorkerPrompt({
    prompts: {
      mapper: "MAPPER",
      skeptic: "SKEPTIC",
      arbiter: "ARBITER",
      executor: "EXECUTOR",
      worker: "WORKER",
    },
    approvedPlanSummary: "Split the refactor workflow into explicit execution units.",
    step: 2,
    totalSteps: 3,
    executionUnit: {
      id: "guided-shell",
      title: "Adopt GuidedWorkflow",
      objective: "Move /refactor planning to GuidedWorkflow.",
      targets: ["extensions/refactor/workflow.ts", "extensions/refactor/index.ts"],
      validations: ["bun test extensions/refactor/index.test.ts"],
      dependsOn: ["contract-core"],
    },
  });

  assert.match(prompt, /^WORKER/m);
  assert.match(prompt, /## Approved Plan Summary/);
  assert.match(prompt, /## Execution Position/);
  assert.match(prompt, /Unit 2\/3/);
  assert.match(prompt, /## Assigned Execution Unit/);
  assert.match(prompt, /ID: guided-shell/);
  assert.match(prompt, /Depends on: contract-core/);
  assert.match(prompt, /- extensions\/refactor\/workflow.ts/);
  assert.match(prompt, /- bun test extensions\/refactor\/index.test.ts/);
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
  assert.match(loaded.prompts.worker, /refactor worker executing one approved refactor unit/i);
  assert.match(loaded.prompts.executor, /Refactoring action discipline/i);
  assert.match(loaded.prompts.executor, /Change Function Declaration/i);
  assert.match(loaded.prompts.executor, /Decompose Conditional/i);
  assert.match(loaded.prompts.executor, /Cross-boundary refactorings/i);
});

test("real worker prompt instructs isolated execution within one approved unit", () => {
  const promptDirectory = path.join(path.dirname(new URL(import.meta.url).pathname), "prompts");
  const loaded = loadPrompts(promptDirectory);

  assert.equal(loaded.ok, true);
  if (!loaded.ok) {
    return;
  }

  assert.match(loaded.prompts.worker, /isolated workspace/i);
  assert.match(loaded.prompts.worker, /implement ONLY the assigned unit/i);
  assert.match(loaded.prompts.worker, /Do not expand into sibling units/i);
  assert.match(loaded.prompts.worker, /validations you ran/i);
});

test("real prompt bundle wires mapper and arbiter to the refactor structured contract", () => {
  const promptDirectory = path.join(path.dirname(new URL(import.meta.url).pathname), "prompts");
  const loaded = loadPrompts(promptDirectory);

  assert.equal(loaded.ok, true);
  if (!loaded.ok) {
    return;
  }

  assert.match(loaded.prompts.mapper, /refactor-plan-json/i);
  assert.match(loaded.prompts.mapper, /approved_refactor_plan/i);
  assert.match(loaded.prompts.mapper, /executionUnits/i);
  assert.match(loaded.prompts.mapper, /dependsOn/i);
  assert.match(loaded.prompts.arbiter, /refactor-plan-json/i);
  assert.match(loaded.prompts.arbiter, /approved_refactor_plan/i);
  assert.match(
    loaded.prompts.arbiter,
    /Emit the tagged block only when at least one execution unit is approved/i,
  );
});

test("real skeptic prompt challenges malformed structured mapper proposals", () => {
  const promptDirectory = path.join(path.dirname(new URL(import.meta.url).pathname), "prompts");
  const loaded = loadPrompts(promptDirectory);

  assert.equal(loaded.ok, true);
  if (!loaded.ok) {
    return;
  }

  assert.match(loaded.prompts.skeptic, /refactor-plan-json/i);
  assert.match(loaded.prompts.skeptic, /approved_refactor_plan/i);
  assert.match(loaded.prompts.skeptic, /missing or weak `validations` commands/i);
  assert.match(loaded.prompts.skeptic, /bad `dependsOn` edges/i);
  assert.match(loaded.prompts.skeptic, /malformed, incomplete, or internally inconsistent/i);
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
  assert.match(loaded.prompts.executor, /smallest clear domain term/i);
  assert.match(loaded.prompts.skeptic, /context-bound naming/i);
  assert.match(
    loaded.prompts.skeptic,
    /repeat context the surrounding module\/package already supplies/i,
  );
  assert.match(loaded.prompts.skeptic, /semantic drift/i);
  assert.match(loaded.prompts.arbiter, /semantic naming quality/i);
  assert.match(loaded.prompts.arbiter, /smallest clear domain term/i);
  assert.match(
    loaded.prompts.arbiter,
    /materially change an existing symbol's responsibility while preserving a misleading old name/i,
  );
  assert.match(loaded.prompts.mapper, /existing names that have become inaccurate/i);
  assert.match(loaded.prompts.mapper, /redundant qualifier chains/i);
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

test("real arbiter prompt requires evidence-backed approval for LLM smell candidates", () => {
  const promptDirectory = path.join(path.dirname(new URL(import.meta.url).pathname), "prompts");
  const loaded = loadPrompts(promptDirectory);

  assert.equal(loaded.ok, true);
  if (!loaded.ok) {
    return;
  }

  assert.match(loaded.prompts.arbiter, /explicit applicability evidence/i);
  assert.match(
    loaded.prompts.arbiter,
    /concrete LLM integration path in code and the candidate ties the smell to that exact path/i,
  );
  assert.match(
    loaded.prompts.arbiter,
    /prompt templates, docs, comments, README examples, naming, or generic AI-adjacent context/i,
  );
  assert.match(loaded.prompts.arbiter, /repo-specific approval or rejection criteria/i);
  assert.match(
    loaded.prompts.arbiter,
    /exact call site, message construction path, schema expectation, model identifier, or request-setting omission/i,
  );
  assert.match(
    loaded.prompts.arbiter,
    /Do not widen an LLM smell approval into runtime\/framework redesign/i,
  );
});

test("real executor prompt gives concrete remediation guidance for LLM smells", () => {
  const promptDirectory = path.join(path.dirname(new URL(import.meta.url).pathname), "prompts");
  const loaded = loadPrompts(promptDirectory);

  assert.equal(loaded.ok, true);
  if (!loaded.ok) {
    return;
  }

  assert.match(loaded.prompts.executor, /Unbounded Max Metrics/i);
  assert.match(loaded.prompts.executor, /No Model Version Pinning/i);
  assert.match(loaded.prompts.executor, /No System Message/i);
  assert.match(loaded.prompts.executor, /No Structured Output/i);
  assert.match(loaded.prompts.executor, /LLM Temperature Not Explicitly Set/i);
  assert.match(loaded.prompts.executor, /free-form markdown/i);
  assert.match(loaded.prompts.executor, /precise refactoring-action language/i);
  assert.match(loaded.prompts.executor, /evidence-backed/i);
  assert.match(
    loaded.prompts.executor,
    /Do not widen a local LLM smell fix into runtime\/framework redesign/i,
  );
});

test("real executor prompt aligns with manager-owned merge and conflict gating", () => {
  const promptDirectory = path.join(path.dirname(new URL(import.meta.url).pathname), "prompts");
  const loaded = loadPrompts(promptDirectory);

  assert.equal(loaded.ok, true);
  if (!loaded.ok) {
    return;
  }

  assert.match(loaded.prompts.executor, /merge and conflict handling as manager-owned gates/i);
  assert.match(loaded.prompts.executor, /report the conflict explicitly/i);
  assert.match(loaded.prompts.executor, /surface the exact conflicted files or blockers/i);
});

test("workflow retries an invalid planning payload as empty output", async () => {
  const { workflow, ctx, sentMessages, notifications } = createHarness();

  await workflow.handleCommand("", ctx);
  assert.equal(sentMessages.length, 1);

  const result = await workflow.handleAgentEnd(
    {
      messages: [
        { role: "user", content: [{ type: "text", text: sentMessages[0]! }] },
        { role: "assistant", content: "invalid-payload-shape" },
      ],
    },
    ctx,
  );

  assert.equal(result.kind, "recoverable_error");
  assert.equal(result.reason, "empty_output_retry");
  assert.equal(notifications.at(-1)?.level, "warning");
  assert.match(notifications.at(-1)?.message ?? "", /planning response/i);
});

test("refactor command wiring uses real prompt files through mapper and hidden skeptic phases", async () => {
  const commands: Record<string, { handler: (args: unknown, ctx: unknown) => Promise<unknown> }> =
    {};
  const listeners: Record<string, (...args: unknown[]) => Promise<unknown>> = {};
  const sentMessages: string[] = [];
  const sentCustomMessages: Array<{ customType?: string; content?: unknown; display?: boolean }> =
    [];

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
    sendMessage(message: { customType?: string; content?: unknown; display?: boolean }) {
      sentCustomMessages.push(message);
    },
  };

  const ctx = {
    ui: {
      notify() {},
      setStatus() {},
      setWidget() {},
      async select() {
        return undefined;
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
    {
      messages: [
        { role: "user", content: [{ type: "text", text: sentMessages[0] }] },
        { role: "assistant", content: [{ type: "text", text: "mapper-report" }] },
      ],
    },
    ctx,
  );
  assert.match(
    String(sentCustomMessages[0]?.content ?? ""),
    /You are an adversarial refactor reviewer/,
  );
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
  assertGuidedWorkflowListenerSurface(listeners);
});
