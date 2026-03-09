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

function extractRequestId(prompt: string): string | undefined {
  const match = prompt.match(/<!--\s*workflow-request-id:([^>]+)\s*-->/i);
  return match?.[1]?.trim();
}

async function emitMatchedHiddenResponse(
  harness: ReturnType<typeof createPlanExtensionHarness>,
  assistantText: string,
) {
  const hiddenPrompt = String(harness.sentMessages.at(-1)?.content ?? "");
  expect(hiddenPrompt).toContain("workflow-request-id");

  await harness.emit("agent_end", {
    messages: [
      {
        role: "custom",
        content: hiddenPrompt,
      },
      {
        role: "assistant",
        content: [{ type: "text", text: assistantText }],
      },
    ],
  });
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

test("one-shot /plan task enables plan mode and starts a correlated planning request", async () => {
  const harness = createPlanExtensionHarness();

  await harness.runCommand("plan", "Investigate flaky prompt extraction");

  expect(harness.getActiveTools()).toEqual(["read", "bash", "grep", "find", "ls"]);
  expect(harness.sentUserMessages).toHaveLength(1);
  expect(harness.sentUserMessages[0]).toContain("Investigate flaky prompt extraction");
  expect(extractRequestId(harness.sentUserMessages[0] ?? "")).toBeTruthy();
});

test("correlated /plan requests ignore unmatched agent_end payloads", async () => {
  const harness = createPlanExtensionHarness({ hasUI: true });

  await harness.runCommand("plan", "Investigate flaky prompt extraction");

  const requestPrompt = harness.sentUserMessages[0] ?? "";
  const requestId = extractRequestId(requestPrompt);
  expect(requestId).toBeTruthy();

  const agentEndHandler = harness.eventHandlers.get("agent_end")?.[0];
  expect(agentEndHandler).toBeTruthy();

  const result = await agentEndHandler?.(
    {
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: requestPrompt.replace(requestId ?? "", "pi-plan-999"),
            },
          ],
        },
        {
          role: "assistant",
          content: [{ type: "text", text: buildPlanText() }],
        },
      ],
    },
    harness.ctx,
  );

  expect(result).toEqual({ kind: "blocked", reason: "unmatched_agent_end" });
  expect(harness.sentMessages).toHaveLength(0);
  expect(harness.uiStub.customCalls).toHaveLength(0);
});

test("correlated /plan requests still route matched responses into critique", async () => {
  const harness = createPlanExtensionHarness({ hasUI: true });

  await harness.runCommand("plan", "Investigate flaky prompt extraction");

  await harness.emit("agent_end", {
    messages: [
      {
        role: "user",
        content: [{ type: "text", text: harness.sentUserMessages[0] }],
      },
      {
        role: "assistant",
        content: [{ type: "text", text: buildPlanText() }],
      },
    ],
  });

  expect(harness.sentMessages).toHaveLength(1);
  expect(harness.sentMessages[0]).toMatchObject({
    customType: "pi-plan-internal",
    display: false,
  });
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
  expect(extractRequestId(String(harness.sentMessages[0]?.content ?? ""))).toBeTruthy();
  expect(harness.uiStub.notifications).toContainEqual({
    message: "Reviewing the plan with a critique pass before approval.",
    level: "info",
  });
});

test("hidden critique responses ignore unmatched agent_end payloads", async () => {
  const harness = createPlanExtensionHarness({ hasUI: true });

  await harness.runCommand("plan", "on");
  await harness.emit("agent_end", {
    messages: [
      {
        role: "assistant",
        content: [{ type: "text", text: buildPlanText() }],
      },
    ],
  });

  const critiquePrompt = String(harness.sentMessages[0]?.content ?? "");
  const critiqueRequestId = extractRequestId(critiquePrompt);
  expect(critiqueRequestId).toBeTruthy();

  const result = await harness.eventHandlers.get("agent_end")?.[0]?.(
    {
      messages: [
        {
          role: "custom",
          content: critiquePrompt.replace(critiqueRequestId ?? "", "pi-plan-999"),
        },
        {
          role: "assistant",
          content: [{ type: "text", text: "1) Verdict: PASS\n2) Issues:\n- none\n3) Required fixes:\n- none\n4) Summary:\n- ready" }],
        },
      ],
    },
    harness.ctx,
  );

  expect(result).toEqual({ kind: "blocked", reason: "unmatched_agent_end" });
  expect(harness.uiStub.customCalls).toHaveLength(0);
});

test("REFINE critique responses route through a hidden revision follow-up", async () => {
  const harness = createPlanExtensionHarness({ hasUI: true });

  await harness.runCommand("plan", "on");
  await harness.emit("agent_end", {
    messages: [
      {
        role: "assistant",
        content: [{ type: "text", text: buildPlanText() }],
      },
    ],
  });

  await emitMatchedHiddenResponse(
    harness,
    "1) Verdict: REFINE\n2) Issues:\n- split step two\n3) Required fixes:\n- make the steps smaller\n4) Summary:\n- refine it",
  );

  expect(harness.sentMessages).toHaveLength(2);
  expect(harness.sentMessages[1]).toMatchObject({
    customType: "pi-plan-internal",
    display: false,
  });
  expect(String(harness.sentMessages[1]?.content)).toContain(
    "Revise the latest plan using the critique below.",
  );
  expect(extractRequestId(String(harness.sentMessages[1]?.content ?? ""))).toBeTruthy();
  expect(harness.uiStub.notifications).toContainEqual({
    message: "The critique requested plan refinement. Regenerating the plan.",
    level: "warning",
  });
});

test("revised hidden plan drafts re-enter critique before approval", async () => {
  const harness = createPlanExtensionHarness({ hasUI: true });

  await harness.runCommand("plan", "on");
  await harness.emit("agent_end", {
    messages: [
      {
        role: "assistant",
        content: [{ type: "text", text: buildPlanText() }],
      },
    ],
  });
  await emitMatchedHiddenResponse(
    harness,
    "1) Verdict: REFINE\n2) Issues:\n- split step two\n3) Required fixes:\n- make the steps smaller\n4) Summary:\n- refine it",
  );

  await emitMatchedHiddenResponse(
    harness,
    [
      "1) Goal understanding (brief)",
      "2) Evidence gathered",
      "3) Uncertainties / assumptions",
      "4) Plan:",
      "1. Add a regression test for prompt leakage",
      "2. Split the approval UI update into a focused summary step",
      "5) Risks and rollback notes",
      "6) Ready to execute when approved.",
    ].join("\n"),
  );

  expect(harness.sentMessages).toHaveLength(3);
  expect(String(harness.sentMessages[2]?.content)).toContain(
    "Critique the latest proposed implementation plan for execution quality.",
  );
  expect(extractRequestId(String(harness.sentMessages[2]?.content ?? ""))).toBeTruthy();
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

  await emitMatchedHiddenResponse(
    harness,
    "1) Verdict: PASS\n2) Issues:\n- none\n3) Required fixes:\n- none\n4) Summary:\n- ready",
  );

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

  await emitMatchedHiddenResponse(
    harness,
    "1) Verdict: PASS\n2) Issues:\n- none\n3) Required fixes:\n- none\n4) Summary:\n- ready",
  );

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

test("continue selection sends a correlated planning follow-up and keeps read-only tools", async () => {
  const harness = createPlanExtensionHarness({
    hasUI: true,
    customSelection: { cancelled: false, action: "continue", note: "split step two" },
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

  await emitMatchedHiddenResponse(
    harness,
    "1) Verdict: PASS\n2) Issues:\n- none\n3) Required fixes:\n- none\n4) Summary:\n- ready",
  );

  expect(harness.getActiveTools()).toEqual(["read", "bash", "grep", "find", "ls"]);
  expect(harness.sentUserMessages).toHaveLength(1);
  expect(harness.sentUserMessages[0]).toContain("Continue planning from the proposed plan. User note: split step two.");
  expect(extractRequestId(harness.sentUserMessages[0] ?? "")).toBeTruthy();
});

test("approve action can include an execution note and restores normal tools", async () => {
  const harness = createPlanExtensionHarness({
    hasUI: true,
    customSelection: { cancelled: false, action: "approve", note: "keep keyboard flow fast" },
  });

  await harness.runCommand("plan", "on");
  expect(harness.uiStub.statuses.get("pi-plan")).toBe("⏸ plan");
  expect(harness.uiStub.widgets.get("pi-plan-todos")).toBeUndefined();

  await harness.emit("agent_end", {
    messages: [
      {
        role: "assistant",
        content: [{ type: "text", text: buildPlanText() }],
      },
    ],
  });

  await emitMatchedHiddenResponse(
    harness,
    "1) Verdict: PASS\n2) Issues:\n- none\n3) Required fixes:\n- none\n4) Summary:\n- compact and ready",
  );

  expect(harness.getActiveTools()).toEqual(["read", "bash", "grep", "find", "ls", "edit", "write"]);
  expect(harness.sentUserMessages).toHaveLength(1);
  expect(harness.sentUserMessages[0]).toContain(
    "Honor this user execution note while implementing the step: keep keyboard flow fast",
  );
  expect(harness.uiStub.statuses.get("pi-plan")).toBe("📋 0/2");
  expect(harness.uiStub.widgets.get("pi-plan-todos")).toEqual([
    "☐ A regression test for prompt leakage",
    "☐ Approval action UI to show a compact summary",
  ]);
});

test("execution DONE markers advance to the next guided step", async () => {
  const harness = createPlanExtensionHarness({
    hasUI: true,
    customSelection: { cancelled: false, action: "approve" },
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
  await emitMatchedHiddenResponse(
    harness,
    "1) Verdict: PASS\n2) Issues:\n- none\n3) Required fixes:\n- none\n4) Summary:\n- ready",
  );

  await harness.emit("turn_end", {
    message: {
      role: "assistant",
      content: [{ type: "text", text: "Implemented step one [DONE:1]" }],
    },
  });

  expect(harness.sentUserMessages).toHaveLength(2);
  expect(harness.sentUserMessages[1]).toContain("Complete only step 2: Approval action UI to show a compact summary");
  expect(harness.uiStub.statuses.get("pi-plan")).toBe("📋 1/2");
  expect(harness.uiStub.widgets.get("pi-plan-todos")).toEqual([
    "☑ A regression test for prompt leakage",
    "☐ Approval action UI to show a compact summary",
  ]);

  await harness.runCommand("todos");
  expect(harness.uiStub.notifications).toContainEqual({
    message:
      "Plan progress 1/2\n1. ✓ A regression test for prompt leakage\n2. ○ Approval action UI to show a compact summary",
    level: "info",
  });
});

test("final guided execution completion stops prompting and clears /todos state", async () => {
  const harness = createPlanExtensionHarness({
    hasUI: true,
    customSelection: { cancelled: false, action: "approve" },
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
  await emitMatchedHiddenResponse(
    harness,
    "1) Verdict: PASS\n2) Issues:\n- none\n3) Required fixes:\n- none\n4) Summary:\n- ready",
  );

  await harness.emit("turn_end", {
    message: {
      role: "assistant",
      content: [{ type: "text", text: "Implemented step one [DONE:1]" }],
    },
  });
  await harness.emit("turn_end", {
    message: {
      role: "assistant",
      content: [{ type: "text", text: "Implemented step two [DONE:2]" }],
    },
  });

  expect(harness.sentUserMessages).toHaveLength(2);
  expect(harness.uiStub.notifications).toContainEqual({
    message: "All tracked plan steps are complete.",
    level: "info",
  });
  expect(harness.uiStub.statuses.get("pi-plan")).toBeUndefined();
  expect(harness.uiStub.widgets.get("pi-plan-todos")).toBeUndefined();

  await harness.runCommand("todos");
  expect(harness.uiStub.notifications).toContainEqual({
    message: "No tracked plan steps. Create a plan in /plan mode first.",
    level: "info",
  });
});

test("exit selection restores normal tools and clears tracked progress", async () => {
  const harness = createPlanExtensionHarness({
    hasUI: true,
    customSelection: { cancelled: false, action: "exit" },
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

  await emitMatchedHiddenResponse(
    harness,
    "1) Verdict: PASS\n2) Issues:\n- none\n3) Required fixes:\n- none\n4) Summary:\n- ready",
  );

  expect(harness.getActiveTools()).toEqual(["read", "bash", "grep", "find", "ls", "edit", "write"]);
  expect(harness.sentUserMessages).toHaveLength(0);

  await harness.runCommand("todos");
  expect(harness.uiStub.notifications).toContainEqual({
    message: "No tracked plan steps. Create a plan in /plan mode first.",
    level: "info",
  });
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

  await emitMatchedHiddenResponse(
    harness,
    "1) Verdict: PASS\n2) Issues:\n- none\n3) Required fixes:\n- none\n4) Summary:\n- ready",
  );

  expect(harness.sentUserMessages).toHaveLength(1);
  expect(harness.sentUserMessages[0]).toContain(
    "Regenerate the full plan from scratch. Re-check context and provide a refreshed Plan: section.",
  );
  expect(extractRequestId(harness.sentUserMessages[0] ?? "")).toBeTruthy();

  await harness.runCommand("todos");

  expect(harness.uiStub.notifications).toContainEqual({
    message: "No tracked plan steps. Create a plan in /plan mode first.",
    level: "info",
  });
});
