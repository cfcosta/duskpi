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

    render(_width: number) {
      return [""];
    }
  },
  Markdown: class {
    constructor(..._args: unknown[]) {}

    setText(_value: string) {}

    render(_width: number) {
      return [""];
    }
  },
  Text: class {
    constructor(private readonly text: string) {}

    render(_width: number) {
      return [this.text];
    }
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
  wrapTextWithAnsi: (text: string) => [text],
}));

const { default: planExtension } = await import("./index");

type CommandHandler = (args: string, ctx: ExtensionContext) => Promise<void> | void;
type EventHandler = (event: unknown, ctx: ExtensionContext) => Promise<unknown> | unknown;

interface HarnessOptions {
  hasUI?: boolean;
  customSelection?: { cancelled: boolean; action?: string; note?: string };
  extraTools?: string[];
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
  const tools = new Map<string, unknown>();
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
    ...(options.extraTools ?? []).map((name) => ({ name })),
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
    registerTool(definition: { name: string }) {
      tools.set(definition.name, definition);
      if (!allTools.some((tool) => tool.name === definition.name)) {
        allTools.push({ name: definition.name });
      }
      if (!activeTools.includes(definition.name)) {
        activeTools = [...activeTools, definition.name];
      }
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
    tools,
    sentMessages,
    sentUserMessages,
    getActiveTools: () => [...activeTools],
    runCommand,
    emit,
  };
}

function buildPlanText(): string {
  return [
    "1) Task understanding",
    "2) Codebase findings",
    "3) Approach options / trade-offs",
    "4) Open questions / assumptions",
    "5) Plan:",
    "1. Add a regression test for prompt leakage",
    "2. Update the approval action UI to show a compact summary",
    "6) Ready to execute when approved.",
  ].join("\n");
}

function buildRichPlanText(): string {
  return [
    "1) Task understanding",
    "2) Codebase findings",
    "3) Approach options / trade-offs",
    "4) Open questions / assumptions",
    "5) Plan:",
    "1. Add a regression test for prompt leakage",
    "   - target files/components:",
    "     - src/index.test.ts",
    "     - src/workflow.ts",
    "   - validation method:",
    "     - bun test ./src/index.test.ts",
    "     - bun run typecheck",
    "   - risks and rollback notes: revert the structured execution prompt if agent guidance regresses",
    "2. Update the approval action UI to show a compact summary",
    "   - target files/components: src/plan-action-ui.ts",
    "   - validation method: bun test ./src/index.test.ts",
    "6) Ready to execute when approved.",
  ].join("\n");
}

function buildLongPlanText(stepCount = 8): string {
  return [
    "1) Task understanding",
    "2) Codebase findings",
    "3) Approach options / trade-offs",
    "4) Open questions / assumptions",
    "5) Plan:",
    ...Array.from({ length: stepCount }, (_value, index) => {
      return `${index + 1}. Task ${index + 1} for the scrolling todo widget`;
    }),
    "6) Ready to execute when approved.",
  ].join("\n");
}

function buildUnparseablePlanText(): string {
  return [
    "1) Task understanding",
    "2) Codebase findings",
    "3) Approach options / trade-offs",
    "4) Open questions / assumptions",
    "The work should be split into a couple of safe implementation steps.",
    "Ready to execute when approved.",
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

async function enterApprovalState(harness: ReturnType<typeof createPlanExtensionHarness>) {
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
}

async function enterExecutionState(harness: ReturnType<typeof createPlanExtensionHarness>) {
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
}

async function enterNonUiApprovalState(harness: ReturnType<typeof createPlanExtensionHarness>) {
  await harness.runCommand("plan", "Investigate flaky prompt extraction");

  const planningPrompt = harness.sentUserMessages[0] ?? "";
  await harness.emit("agent_end", {
    messages: [
      {
        role: "user",
        content: [{ type: "text", text: planningPrompt }],
      },
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
}

async function invokeToolCall(
  harness: ReturnType<typeof createPlanExtensionHarness>,
  event: { toolName?: string; input?: unknown },
) {
  const handler = harness.eventHandlers.get("tool_call")?.[0];
  expect(handler).toBeTruthy();
  return handler?.(event, harness.ctx);
}

async function expectPlanStatus(
  harness: ReturnType<typeof createPlanExtensionHarness>,
  message: string,
) {
  await harness.runCommand("plan", "status");
  expect(harness.uiStub.notifications.at(-1)).toEqual({
    message,
    level: "info",
  });
}

async function expectLatestNonUiStatusMessage(
  harness: ReturnType<typeof createPlanExtensionHarness>,
  message: string,
) {
  expect(harness.sentMessages.at(-1)).toEqual({
    customType: "plan-mode-status",
    content: message,
    display: true,
  });
}

async function assertPlanStateReset(
  harness: ReturnType<typeof createPlanExtensionHarness>,
  eventName: "session_switch" | "session_fork" | "session_compact",
  event: unknown,
) {
  await harness.emit(eventName, event);

  expect(harness.getActiveTools()).toEqual([
    "read",
    "bash",
    "grep",
    "find",
    "ls",
    "edit",
    "write",
    "AskUserQuestion",
  ]);
  expect(harness.uiStub.statuses.get("plan")).toBeUndefined();
  expect(harness.uiStub.widgets.get("plan-todos")).toBeUndefined();

  await harness.runCommand("plan", "status");
  expect(harness.uiStub.notifications).toContainEqual({
    message: "Plan mode: OFF (default YOLO mode)",
    level: "info",
  });

  await harness.runCommand("todos");
  expect(harness.uiStub.notifications).toContainEqual({
    message: "No tracked plan steps. Create a plan in /plan mode first.",
    level: "info",
  });
}

const SESSION_BOUNDARY_EVENTS = [
  ["session_switch", { reason: "resume", previousSessionFile: "/tmp/previous.pi" }],
  ["session_fork", { previousSessionFile: "/tmp/previous.pi" }],
  ["session_compact", { compactionEntry: { id: "compact-1" }, fromExtension: false }],
] as const;

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

test("extractPlanSteps preserves objective text and metadata for flat plan sections", async () => {
  const { extractPlanSteps } = await import("./utils");

  expect(
    extractPlanSteps(
      [
        "1) Task understanding",
        "2) Codebase findings",
        "3) Approach options / trade-offs",
        "4) Open questions / assumptions",
        "5) Plan:",
        "1. Add a regression test for prompt leakage",
        "   - target files/components: src/index.test.ts",
        "   - validation method: bun test ./src/index.test.ts",
        "2. Update the approval action UI to show a compact summary",
        "   - target files/components:",
        "     - src/plan-action-ui.ts",
        "     - review summary preview",
        "   - validation method:",
        "     - bun test ./src/index.test.ts",
        "     - bun run typecheck",
        "   - risks and rollback notes: revert the preview rendering if truncation regresses",
        "6) Ready to execute when approved.",
      ].join("\n"),
    ),
  ).toEqual([
    {
      step: 1,
      objective: "Add a regression test for prompt leakage",
      label: "A regression test for prompt leakage",
      targets: ["src/index.test.ts"],
      validation: ["bun test ./src/index.test.ts"],
      risks: [],
    },
    {
      step: 2,
      objective: "Update the approval action UI to show a compact summary",
      label: "Approval action UI to show a compact summary",
      targets: ["src/plan-action-ui.ts", "review summary preview"],
      validation: ["bun test ./src/index.test.ts", "bun run typecheck"],
      risks: ["revert the preview rendering if truncation regresses"],
    },
  ]);
});

test("extractPlanSteps handles indented plan steps with metadata", async () => {
  const { extractPlanSteps } = await import("./utils");

  expect(
    extractPlanSteps(
      [
        "1) Task understanding",
        "2) Codebase findings",
        "3) Approach options / trade-offs",
        "4) Open questions / assumptions",
        "5) Plan:",
        "   1. Add a regression test for prompt leakage",
        "      - target files/components: src/index.test.ts",
        "      - validation method: bun test",
        "   2. Update the approval action UI to show a compact summary",
        "      - target files/components: src/plan-action-ui.ts",
        "      - validation method: bun test",
        "      - risks and rollback notes: revert the summary preview wiring if it breaks",
        "6) Ready to execute when approved.",
      ].join("\n"),
    ),
  ).toEqual([
    {
      step: 1,
      objective: "Add a regression test for prompt leakage",
      label: "A regression test for prompt leakage",
      targets: ["src/index.test.ts"],
      validation: ["bun test"],
      risks: [],
    },
    {
      step: 2,
      objective: "Update the approval action UI to show a compact summary",
      label: "Approval action UI to show a compact summary",
      targets: ["src/plan-action-ui.ts"],
      validation: ["bun test"],
      risks: ["revert the summary preview wiring if it breaks"],
    },
  ]);
});

test("buildApprovalReviewState summarizes structured plan previews for the approval UI", async () => {
  const { buildApprovalReviewState } = await import("./workflow");

  expect(
    buildApprovalReviewState(
      [
        "1) Task understanding",
        "2) Codebase findings",
        "3) Approach options / trade-offs",
        "4) Open questions / assumptions",
        "5) Plan:",
        "1. Add a regression test for prompt leakage",
        "   - target files/components: src/index.test.ts",
        "   - validation method: bun test ./src/index.test.ts",
        "2. Update the approval action UI to show a compact summary",
        "   - target files/components:",
        "     - src/plan-action-ui.ts",
        "     - src/workflow.ts",
        "     - review summary preview",
        "   - validation method:",
        "     - bun test ./src/index.test.ts",
        "     - bun run typecheck",
        "   - risks and rollback notes: revert the preview layout if it gets noisy",
        "3. Update the todo widget labels to stay compact",
        "   - validation method: bun test ./src/index.test.ts",
        "4. Document the richer approval summary",
        "   - target files/components: README.md",
        "   - validation method: review the docs copy",
        "6) Ready to execute when approved.",
      ].join("\n"),
      {
        critiqueSummary: "ready",
        wasRevised: true,
      },
    ),
  ).toEqual({
    stepCount: 4,
    previewSteps: [
      {
        step: 1,
        label: "A regression test for prompt leakage",
        targetsSummary: "src/index.test.ts",
        validationSummary: "bun test ./src/index.test.ts",
      },
      {
        step: 2,
        label: "Approval action UI to show a compact summary",
        targetsSummary: "src/plan-action-ui.ts, src/workflow.ts (+1 more)",
        validationSummary: "bun test ./src/index.test.ts, bun run typecheck",
      },
      {
        step: 3,
        label: "Todo widget labels to stay compact",
        targetsSummary: undefined,
        validationSummary: "bun test ./src/index.test.ts",
      },
    ],
    critiqueSummary: "ready",
    badges: ["compact steps", "validation noted", "rollback noted", "assumptions listed"],
    wasRevised: true,
  });
});

test("extractTodoItems ignores the ready-to-execute footer", async () => {
  const { extractTodoItems } = await import("./utils");

  expect(
    extractTodoItems(
      [
        "1) Task understanding",
        "2) Codebase findings",
        "3) Approach options / trade-offs",
        "4) Open questions / assumptions",
        "5) Plan:",
        "1. Add a regression test for prompt leakage",
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
        "1) Task understanding",
        "2) Codebase findings",
        "3) Approach options / trade-offs",
        "4) Open questions / assumptions",
        "5) Plan:",
        "   1. Add a regression test for prompt leakage",
        "      - target files/components: src/index.test.ts",
        "      - validation method: bun test",
        "   2. Update the approval action UI to show a compact summary",
        "      - target files/components: src/plan-action-ui.ts",
        "      - validation method: bun test",
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
    "session_compact",
    "session_fork",
    "session_shutdown",
    "session_start",
    "session_switch",
    "tool_call",
    "turn_end",
  ]);
  expect(harness.tools.has("AskUserQuestion")).toBe(true);
});

test("one-shot /plan task enables plan mode and starts a correlated planning request", async () => {
  const harness = createPlanExtensionHarness();

  await harness.runCommand("plan", "Investigate flaky prompt extraction");

  expect(harness.getActiveTools()).toEqual([
    "read",
    "bash",
    "grep",
    "find",
    "ls",
    "AskUserQuestion",
  ]);
  expect(harness.sentUserMessages).toHaveLength(1);
  expect(harness.sentUserMessages[0]).toContain("Investigate flaky prompt extraction");
  expect(extractRequestId(harness.sentUserMessages[0] ?? "")).toBeTruthy();
});

test("cancelling a planning response keeps plan mode ready for steering instead of auto-retrying", async () => {
  const harness = createPlanExtensionHarness({ hasUI: true });

  await harness.runCommand("plan", "Investigate flaky prompt extraction");

  const firstPrompt = harness.sentUserMessages[0] ?? "";
  await harness.emit("agent_end", {
    messages: [
      {
        role: "user",
        content: [{ type: "text", text: firstPrompt }],
      },
      {
        role: "assistant",
        content: [{ type: "tool_result", text: "ignored" }],
      },
    ],
  });

  expect(harness.sentUserMessages).toHaveLength(1);
  expect(harness.uiStub.notifications).toContainEqual({
    message:
      "Planning response interrupted. Send another message to steer the plan and Pi will use it for the next draft.",
    level: "info",
  });

  await harness.emit("agent_end", {
    messages: [
      {
        role: "user",
        content: [{ type: "text", text: "Also keep the keyboard flow fast." }],
      },
      {
        role: "assistant",
        content: [{ type: "text", text: buildPlanText() }],
      },
    ],
  });

  expect(harness.sentMessages).toHaveLength(1);
  expect(String(harness.sentMessages[0]?.content ?? "")).toContain(
    "Critique the latest proposed implementation plan for execution quality.",
  );
});

test("unparseable planning drafts trigger one automatic retry with a new request id", async () => {
  const harness = createPlanExtensionHarness({ hasUI: true });

  await harness.runCommand("plan", "Investigate flaky prompt extraction");

  const firstPrompt = harness.sentUserMessages[0] ?? "";
  const firstRequestId = extractRequestId(firstPrompt);
  expect(firstRequestId).toBeTruthy();

  await harness.emit("agent_end", {
    messages: [
      {
        role: "user",
        content: [{ type: "text", text: firstPrompt }],
      },
      {
        role: "assistant",
        content: [{ type: "text", text: buildUnparseablePlanText() }],
      },
    ],
  });

  expect(harness.sentUserMessages).toHaveLength(2);
  const retryPrompt = harness.sentUserMessages[1] ?? "";
  const retryRequestId = extractRequestId(retryPrompt);
  expect(retryRequestId).toBeTruthy();
  expect(retryRequestId).not.toBe(firstRequestId);
  expect(retryPrompt).toContain(
    "Include an explicit Plan: section with numbered executable steps.",
  );
  expect(harness.uiStub.notifications).toContainEqual({
    message:
      "Couldn't extract plan steps. Asking Pi to restate the same draft with an explicit Plan: section.",
    level: "warning",
  });
});

test("a second unparseable planning draft stays read-only and fails visibly without opening approval", async () => {
  const harness = createPlanExtensionHarness({ hasUI: true });

  await harness.runCommand("plan", "Investigate flaky prompt extraction");

  const firstPrompt = harness.sentUserMessages[0] ?? "";
  await harness.emit("agent_end", {
    messages: [
      {
        role: "user",
        content: [{ type: "text", text: firstPrompt }],
      },
      {
        role: "assistant",
        content: [{ type: "text", text: buildUnparseablePlanText() }],
      },
    ],
  });

  const retryPrompt = harness.sentUserMessages[1] ?? "";
  const retryRequestId = extractRequestId(retryPrompt);
  expect(retryRequestId).toBeTruthy();

  await harness.emit("agent_end", {
    messages: [
      {
        role: "user",
        content: [{ type: "text", text: retryPrompt }],
      },
      {
        role: "assistant",
        content: [{ type: "text", text: buildUnparseablePlanText() }],
      },
    ],
  });

  expect(harness.sentUserMessages).toHaveLength(2);
  expect(extractRequestId(harness.sentUserMessages[1] ?? "")).toBe(retryRequestId);
  expect(harness.sentMessages).toHaveLength(0);
  expect(harness.uiStub.customCalls).toHaveLength(0);
  expect(harness.getActiveTools()).toEqual([
    "read",
    "bash",
    "grep",
    "find",
    "ls",
    "AskUserQuestion",
  ]);
  expect(harness.uiStub.notifications).toContainEqual({
    message: "Couldn't extract plan steps after one automatic retry. Still in read-only plan mode.",
    level: "error",
  });
});

test("non-ui /plan approve restores normal tools and sends the execution prompt", async () => {
  const harness = createPlanExtensionHarness();

  await enterNonUiApprovalState(harness);

  expect(harness.getActiveTools()).toEqual([
    "read",
    "bash",
    "grep",
    "find",
    "ls",
    "AskUserQuestion",
  ]);

  await harness.runCommand("plan", "approve");

  expect(harness.getActiveTools()).toEqual([
    "read",
    "bash",
    "grep",
    "find",
    "ls",
    "edit",
    "write",
    "AskUserQuestion",
  ]);
  expect(harness.sentUserMessages).toHaveLength(2);
  expect(harness.sentUserMessages[1]).toContain(
    "Complete only step 1: Add a regression test for prompt leakage",
  );
});

test("non-ui /plan continue with a note sends a planning follow-up prompt", async () => {
  const harness = createPlanExtensionHarness();

  await enterNonUiApprovalState(harness);
  await harness.runCommand("plan", "continue narrow scope");

  expect(harness.sentUserMessages).toHaveLength(2);
  expect(harness.sentUserMessages[1]).toContain(
    "Continue planning from the proposed plan. User note: narrow scope.",
  );
  expect(extractRequestId(harness.sentUserMessages[1] ?? "")).toBeTruthy();
});

test("non-ui /plan regenerate sends a full regenerate prompt", async () => {
  const harness = createPlanExtensionHarness();

  await enterNonUiApprovalState(harness);
  await harness.runCommand("plan", "regenerate");

  expect(harness.sentUserMessages).toHaveLength(2);
  expect(harness.sentUserMessages[1]).toContain(
    "Regenerate the full plan from scratch. Re-check context and provide a refreshed Plan: section.",
  );
  expect(extractRequestId(harness.sentUserMessages[1] ?? "")).toBeTruthy();
});

test("non-ui /plan exit clears tracked plan state", async () => {
  const harness = createPlanExtensionHarness();

  await enterNonUiApprovalState(harness);
  await harness.runCommand("plan", "exit");

  expect(harness.getActiveTools()).toEqual([
    "read",
    "bash",
    "grep",
    "find",
    "ls",
    "edit",
    "write",
    "AskUserQuestion",
  ]);

  await harness.runCommand("plan", "status");
  await expectLatestNonUiStatusMessage(harness, "Plan mode: OFF (default YOLO mode)");

  await harness.runCommand("todos");
  await expectLatestNonUiStatusMessage(
    harness,
    "No tracked plan steps. Create a plan in /plan mode first.",
  );
});

test("non-ui /plan continue without a note shows an error and leaves approval pending", async () => {
  const harness = createPlanExtensionHarness();

  await enterNonUiApprovalState(harness);
  await harness.runCommand("plan", "continue");

  expect(harness.sentUserMessages).toHaveLength(1);
  await expectLatestNonUiStatusMessage(
    harness,
    "Usage: /plan continue <note> while approval is pending.",
  );

  await harness.runCommand("plan", "status");
  await expectLatestNonUiStatusMessage(harness, "Plan mode: ON (read-only planning)");

  await harness.runCommand("plan", "approve");
  expect(harness.sentUserMessages).toHaveLength(2);
  expect(harness.sentUserMessages[1]).toContain(
    "Complete only step 1: Add a regression test for prompt leakage",
  );
});

test("outside approval non-ui /plan commands still behave like normal planning tasks", async () => {
  const harness = createPlanExtensionHarness();

  await harness.runCommand("plan", "approve");

  expect(harness.sentUserMessages).toHaveLength(1);
  expect(harness.sentUserMessages[0]).toContain("Task: approve");
  expect(harness.sentUserMessages[0]).not.toContain(
    "Plan approved. Switch to implementation mode and execute the latest plan now.",
  );
});

test("plan status reflects guided idle and planning phases", async () => {
  const harness = createPlanExtensionHarness({ hasUI: true });

  await expectPlanStatus(harness, "Plan mode: OFF (default YOLO mode)");

  await harness.runCommand("plan", "Investigate flaky prompt extraction");

  await expectPlanStatus(harness, "Plan mode: ON (read-only planning)");
});

test("plan status reflects the guided approval phase", async () => {
  const harness = createPlanExtensionHarness({ hasUI: true });

  await enterApprovalState(harness);

  await expectPlanStatus(harness, "Plan mode: ON (read-only planning)");
});

test("plan status reflects the guided executing phase", async () => {
  const harness = createPlanExtensionHarness({
    hasUI: true,
    customSelection: { cancelled: false, action: "approve" },
  });

  await enterExecutionState(harness);

  await expectPlanStatus(harness, "Plan mode: OFF (executing approved plan)");
});

test("planningPolicy blocks write-like tools and mutating bash during planning", async () => {
  const harness = createPlanExtensionHarness();

  await harness.runCommand("plan", "Investigate flaky prompt extraction");

  for (const toolName of ["edit", "write", "ast_rewrite"]) {
    expect(await invokeToolCall(harness, { toolName })).toEqual({
      block: true,
      reason: "Plan mode is read-only. Approve execution first (choose 'Approve and execute now').",
    });
  }

  expect(
    await invokeToolCall(harness, { toolName: "bash", input: { command: "rm -rf tmp" } }),
  ).toEqual({
    block: true,
    reason: "Plan mode blocked a potentially mutating bash command: rm -rf tmp",
  });

  expect(
    await invokeToolCall(harness, { toolName: "bash", input: { command: "ls -la" } }),
  ).toBeUndefined();
});

test("planningPolicy keeps write-like and bash blocking active during approval", async () => {
  const harness = createPlanExtensionHarness({ hasUI: true });

  await enterApprovalState(harness);

  for (const toolName of ["edit", "write", "ast_rewrite"]) {
    expect(await invokeToolCall(harness, { toolName })).toEqual({
      block: true,
      reason: "Plan mode is read-only. Approve execution first (choose 'Approve and execute now').",
    });
  }

  expect(
    await invokeToolCall(harness, { toolName: "bash", input: { command: "rm -rf tmp" } }),
  ).toEqual({
    block: true,
    reason: "Plan mode blocked a potentially mutating bash command: rm -rf tmp",
  });

  expect(
    await invokeToolCall(harness, { toolName: "bash", input: { command: "ls -la" } }),
  ).toBeUndefined();
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
              text: requestPrompt.replace(requestId ?? "", "plan-999"),
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
    customType: "plan-internal",
    display: false,
  });
});

test("plan extension harness registers commands and handles agent_end in read-only mode", async () => {
  const harness = createPlanExtensionHarness();

  await harness.runCommand("plan", "on");
  expect(harness.getActiveTools()).toEqual([
    "read",
    "bash",
    "grep",
    "find",
    "ls",
    "AskUserQuestion",
  ]);

  await harness.emit("agent_end", {
    messages: [
      {
        role: "assistant",
        content: "1) Task understanding\n2) Codebase findings\n3) Approach options / trade-offs",
      },
    ],
  });

  expect(harness.eventHandlers.get("agent_end")?.length).toBeTruthy();
  expect(harness.sentUserMessages).toHaveLength(0);
  expect(harness.sentMessages).toHaveLength(1);
  expect(harness.sentMessages[0]?.customType).toBe("plan-mode-status");
  expect(String(harness.sentMessages[0]?.content)).toContain("Plan mode enabled");
});

test("plan mode enables web_search and fetch_content when they are available", async () => {
  const harness = createPlanExtensionHarness({
    extraTools: ["web_search", "fetch_content"],
  });

  await harness.runCommand("plan", "on");

  expect(harness.getActiveTools()).toEqual([
    "read",
    "bash",
    "grep",
    "find",
    "ls",
    "AskUserQuestion",
    "web_search",
    "fetch_content",
  ]);
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
    customType: "plan-internal",
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
          content: critiquePrompt.replace(critiqueRequestId ?? "", "plan-999"),
        },
        {
          role: "assistant",
          content: [
            {
              type: "text",
              text: "1) Verdict: PASS\n2) Issues:\n- none\n3) Required fixes:\n- none\n4) Summary:\n- ready",
            },
          ],
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
    customType: "plan-internal",
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
      "1) Task understanding",
      "2) Codebase findings",
      "3) Approach options / trade-offs",
      "4) Open questions / assumptions",
      "5) Plan:",
      "1. Add a regression test for prompt leakage",
      "2. Split the approval UI update into a focused summary step",
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
              "1) Task understanding",
              "2) Codebase findings",
              "3) Approach options / trade-offs",
              "4) Open questions / assumptions",
              "5) Plan:",
              "   1. Add a regression test for prompt leakage",
              "      - target files/components: src/index.test.ts",
              "      - validation method: bun test",
              "   2. Update the approval action UI to show a compact summary",
              "      - target files/components: src/plan-action-ui.ts",
              "      - validation method: bun test",
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
    message: "No tracked plan steps. Create a plan in /plan mode first.",
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

  expect(harness.getActiveTools()).toEqual([
    "read",
    "bash",
    "grep",
    "find",
    "ls",
    "AskUserQuestion",
  ]);
  expect(harness.sentUserMessages).toHaveLength(1);
  expect(harness.sentUserMessages[0]).toContain(
    "Continue planning from the proposed plan. User note: split step two.",
  );
  expect(extractRequestId(harness.sentUserMessages[0] ?? "")).toBeTruthy();
});

test("approve action can include an execution note and restores normal tools", async () => {
  const harness = createPlanExtensionHarness({
    hasUI: true,
    customSelection: { cancelled: false, action: "approve", note: "keep keyboard flow fast" },
  });

  await harness.runCommand("plan", "on");
  expect(harness.uiStub.statuses.get("plan")).toBe("⏸ plan");
  expect(harness.uiStub.widgets.get("plan-todos")).toBeUndefined();

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

  expect(harness.getActiveTools()).toEqual([
    "read",
    "bash",
    "grep",
    "find",
    "ls",
    "edit",
    "write",
    "AskUserQuestion",
  ]);
  expect(harness.sentUserMessages).toHaveLength(1);
  expect(harness.sentUserMessages[0]).toContain(
    "Honor this user execution note while implementing the step: keep keyboard flow fast",
  );
  expect(harness.uiStub.statuses.get("plan")).toBe("📋 0/2");
  expect(harness.uiStub.widgets.get("plan-todos")).toEqual([
    "☐ A regression test for prompt leakage",
    "☐ Approval action UI to show a compact summary",
  ]);
});

test("execution progress surfaces derive from guided execution snapshots", async () => {
  const harness = createPlanExtensionHarness({
    hasUI: true,
    customSelection: { cancelled: false, action: "approve" },
  });

  await enterExecutionState(harness);

  expect(harness.uiStub.statuses.get("plan")).toBe("📋 0/2");
  expect(harness.uiStub.widgets.get("plan-todos")).toEqual([
    "☐ A regression test for prompt leakage",
    "☐ Approval action UI to show a compact summary",
  ]);
  await harness.runCommand("todos");
  expect(harness.uiStub.notifications.at(-1)).toEqual({
    message:
      "Plan progress 0/2\n1. ○ A regression test for prompt leakage\n2. ○ Approval action UI to show a compact summary",
    level: "info",
  });

  await harness.emit("turn_end", {
    message: {
      role: "assistant",
      content: [{ type: "text", text: "Implemented step one [DONE:1]" }],
    },
  });

  expect(harness.uiStub.statuses.get("plan")).toBe("📋 1/2");
  expect(harness.uiStub.widgets.get("plan-todos")).toEqual([
    "☑ A regression test for prompt leakage",
    "☐ Approval action UI to show a compact summary",
  ]);
  await harness.runCommand("todos");
  expect(harness.uiStub.notifications.at(-1)).toEqual({
    message:
      "Plan progress 1/2\n1. ✓ A regression test for prompt leakage\n2. ○ Approval action UI to show a compact summary",
    level: "info",
  });

  await harness.emit("turn_end", {
    message: {
      role: "assistant",
      content: [{ type: "text", text: "Implemented step two [DONE:2]" }],
    },
  });

  expect(harness.uiStub.statuses.get("plan")).toBeUndefined();
  expect(harness.uiStub.widgets.get("plan-todos")).toBeUndefined();
  await harness.runCommand("todos");
  expect(harness.uiStub.notifications.at(-1)).toEqual({
    message: "No tracked plan steps. Create a plan in /plan mode first.",
    level: "info",
  });
});

test("execution prompts rehydrate structured step details and DONE markers advance", async () => {
  const harness = createPlanExtensionHarness({
    hasUI: true,
    customSelection: { cancelled: false, action: "approve" },
  });

  await harness.runCommand("plan", "on");
  await harness.emit("agent_end", {
    messages: [
      {
        role: "assistant",
        content: [{ type: "text", text: buildRichPlanText() }],
      },
    ],
  });
  await emitMatchedHiddenResponse(
    harness,
    "1) Verdict: PASS\n2) Issues:\n- none\n3) Required fixes:\n- none\n4) Summary:\n- ready",
  );

  expect(harness.sentUserMessages).toHaveLength(1);
  expect(harness.sentUserMessages[0]).toContain(
    "Complete only step 1: Add a regression test for prompt leakage",
  );
  expect(harness.sentUserMessages[0]).toContain(
    "Target files/components: src/index.test.ts; src/workflow.ts",
  );
  expect(harness.sentUserMessages[0]).toContain(
    "Validation method: bun test ./src/index.test.ts; bun run typecheck",
  );
  expect(harness.sentUserMessages[0]).toContain(
    "Risks and rollback notes: revert the structured execution prompt if agent guidance regresses",
  );

  await harness.emit("turn_end", {
    message: {
      role: "assistant",
      content: [{ type: "text", text: "Implemented step one [DONE:1]" }],
    },
  });

  expect(harness.sentUserMessages).toHaveLength(2);
  expect(harness.sentUserMessages[1]).toContain(
    "Complete only step 2: Update the approval action UI to show a compact summary",
  );
  expect(harness.sentUserMessages[1]).toContain("Target files/components: src/plan-action-ui.ts");
  expect(harness.sentUserMessages[1]).toContain("Validation method: bun test ./src/index.test.ts");
  expect(harness.uiStub.statuses.get("plan")).toBe("📋 1/2");
  expect(harness.uiStub.widgets.get("plan-todos")).toEqual([
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

test("todos output and widget stay compact for metadata-rich plans", async () => {
  const harness = createPlanExtensionHarness({
    hasUI: true,
    customSelection: { cancelled: false, action: "approve" },
  });

  await harness.runCommand("plan", "on");
  await harness.emit("agent_end", {
    messages: [
      {
        role: "assistant",
        content: [{ type: "text", text: buildRichPlanText() }],
      },
    ],
  });
  await emitMatchedHiddenResponse(
    harness,
    "1) Verdict: PASS\n2) Issues:\n- none\n3) Required fixes:\n- none\n4) Summary:\n- ready",
  );

  const initialWidgetLines = harness.uiStub.widgets.get("plan-todos") ?? [];
  expect(initialWidgetLines).toEqual([
    "☐ A regression test for prompt leakage",
    "☐ Approval action UI to show a compact summary",
  ]);
  expect(initialWidgetLines.join("\n")).not.toContain("src/index.test.ts");
  expect(initialWidgetLines.join("\n")).not.toContain("bun run typecheck");

  await harness.runCommand("todos");
  expect(harness.uiStub.notifications.at(-1)).toEqual({
    message:
      "Plan progress 0/2\n1. ○ A regression test for prompt leakage\n2. ○ Approval action UI to show a compact summary",
    level: "info",
  });
  expect(harness.uiStub.notifications.at(-1)?.message).not.toContain("src/index.test.ts");
  expect(harness.uiStub.notifications.at(-1)?.message).not.toContain("Validation method");

  await harness.emit("turn_end", {
    message: {
      role: "assistant",
      content: [{ type: "text", text: "Implemented step one [DONE:1]" }],
    },
  });

  const updatedWidgetLines = harness.uiStub.widgets.get("plan-todos") ?? [];
  expect(updatedWidgetLines).toEqual([
    "☑ A regression test for prompt leakage",
    "☐ Approval action UI to show a compact summary",
  ]);
  expect(updatedWidgetLines.join("\n")).not.toContain("src/index.test.ts");
  expect(updatedWidgetLines.join("\n")).not.toContain("bun run typecheck");

  await harness.runCommand("todos");
  expect(harness.uiStub.notifications.at(-1)).toEqual({
    message:
      "Plan progress 1/2\n1. ✓ A regression test for prompt leakage\n2. ○ Approval action UI to show a compact summary",
    level: "info",
  });
  expect(harness.uiStub.notifications.at(-1)?.message).not.toContain("src/index.test.ts");
  expect(harness.uiStub.notifications.at(-1)?.message).not.toContain("Validation method");
});

test("todo widget hides older items once the current step would scroll off-screen", async () => {
  const harness = createPlanExtensionHarness({
    hasUI: true,
    customSelection: { cancelled: false, action: "approve" },
  });

  await harness.runCommand("plan", "on");
  await harness.emit("agent_end", {
    messages: [
      {
        role: "assistant",
        content: [{ type: "text", text: buildLongPlanText() }],
      },
    ],
  });
  await emitMatchedHiddenResponse(
    harness,
    "1) Verdict: PASS\n2) Issues:\n- none\n3) Required fixes:\n- none\n4) Summary:\n- ready",
  );

  expect(harness.uiStub.widgets.get("plan-todos")).toEqual([
    "☐ Task 1 for the scrolling todo widget",
    "☐ Task 2 for the scrolling todo widget",
    "☐ Task 3 for the scrolling todo widget",
    "☐ Task 4 for the scrolling todo widget",
    "☐ Task 5 for the scrolling todo widget",
  ]);

  await harness.emit("turn_end", {
    message: {
      role: "assistant",
      content: [
        {
          type: "text",
          text: "Completed the first chunk [DONE:1] [DONE:2] [DONE:3] [DONE:4] [DONE:5]",
        },
      ],
    },
  });

  expect(harness.uiStub.widgets.get("plan-todos")).toEqual([
    "… 4 earlier items hidden",
    "☑ Task 5 for the scrolling todo widget",
    "☐ Task 6 for the scrolling todo widget",
    "☐ Task 7 for the scrolling todo widget",
    "☐ Task 8 for the scrolling todo widget",
  ]);

  await harness.runCommand("todos");
  expect(harness.uiStub.notifications.at(-1)).toEqual({
    message:
      "Plan progress 5/8\n… 4 earlier items hidden\n5. ✓ Task 5 for the scrolling todo widget\n6. ○ Task 6 for the scrolling todo widget\n7. ○ Task 7 for the scrolling todo widget\n8. ○ Task 8 for the scrolling todo widget",
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
  expect(harness.uiStub.statuses.get("plan")).toBeUndefined();
  expect(harness.uiStub.widgets.get("plan-todos")).toBeUndefined();

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

  expect(harness.getActiveTools()).toEqual([
    "read",
    "bash",
    "grep",
    "find",
    "ls",
    "edit",
    "write",
    "AskUserQuestion",
  ]);
  expect(harness.sentUserMessages).toHaveLength(0);

  await harness.runCommand("todos");
  expect(harness.uiStub.notifications).toContainEqual({
    message: "No tracked plan steps. Create a plan in /plan mode first.",
    level: "info",
  });
});

test("session boundary events reset transient plan state while approval is pending", async () => {
  for (const [eventName, event] of SESSION_BOUNDARY_EVENTS) {
    const harness = createPlanExtensionHarness({ hasUI: true });

    await enterApprovalState(harness);

    expect(harness.getActiveTools()).toEqual([
      "read",
      "bash",
      "grep",
      "find",
      "ls",
      "AskUserQuestion",
    ]);
    expect(harness.uiStub.statuses.get("plan")).toBe("⏸ plan");

    await assertPlanStateReset(harness, eventName, event);
  }
});

test("session boundary events reset transient plan state while approved execution is active", async () => {
  for (const [eventName, event] of SESSION_BOUNDARY_EVENTS) {
    const harness = createPlanExtensionHarness({
      hasUI: true,
      customSelection: { cancelled: false, action: "approve" },
    });

    await enterExecutionState(harness);

    expect(harness.getActiveTools()).toEqual([
      "read",
      "bash",
      "grep",
      "find",
      "ls",
      "edit",
      "write",
      "AskUserQuestion",
    ]);
    expect(harness.uiStub.statuses.get("plan")).toBe("📋 0/2");
    expect(harness.uiStub.widgets.get("plan-todos")).toEqual([
      "☐ A regression test for prompt leakage",
      "☐ Approval action UI to show a compact summary",
    ]);

    await assertPlanStateReset(harness, eventName, event);
  }
});

test("session shutdown restores tools and clears stale plan-mode status", async () => {
  const harness = createPlanExtensionHarness({ hasUI: true });

  await harness.runCommand("plan", "on");
  expect(harness.getActiveTools()).toEqual([
    "read",
    "bash",
    "grep",
    "find",
    "ls",
    "AskUserQuestion",
  ]);
  expect(harness.uiStub.statuses.get("plan")).toBe("⏸ plan");

  await harness.emit("session_shutdown", { reason: "exit" });

  expect(harness.getActiveTools()).toEqual([
    "read",
    "bash",
    "grep",
    "find",
    "ls",
    "edit",
    "write",
    "AskUserQuestion",
  ]);
  expect(harness.uiStub.statuses.get("plan")).toBeUndefined();
  expect(harness.uiStub.widgets.get("plan-todos")).toBeUndefined();

  await harness.emit("session_start", { restored: true });
  expect(harness.uiStub.statuses.get("plan")).toBeUndefined();

  await harness.runCommand("plan", "status");
  expect(harness.uiStub.notifications).toContainEqual({
    message: "Plan mode: OFF (default YOLO mode)",
    level: "info",
  });
});

test("session shutdown clears guided execution lifecycle state", async () => {
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

  expect(harness.uiStub.statuses.get("plan")).toBe("📋 0/2");

  await harness.emit("session_shutdown", { reason: "exit" });

  expect(harness.uiStub.statuses.get("plan")).toBeUndefined();
  expect(harness.uiStub.widgets.get("plan-todos")).toBeUndefined();

  await harness.runCommand("todos");
  expect(harness.uiStub.notifications).toContainEqual({
    message: "No tracked plan steps. Create a plan in /plan mode first.",
    level: "info",
  });

  const beforeAgentStart = harness.eventHandlers.get("before_agent_start")?.[0];
  expect(beforeAgentStart).toBeTruthy();
  const result = await beforeAgentStart?.({ systemPrompt: "base" }, harness.ctx);
  expect(String((result as { systemPrompt?: string })?.systemPrompt ?? "")).toContain(
    "[DEFAULT MODE: YOLO]",
  );
  expect(String((result as { systemPrompt?: string })?.systemPrompt ?? "")).not.toContain(
    "[APPROVED PLAN EXECUTION]",
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
