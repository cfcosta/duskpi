import test from "node:test";
import assert from "node:assert/strict";
import {
  registerGuidedWorkflowExtension,
  type BeforeAgentStartResult,
  type ExtensionAPI,
  type ExtensionContext,
  type ExtensionTheme,
  type ExtensionUICustomFactory,
  type ExtensionWidgetFactory,
  type SessionCompactEvent,
  type SessionForkEvent,
  type SessionSwitchEvent,
} from "./index";

function createContext(): ExtensionContext {
  const theme: ExtensionTheme = {
    fg(_color: string, text: string) {
      return text;
    },
    strikethrough(text: string) {
      return `~~${text}~~`;
    },
  };

  return {
    hasUI: true,
    ui: {
      theme,
      notify() {},
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
}

test("local extension typings cover guided-workflow UI and messaging features", async () => {
  const ctx = createContext();
  const widgetFactory: ExtensionWidgetFactory = (_tui, theme) => ({
    dispose() {
      theme.fg("accent", "dispose");
    },
  });

  ctx.ui.setWidget("todos", ["first", "second"]);
  ctx.ui.setWidget("todos", widgetFactory, { placement: "above_editor" });

  const customResult = await ctx.ui.custom<string>((_tui, theme, _keybindings, done) => {
    done(theme.strikethrough("done"));
    return { dispose() {} };
  });

  assert.equal(customResult, "~~done~~");
  assert.equal(ctx.ui.theme.fg("accent", "text"), "text");
});

test("registerGuidedWorkflowExtension wires guided workflow handlers", async () => {
  const commands: Record<
    string,
    { description: string; handler: (args: unknown, ctx: ExtensionContext) => unknown }
  > = {};
  const listeners: Record<string, (event: unknown, ctx: ExtensionContext) => unknown> = {};
  const forwarded: Array<{ type: string; payload: unknown; ctx: ExtensionContext }> = [];
  const sentCustomMessages: Array<{ customType: string; optionsDeliverAs?: string }> = [];
  let activeTools = ["read", "bash"];

  const api: ExtensionAPI = {
    sendMessage(message, options) {
      sentCustomMessages.push({
        customType: message.customType,
        optionsDeliverAs: options?.deliverAs,
      });
    },
    sendUserMessage() {},
    registerMessageRenderer() {},
    registerTool() {},
    registerCommand(name, command) {
      commands[name] = command;
    },
    getActiveTools() {
      return [...activeTools];
    },
    getAllTools() {
      return [
        { name: "read", description: "Read file contents" },
        { name: "bash", description: "Execute shell commands", parameters: { type: "object" } },
      ];
    },
    setActiveTools(toolNames) {
      activeTools = [...toolNames];
    },
    on(name, handler) {
      listeners[name] = handler as (event: unknown, ctx: ExtensionContext) => unknown;
    },
  };

  api.sendMessage(
    { customType: "guided-status", content: "hidden", display: false },
    { triggerTurn: true, deliverAs: "followUp" },
  );
  api.setActiveTools(["read"]);

  assert.deepEqual(api.getActiveTools(), ["read"]);
  assert.deepEqual(
    api.getAllTools().map((tool) => tool.name),
    ["read", "bash"],
  );
  assert.deepEqual(sentCustomMessages, [
    { customType: "guided-status", optionsDeliverAs: "followUp" },
  ]);

  let createWorkflowCalls = 0;
  const beforeResult: BeforeAgentStartResult = { systemPrompt: "base\n\nguided" };
  const workflow = {
    handleCommand(args: unknown, ctx: ExtensionContext) {
      forwarded.push({ type: "command", payload: args, ctx });
      return "command-result";
    },
    handleToolCall(event: { toolName?: string; input?: unknown }, ctx: ExtensionContext) {
      forwarded.push({ type: "tool_call", payload: event, ctx });
      return "tool-result";
    },
    handleAgentEnd(event: { messages?: unknown[] }, ctx: ExtensionContext) {
      forwarded.push({ type: "agent_end", payload: event, ctx });
      return "agent-end-result";
    },
    handleBeforeAgentStart(event: { systemPrompt: string }, ctx: ExtensionContext) {
      forwarded.push({ type: "before_agent_start", payload: event, ctx });
      return beforeResult;
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

  const returnedWorkflow = registerGuidedWorkflowExtension(api, {
    commandName: "plan",
    description: "Guided plan workflow",
    createWorkflow(apiArg) {
      createWorkflowCalls += 1;
      assert.equal(apiArg, api);
      return workflow;
    },
  });

  const ctx = createContext();

  assert.equal(returnedWorkflow, workflow);
  assert.equal(createWorkflowCalls, 1);
  assert.equal(commands.plan?.description, "Guided plan workflow");
  assert.ok(listeners.tool_call);
  assert.ok(listeners.agent_end);
  assert.ok(listeners.before_agent_start);
  assert.ok(listeners.turn_end);
  assert.ok(listeners.session_start);
  assert.ok(listeners.session_switch);
  assert.ok(listeners.session_fork);
  assert.ok(listeners.session_compact);
  assert.ok(listeners.session_shutdown);

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

  assert.equal(commands.plan?.handler("scope", ctx), "command-result");
  assert.equal(
    listeners.tool_call?.({ toolName: "bash", input: { command: "ls" } }, ctx),
    "tool-result",
  );
  assert.equal(listeners.agent_end?.({ messages: ["report"] }, ctx), "agent-end-result");
  assert.deepEqual(listeners.before_agent_start?.({ systemPrompt: "base" }, ctx), beforeResult);
  assert.equal(listeners.turn_end?.({ message: { role: "assistant" } }, ctx), "turn-end-result");
  assert.equal(listeners.session_start?.({ restored: true }, ctx), "session-start-result");
  assert.equal(listeners.session_switch?.(sessionSwitchEvent, ctx), "session-switch-result");
  assert.equal(listeners.session_fork?.(sessionForkEvent, ctx), "session-fork-result");
  assert.equal(listeners.session_compact?.(sessionCompactEvent, ctx), "session-compact-result");
  assert.equal(listeners.session_shutdown?.({ reason: "exit" }, ctx), "session-shutdown-result");

  assert.deepEqual(forwarded, [
    { type: "command", payload: "scope", ctx },
    { type: "tool_call", payload: { toolName: "bash", input: { command: "ls" } }, ctx },
    { type: "agent_end", payload: { messages: ["report"] }, ctx },
    { type: "before_agent_start", payload: { systemPrompt: "base" }, ctx },
    { type: "turn_end", payload: { message: { role: "assistant" } }, ctx },
    { type: "session_start", payload: { restored: true }, ctx },
    { type: "session_switch", payload: sessionSwitchEvent, ctx },
    { type: "session_fork", payload: sessionForkEvent, ctx },
    { type: "session_compact", payload: sessionCompactEvent, ctx },
    { type: "session_shutdown", payload: { reason: "exit" }, ctx },
  ]);
});
