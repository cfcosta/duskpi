import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type {
  ExtensionAPI,
  ExtensionContext,
  ExtensionTheme,
  ExtensionUICustomFactory,
  SessionCompactEvent,
  SessionForkEvent,
  SessionSwitchEvent,
} from "../../../packages/workflow-core/src/index";
import rlmExtension, { registerRlmExtension } from "../index";
import { RLM_COMMAND_DESCRIPTION, RlmWorkflow } from "./workflow";

interface Harness {
  commands: Record<
    string,
    { description: string; handler: (args: unknown, ctx: ExtensionContext) => unknown }
  >;
  listeners: Record<string, (event: unknown, ctx: ExtensionContext) => unknown>;
  sentMessages: Array<{
    message: { customType?: string; content?: unknown; display?: boolean };
    options?: unknown;
  }>;
  sentUserMessages: Array<{ content: unknown; options?: unknown }>;
}

function createContext(): ExtensionContext {
  const notifications: Array<{ message: string; level?: string }> = [];
  const statuses: Array<{ key: string; value: string | undefined }> = [];
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
      notify(message: string, level?: "info" | "warning" | "error") {
        notifications.push({ message, level });
      },
      setStatus(key: string, value: string | undefined) {
        statuses.push({ key, value });
      },
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

  Reflect.set(ctx, "notifications", notifications);
  Reflect.set(ctx, "statuses", statuses);
  return ctx;
}

function createHarness(register = rlmExtension): Harness {
  const commands: Harness["commands"] = {};
  const listeners: Harness["listeners"] = {};
  const sentMessages: Harness["sentMessages"] = [];
  const sentUserMessages: Harness["sentUserMessages"] = [];

  const api: ExtensionAPI = {
    sendMessage(message, options) {
      sentMessages.push({ message, options });
    },
    sendUserMessage(content, options) {
      sentUserMessages.push({ content, options });
    },
    registerMessageRenderer() {},
    registerTool() {},
    registerCommand(name, command) {
      commands[name] = command;
    },
    getActiveTools() {
      return [];
    },
    getAllTools() {
      return [];
    },
    setActiveTools() {},
    on(name, handler) {
      listeners[name] = handler as (event: unknown, ctx: ExtensionContext) => unknown;
    },
  };

  register(api);

  return {
    commands,
    listeners,
    sentMessages,
    sentUserMessages,
  };
}

function buildTextMessage(role: "user" | "assistant" | "custom", text: string) {
  return {
    role,
    content: [{ type: "text", text }],
  };
}

function extractRequestId(prompt: string): string | undefined {
  const match = prompt.match(/<!--\s*workflow-request-id:([^>]+)\s*-->/i);
  return match?.[1]?.trim();
}

function extractMetadataPath(prompt: string, fieldName: string): string | undefined {
  const escapedName = fieldName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = prompt.match(new RegExp(`"${escapedName}":\\s*"([^"]+)"`));
  return match?.[1];
}

test("registerRlmExtension wires /rlm and forwards all workflow handlers", async () => {
  const commands: Record<
    string,
    { description: string; handler: (args: unknown, ctx: ExtensionContext) => unknown }
  > = {};
  const listeners: Record<string, (event: unknown, ctx: ExtensionContext) => unknown> = {};
  const forwarded: Array<{ type: string; payload: unknown; ctx: ExtensionContext }> = [];

  const api: ExtensionAPI = {
    sendMessage() {},
    sendUserMessage() {},
    registerMessageRenderer() {},
    registerTool() {},
    registerCommand(name, command) {
      commands[name] = command;
    },
    getActiveTools() {
      return [];
    },
    getAllTools() {
      return [];
    },
    setActiveTools() {},
    on(name, handler) {
      listeners[name] = handler as (event: unknown, ctx: ExtensionContext) => unknown;
    },
  };

  const workflow = {
    handleCommand(args: unknown, ctx: ExtensionContext) {
      forwarded.push({ type: "command", payload: args, ctx });
      return "command-result";
    },
    handleToolCall(event: { toolName?: string }, ctx: ExtensionContext) {
      forwarded.push({ type: "tool_call", payload: event, ctx });
      return "tool-result";
    },
    handleAgentEnd(event: { messages?: unknown[] }, ctx: ExtensionContext) {
      forwarded.push({ type: "agent_end", payload: event, ctx });
      return "agent-end-result";
    },
    handleBeforeAgentStart(event: { systemPrompt: string }, ctx: ExtensionContext) {
      forwarded.push({ type: "before_agent_start", payload: event, ctx });
      return { systemPrompt: `${event.systemPrompt}\n\nrlm` };
    },
    handleTurnEnd(event: { message?: unknown }, ctx: ExtensionContext) {
      forwarded.push({ type: "turn_end", payload: event, ctx });
      return "turn-end-result";
    },
    handleSessionStart(event: { restored?: boolean }, ctx: ExtensionContext) {
      forwarded.push({ type: "session_start", payload: event, ctx });
      return "session-start-result";
    },
    handleSessionSwitch(event: SessionSwitchEvent, ctx: ExtensionContext) {
      forwarded.push({ type: "session_switch", payload: event, ctx });
      return "session-switch-result";
    },
    handleSessionFork(event: SessionForkEvent, ctx: ExtensionContext) {
      forwarded.push({ type: "session_fork", payload: event, ctx });
      return "session-fork-result";
    },
    handleSessionCompact(event: SessionCompactEvent, ctx: ExtensionContext) {
      forwarded.push({ type: "session_compact", payload: event, ctx });
      return "session-compact-result";
    },
    handleSessionShutdown(event: { reason?: string }, ctx: ExtensionContext) {
      forwarded.push({ type: "session_shutdown", payload: event, ctx });
      return "session-shutdown-result";
    },
  };

  const returnedWorkflow = registerRlmExtension(api, workflow);
  const ctx = createContext();
  const sessionSwitchEvent: SessionSwitchEvent = {
    reason: "resume",
    previousSessionFile: "/tmp/previous.pi",
  };
  const sessionForkEvent: SessionForkEvent = {
    previousSessionFile: "/tmp/previous.pi",
  };
  const sessionCompactEvent: SessionCompactEvent = {
    compactionEntry: { id: "compact-1" },
    fromExtension: true,
  };

  assert.equal(returnedWorkflow, workflow);
  assert.equal(commands.rlm?.description, RLM_COMMAND_DESCRIPTION);
  assert.ok(listeners.tool_call);
  assert.ok(listeners.agent_end);
  assert.ok(listeners.before_agent_start);
  assert.ok(listeners.turn_end);
  assert.ok(listeners.session_start);
  assert.ok(listeners.session_switch);
  assert.ok(listeners.session_fork);
  assert.ok(listeners.session_compact);
  assert.ok(listeners.session_shutdown);

  assert.equal(commands.rlm?.handler("what changed?", ctx), "command-result");
  assert.equal(listeners.tool_call?.({ toolName: "read" }, ctx), "tool-result");
  assert.equal(listeners.agent_end?.({ messages: ["done"] }, ctx), "agent-end-result");
  assert.deepEqual(listeners.before_agent_start?.({ systemPrompt: "base" }, ctx), {
    systemPrompt: "base\n\nrlm",
  });
  assert.equal(listeners.turn_end?.({ message: { role: "assistant" } }, ctx), "turn-end-result");
  assert.equal(listeners.session_start?.({ restored: true }, ctx), "session-start-result");
  assert.equal(listeners.session_switch?.(sessionSwitchEvent, ctx), "session-switch-result");
  assert.equal(listeners.session_fork?.(sessionForkEvent, ctx), "session-fork-result");
  assert.equal(listeners.session_compact?.(sessionCompactEvent, ctx), "session-compact-result");
  assert.equal(
    listeners.session_shutdown?.({ reason: "shutdown" }, ctx),
    "session-shutdown-result",
  );

  assert.deepEqual(
    forwarded.map((entry) => entry.type),
    [
      "command",
      "tool_call",
      "agent_end",
      "before_agent_start",
      "turn_end",
      "session_start",
      "session_switch",
      "session_fork",
      "session_compact",
      "session_shutdown",
    ],
  );
});

test("/rlm starts a run from a question and sends workspace metadata only", async () => {
  const harness = createHarness();
  const ctx = createContext();

  await harness.commands.rlm?.handler(
    "summarize the recursive workflow without leaking the full workspace",
    ctx,
  );

  assert.equal(harness.sentUserMessages.length, 1);
  assert.equal(harness.sentMessages.length, 0);
  const prompt = String(harness.sentUserMessages[0]?.content ?? "");
  assert.match(prompt, /Workspace metadata:/);
  assert.match(
    prompt,
    /"question": "summarize the recursive workflow without leaking the full workspace"/,
  );
  assert.match(prompt, /"taskFilePath":/);
  assert.match(prompt, /"scratchpadFilePath":/);
  assert.match(prompt, /"finalFilePath":/);
  assert.match(prompt, /workflow-request-id:rlm-1/);
  assert.doesNotMatch(prompt, /No notes yet\./);
  assert.deepEqual((ctx as ExtensionContext & { notifications?: unknown[] }).notifications, []);
});

test("/rlm sets status during an active run and clears it on completion", async () => {
  const harness = createHarness();
  const ctx = createContext() as ExtensionContext & {
    notifications?: Array<{ message: string; level?: string }>;
    statuses?: Array<{ key: string; value: string | undefined }>;
  };

  await harness.commands.rlm?.handler("draft a synthesis of the main tradeoffs", ctx);

  assert.ok(
    ctx.statuses?.some(
      (entry) =>
        entry.key === "rlm" &&
        /RLM root: draft a synthesis of the main tradeoffs/.test(entry.value ?? ""),
    ),
  );

  const prompt = String(harness.sentUserMessages[0]?.content ?? "");
  const finalFilePath = extractMetadataPath(prompt, "finalFilePath");
  assert.ok(finalFilePath);

  harness.listeners.agent_end?.(
    {
      messages: [
        buildTextMessage("user", prompt),
        buildTextMessage("assistant", '{"action":"final_result","result":"done"}'),
      ],
    },
    ctx,
  );

  assert.deepEqual(ctx.statuses?.at(-1), { key: "rlm", value: undefined });
  assert.match(readFileSync(finalFilePath!, "utf8"), /done/);
});

test("/rlm resets active state on session lifecycle events", async () => {
  for (const [eventName, eventPayload] of [
    ["session_switch", { reason: "resume", previousSessionFile: "/tmp/prev.pi" }],
    ["session_fork", { previousSessionFile: "/tmp/prev.pi" }],
    ["session_compact", { compactionEntry: { id: "compact-1" }, fromExtension: true }],
    ["session_shutdown", { reason: "shutdown" }],
  ] as const) {
    const harness = createHarness();
    const ctx = createContext() as ExtensionContext & {
      statuses?: Array<{ key: string; value: string | undefined }>;
    };

    await harness.commands.rlm?.handler("inspect the workspace state", ctx);
    assert.ok(
      ctx.statuses?.some((entry) => entry.key === "rlm" && typeof entry.value === "string"),
    );

    harness.listeners[eventName]?.(eventPayload, ctx);

    assert.deepEqual(ctx.statuses?.at(-1), { key: "rlm", value: undefined });

    const prompt = String(harness.sentUserMessages[0]?.content ?? "");
    harness.listeners.agent_end?.(
      {
        messages: [
          buildTextMessage("user", prompt),
          buildTextMessage("assistant", '{"action":"inspect_document"}'),
        ],
      },
      ctx,
    );

    assert.equal(harness.sentMessages.length, 0);
  }
});

test("/rlm ignores agent_end payloads with mismatched request ids", async () => {
  const harness = createHarness();
  const ctx = createContext();

  await harness.commands.rlm?.handler("inspect the generated workspace", ctx);
  const prompt = String(harness.sentUserMessages[0]?.content ?? "");

  harness.listeners.agent_end?.(
    {
      messages: [
        buildTextMessage(
          "user",
          prompt.replace("workflow-request-id:rlm-1", "workflow-request-id:rlm-mismatch"),
        ),
        buildTextMessage("assistant", '{"action":"inspect_document"}'),
      ],
    },
    ctx,
  );

  assert.equal(harness.sentMessages.length, 0);
  assert.deepEqual((ctx as ExtensionContext & { notifications?: unknown[] }).notifications, []);
});

test("/rlm executes inspect_document and sends a follow-up observation", async () => {
  const harness = createHarness();
  const ctx = createContext();

  await harness.commands.rlm?.handler("inspect the workspace", ctx);
  const prompt = String(harness.sentUserMessages[0]?.content ?? "");

  harness.listeners.agent_end?.(
    {
      messages: [
        buildTextMessage("user", prompt),
        buildTextMessage("assistant", '{"action":"inspect_document"}'),
      ],
    },
    ctx,
  );

  assert.equal(harness.sentMessages.length, 1);
  assert.equal(harness.sentMessages[0]?.message.customType, "rlm-internal");
  assert.equal(harness.sentMessages[0]?.message.display, false);
  assert.deepEqual(harness.sentMessages[0]?.options, {
    triggerTurn: true,
    deliverAs: "followUp",
  });
  const followUp = String(harness.sentMessages[0]?.message.content ?? "");
  assert.match(followUp, /"type": "inspect_document"/);
  assert.match(followUp, /"hasFinalResult": false/);
  assert.match(followUp, /workflow-request-id:rlm-2/);
});

test("/rlm executes read_segment and search_document actions over the workspace", async () => {
  const harness = createHarness();
  const ctx = createContext();

  await harness.commands.rlm?.handler("recursion should appear in the workspace question", ctx);
  const initialPrompt = String(harness.sentUserMessages[0]?.content ?? "");

  harness.listeners.agent_end?.(
    {
      messages: [
        buildTextMessage("user", initialPrompt),
        buildTextMessage("assistant", '{"action":"read_segment","offset":0,"length":120}'),
      ],
    },
    ctx,
  );

  assert.equal(harness.sentMessages.length, 1);
  const readFollowUp = String(harness.sentMessages[0]?.message.content ?? "");
  assert.match(readFollowUp, /"type": "read_segment"/);
  assert.match(readFollowUp, /RLM Workspace/);

  harness.listeners.agent_end?.(
    {
      messages: [
        buildTextMessage("custom", readFollowUp),
        buildTextMessage(
          "assistant",
          '{"action":"search_document","query":"recursion","maxResults":2}',
        ),
      ],
    },
    ctx,
  );

  assert.equal(harness.sentMessages.length, 2);
  const searchFollowUp = String(harness.sentMessages[1]?.message.content ?? "");
  assert.match(searchFollowUp, /"type": "search_document"/);
  assert.match(searchFollowUp, /"totalMatches": 1/);
  assert.match(searchFollowUp, /recursion should appear in the workspace question/i);
});

test("/rlm schedules a hidden child turn, updates the scratchpad, and resumes the parent", async () => {
  const harness = createHarness();
  const ctx = createContext() as ExtensionContext & {
    notifications?: Array<{ message: string; level?: string }>;
  };

  await harness.commands.rlm?.handler("summarize the introduction in one sentence", ctx);
  const initialPrompt = String(harness.sentUserMessages[0]?.content ?? "");
  const scratchpadFilePath = extractMetadataPath(initialPrompt, "scratchpadFilePath");
  assert.ok(scratchpadFilePath);

  harness.listeners.agent_end?.(
    {
      messages: [
        buildTextMessage("user", initialPrompt),
        buildTextMessage(
          "assistant",
          '{"action":"subcall","prompt":"Summarize the first workspace section in one sentence.","storeAs":"chunk_1"}',
        ),
      ],
    },
    ctx,
  );

  assert.equal(harness.sentMessages.length, 1);
  const childPrompt = String(harness.sentMessages[0]?.message.content ?? "");
  assert.match(childPrompt, /Recursive child sub-call/);
  assert.match(childPrompt, /Store target: chunk_1/);
  assert.match(childPrompt, /workflow-request-id:rlm-2/);

  harness.listeners.agent_end?.(
    {
      messages: [
        buildTextMessage("custom", childPrompt),
        buildTextMessage(
          "assistant",
          '{"action":"final_result","result":"The first workspace section says the run starts from a question and stores intermediate summaries in files."}',
        ),
      ],
    },
    ctx,
  );

  assert.equal(harness.sentMessages.length, 2);
  const parentResume = String(harness.sentMessages[1]?.message.content ?? "");
  assert.match(parentResume, /"type": "subcall_result"/);
  assert.match(parentResume, /"storeAs": "chunk_1"/);
  assert.match(parentResume, /intermediate summaries in files/);
  assert.match(parentResume, /workflow-request-id:rlm-3/);
  assert.match(readFileSync(scratchpadFilePath!, "utf8"), /subcall:chunk_1/);
  assert.match(readFileSync(scratchpadFilePath!, "utf8"), /intermediate summaries in files/);
});

test("/rlm stops when subcalls exceed the recursion depth budget", async () => {
  const harness = createHarness((api) =>
    registerRlmExtension(
      api,
      new RlmWorkflow(api, {
        maxRecursionDepth: 0,
      }),
    ),
  );
  const ctx = createContext() as ExtensionContext & {
    notifications?: Array<{ message: string; level?: string }>;
  };

  await harness.commands.rlm?.handler("summarize the workspace", ctx);
  const prompt = String(harness.sentUserMessages[0]?.content ?? "");

  harness.listeners.agent_end?.(
    {
      messages: [
        buildTextMessage("user", prompt),
        buildTextMessage(
          "assistant",
          '{"action":"subcall","prompt":"Summarize the chunk.","storeAs":"chunk_1"}',
        ),
      ],
    },
    ctx,
  );

  assert.equal(harness.sentMessages.length, 0);
  assert.deepEqual(ctx.notifications, [
    {
      message: "RLM stopped: exceeded max recursion depth (0).",
      level: "error",
    },
  ]);
});

test("/rlm stops when actions exceed the iteration budget", async () => {
  const harness = createHarness((api) =>
    registerRlmExtension(
      api,
      new RlmWorkflow(api, {
        maxIterations: 1,
      }),
    ),
  );
  const ctx = createContext() as ExtensionContext & {
    notifications?: Array<{ message: string; level?: string }>;
  };

  await harness.commands.rlm?.handler("inspect the workspace", ctx);
  const prompt = String(harness.sentUserMessages[0]?.content ?? "");

  harness.listeners.agent_end?.(
    {
      messages: [
        buildTextMessage("user", prompt),
        buildTextMessage("assistant", '{"action":"inspect_document"}'),
      ],
    },
    ctx,
  );

  assert.equal(harness.sentMessages.length, 1);
  const followUp = String(harness.sentMessages[0]?.message.content ?? "");

  harness.listeners.agent_end?.(
    {
      messages: [
        buildTextMessage("custom", followUp),
        buildTextMessage("assistant", '{"action":"inspect_document"}'),
      ],
    },
    ctx,
  );

  assert.equal(harness.sentMessages.length, 1);
  assert.deepEqual(ctx.notifications, [
    {
      message: "RLM stopped: exceeded max iteration budget (1).",
      level: "error",
    },
  ]);
});

test("/rlm retries malformed assistant output once and then stops with a clear error", async () => {
  const harness = createHarness((api) =>
    registerRlmExtension(
      api,
      new RlmWorkflow(api, {
        maxMalformedOutputRetries: 1,
      }),
    ),
  );
  const ctx = createContext() as ExtensionContext & {
    notifications?: Array<{ message: string; level?: string }>;
  };

  await harness.commands.rlm?.handler("inspect the workspace", ctx);
  const prompt = String(harness.sentUserMessages[0]?.content ?? "");

  harness.listeners.agent_end?.(
    {
      messages: [
        buildTextMessage("user", prompt),
        {
          role: "assistant",
          content: [{ type: "text", text: "   " }],
        },
      ],
    },
    ctx,
  );

  assert.equal(harness.sentMessages.length, 1);
  const retryPrompt = String(harness.sentMessages[0]?.message.content ?? "");
  assert.match(retryPrompt, /workflow-request-id:rlm-2/);

  harness.listeners.agent_end?.(
    {
      messages: [
        buildTextMessage("custom", retryPrompt),
        buildTextMessage("assistant", "not json"),
      ],
    },
    ctx,
  );

  assert.equal(harness.sentMessages.length, 1);
  assert.deepEqual(ctx.notifications, [
    {
      message: "RLM response was empty or invalid. Retrying (1/1).",
      level: "warning",
    },
    {
      message: "RLM stopped: assistant action output remained malformed.",
      level: "error",
    },
  ]);
});

test("/rlm completes an end-to-end recursive workflow over the generated workspace", async () => {
  const harness = createHarness();
  const ctx = createContext() as ExtensionContext & {
    notifications?: Array<{ message: string; level?: string }>;
  };

  await harness.commands.rlm?.handler(
    "write a final synthesis about recursive workspace control",
    ctx,
  );

  assert.equal(harness.sentUserMessages.length, 1);
  const initialPrompt = String(harness.sentUserMessages[0]?.content ?? "");
  const finalFilePath = extractMetadataPath(initialPrompt, "finalFilePath");
  assert.ok(finalFilePath);
  assert.match(initialPrompt, /Workspace metadata:/);

  harness.listeners.agent_end?.(
    {
      messages: [
        buildTextMessage("user", initialPrompt),
        buildTextMessage(
          "assistant",
          '{"action":"subcall","prompt":"Summarize the task and workspace layout in one sentence.","storeAs":"intro_summary"}',
        ),
      ],
    },
    ctx,
  );

  assert.equal(harness.sentMessages.length, 1);
  const childPrompt = String(harness.sentMessages[0]?.message.content ?? "");
  assert.match(childPrompt, /Store target: intro_summary/);

  harness.listeners.agent_end?.(
    {
      messages: [
        buildTextMessage("custom", childPrompt),
        buildTextMessage(
          "assistant",
          '{"action":"final_result","result":"The workspace starts from a question, tracks scratchpad notes, and stores reusable summaries for later reasoning."}',
        ),
      ],
    },
    ctx,
  );

  assert.equal(harness.sentMessages.length, 2);
  const parentResume = String(harness.sentMessages[1]?.message.content ?? "");
  assert.match(parentResume, /"type": "subcall_result"/);
  assert.match(parentResume, /intro_summary/);

  harness.listeners.agent_end?.(
    {
      messages: [
        buildTextMessage("custom", parentResume),
        buildTextMessage(
          "assistant",
          '{"action":"final_result","result":"Final answer: start from a question, create workspace files, and let recursive summaries accumulate in scratchpad and final outputs."}',
        ),
      ],
    },
    ctx,
  );

  assert.deepEqual(ctx.notifications, [
    {
      message: `RLM final result ready at ${finalFilePath}.`,
      level: "info",
    },
  ]);
  assert.match(readFileSync(finalFilePath!, "utf8"), /create workspace files/);
});
