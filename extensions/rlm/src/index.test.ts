import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtempSync, writeFileSync } from "node:fs";
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
import { RLM_COMMAND_DESCRIPTION } from "./workflow";

function createContext(): ExtensionContext {
  const notifications: Array<{ message: string; level?: string }> = [];
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

  Reflect.set(ctx, "notifications", notifications);
  return ctx;
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

  assert.equal(commands.rlm?.handler("notes.md", ctx), "command-result");
  assert.equal(listeners.tool_call?.({ toolName: "read" }, ctx), "tool-result");
  assert.equal(listeners.agent_end?.({ messages: ["done"] }, ctx), "agent-end-result");
  assert.deepEqual(
    listeners.before_agent_start?.({ systemPrompt: "base" }, ctx),
    { systemPrompt: "base\n\nrlm" },
  );
  assert.equal(listeners.turn_end?.({ message: { role: "assistant" } }, ctx), "turn-end-result");
  assert.equal(listeners.session_start?.({ restored: true }, ctx), "session-start-result");
  assert.equal(listeners.session_switch?.(sessionSwitchEvent, ctx), "session-switch-result");
  assert.equal(listeners.session_fork?.(sessionForkEvent, ctx), "session-fork-result");
  assert.equal(
    listeners.session_compact?.(sessionCompactEvent, ctx),
    "session-compact-result",
  );
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

test("default rlm extension registers the command and minimal workflow stub", async () => {
  const commands: Record<
    string,
    { description: string; handler: (args: unknown, ctx: ExtensionContext) => unknown }
  > = {};
  const listeners: Record<string, (event: unknown, ctx: ExtensionContext) => unknown> = {};

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

  rlmExtension(api);

  const tempDir = mkdtempSync(path.join(os.tmpdir(), "rlm-index-test-"));
  const notePath = path.join(tempDir, "example.md");
  writeFileSync(notePath, "# Example\n\nhello world\n", "utf8");

  const ctx = createContext() as ExtensionContext & {
    notifications?: Array<{ message: string; level?: string }>;
  };

  assert.equal(commands.rlm?.description, RLM_COMMAND_DESCRIPTION);
  assert.ok(listeners.agent_end);
  assert.ok(listeners.before_agent_start);

  await commands.rlm?.handler(`${notePath} summarize this note`, ctx);

  assert.deepEqual(ctx.notifications, [
    {
      message: `RLM scaffold is registered for ${notePath}. Question: summarize this note`,
      level: "info",
    },
  ]);
});
