import { test } from "bun:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import type {
  ExtensionAPI,
  ExtensionContext,
  ExtensionTheme,
  ExtensionUICustomFactory,
  SessionCompactEvent,
  SessionForkEvent,
  SessionSwitchEvent,
} from "../../../packages/workflow-core/src/index";
import type { RlmExecutorResult } from "./executor";
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

function createQueuedExecutor(results: RlmExecutorResult[]) {
  const calls: Array<Record<string, unknown>> = [];
  return {
    calls,
    executor: {
      async execute(input: Record<string, unknown>): Promise<RlmExecutorResult> {
        calls.push(input);
        const next = results.shift();
        if (!next) {
          throw new Error("executor queue exhausted");
        }
        return next;
      },
    },
  };
}

function createPersistentMockExecutor() {
  const state: { prefix?: string } = {};
  return {
    executor: {
      async execute(input: Record<string, unknown>): Promise<RlmExecutorResult> {
        const program = input.program as { code?: unknown } | undefined;
        const code = typeof program?.code === "string" ? program.code : "";

        if (code.includes("const prefix = 'live';") && code.includes("finish(value)")) {
          state.prefix = "live";
          return {
            kind: "completed",
            variables: { stage: "live:ready" },
            logs: [],
            summary: undefined,
          };
        }

        if (code.includes("setFinal(finish('done'));")) {
          return {
            kind: "completed",
            variables: { Final: `${state.prefix ?? "missing"}:done` },
            logs: [],
            summary: undefined,
          };
        }

        return {
          kind: "runtime_error",
          message: `unexpected mock program: ${code}`,
          exitCode: null,
        };
      },
    },
  };
}

function createLoopingSubcallExecutor() {
  const createChildExecutor = () => ({
    async execute(input: Record<string, unknown>): Promise<RlmExecutorResult> {
      const program = input.program as { code?: unknown } | undefined;
      const code = typeof program?.code === "string" ? program.code : "";

      const finalMatch = code.match(/setFinal\("([^"]+)"\)/);
      if (finalMatch) {
        return {
          kind: "completed",
          variables: { Final: finalMatch[1]! },
          logs: [],
          summary: undefined,
        };
      }

      return {
        kind: "runtime_error",
        message: `unexpected child mock program: ${code}`,
        exitCode: null,
      };
    },
    fork() {
      return createChildExecutor();
    },
  });

  const createRootExecutor = () => ({
    async execute(input: Record<string, unknown>): Promise<RlmExecutorResult> {
      const program = input.program as { code?: unknown } | undefined;
      const code = typeof program?.code === "string" ? program.code : "";
      const bindings = (input.bindings as { variables?: Record<string, string> } | undefined) ?? {};
      const variables = bindings.variables ?? {};

      if (!code.includes("intro_summary") || !code.includes("body_summary")) {
        return {
          kind: "runtime_error",
          message: `unexpected root mock program: ${code}`,
          exitCode: null,
        };
      }

      if (!variables.intro_summary) {
        return {
          kind: "subcall",
          subcall: { prompt: "Summarize intro", storeAs: "intro_summary" },
          variables: { phase: "intro" },
          logs: ["request intro_summary"],
          summary: undefined,
        };
      }

      if (!variables.body_summary) {
        return {
          kind: "subcall",
          subcall: { prompt: "Summarize body", storeAs: "body_summary" },
          variables: { phase: "body" },
          logs: ["request body_summary"],
          summary: undefined,
        };
      }

      return {
        kind: "completed",
        variables: { Final: `${variables.intro_summary} | ${variables.body_summary}` },
        logs: ["root finished"],
        summary: undefined,
      };
    },
    fork() {
      return createChildExecutor();
    },
  });

  return {
    executor: createRootExecutor(),
  };
}

function buildTextMessage(role: "user" | "assistant" | "custom", text: string) {
  return {
    role,
    content: [{ type: "text", text }],
  };
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

test("/rlm starts a run from prompt metadata only", async () => {
  const { executor } = createQueuedExecutor([]);
  const harness = createHarness((api) =>
    registerRlmExtension(api, new RlmWorkflow(api, { executor })),
  );
  const ctx = createContext();
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "rlm-index-source-"));
  const sourcePath = path.join(tempDir, "paper.md");
  writeFileSync(sourcePath, "# Paper\n\nSENTINEL_IMPORTED_SOURCE_DO_NOT_LEAK", "utf8");

  await harness.commands.rlm?.handler(
    `summarize ${sourcePath} without leaking the full prompt`,
    ctx,
  );

  assert.equal(harness.sentUserMessages.length, 1);
  assert.equal(harness.sentMessages.length, 0);
  const prompt = String(harness.sentUserMessages[0]?.content ?? "");
  assert.match(prompt, /full prompt lives outside your context window/i);
  assert.match(prompt, /Prompt metadata:/);
  assert.match(prompt, /"label": "summarize/);
  assert.match(prompt, /"promptCharLength":/);
  assert.match(prompt, /"importedSourceCount": 1/);
  assert.match(prompt, /set\('Final', answer\)|setFinal/);
  assert.match(prompt, /workflow-request-id:rlm-1/);
  assert.doesNotMatch(prompt, /SENTINEL_IMPORTED_SOURCE_DO_NOT_LEAK/);
});

test("/rlm sets status during an active run and clears it on completion", async () => {
  const { executor } = createQueuedExecutor([
    {
      kind: "completed",
      variables: { Final: "done" },
      logs: [],
      summary: undefined,
    },
  ]);
  const harness = createHarness((api) =>
    registerRlmExtension(api, new RlmWorkflow(api, { executor })),
  );
  const ctx = createContext() as ExtensionContext & {
    notifications?: Array<{ message: string; level?: string }>;
    statuses?: Array<{ key: string; value: string | undefined }>;
  };

  await harness.commands.rlm?.handler("draft a synthesis of the main tradeoffs", ctx);

  assert.ok(
    ctx.statuses?.some(
      (entry) => entry.key === "rlm" && /RLM root: draft a synthesis/.test(entry.value ?? ""),
    ),
  );

  const prompt = String(harness.sentUserMessages[0]?.content ?? "");
  const finalFilePath = extractMetadataPath(prompt, "finalFilePath");
  assert.ok(finalFilePath);

  await harness.listeners.agent_end?.(
    {
      messages: [
        buildTextMessage("user", prompt),
        buildTextMessage("assistant", 'setFinal("done");'),
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
    const { executor } = createQueuedExecutor([]);
    const harness = createHarness((api) =>
      registerRlmExtension(api, new RlmWorkflow(api, { executor })),
    );
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
    await harness.listeners.agent_end?.(
      {
        messages: [
          buildTextMessage("user", prompt),
          buildTextMessage("assistant", 'setSummary("noop");'),
        ],
      },
      ctx,
    );

    assert.equal(harness.sentMessages.length, 0);
  }
});

test("/rlm ignores agent_end payloads with mismatched request ids", async () => {
  const { executor } = createQueuedExecutor([]);
  const harness = createHarness((api) =>
    registerRlmExtension(api, new RlmWorkflow(api, { executor })),
  );
  const ctx = createContext();

  await harness.commands.rlm?.handler("inspect the generated workspace", ctx);
  const prompt = String(harness.sentUserMessages[0]?.content ?? "");

  await harness.listeners.agent_end?.(
    {
      messages: [
        buildTextMessage(
          "user",
          prompt.replace("workflow-request-id:rlm-1", "workflow-request-id:rlm-mismatch"),
        ),
        buildTextMessage("assistant", 'setSummary("ignored");'),
      ],
    },
    ctx,
  );

  assert.equal(harness.sentMessages.length, 0);
  assert.deepEqual((ctx as ExtensionContext & { notifications?: unknown[] }).notifications, []);
});

test("/rlm schedules a child frame and resumes the parent program automatically", async () => {
  const { executor } = createQueuedExecutor([
    {
      kind: "subcall",
      subcall: { prompt: "Summarize the first section.", storeAs: "chunk_1" },
      variables: { phase: "search" },
      logs: ["launch child"],
      summary: "searched prompt",
    },
    {
      kind: "completed",
      variables: { Final: "The child summary." },
      logs: ["child done"],
      summary: undefined,
    },
    {
      kind: "completed",
      variables: { Final: "Parent completed with chunk_1." },
      logs: ["parent done"],
      summary: undefined,
    },
  ]);
  const harness = createHarness((api) =>
    registerRlmExtension(api, new RlmWorkflow(api, { executor })),
  );
  const ctx = createContext();

  await harness.commands.rlm?.handler("summarize the introduction", ctx);
  const initialPrompt = String(harness.sentUserMessages[0]?.content ?? "");
  const scratchpadFilePath = extractMetadataPath(initialPrompt, "scratchpadFilePath");
  const finalFilePath = extractMetadataPath(initialPrompt, "finalFilePath");
  assert.ok(scratchpadFilePath);
  assert.ok(finalFilePath);

  await harness.listeners.agent_end?.(
    {
      messages: [
        buildTextMessage("user", initialPrompt),
        buildTextMessage("assistant", 'subcall("Summarize the first section.", "chunk_1");'),
      ],
    },
    ctx,
  );

  assert.equal(harness.sentMessages.length, 1);
  const childPrompt = String(harness.sentMessages[0]?.message.content ?? "");
  assert.match(childPrompt, /Recursive child sub-call active/i);
  assert.match(childPrompt, /chunk_1/);
  assert.match(childPrompt, /workflow-request-id:rlm-2/);

  await harness.listeners.agent_end?.(
    {
      messages: [
        buildTextMessage("custom", childPrompt),
        buildTextMessage("assistant", 'setFinal("The child summary.");'),
      ],
    },
    ctx,
  );

  assert.equal(harness.sentMessages.length, 1);
  assert.deepEqual(
    (ctx as ExtensionContext & { notifications?: Array<{ message: string; level?: string }> })
      .notifications,
    [
      {
        message: `RLM final result ready at ${finalFilePath}.`,
        level: "info",
      },
    ],
  );
  assert.match(readFileSync(scratchpadFilePath!, "utf8"), /subcall:chunk_1/);
  assert.match(
    readFileSync(scratchpadFilePath!, "utf8"),
    /Stored child response in variable 'chunk_1'/,
  );
});

test("/rlm can satisfy repeated subcalls inside one parent program without a new parent turn", async () => {
  const { executor } = createLoopingSubcallExecutor();
  const harness = createHarness((api) =>
    registerRlmExtension(api, new RlmWorkflow(api, { executor })),
  );
  const ctx = createContext() as ExtensionContext & {
    notifications?: Array<{ message: string; level?: string }>;
  };

  await harness.commands.rlm?.handler("summarize two sections and combine them", ctx);
  const initialPrompt = String(harness.sentUserMessages[0]?.content ?? "");
  const finalFilePath = extractMetadataPath(initialPrompt, "finalFilePath");
  assert.ok(finalFilePath);

  await harness.listeners.agent_end?.(
    {
      messages: [
        buildTextMessage("user", initialPrompt),
        buildTextMessage(
          "assistant",
          [
            "const intro = subcall('Summarize intro', 'intro_summary');",
            "const body = subcall('Summarize body', 'body_summary');",
            "setFinal(intro + ' | ' + body);",
          ].join("\n"),
        ),
      ],
    },
    ctx,
  );

  assert.equal(harness.sentMessages.length, 1);
  const firstChildPrompt = String(harness.sentMessages[0]?.message.content ?? "");
  assert.match(firstChildPrompt, /intro_summary/);

  await harness.listeners.agent_end?.(
    {
      messages: [
        buildTextMessage("custom", firstChildPrompt),
        buildTextMessage("assistant", 'setFinal("Intro summary");'),
      ],
    },
    ctx,
  );

  assert.equal(harness.sentMessages.length, 2);
  const secondChildPrompt = String(harness.sentMessages[1]?.message.content ?? "");
  assert.match(secondChildPrompt, /body_summary/);
  assert.doesNotMatch(secondChildPrompt, /Child sub-call completed/);

  await harness.listeners.agent_end?.(
    {
      messages: [
        buildTextMessage("custom", secondChildPrompt),
        buildTextMessage("assistant", 'setFinal("Body summary");'),
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
  assert.equal(harness.sentMessages.length, 2);
  assert.match(readFileSync(finalFilePath!, "utf8"), /Intro summary \| Body summary/);
});

test("/rlm stops when subcalls exceed the recursion depth budget", async () => {
  const { executor } = createQueuedExecutor([
    {
      kind: "subcall",
      subcall: { prompt: "Summarize chunk", storeAs: "chunk_1" },
      variables: {},
      logs: [],
      summary: undefined,
    },
  ]);
  const harness = createHarness((api) =>
    registerRlmExtension(
      api,
      new RlmWorkflow(api, {
        maxRecursionDepth: 0,
        executor,
      }),
    ),
  );
  const ctx = createContext() as ExtensionContext & {
    notifications?: Array<{ message: string; level?: string }>;
  };

  await harness.commands.rlm?.handler("summarize the workspace", ctx);
  const prompt = String(harness.sentUserMessages[0]?.content ?? "");

  await harness.listeners.agent_end?.(
    {
      messages: [
        buildTextMessage("user", prompt),
        buildTextMessage("assistant", 'subcall("Summarize chunk", "chunk_1");'),
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

test("/rlm stops when programs exceed the iteration budget", async () => {
  const { executor } = createQueuedExecutor([
    {
      kind: "completed",
      variables: { note: "first pass" },
      logs: ["first"],
      summary: undefined,
    },
  ]);
  const harness = createHarness((api) =>
    registerRlmExtension(
      api,
      new RlmWorkflow(api, {
        maxIterations: 1,
        executor,
      }),
    ),
  );
  const ctx = createContext() as ExtensionContext & {
    notifications?: Array<{ message: string; level?: string }>;
  };

  await harness.commands.rlm?.handler("inspect the workspace", ctx);
  const prompt = String(harness.sentUserMessages[0]?.content ?? "");

  await harness.listeners.agent_end?.(
    {
      messages: [
        buildTextMessage("user", prompt),
        buildTextMessage("assistant", 'set("note", "first pass");'),
      ],
    },
    ctx,
  );

  assert.equal(harness.sentMessages.length, 1);
  const followUp = String(harness.sentMessages[0]?.message.content ?? "");

  await harness.listeners.agent_end?.(
    {
      messages: [
        buildTextMessage("custom", followUp),
        buildTextMessage("assistant", 'setSummary("again");'),
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

test("/rlm retries malformed assistant programs once and then stops with a clear error", async () => {
  const { executor } = createQueuedExecutor([]);
  const harness = createHarness((api) =>
    registerRlmExtension(
      api,
      new RlmWorkflow(api, {
        maxMalformedOutputRetries: 1,
        executor,
      }),
    ),
  );
  const ctx = createContext() as ExtensionContext & {
    notifications?: Array<{ message: string; level?: string }>;
  };

  await harness.commands.rlm?.handler("inspect the workspace", ctx);
  const prompt = String(harness.sentUserMessages[0]?.content ?? "");

  await harness.listeners.agent_end?.(
    {
      messages: [
        buildTextMessage("user", prompt),
        buildTextMessage(
          "assistant",
          'Here is the program you asked for:\n```js\nsetFinal("done");\n```',
        ),
      ],
    },
    ctx,
  );

  assert.equal(harness.sentMessages.length, 1);
  const retryPrompt = String(harness.sentMessages[0]?.message.content ?? "");
  assert.match(retryPrompt, /workflow-request-id:rlm-2/);
  assert.match(retryPrompt, /previous RLM JavaScript program was invalid/i);
  assert.match(retryPrompt, /must not include prose/i);

  await harness.listeners.agent_end?.(
    {
      messages: [
        buildTextMessage("custom", retryPrompt),
        buildTextMessage("assistant", "const broken = ;"),
      ],
    },
    ctx,
  );

  assert.equal(harness.sentMessages.length, 1);
  assert.deepEqual(ctx.notifications, [
    {
      message:
        "RLM could not parse the assistant program: Assistant program output must not include prose outside the JavaScript code block. Retrying (1/1).",
      level: "warning",
    },
    {
      message: "RLM stopped: assistant program output remained malformed.",
      level: "error",
    },
  ]);
});

test("/rlm retries executor failures once and then can recover", async () => {
  const { executor } = createQueuedExecutor([
    {
      kind: "runtime_error",
      message: "Executor timed out after 10000ms.",
      exitCode: null,
    },
    {
      kind: "completed",
      variables: { Final: "done" },
      logs: [],
      summary: undefined,
    },
  ]);
  const harness = createHarness((api) =>
    registerRlmExtension(
      api,
      new RlmWorkflow(api, {
        maxMalformedOutputRetries: 1,
        executor,
      }),
    ),
  );
  const ctx = createContext() as ExtensionContext & {
    notifications?: Array<{ message: string; level?: string }>;
  };

  await harness.commands.rlm?.handler("finish the run", ctx);
  const prompt = String(harness.sentUserMessages[0]?.content ?? "");
  const finalFilePath = extractMetadataPath(prompt, "finalFilePath");
  assert.ok(finalFilePath);

  await harness.listeners.agent_end?.(
    {
      messages: [
        buildTextMessage("user", prompt),
        buildTextMessage("assistant", 'setFinal("done");'),
      ],
    },
    ctx,
  );

  assert.equal(harness.sentMessages.length, 1);
  const retryPrompt = String(harness.sentMessages[0]?.message.content ?? "");
  assert.match(retryPrompt, /Executor timed out/i);

  await harness.listeners.agent_end?.(
    {
      messages: [
        buildTextMessage("custom", retryPrompt),
        buildTextMessage("assistant", 'setFinal("done");'),
      ],
    },
    ctx,
  );

  assert.match(readFileSync(finalFilePath!, "utf8"), /done/);
  assert.deepEqual(ctx.notifications, [
    {
      message: "RLM program execution failed: Executor timed out after 10000ms. Retrying (1/1).",
      level: "warning",
    },
    {
      message: `RLM final result ready at ${finalFilePath}.`,
      level: "info",
    },
  ]);
});

test("/rlm keeps the JavaScript repl live across follow-up turns within a frame", async () => {
  const { executor } = createPersistentMockExecutor();
  const harness = createHarness((api) =>
    registerRlmExtension(api, new RlmWorkflow(api, { executor })),
  );
  const ctx = createContext() as ExtensionContext & {
    notifications?: Array<{ message: string; level?: string }>;
  };

  await harness.commands.rlm?.handler("keep a live repl across iterations", ctx);

  const initialPrompt = String(harness.sentUserMessages[0]?.content ?? "");
  const finalFilePath = extractMetadataPath(initialPrompt, "finalFilePath");
  assert.ok(finalFilePath);

  await harness.listeners.agent_end?.(
    {
      messages: [
        buildTextMessage("user", initialPrompt),
        buildTextMessage(
          "assistant",
          [
            "const prefix = 'live';",
            "function finish(value) { return `${prefix}:${value}`; }",
            "set('stage', finish('ready'));",
          ].join("\n"),
        ),
      ],
    },
    ctx,
  );

  assert.equal(harness.sentMessages.length, 1);
  const followUpPrompt = String(harness.sentMessages[0]?.message.content ?? "");
  assert.match(followUpPrompt, /Execution feedback metadata/);
  assert.match(followUpPrompt, /Previous program:/);
  assert.match(followUpPrompt, /const prefix = 'live';/);
  assert.match(followUpPrompt, /function finish\(value\)/);

  await harness.listeners.agent_end?.(
    {
      messages: [
        buildTextMessage("custom", followUpPrompt),
        buildTextMessage("assistant", "setFinal(finish('done'));"),
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
  assert.match(readFileSync(finalFilePath!, "utf8"), /live:done/);
});

test("/rlm completes an end-to-end recursive workflow over the generated workspace", async () => {
  const { executor } = createQueuedExecutor([
    {
      kind: "subcall",
      subcall: {
        prompt: "Summarize the task and workspace layout in one sentence.",
        storeAs: "intro_summary",
      },
      variables: { phase: "planning" },
      logs: ["launch intro_summary"],
      summary: "prepared child call",
    },
    {
      kind: "completed",
      variables: {
        Final:
          "The workspace starts from a prompt, uses symbolic variables, and returns compact child results.",
      },
      logs: ["child finished"],
      summary: undefined,
    },
    {
      kind: "completed",
      variables: {
        Final:
          "Final answer: treat the prompt as external state, execute code over it, recurse symbolically, and return via Final.",
      },
      logs: ["root finished"],
      summary: "done",
    },
  ]);
  const harness = createHarness((api) =>
    registerRlmExtension(api, new RlmWorkflow(api, { executor })),
  );
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
  assert.match(initialPrompt, /Prompt metadata:/);

  await harness.listeners.agent_end?.(
    {
      messages: [
        buildTextMessage("user", initialPrompt),
        buildTextMessage(
          "assistant",
          'subcall("Summarize the task and workspace layout in one sentence.", "intro_summary");',
        ),
      ],
    },
    ctx,
  );

  assert.equal(harness.sentMessages.length, 1);
  const childPrompt = String(harness.sentMessages[0]?.message.content ?? "");
  assert.match(childPrompt, /intro_summary/);

  await harness.listeners.agent_end?.(
    {
      messages: [
        buildTextMessage("custom", childPrompt),
        buildTextMessage(
          "assistant",
          'setFinal("The workspace starts from a prompt, uses symbolic variables, and returns compact child results.");',
        ),
      ],
    },
    ctx,
  );

  assert.equal(harness.sentMessages.length, 1);

  assert.deepEqual(ctx.notifications, [
    {
      message: `RLM final result ready at ${finalFilePath}.`,
      level: "info",
    },
  ]);
  assert.match(readFileSync(finalFilePath!, "utf8"), /recurse symbolically/);
});
