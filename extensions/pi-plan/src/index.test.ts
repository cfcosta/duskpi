import { mock, test, expect } from "bun:test";
import assert from "node:assert/strict";
import type { ExtensionContext } from "@mariozechner/pi-coding-agent";
import { parseCritiqueVerdict } from "./utils";

mock.module("@mariozechner/pi-tui", () => ({
  Editor: class {
    onChange?: (value: string) => void;
    onSubmit?: (value: string) => void;

    constructor(..._args: unknown[]) {}

    setText(value: string) {
      this.onChange?.(value);
    }

    handleInput(_data: string) {}
  },
  Key: {
    tab: "tab",
    escape: "escape",
    up: "up",
    down: "down",
    enter: "enter",
  },
  matchesKey: () => false,
  truncateToWidth: (text: string) => text,
}));

const { default: planExtension } = await import("./index");

type CommandHandler = (args: string, ctx: ExtensionContext) => Promise<void> | void;
type EventHandler = (event: unknown, ctx: ExtensionContext) => Promise<unknown> | unknown;

interface HarnessOptions {
  hasUI?: boolean;
  customSelection?: { cancelled: boolean; action?: string; note?: string };
}

function createUiStub(customSelection?: { cancelled: boolean; action?: string; note?: string }) {
  const notifications: Array<{ message: string; level: "info" | "warning" | "error" }> = [];
  const statuses = new Map<string, string | undefined>();
  const widgets = new Map<string, string[] | undefined>();
  const customCalls: unknown[] = [];

  return {
    notifications,
    statuses,
    widgets,
    customCalls,
    ui: {
      notify(message: string, level: "info" | "warning" | "error") {
        notifications.push({ message, level });
      },
      setStatus(key: string, value: string | undefined) {
        statuses.set(key, value);
      },
      setWidget(key: string, value: string[] | undefined) {
        widgets.set(key, value);
      },
      theme: {
        fg: (_color: string, text: string) => text,
        strikethrough: (text: string) => text,
      },
      custom: async (renderer: unknown) => {
        customCalls.push(renderer);
        return customSelection ?? { cancelled: true };
      },
    },
  };
}

function createPlanExtensionHarness(options: HarnessOptions = {}) {
  const commands = new Map<string, CommandHandler>();
  const eventHandlers = new Map<string, EventHandler[]>();
  const sentUserMessages: string[] = [];
  const sentMessages: Array<{ customType?: string; content?: unknown; display?: boolean }> = [];
  const allTools = [
    { name: "read" },
    { name: "bash" },
    { name: "grep" },
    { name: "find" },
    { name: "ls" },
    { name: "edit" },
    { name: "write" },
  ];
  let activeTools = allTools.map((tool) => tool.name);

  const uiStub = createUiStub(options.customSelection);
  const hasUI = options.hasUI ?? false;
  const ctx = {
    hasUI,
    ui: uiStub.ui,
  } as ExtensionContext;

  const pi = {
    registerCommand(name: string, config: { handler: CommandHandler }) {
      commands.set(name, config.handler);
    },
    on(eventName: string, handler: EventHandler) {
      const handlers = eventHandlers.get(eventName) ?? [];
      handlers.push(handler);
      eventHandlers.set(eventName, handlers);
    },
    getAllTools() {
      return allTools;
    },
    getActiveTools() {
      return activeTools;
    },
    setActiveTools(tools: string[]) {
      activeTools = [...tools];
    },
    sendUserMessage(content: string) {
      sentUserMessages.push(content);
    },
    sendMessage(message: { customType?: string; content?: unknown; display?: boolean }) {
      sentMessages.push(message);
    },
  };

  planExtension(pi as never);

  const runCommand = async (name: string, args = "") => {
    const handler = commands.get(name);
    assert.ok(handler, `Expected command ${name} to be registered`);
    await handler?.(args, ctx);
  };

  const emit = async (eventName: string, event: unknown) => {
    for (const handler of eventHandlers.get(eventName) ?? []) {
      await handler(event, ctx);
    }
  };

  return {
    ctx,
    uiStub,
    commands,
    eventHandlers,
    sentMessages,
    sentUserMessages,
    getActiveTools: () => [...activeTools],
    runCommand,
    emit,
  };
}

function buildPlanText(): string {
  return [
    "1) Goal understanding (brief)",
    "2) Evidence gathered",
    "3) Uncertainties / assumptions",
    "4) Plan:",
    "1. Add a regression test for prompt leakage",
    "2. Update the approval action UI to show a compact summary",
    "5) Risks and rollback notes",
    "6) Ready to execute when approved.",
  ].join("\n");
}

test("parseCritiqueVerdict accepts markdown-formatted PASS verdicts", () => {
  expect(parseCritiqueVerdict(`1) **Verdict:** PASS\n2) Issues:\n- none`)).toBe("PASS");
});

test("parseCritiqueVerdict accepts markdown-formatted REFINE verdicts", () => {
  expect(parseCritiqueVerdict(`1) **Verdict:** REFINE\n2) Issues:\n- split step two`)).toBe(
    "REFINE",
  );
});

test("parseCritiqueVerdict ignores unrelated PASS mentions", () => {
  expect(parseCritiqueVerdict(`Summary: This looks passable.`)).toBeUndefined();
});

test("extractTodoItems ignores the ready-to-execute footer", async () => {
  const { extractTodoItems } = await import("./utils");

  expect(
    extractTodoItems(
      [
        "1) Goal understanding (brief)",
        "2) Evidence gathered",
        "3) Uncertainties / assumptions",
        "4) Plan:",
        "1. Add a regression test for prompt leakage",
        "5) Risks and rollback notes",
        "6) Ready to execute when approved.",
      ].join("\n"),
    ),
  ).toEqual([{ step: 1, text: "A regression test for prompt leakage", completed: false }]);
});

test("extractTodoItems handles indented plan steps under the numbered plan section", async () => {
  const { extractTodoItems } = await import("./utils");

  expect(
    extractTodoItems(
      [
        "1) Goal understanding (brief)",
        "2) Evidence gathered",
        "3) Uncertainties / assumptions",
        "4) Plan:",
        "   1. Add a regression test for prompt leakage",
        "      - target files/components: src/index.test.ts",
        "      - validation method: bun test",
        "   2. Update the approval action UI to show a compact summary",
        "      - target files/components: src/plan-action-ui.ts",
        "      - validation method: bun test",
        "5) Risks and rollback notes",
        "6) Ready to execute when approved.",
      ].join("\n"),
    ),
  ).toEqual([
    { step: 1, text: "A regression test for prompt leakage", completed: false },
    { step: 2, text: "Approval action UI to show a compact summary", completed: false },
  ]);
});

test("plan extension registers the guided workflow listener surface plus todos", () => {
  const harness = createPlanExtensionHarness();

  expect([...harness.commands.keys()].sort()).toEqual(["plan", "todos"]);
  expect([...harness.eventHandlers.keys()].sort()).toEqual([
    "agent_end",
    "before_agent_start",
    "session_shutdown",
    "session_start",
    "tool_call",
    "turn_end",
  ]);
});

test("one-shot /plan task enables plan mode and immediately sends the task", async () => {
  const harness = createPlanExtensionHarness();

  await harness.runCommand("plan", "Investigate flaky prompt extraction");

  expect(harness.getActiveTools()).toEqual(["read", "bash", "grep", "find", "ls"]);
  expect(harness.sentUserMessages).toEqual(["Investigate flaky prompt extraction"]);
});

test("plan extension harness registers commands and handles agent_end in read-only mode", async () => {
  const harness = createPlanExtensionHarness();

  await harness.runCommand("plan", "on");
  expect(harness.getActiveTools()).toEqual(["read", "bash", "grep", "find", "ls"]);

  await harness.emit("agent_end", {
    messages: [
      {
        role: "assistant",
        content: "1) Goal understanding\n2) Evidence gathered\n3) Uncertainties / assumptions",
      },
    ],
  });

  expect(harness.eventHandlers.get("agent_end")?.length).toBeTruthy();
  expect(harness.sentUserMessages).toHaveLength(0);
  expect(harness.sentMessages).toHaveLength(1);
  expect(harness.sentMessages[0]?.customType).toBe("plan-mode-status");
  expect(String(harness.sentMessages[0]?.content)).toContain("Plan mode enabled");
});

test("critique pass routes orchestration through a hidden custom message after extracting a plan", async () => {
  const harness = createPlanExtensionHarness({ hasUI: true });

  await harness.runCommand("plan", "on");

  await harness.emit("agent_end", {
    messages: [
      {
        role: "assistant",
        content: [
          {
            type: "text",
            text: buildPlanText(),
          },
        ],
      },
    ],
  });

  expect(harness.sentUserMessages).toHaveLength(0);
  expect(harness.sentMessages).toHaveLength(1);
  expect(harness.sentMessages[0]).toMatchObject({
    customType: "pi-plan-internal",
    display: false,
  });
  expect(String(harness.sentMessages[0]?.content)).toContain(
    "Critique the latest proposed implementation plan for execution quality.",
  );
  expect(harness.uiStub.notifications).toContainEqual({
    message: "Reviewing the plan with a critique pass before approval.",
    level: "info",
  });
});

test("indented plan output still reaches the approval UI after critique", async () => {
  const harness = createPlanExtensionHarness({ hasUI: true });

  await harness.runCommand("plan", "on");

  await harness.emit("agent_end", {
    messages: [
      {
        role: "assistant",
        content: [
          {
            type: "text",
            text: [
              "1) Goal understanding (brief)",
              "2) Evidence gathered",
              "3) Uncertainties / assumptions",
              "4) Plan:",
              "   1. Add a regression test for prompt leakage",
              "      - target files/components: src/index.test.ts",
              "      - validation method: bun test",
              "   2. Update the approval action UI to show a compact summary",
              "      - target files/components: src/plan-action-ui.ts",
              "      - validation method: bun test",
              "5) Risks and rollback notes",
              "6) Ready to execute when approved.",
            ].join("\n"),
          },
        ],
      },
    ],
  });

  await harness.emit("agent_end", {
    messages: [
      {
        role: "assistant",
        content:
          "1) Verdict: PASS\n2) Issues:\n- none\n3) Required fixes:\n- none\n4) Summary:\n- ready",
      },
    ],
  });

  expect(harness.uiStub.customCalls).toHaveLength(1);
});

test("after a PASS critique the plan stays tracked without leaking visible follow-up messages", async () => {
  const harness = createPlanExtensionHarness({ hasUI: true });

  await harness.runCommand("plan", "on");

  await harness.emit("agent_end", {
    messages: [
      {
        role: "assistant",
        content: [
          {
            type: "text",
            text: buildPlanText(),
          },
        ],
      },
    ],
  });

  await harness.emit("agent_end", {
    messages: [
      {
        role: "assistant",
        content:
          "1) Verdict: PASS\n2) Issues:\n- none\n3) Required fixes:\n- none\n4) Summary:\n- ready",
      },
    ],
  });

  expect(harness.sentUserMessages).toHaveLength(0);
  expect(harness.sentMessages).toHaveLength(1);
  expect(harness.uiStub.notifications).toContainEqual({
    message: "Plan critique passed. Review and approve when ready.",
    level: "info",
  });
  expect(harness.uiStub.customCalls).toHaveLength(1);

  await harness.runCommand("todos");

  expect(harness.uiStub.notifications).toContainEqual({
    message:
      "Plan progress 0/2\n1. ○ A regression test for prompt leakage\n2. ○ Approval action UI to show a compact summary",
    level: "info",
  });
});

test("approve action can include an execution note and restores normal tools", async () => {
  const harness = createPlanExtensionHarness({
    hasUI: true,
    customSelection: { cancelled: false, action: "approve", note: "keep keyboard flow fast" },
  });

  await harness.runCommand("plan", "on");

  await harness.emit("agent_end", {
    messages: [
      {
        role: "assistant",
        content: [{ type: "text", text: buildPlanText() }],
      },
    ],
  });

  await harness.emit("agent_end", {
    messages: [
      {
        role: "assistant",
        content:
          "1) Verdict: PASS\n2) Issues:\n- none\n3) Required fixes:\n- none\n4) Summary:\n- compact and ready",
      },
    ],
  });

  expect(harness.getActiveTools()).toEqual(["read", "bash", "grep", "find", "ls", "edit", "write"]);
  expect(harness.sentUserMessages).toHaveLength(1);
  expect(harness.sentUserMessages[0]).toContain(
    "Honor this user execution note while implementing the step: keep keyboard flow fast",
  );
});

test("regenerate selection clears tracked todos before sending a refresh prompt", async () => {
  const harness = createPlanExtensionHarness({
    hasUI: true,
    customSelection: { cancelled: false, action: "regenerate" },
  });

  await harness.runCommand("plan", "on");

  await harness.emit("agent_end", {
    messages: [
      {
        role: "assistant",
        content: [{ type: "text", text: buildPlanText() }],
      },
    ],
  });

  await harness.emit("agent_end", {
    messages: [
      {
        role: "assistant",
        content:
          "1) Verdict: PASS\n2) Issues:\n- none\n3) Required fixes:\n- none\n4) Summary:\n- ready",
      },
    ],
  });

  expect(harness.sentUserMessages).toEqual([
    "Regenerate the full plan from scratch. Re-check context and provide a refreshed Plan: section.",
  ]);

  await harness.runCommand("todos");

  expect(harness.uiStub.notifications).toContainEqual({
    message: "No tracked plan steps. Create a plan in /plan mode first.",
    level: "info",
  });
});
