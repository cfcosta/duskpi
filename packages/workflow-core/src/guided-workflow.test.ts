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

  const api: ExtensionAPI = {
    sendMessage() {},
    sendUserMessage(message) {
      if (typeof message !== "string") {
        throw new Error("GuidedWorkflow tests expect string prompts");
      }
      sentUserMessages.push(message);
    },
    registerCommand() {},
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

  return { api, sentUserMessages };
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
          content: [{ type: "text", text: "plan prompt\n\n<!-- workflow-request-id:guided-test-99 -->" }],
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

test("GuidedWorkflow non-correlation lifecycle hooks are currently no-ops", async () => {
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
  assert.equal(await workflow.handleSessionShutdown({ reason: "exit" }, ctx), undefined);
  assert.deepEqual(workflow.getStateSnapshot(), {
    phase: "planning",
    goal: "first run",
    pendingRequestId: "guided-test-1",
    awaitingResponse: true,
  });
});
