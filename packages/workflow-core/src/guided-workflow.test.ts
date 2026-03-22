import test from "node:test";
import assert from "node:assert/strict";
import {
  GuidedWorkflow,
  parseTrimmedStringArg,
  type ExtensionAPI,
  type ExtensionContext,
  type ExtensionTheme,
  type ExtensionUICustomFactory,
} from "./index";

function createContext() {
  const notifications: Array<{ level: string; message: string }> = [];
  const theme: ExtensionTheme = {
    fg(_color: string, text: string) {
      return text;
    },
    strikethrough(text: string) {
      return `~~${text}~~`;
    },
  };

  const ctx: ExtensionContext = {
    hasUI: true,
    ui: {
      theme,
      notify(message: string, level = "info") {
        notifications.push({ message, level });
      },
      setStatus() {},
      setWidget() {},
      async select() {
        return undefined;
      },
      async editor() {
        return undefined;
      },
      async custom<T>(factory: ExtensionUICustomFactory<T>): Promise<T> {
        let resolved!: T;
        await factory({}, theme, {}, (value) => {
          resolved = value;
        });
        return resolved;
      },
      setTheme() {
        return { success: true } as const;
      },
    },
  };

  return { ctx, notifications };
}

function createApi() {
  const sentUserMessages: string[] = [];
  const sentUserMessageOptions: Array<{ deliverAs?: string } | undefined> = [];
  const sentCustomMessages: Array<{
    customType?: string;
    content?: unknown;
    display?: boolean;
    triggerTurn?: boolean;
    deliverAs?: string;
  }> = [];

  const api: ExtensionAPI = {
    sendMessage(message, options) {
      sentCustomMessages.push({
        customType: message.customType,
        content: message.content,
        display: message.display,
        triggerTurn: options?.triggerTurn,
        deliverAs: options?.deliverAs,
      });
    },
    sendUserMessage(message, options) {
      if (typeof message !== "string") {
        throw new Error("GuidedWorkflow tests expect string prompts");
      }
      sentUserMessages.push(message);
      sentUserMessageOptions.push(options ? { deliverAs: options.deliverAs } : undefined);
    },
    registerCommand() {},
    registerMessageRenderer() {},
    registerTool() {},
    getActiveTools() {
      return ["read", "bash"];
    },
    getAllTools() {
      return [
        { name: "read", description: "Read file contents" },
        { name: "bash", description: "Execute shell commands" },
      ];
    },
    setActiveTools() {},
    on() {},
  };

  return { api, sentUserMessages, sentUserMessageOptions, sentCustomMessages };
}

function createCritiqueOptions() {
  return {
    buildCritiquePrompt({ planText }: { goal?: string; planText: string }) {
      return `Critique the plan:\n\n${planText}`;
    },
    buildRevisionPrompt(args: {
      goal?: string;
      planText: string;
      critiqueText: string;
      verdict: "PASS" | "REFINE" | "REJECT";
    }) {
      return [
        `Revise the plan after ${args.verdict}:`,
        args.planText,
        "Critique:",
        args.critiqueText,
      ].join("\n\n");
    },
    parseCritiqueVerdict(text: string) {
      if (text.includes("PASS")) {
        return "PASS" as const;
      }
      if (text.includes("REFINE")) {
        return "REFINE" as const;
      }
      if (text.includes("REJECT")) {
        return "REJECT" as const;
      }
      return undefined;
    },
    customMessageType: "guided-test-internal",
  };
}

function createApprovalOptions(options?: {
  selection?: {
    cancelled?: boolean;
    action?: "approve" | "continue" | "regenerate" | "exit";
    note?: string;
  };
  onApprove?: (args: {
    goal?: string;
    planText: string;
    critiqueText?: string;
    note?: string;
  }) => void;
  onExit?: (args: {
    goal?: string;
    planText: string;
    critiqueText?: string;
    note?: string;
  }) => void;
}) {
  const selectCalls: Array<{ planText: string; critiqueText?: string }> = [];

  return {
    selectCalls,
    approval: {
      async selectAction(
        args: { goal?: string; planText: string; critiqueText?: string },
        _ctx: ExtensionContext,
      ) {
        selectCalls.push({ planText: args.planText, critiqueText: args.critiqueText });
        return options?.selection ?? { cancelled: true };
      },
      buildContinuePrompt(args: { note?: string }) {
        return `Continue planning with note: ${args.note ?? "none"}`;
      },
      buildRegeneratePrompt(args: { note?: string }) {
        return `Regenerate planning with note: ${args.note ?? "none"}`;
      },
      onApprove(args: { planText: string; critiqueText?: string; note?: string }) {
        options?.onApprove?.(args);
      },
      onExit(args: { planText: string; critiqueText?: string; note?: string }) {
        options?.onExit?.(args);
      },
    },
  };
}

function createExecutionOptions() {
  return {
    execution: {
      extractItems() {
        return [
          { step: 1, text: "First task" },
          { step: 2, text: "Second task" },
        ];
      },
      buildExecutionPrompt(args: { currentStep: { step: number; text: string }; note?: string }) {
        return `Execute step ${args.currentStep.step}: ${args.currentStep.text}${args.note ? ` (${args.note})` : ""}`;
      },
    },
  };
}

function extractRequestId(prompt: string): string | undefined {
  const match = prompt.match(/<!--\s*workflow-request-id:([^>]+)\s*-->/i);
  return match?.[1]?.trim();
}

test("GuidedWorkflow starts idle", () => {
  const { api } = createApi();
  const workflow = new GuidedWorkflow(api, {
    id: "guided-test",
    parseGoalArg: parseTrimmedStringArg,
    text: { alreadyRunning: "guided running" },
  });

  assert.deepEqual(workflow.getStateSnapshot(), {
    phase: "idle",
    goal: undefined,
    pendingRequestId: undefined,
    awaitingResponse: false,
  });
});

test("GuidedWorkflow start command sends a planning prompt and records a request id", async () => {
  const { api, sentUserMessages } = createApi();
  const workflow = new GuidedWorkflow(api, {
    id: "guided-test",
    parseGoalArg: parseTrimmedStringArg,
    text: { alreadyRunning: "guided running" },
  });
  const { ctx } = createContext();

  const result = await workflow.handleCommand("  investigate workflow reuse  ", ctx);

  assert.deepEqual(result, { kind: "ok" });
  assert.equal(sentUserMessages.length, 1);
  assert.ok(sentUserMessages[0]?.includes("investigate workflow reuse"));

  const requestId = extractRequestId(sentUserMessages[0]!);
  assert.equal(requestId, "guided-test-1");
  assert.deepEqual(workflow.getStateSnapshot(), {
    phase: "planning",
    goal: "investigate workflow reuse",
    pendingRequestId: requestId,
    awaitingResponse: true,
  });
});

test("GuidedWorkflow blocks duplicate runs while active", async () => {
  const { api } = createApi();
  const workflow = new GuidedWorkflow(api, {
    id: "guided-test",
    parseGoalArg: parseTrimmedStringArg,
    text: { alreadyRunning: "guided running" },
  });
  const { ctx, notifications } = createContext();

  await workflow.handleCommand("first run", ctx);
  const secondRun = await workflow.handleCommand("second run", ctx);

  assert.deepEqual(secondRun, { kind: "blocked", reason: "already_running" });
  assert.deepEqual(notifications.at(-1), { level: "warning", message: "guided running" });
  assert.equal(workflow.getStateSnapshot().goal, "first run");
});

test("GuidedWorkflow ignores unmatched agent_end payloads while awaiting the active request", async () => {
  const { api } = createApi();
  const workflow = new GuidedWorkflow(api, {
    id: "guided-test",
    parseGoalArg: parseTrimmedStringArg,
    text: { alreadyRunning: "guided running" },
  });
  const { ctx } = createContext();

  await workflow.handleCommand("first run", ctx);
  const result = await workflow.handleAgentEnd(
    {
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "plan prompt\n\n<!-- workflow-request-id:guided-test-99 -->" },
          ],
        },
        {
          role: "assistant",
          content: [{ type: "text", text: "draft plan" }],
        },
      ],
    },
    ctx,
  );

  assert.deepEqual(result, { kind: "blocked", reason: "unmatched_agent_end" });
  assert.deepEqual(workflow.getStateSnapshot(), {
    phase: "planning",
    goal: "first run",
    pendingRequestId: "guided-test-1",
    awaitingResponse: true,
  });
});

test("GuidedWorkflow retries a missing planning response once and then resets cleanly", async () => {
  const { api, sentUserMessages } = createApi();
  const workflow = new GuidedWorkflow(api, {
    id: "guided-test",
    maxMissingOutputRetries: 1,
    parseGoalArg: parseTrimmedStringArg,
    text: { alreadyRunning: "guided running" },
  });
  const { ctx, notifications } = createContext();

  await workflow.handleCommand("first run", ctx);

  const retryResult = await workflow.handleAgentEnd(
    {
      messages: [
        {
          role: "user",
          content: [{ type: "text", text: sentUserMessages[0]! }],
        },
        {
          role: "assistant",
          content: [{ type: "tool_result", text: "ignored" }],
        },
      ],
    },
    ctx,
  );

  assert.deepEqual(retryResult, { kind: "recoverable_error", reason: "empty_output_retry" });
  assert.equal(sentUserMessages.length, 2);
  assert.notEqual(extractRequestId(sentUserMessages[1]!), extractRequestId(sentUserMessages[0]!));
  assert.deepEqual(workflow.getStateSnapshot(), {
    phase: "planning",
    goal: "first run",
    pendingRequestId: "guided-test-2",
    awaitingResponse: true,
  });
  assert.deepEqual(notifications.at(-1), {
    level: "warning",
    message:
      "Guided workflow response was empty or invalid during the planning response. Retrying (1/1).",
  });

  const stopResult = await workflow.handleAgentEnd(
    {
      messages: [
        {
          role: "user",
          content: [{ type: "text", text: sentUserMessages[1]! }],
        },
        {
          role: "assistant",
          content: [{ type: "tool_result", text: "ignored" }],
        },
      ],
    },
    ctx,
  );

  assert.deepEqual(stopResult, {
    kind: "recoverable_error",
    reason: "max_missing_output_retries",
  });
  assert.deepEqual(workflow.getStateSnapshot(), {
    phase: "idle",
    goal: undefined,
    pendingRequestId: undefined,
    awaitingResponse: false,
  });
  assert.deepEqual(notifications.at(-1), {
    level: "error",
    message: "Guided workflow stopped: assistant output stayed empty or invalid after 2 attempts.",
  });

  const restart = await workflow.handleCommand("second run", ctx);
  assert.deepEqual(restart, { kind: "ok" });
  assert.equal(sentUserMessages.length, 3);
  assert.equal(extractRequestId(sentUserMessages[2]!), "guided-test-3");
});

test("GuidedWorkflow advances to approval after a matched planning response", async () => {
  const { api, sentUserMessages } = createApi();
  const workflow = new GuidedWorkflow(api, {
    id: "guided-test",
    parseGoalArg: parseTrimmedStringArg,
    text: { alreadyRunning: "guided running" },
  });
  const { ctx } = createContext();

  await workflow.handleCommand("first run", ctx);
  const result = await workflow.handleAgentEnd(
    {
      messages: [
        {
          role: "user",
          content: [{ type: "text", text: sentUserMessages[0]! }],
        },
        {
          role: "assistant",
          content: [{ type: "text", text: "draft plan" }],
        },
      ],
    },
    ctx,
  );

  assert.deepEqual(result, { kind: "ok" });
  assert.deepEqual(workflow.getStateSnapshot(), {
    phase: "approval",
    goal: "first run",
    pendingRequestId: undefined,
    awaitingResponse: false,
  });
});

test("GuidedWorkflow sends hidden critique follow-ups after a planning response", async () => {
  const { api, sentUserMessages, sentCustomMessages } = createApi();
  const workflow = new GuidedWorkflow(api, {
    id: "guided-test",
    parseGoalArg: parseTrimmedStringArg,
    critique: createCritiqueOptions(),
    text: { alreadyRunning: "guided running" },
  });
  const { ctx } = createContext();

  await workflow.handleCommand("first run", ctx);
  const result = await workflow.handleAgentEnd(
    {
      messages: [
        {
          role: "user",
          content: [{ type: "text", text: sentUserMessages[0]! }],
        },
        {
          role: "assistant",
          content: [{ type: "text", text: "draft plan" }],
        },
      ],
    },
    ctx,
  );

  assert.deepEqual(result, { kind: "ok" });
  assert.equal(sentCustomMessages.length, 1);
  assert.deepEqual(sentCustomMessages[0], {
    customType: "guided-test-internal",
    content: `Critique the plan:\n\ndraft plan\n\n<!-- workflow-request-id:guided-test-2 -->`,
    display: false,
    triggerTurn: true,
    deliverAs: "followUp",
  });
  assert.deepEqual(workflow.getStateSnapshot(), {
    phase: "planning",
    goal: "first run",
    pendingRequestId: "guided-test-2",
    awaitingResponse: true,
  });
});

test("GuidedWorkflow retries invalid critique output with a fresh hidden follow-up", async () => {
  const { api, sentUserMessages, sentCustomMessages } = createApi();
  const workflow = new GuidedWorkflow(api, {
    id: "guided-test",
    maxMissingOutputRetries: 1,
    parseGoalArg: parseTrimmedStringArg,
    critique: createCritiqueOptions(),
    text: { alreadyRunning: "guided running" },
  });
  const { ctx, notifications } = createContext();

  await workflow.handleCommand("first run", ctx);
  await workflow.handleAgentEnd(
    {
      messages: [
        {
          role: "user",
          content: [{ type: "text", text: sentUserMessages[0]! }],
        },
        {
          role: "assistant",
          content: [{ type: "text", text: "draft plan" }],
        },
      ],
    },
    ctx,
  );

  const firstCritiquePrompt = String(sentCustomMessages[0]?.content);
  const result = await workflow.handleAgentEnd(
    {
      messages: [
        {
          role: "custom",
          content: firstCritiquePrompt,
        },
        {
          role: "assistant",
          content: "invalid-payload",
        },
      ],
    },
    ctx,
  );

  assert.deepEqual(result, { kind: "recoverable_error", reason: "empty_output_retry" });
  assert.equal(sentCustomMessages.length, 2);
  assert.deepEqual(sentCustomMessages[1], {
    customType: "guided-test-internal",
    content: `Critique the plan:\n\ndraft plan\n\n<!-- workflow-request-id:guided-test-3 -->`,
    display: false,
    triggerTurn: true,
    deliverAs: "followUp",
  });
  assert.deepEqual(workflow.getStateSnapshot(), {
    phase: "planning",
    goal: "first run",
    pendingRequestId: "guided-test-3",
    awaitingResponse: true,
  });
  assert.deepEqual(notifications.at(-1), {
    level: "warning",
    message:
      "Guided workflow response was empty or invalid during the critique review. Retrying (1/1).",
  });
});

test("GuidedWorkflow sends a hidden revision follow-up after a REFINE critique", async () => {
  const { api, sentUserMessages, sentCustomMessages } = createApi();
  const workflow = new GuidedWorkflow(api, {
    id: "guided-test",
    parseGoalArg: parseTrimmedStringArg,
    critique: createCritiqueOptions(),
    text: { alreadyRunning: "guided running" },
  });
  const { ctx } = createContext();

  await workflow.handleCommand("first run", ctx);
  await workflow.handleAgentEnd(
    {
      messages: [
        {
          role: "user",
          content: [{ type: "text", text: sentUserMessages[0]! }],
        },
        {
          role: "assistant",
          content: [{ type: "text", text: "draft plan" }],
        },
      ],
    },
    ctx,
  );

  const critiqueResult = await workflow.handleAgentEnd(
    {
      messages: [
        {
          role: "custom",
          content: String(sentCustomMessages[0]?.content),
        },
        {
          role: "assistant",
          content: [{ type: "text", text: "1) Verdict: REFINE\n2) Issues:\n- split a step" }],
        },
      ],
    },
    ctx,
  );

  assert.deepEqual(critiqueResult, { kind: "ok" });
  assert.equal(sentCustomMessages.length, 2);
  assert.deepEqual(sentCustomMessages[1], {
    customType: "guided-test-internal",
    content:
      "Revise the plan after REFINE:\n\ndraft plan\n\nCritique:\n\n1) Verdict: REFINE\n2) Issues:\n- split a step\n\n<!-- workflow-request-id:guided-test-3 -->",
    display: false,
    triggerTurn: true,
    deliverAs: "followUp",
  });
  assert.deepEqual(workflow.getStateSnapshot(), {
    phase: "planning",
    goal: "first run",
    pendingRequestId: "guided-test-3",
    awaitingResponse: true,
  });
});

test("GuidedWorkflow retries missing revision output with a fresh hidden follow-up", async () => {
  const { api, sentUserMessages, sentCustomMessages } = createApi();
  const workflow = new GuidedWorkflow(api, {
    id: "guided-test",
    maxMissingOutputRetries: 1,
    parseGoalArg: parseTrimmedStringArg,
    critique: createCritiqueOptions(),
    text: { alreadyRunning: "guided running" },
  });
  const { ctx, notifications } = createContext();

  await workflow.handleCommand("first run", ctx);
  await workflow.handleAgentEnd(
    {
      messages: [
        {
          role: "user",
          content: [{ type: "text", text: sentUserMessages[0]! }],
        },
        {
          role: "assistant",
          content: [{ type: "text", text: "draft plan" }],
        },
      ],
    },
    ctx,
  );
  await workflow.handleAgentEnd(
    {
      messages: [
        {
          role: "custom",
          content: String(sentCustomMessages[0]?.content),
        },
        {
          role: "assistant",
          content: [{ type: "text", text: "1) Verdict: REFINE\n2) Issues:\n- split a step" }],
        },
      ],
    },
    ctx,
  );

  const firstRevisionPrompt = String(sentCustomMessages[1]?.content);
  const result = await workflow.handleAgentEnd(
    {
      messages: [
        {
          role: "custom",
          content: firstRevisionPrompt,
        },
        {
          role: "assistant",
          content: [{ type: "tool_result", text: "ignored" }],
        },
      ],
    },
    ctx,
  );

  assert.deepEqual(result, { kind: "recoverable_error", reason: "empty_output_retry" });
  assert.equal(sentCustomMessages.length, 3);
  assert.deepEqual(sentCustomMessages[2], {
    customType: "guided-test-internal",
    content:
      "Revise the plan after REFINE:\n\ndraft plan\n\nCritique:\n\n1) Verdict: REFINE\n2) Issues:\n- split a step\n\n<!-- workflow-request-id:guided-test-4 -->",
    display: false,
    triggerTurn: true,
    deliverAs: "followUp",
  });
  assert.deepEqual(workflow.getStateSnapshot(), {
    phase: "planning",
    goal: "first run",
    pendingRequestId: "guided-test-4",
    awaitingResponse: true,
  });
  assert.deepEqual(notifications.at(-1), {
    level: "warning",
    message:
      "Guided workflow response was empty or invalid during the revision draft. Retrying (1/1).",
  });
});

test("GuidedWorkflow marks critique PASS responses as approval-ready", async () => {
  const { api, sentUserMessages, sentCustomMessages } = createApi();
  const workflow = new GuidedWorkflow(api, {
    id: "guided-test",
    parseGoalArg: parseTrimmedStringArg,
    critique: createCritiqueOptions(),
    text: { alreadyRunning: "guided running" },
  });
  const { ctx } = createContext();

  await workflow.handleCommand("first run", ctx);
  await workflow.handleAgentEnd(
    {
      messages: [
        {
          role: "user",
          content: [{ type: "text", text: sentUserMessages[0]! }],
        },
        {
          role: "assistant",
          content: [{ type: "text", text: "draft plan" }],
        },
      ],
    },
    ctx,
  );

  const critiqueResult = await workflow.handleAgentEnd(
    {
      messages: [
        {
          role: "custom",
          content: String(sentCustomMessages[0]?.content),
        },
        {
          role: "assistant",
          content: [{ type: "text", text: "1) Verdict: PASS\n2) Issues:\n- none" }],
        },
      ],
    },
    ctx,
  );

  assert.deepEqual(critiqueResult, { kind: "ok" });
  assert.deepEqual(workflow.getStateSnapshot(), {
    phase: "approval",
    goal: "first run",
    pendingRequestId: undefined,
    awaitingResponse: false,
  });
});

test("GuidedWorkflow blocks write-capable tools during planning", async () => {
  const { api } = createApi();
  const workflow = new GuidedWorkflow(api, {
    id: "guided-test",
    parseGoalArg: parseTrimmedStringArg,
    planningPolicy: {
      isWriteCapableTool(toolName) {
        return (toolName ?? "").trim().toLowerCase() === "write";
      },
      writeBlockedReason: "planning is read-only",
    },
    text: { alreadyRunning: "guided running" },
  });
  const { ctx } = createContext();

  await workflow.handleCommand("first run", ctx);
  const result = await workflow.handleToolCall({ toolName: "Write" }, ctx);

  assert.deepEqual(result, { block: true, reason: "planning is read-only" });
});

test("GuidedWorkflow allows safe read-only bash during planning", async () => {
  const { api } = createApi();
  const workflow = new GuidedWorkflow(api, {
    id: "guided-test",
    parseGoalArg: parseTrimmedStringArg,
    planningPolicy: {
      isSafeReadOnlyCommand(command) {
        return command === "ls -la";
      },
    },
    text: { alreadyRunning: "guided running" },
  });
  const { ctx } = createContext();

  await workflow.handleCommand("first run", ctx);
  const result = await workflow.handleToolCall(
    { toolName: "Bash", input: { command: "ls -la" } },
    ctx,
  );

  assert.equal(result, undefined);
});

test("GuidedWorkflow blocks mutating bash during planning with an explicit reason", async () => {
  const { api } = createApi();
  const workflow = new GuidedWorkflow(api, {
    id: "guided-test",
    parseGoalArg: parseTrimmedStringArg,
    planningPolicy: {
      isSafeReadOnlyCommand(command) {
        return command === "ls -la";
      },
      bashBlockedReason(command) {
        return `blocked: ${command}`;
      },
    },
    text: { alreadyRunning: "guided running" },
  });
  const { ctx } = createContext();

  await workflow.handleCommand("first run", ctx);
  const result = await workflow.handleToolCall(
    { toolName: "bash", input: { command: "rm -rf tmp" } },
    ctx,
  );

  assert.deepEqual(result, { block: true, reason: "blocked: rm -rf tmp" });
});

test("GuidedWorkflow opens the approval callback only after critique PASS", async () => {
  const { api, sentUserMessages, sentCustomMessages } = createApi();
  const { approval, selectCalls } = createApprovalOptions();
  const workflow = new GuidedWorkflow(api, {
    id: "guided-test",
    parseGoalArg: parseTrimmedStringArg,
    critique: createCritiqueOptions(),
    approval,
    text: { alreadyRunning: "guided running" },
  });
  const { ctx } = createContext();

  await workflow.handleCommand("first run", ctx);
  await workflow.handleAgentEnd(
    {
      messages: [
        { role: "user", content: [{ type: "text", text: sentUserMessages[0]! }] },
        { role: "assistant", content: [{ type: "text", text: "draft plan" }] },
      ],
    },
    ctx,
  );

  assert.equal(selectCalls.length, 0);

  await workflow.handleAgentEnd(
    {
      messages: [
        { role: "custom", content: String(sentCustomMessages[0]?.content) },
        {
          role: "assistant",
          content: [{ type: "text", text: "1) Verdict: PASS\n2) Issues:\n- none" }],
        },
      ],
    },
    ctx,
  );

  assert.deepEqual(selectCalls, [
    {
      planText: "draft plan",
      critiqueText: "1) Verdict: PASS\n2) Issues:\n- none",
    },
  ]);
  assert.deepEqual(workflow.getStateSnapshot(), {
    phase: "approval",
    goal: "first run",
    pendingRequestId: undefined,
    awaitingResponse: false,
  });
});

test("GuidedWorkflow dispatches continue actions back into planning", async () => {
  const { api, sentUserMessages, sentCustomMessages } = createApi();
  const { approval } = createApprovalOptions({
    selection: { action: "continue", note: "tighten scope" },
  });
  const workflow = new GuidedWorkflow(api, {
    id: "guided-test",
    parseGoalArg: parseTrimmedStringArg,
    critique: createCritiqueOptions(),
    approval,
    text: { alreadyRunning: "guided running" },
  });
  const { ctx } = createContext();

  await workflow.handleCommand("first run", ctx);
  await workflow.handleAgentEnd(
    {
      messages: [
        { role: "user", content: [{ type: "text", text: sentUserMessages[0]! }] },
        { role: "assistant", content: [{ type: "text", text: "draft plan" }] },
      ],
    },
    ctx,
  );

  const result = await workflow.handleAgentEnd(
    {
      messages: [
        { role: "custom", content: String(sentCustomMessages[0]?.content) },
        {
          role: "assistant",
          content: [{ type: "text", text: "1) Verdict: PASS\n2) Issues:\n- none" }],
        },
      ],
    },
    ctx,
  );

  assert.deepEqual(result, { kind: "ok" });
  assert.equal(sentUserMessages.length, 2);
  assert.equal(
    sentUserMessages[1],
    "Continue planning with note: tighten scope\n\n<!-- workflow-request-id:guided-test-3 -->",
  );
  assert.deepEqual(workflow.getStateSnapshot(), {
    phase: "planning",
    goal: "first run",
    pendingRequestId: "guided-test-3",
    awaitingResponse: true,
  });
});

test("GuidedWorkflow dispatches regenerate actions into a fresh planning round", async () => {
  const { api, sentUserMessages, sentCustomMessages } = createApi();
  const { approval } = createApprovalOptions({
    selection: { action: "regenerate", note: "fresh start" },
  });
  const workflow = new GuidedWorkflow(api, {
    id: "guided-test",
    parseGoalArg: parseTrimmedStringArg,
    critique: createCritiqueOptions(),
    approval,
    text: { alreadyRunning: "guided running" },
  });
  const { ctx } = createContext();

  await workflow.handleCommand("first run", ctx);
  await workflow.handleAgentEnd(
    {
      messages: [
        { role: "user", content: [{ type: "text", text: sentUserMessages[0]! }] },
        { role: "assistant", content: [{ type: "text", text: "draft plan" }] },
      ],
    },
    ctx,
  );

  const result = await workflow.handleAgentEnd(
    {
      messages: [
        { role: "custom", content: String(sentCustomMessages[0]?.content) },
        {
          role: "assistant",
          content: [{ type: "text", text: "1) Verdict: PASS\n2) Issues:\n- none" }],
        },
      ],
    },
    ctx,
  );

  assert.deepEqual(result, { kind: "ok" });
  assert.equal(sentUserMessages.length, 2);
  assert.equal(
    sentUserMessages[1],
    "Regenerate planning with note: fresh start\n\n<!-- workflow-request-id:guided-test-3 -->",
  );
  assert.deepEqual(workflow.getStateSnapshot(), {
    phase: "planning",
    goal: "first run",
    pendingRequestId: "guided-test-3",
    awaitingResponse: true,
  });

  await workflow.handleAgentEnd(
    {
      messages: [
        { role: "user", content: [{ type: "text", text: sentUserMessages[1]! }] },
        { role: "assistant", content: [{ type: "text", text: "replacement plan" }] },
      ],
    },
    ctx,
  );

  assert.equal(sentCustomMessages.length, 2);
  assert.deepEqual(sentCustomMessages[1], {
    customType: "guided-test-internal",
    content: `Critique the plan:\n\nreplacement plan\n\n<!-- workflow-request-id:guided-test-4 -->`,
    display: false,
    triggerTurn: true,
    deliverAs: "followUp",
  });
});

test("GuidedWorkflow transitions into execution-ready state on approve", async () => {
  const { api, sentUserMessages, sentCustomMessages } = createApi();
  const approved: Array<{ planText: string; critiqueText?: string; note?: string }> = [];
  const { approval } = createApprovalOptions({
    selection: { action: "approve", note: "ship it" },
    onApprove(args) {
      approved.push(args);
    },
  });
  const workflow = new GuidedWorkflow(api, {
    id: "guided-test",
    parseGoalArg: parseTrimmedStringArg,
    critique: createCritiqueOptions(),
    approval,
    text: { alreadyRunning: "guided running" },
  });
  const { ctx } = createContext();

  await workflow.handleCommand("first run", ctx);
  await workflow.handleAgentEnd(
    {
      messages: [
        { role: "user", content: [{ type: "text", text: sentUserMessages[0]! }] },
        { role: "assistant", content: [{ type: "text", text: "draft plan" }] },
      ],
    },
    ctx,
  );

  const result = await workflow.handleAgentEnd(
    {
      messages: [
        { role: "custom", content: String(sentCustomMessages[0]?.content) },
        {
          role: "assistant",
          content: [{ type: "text", text: "1) Verdict: PASS\n2) Issues:\n- none" }],
        },
      ],
    },
    ctx,
  );

  assert.deepEqual(result, { kind: "ok" });
  assert.deepEqual(approved, [
    {
      goal: "first run",
      planText: "draft plan",
      critiqueText: "1) Verdict: PASS\n2) Issues:\n- none",
      note: "ship it",
    },
  ]);
  assert.deepEqual(workflow.getStateSnapshot(), {
    phase: "executing",
    goal: "first run",
    pendingRequestId: undefined,
    awaitingResponse: false,
  });
});

test("GuidedWorkflow clears the active run on exit", async () => {
  const { api, sentUserMessages, sentCustomMessages } = createApi();
  const exited: Array<{ planText: string; critiqueText?: string; note?: string }> = [];
  const { approval } = createApprovalOptions({
    selection: { action: "exit", note: "stop" },
    onExit(args) {
      exited.push(args);
    },
  });
  const workflow = new GuidedWorkflow(api, {
    id: "guided-test",
    parseGoalArg: parseTrimmedStringArg,
    critique: createCritiqueOptions(),
    approval,
    text: { alreadyRunning: "guided running" },
  });
  const { ctx } = createContext();

  await workflow.handleCommand("first run", ctx);
  await workflow.handleAgentEnd(
    {
      messages: [
        { role: "user", content: [{ type: "text", text: sentUserMessages[0]! }] },
        { role: "assistant", content: [{ type: "text", text: "draft plan" }] },
      ],
    },
    ctx,
  );

  const result = await workflow.handleAgentEnd(
    {
      messages: [
        { role: "custom", content: String(sentCustomMessages[0]?.content) },
        {
          role: "assistant",
          content: [{ type: "text", text: "1) Verdict: PASS\n2) Issues:\n- none" }],
        },
      ],
    },
    ctx,
  );

  assert.deepEqual(result, { kind: "ok" });
  assert.deepEqual(exited, [
    {
      goal: "first run",
      planText: "draft plan",
      critiqueText: "1) Verdict: PASS\n2) Issues:\n- none",
      note: "stop",
    },
  ]);
  assert.deepEqual(workflow.getStateSnapshot(), {
    phase: "idle",
    goal: undefined,
    pendingRequestId: undefined,
    awaitingResponse: false,
  });
});

test("GuidedWorkflow builds the first execution prompt for the current open step", async () => {
  const { api, sentUserMessages } = createApi();
  const { approval } = createApprovalOptions({
    selection: { action: "approve", note: "ship it" },
  });
  const { execution } = createExecutionOptions();
  const workflow = new GuidedWorkflow(api, {
    id: "guided-test",
    parseGoalArg: parseTrimmedStringArg,
    approval,
    execution,
    text: { alreadyRunning: "guided running" },
  });
  const { ctx } = createContext();

  await workflow.handleCommand("first run", ctx);
  const result = await workflow.handleAgentEnd(
    {
      messages: [
        { role: "user", content: [{ type: "text", text: sentUserMessages[0]! }] },
        { role: "assistant", content: [{ type: "text", text: "draft plan" }] },
      ],
    },
    ctx,
  );

  assert.deepEqual(result, { kind: "ok" });
  assert.equal(sentUserMessages[1], "Execute step 1: First task (ship it)");
  assert.deepEqual(workflow.getExecutionSnapshot(), {
    note: "ship it",
    items: [
      { step: 1, text: "First task", completed: false },
      { step: 2, text: "Second task", completed: false },
    ],
  });
});

test("GuidedWorkflow syncs matching [DONE:n] markers onto execution items", async () => {
  const { api, sentUserMessages } = createApi();
  const { approval } = createApprovalOptions({
    selection: { action: "approve" },
  });
  const { execution } = createExecutionOptions();
  const workflow = new GuidedWorkflow(api, {
    id: "guided-test",
    parseGoalArg: parseTrimmedStringArg,
    approval,
    execution,
    text: { alreadyRunning: "guided running" },
  });
  const { ctx } = createContext();

  await workflow.handleCommand("first run", ctx);
  await workflow.handleAgentEnd(
    {
      messages: [
        { role: "user", content: [{ type: "text", text: sentUserMessages[0]! }] },
        { role: "assistant", content: [{ type: "text", text: "draft plan" }] },
      ],
    },
    ctx,
  );

  await workflow.handleTurnEnd(
    {
      message: {
        role: "assistant",
        content: [{ type: "text", text: "Implemented second task [DONE:2]" }],
      },
    },
    ctx,
  );

  assert.deepEqual(workflow.getExecutionSnapshot(), {
    note: undefined,
    items: [
      { step: 1, text: "First task", completed: false },
      { step: 2, text: "Second task", completed: true },
    ],
  });
});

test("GuidedWorkflow ignores unrelated execution output when syncing progress", async () => {
  const { api, sentUserMessages } = createApi();
  const { approval } = createApprovalOptions({
    selection: { action: "approve" },
  });
  const { execution } = createExecutionOptions();
  const workflow = new GuidedWorkflow(api, {
    id: "guided-test",
    parseGoalArg: parseTrimmedStringArg,
    approval,
    execution,
    text: { alreadyRunning: "guided running" },
  });
  const { ctx } = createContext();

  await workflow.handleCommand("first run", ctx);
  await workflow.handleAgentEnd(
    {
      messages: [
        { role: "user", content: [{ type: "text", text: sentUserMessages[0]! }] },
        { role: "assistant", content: [{ type: "text", text: "draft plan" }] },
      ],
    },
    ctx,
  );

  await workflow.handleTurnEnd(
    {
      message: {
        role: "assistant",
        content: [{ type: "text", text: "Finished validation without markers" }],
      },
    },
    ctx,
  );

  assert.deepEqual(workflow.getExecutionSnapshot(), {
    note: undefined,
    items: [
      { step: 1, text: "First task", completed: false },
      { step: 2, text: "Second task", completed: false },
    ],
  });
});

test("GuidedWorkflow sends the next execution prompt after completing the current step", async () => {
  const { api, sentUserMessages, sentUserMessageOptions } = createApi();
  const { approval } = createApprovalOptions({
    selection: { action: "approve" },
  });
  const { execution } = createExecutionOptions();
  const workflow = new GuidedWorkflow(api, {
    id: "guided-test",
    parseGoalArg: parseTrimmedStringArg,
    approval,
    execution,
    text: { alreadyRunning: "guided running" },
  });
  const { ctx } = createContext();

  await workflow.handleCommand("first run", ctx);
  await workflow.handleAgentEnd(
    {
      messages: [
        { role: "user", content: [{ type: "text", text: sentUserMessages[0]! }] },
        { role: "assistant", content: [{ type: "text", text: "draft plan" }] },
      ],
    },
    ctx,
  );

  await workflow.handleTurnEnd(
    {
      message: {
        role: "assistant",
        content: [{ type: "text", text: "Completed first task [DONE:1]" }],
      },
    },
    ctx,
  );

  assert.equal(sentUserMessages[2], "Execute step 2: Second task");
  assert.deepEqual(sentUserMessageOptions[2], { deliverAs: "followUp" });
  assert.deepEqual(workflow.getExecutionSnapshot(), {
    note: undefined,
    items: [
      { step: 1, text: "First task", completed: true },
      { step: 2, text: "Second task", completed: false },
    ],
  });
});

test("GuidedWorkflow clears execution state after the final step is done", async () => {
  const { api, sentUserMessages } = createApi();
  const { approval } = createApprovalOptions({
    selection: { action: "approve" },
  });
  const { execution } = createExecutionOptions();
  const workflow = new GuidedWorkflow(api, {
    id: "guided-test",
    parseGoalArg: parseTrimmedStringArg,
    approval,
    execution,
    text: { alreadyRunning: "guided running" },
  });
  const { ctx } = createContext();

  await workflow.handleCommand("first run", ctx);
  await workflow.handleAgentEnd(
    {
      messages: [
        { role: "user", content: [{ type: "text", text: sentUserMessages[0]! }] },
        { role: "assistant", content: [{ type: "text", text: "draft plan" }] },
      ],
    },
    ctx,
  );

  await workflow.handleTurnEnd(
    {
      message: {
        role: "assistant",
        content: [{ type: "text", text: "Completed first task [DONE:1]" }],
      },
    },
    ctx,
  );
  await workflow.handleTurnEnd(
    {
      message: {
        role: "assistant",
        content: [{ type: "text", text: "Completed second task [DONE:2]" }],
      },
    },
    ctx,
  );

  assert.deepEqual(workflow.getStateSnapshot(), {
    phase: "idle",
    goal: undefined,
    pendingRequestId: undefined,
    awaitingResponse: false,
  });
  assert.deepEqual(workflow.getExecutionSnapshot(), {
    note: undefined,
    items: [],
  });
});

test("GuidedWorkflow does not send extra prompts after execution is complete", async () => {
  const { api, sentUserMessages } = createApi();
  const { approval } = createApprovalOptions({
    selection: { action: "approve" },
  });
  const { execution } = createExecutionOptions();
  const workflow = new GuidedWorkflow(api, {
    id: "guided-test",
    parseGoalArg: parseTrimmedStringArg,
    approval,
    execution,
    text: { alreadyRunning: "guided running" },
  });
  const { ctx } = createContext();

  await workflow.handleCommand("first run", ctx);
  await workflow.handleAgentEnd(
    {
      messages: [
        { role: "user", content: [{ type: "text", text: sentUserMessages[0]! }] },
        { role: "assistant", content: [{ type: "text", text: "draft plan" }] },
      ],
    },
    ctx,
  );

  await workflow.handleTurnEnd(
    {
      message: {
        role: "assistant",
        content: [{ type: "text", text: "Completed first task [DONE:1]" }],
      },
    },
    ctx,
  );
  await workflow.handleTurnEnd(
    {
      message: {
        role: "assistant",
        content: [{ type: "text", text: "Completed second task [DONE:2]" }],
      },
    },
    ctx,
  );

  const sentMessageCount = sentUserMessages.length;
  await workflow.handleTurnEnd(
    {
      message: {
        role: "assistant",
        content: [{ type: "text", text: "Repeated marker [DONE:2]" }],
      },
    },
    ctx,
  );

  assert.equal(sentUserMessages.length, sentMessageCount);
});

test("GuidedWorkflow resets active execution state on session shutdown", async () => {
  const { api, sentUserMessages } = createApi();
  const { approval } = createApprovalOptions({
    selection: { action: "approve", note: "ship it" },
  });
  const { execution } = createExecutionOptions();
  const workflow = new GuidedWorkflow(api, {
    id: "guided-test",
    parseGoalArg: parseTrimmedStringArg,
    approval,
    execution,
    text: { alreadyRunning: "guided running" },
  });
  const { ctx } = createContext();

  await workflow.handleCommand("first run", ctx);
  await workflow.handleAgentEnd(
    {
      messages: [
        { role: "user", content: [{ type: "text", text: sentUserMessages[0]! }] },
        { role: "assistant", content: [{ type: "text", text: "draft plan" }] },
      ],
    },
    ctx,
  );

  assert.equal(await workflow.handleSessionShutdown({ reason: "exit" }, ctx), undefined);
  assert.deepEqual(workflow.getStateSnapshot(), {
    phase: "idle",
    goal: undefined,
    pendingRequestId: undefined,
    awaitingResponse: false,
  });
  assert.deepEqual(workflow.getExecutionSnapshot(), {
    note: undefined,
    items: [],
  });

  const restart = await workflow.handleCommand("second run", ctx);
  assert.deepEqual(restart, { kind: "ok" });
});

test("GuidedWorkflow non-correlation lifecycle hooks remain no-ops outside shutdown", async () => {
  const { api } = createApi();
  const workflow = new GuidedWorkflow(api, {
    id: "guided-test",
    parseGoalArg: parseTrimmedStringArg,
    text: { alreadyRunning: "guided running" },
  });
  const { ctx } = createContext();

  await workflow.handleCommand("first run", ctx);

  assert.equal(await workflow.handleToolCall({ toolName: "Read" }, ctx), undefined);
  assert.equal(await workflow.handleBeforeAgentStart({ systemPrompt: "base" }, ctx), undefined);
  assert.equal(await workflow.handleTurnEnd({ message: { role: "assistant" } }, ctx), undefined);
  assert.equal(await workflow.handleSessionStart({ restored: true }, ctx), undefined);
  assert.deepEqual(workflow.getStateSnapshot(), {
    phase: "planning",
    goal: "first run",
    pendingRequestId: "guided-test-1",
    awaitingResponse: true,
  });
});
