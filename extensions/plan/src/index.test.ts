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
const { PiPlanWorkflow, getApprovedAutoPlanTextForTesting } = await import("./workflow");

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

  const emitWithResult = async (eventName: string, event: unknown) => {
    const results: unknown[] = [];
    for (const handler of eventHandlers.get(eventName) ?? []) {
      results.push(await handler(event, ctx));
    }
    return results;
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
    emitWithResult,
  };
}

function createDirectWorkflowHarness(options: HarnessOptions = {}) {
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
    { name: "ask_user_question" },
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

  const workflow = new PiPlanWorkflow(pi as never);

  return {
    workflow,
    ctx,
    uiStub,
    sentMessages,
    sentUserMessages,
    getActiveTools: () => [...activeTools],
    handleAutoPlanCommand: async (args: string) =>
      workflow.handleAutoPlanCommand(args, ctx as never),
    handleAgentEnd: async (event: unknown) => workflow.handleAgentEnd(event as never, ctx as never),
    handleTurnEnd: async (event: unknown) => workflow.handleTurnEnd(event as never, ctx as never),
    handleSessionCompact: async (event: unknown) =>
      workflow.handleSessionCompact(event as never, ctx as never),
    handleSessionSwitch: async (event: unknown) =>
      workflow.handleSessionSwitch(event as never, ctx as never),
    handleSessionShutdown: async (event: unknown) =>
      workflow.handleSessionShutdown(event as never, ctx as never),
  };
}

function appendTaggedPlanContract(
  markdownLines: string[],
  steps: Array<{
    step: number;
    objective: string;
    targets?: string[];
    validation?: string[];
    risks?: string[];
  }>,
): string {
  return [
    ...markdownLines,
    "",
    buildTaggedJsonBlock({
      version: 1,
      kind: "plan",
      steps: steps.map((step) => ({
        step: step.step,
        objective: step.objective,
        targets: step.targets ?? [],
        validation: step.validation ?? [],
        risks: step.risks ?? [],
      })),
    }),
  ].join("\n");
}

function buildPlanText(): string {
  return appendTaggedPlanContract(
    [
      "1) Task understanding",
      "2) Codebase findings",
      "3) Approach options / trade-offs",
      "4) Open questions / assumptions",
      "5) Plan:",
      "1. Add a regression test for prompt leakage",
      "2. Update the approval action UI to show a compact summary",
      "6) Ready to execute when approved.",
    ],
    [
      {
        step: 1,
        objective: "Add a regression test for prompt leakage",
      },
      {
        step: 2,
        objective: "Update the approval action UI to show a compact summary",
      },
    ],
  );
}

function buildRichPlanText(): string {
  return appendTaggedPlanContract(
    [
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
    ],
    [
      {
        step: 1,
        objective: "Add a regression test for prompt leakage",
        targets: ["src/index.test.ts", "src/workflow.ts"],
        validation: ["bun test ./src/index.test.ts", "bun run typecheck"],
        risks: ["revert the structured execution prompt if agent guidance regresses"],
      },
      {
        step: 2,
        objective: "Update the approval action UI to show a compact summary",
        targets: ["src/plan-action-ui.ts"],
        validation: ["bun test ./src/index.test.ts"],
      },
    ],
  );
}

function buildConflictingRichPlanText(): string {
  return appendTaggedPlanContract(
    [
      "1) Task understanding",
      "2) Codebase findings",
      "3) Approach options / trade-offs",
      "4) Open questions / assumptions",
      "5) Plan:",
      "1. Markdown says the wrong step name",
      "   - target files/components: wrong/path.ts",
      "   - validation method: wrong validation",
      "2. Markdown says the wrong second step",
      "   - target files/components: wrong/second.ts",
      "   - validation method: wrong second validation",
      "6) Ready to execute when approved.",
    ],
    [
      {
        step: 1,
        objective: "Add a regression test for prompt leakage",
        targets: ["src/index.test.ts", "src/workflow.ts"],
        validation: ["bun test ./src/index.test.ts", "bun run typecheck"],
        risks: ["revert the structured execution prompt if agent guidance regresses"],
      },
      {
        step: 2,
        objective: "Update the approval action UI to show a compact summary",
        targets: ["src/plan-action-ui.ts"],
        validation: ["bun test ./src/index.test.ts"],
      },
    ],
  );
}

function buildLongPlanText(stepCount = 8): string {
  const markdownLines = [
    "1) Task understanding",
    "2) Codebase findings",
    "3) Approach options / trade-offs",
    "4) Open questions / assumptions",
    "5) Plan:",
    ...Array.from({ length: stepCount }, (_value, index) => {
      return `${index + 1}. Task ${index + 1} for the scrolling todo widget`;
    }),
    "6) Ready to execute when approved.",
  ];

  return appendTaggedPlanContract(
    markdownLines,
    Array.from({ length: stepCount }, (_value, index) => ({
      step: index + 1,
      objective: `Task ${index + 1} for the scrolling todo widget`,
    })),
  );
}

function buildAutoPlanReviewText(): string {
  return [
    "1) Progress summary",
    "2) Remaining gaps",
    "3) Plan:",
    "1. Finalize the rust module wiring",
    "2. Remove the legacy implementation path",
    "4) Continue autoplan.",
  ].join("\n");
}

function buildAutoPlanCompleteText(): string {
  return "Status: COMPLETE";
}

function buildMarkdownOnlyPlanText(): string {
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

function buildMalformedTaggedPlanText(): string {
  return [buildMarkdownOnlyPlanText(), "", "```pi-plan-json", '{"version": 1,', "```"].join("\n");
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

function buildPartiallyIndentedSubtaskPlanText(): string {
  return appendTaggedPlanContract(
    [
      "1) Task understanding",
      "2) Codebase findings",
      "3) Approach options / trade-offs",
      "4) Open questions / assumptions",
      "5) Plan:",
      "1. Add a regression test for prompt leakage",
      "",
      "   2. Update the approval action UI to show a compact summary",
      "6) Ready to execute when approved.",
    ],
    [
      {
        step: 1,
        objective: "Add a regression test for prompt leakage",
      },
      {
        step: 2,
        objective: "Update the approval action UI to show a compact summary",
      },
    ],
  );
}

function buildNonCompliantAutoPlanSubtaskText(): string {
  return [
    "1) Task understanding",
    "2) Codebase findings",
    "3) Approach options / trade-offs",
    "4) Open questions / assumptions",
    "I need your decision on whether to keep the legacy path before continuing.",
    "5) Plan:",
    "1. Add a regression test for prompt leakage",
    "2. Update the approval action UI to show a compact summary",
    "6) Ready to execute when approved.",
  ].join("\n");
}

function buildNonCompliantAutoPlanReviewText(): string {
  return [
    "1) Progress summary",
    "2) Remaining gaps",
    "I need your decision on whether to keep the legacy path before continuing.",
    "3) Plan:",
    "1. Finalize the rust module wiring",
    "2. Remove the legacy implementation path",
    "4) Continue autoplan.",
  ].join("\n");
}

function buildNonCompliantAutoPlanExecutionText(): string {
  return "I need your decision on whether to keep the legacy path before continuing. [DONE:1]";
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

async function enterApprovedAutoPlanState(
  harness: ReturnType<typeof createDirectWorkflowHarness>,
  goal: string = "Rewrite this in Rust",
  planText: string = buildPlanText(),
) {
  await harness.handleAutoPlanCommand(goal);

  const planningPrompt = harness.sentUserMessages[0] ?? "";
  await harness.handleAgentEnd({
    messages: [
      {
        role: "user",
        content: [{ type: "text", text: planningPrompt }],
      },
      {
        role: "assistant",
        content: [{ type: "text", text: planText }],
      },
    ],
  });

  const critiquePrompt = String(harness.sentMessages.at(-1)?.content ?? "");
  expect(critiquePrompt).toContain("workflow-request-id");

  await harness.handleAgentEnd({
    messages: [
      {
        role: "custom",
        content: critiquePrompt,
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
  });
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
  eventName: "session_switch" | "session_fork",
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
    "ask_user_question",
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

const SESSION_RESET_EVENTS = [
  ["session_switch", { reason: "resume", previousSessionFile: "/tmp/previous.pi" }],
  ["session_fork", { previousSessionFile: "/tmp/previous.pi" }],
] as const;

const SESSION_COMPACT_EVENT = {
  compactionEntry: { id: "compact-1" },
  fromExtension: false,
} as const;

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

function buildTaggedJsonBlock(payload: unknown): string {
  return ["```pi-plan-json", JSON.stringify(payload, null, 2), "```"].join("\n");
}

test("parseTaggedPlanningContract parses a valid tagged JSON plan block", async () => {
  const { parseTaggedPlanningContract } = await import("./output-contract");

  const result = parseTaggedPlanningContract(
    [
      "1) Task understanding",
      "2) Codebase findings",
      buildTaggedJsonBlock({
        version: 1,
        kind: "plan",
        steps: [
          {
            step: 1,
            objective: "Add a parser module",
            targets: ["src/output-contract.ts"],
            validation: ["bun test ./src/index.test.ts"],
            risks: [],
          },
        ],
      }),
    ].join("\n\n"),
  );

  expect(result).toEqual({
    ok: true,
    rawJson: JSON.stringify(
      {
        version: 1,
        kind: "plan",
        steps: [
          {
            step: 1,
            objective: "Add a parser module",
            targets: ["src/output-contract.ts"],
            validation: ["bun test ./src/index.test.ts"],
            risks: [],
          },
        ],
      },
      null,
      2,
    ),
    value: {
      version: 1,
      kind: "plan",
      steps: [
        {
          step: 1,
          objective: "Add a parser module",
          targets: ["src/output-contract.ts"],
          validation: ["bun test ./src/index.test.ts"],
          risks: [],
        },
      ],
    },
  });
});

test("parseTaggedReviewContract parses a valid tagged JSON continue review block", async () => {
  const { parseTaggedReviewContract } = await import("./output-contract");

  const result = parseTaggedReviewContract(
    buildTaggedJsonBlock({
      version: 1,
      kind: "review",
      status: "continue",
      steps: [
        {
          step: 1,
          objective: "Wire structured review parsing",
          targets: ["src/workflow.ts"],
          validation: ["bun test ./src/index.test.ts"],
          risks: ["keep backlog fallback intact"],
        },
      ],
    }),
  );

  expect(result).toEqual({
    ok: true,
    rawJson: JSON.stringify(
      {
        version: 1,
        kind: "review",
        status: "continue",
        steps: [
          {
            step: 1,
            objective: "Wire structured review parsing",
            targets: ["src/workflow.ts"],
            validation: ["bun test ./src/index.test.ts"],
            risks: ["keep backlog fallback intact"],
          },
        ],
      },
      null,
      2,
    ),
    value: {
      version: 1,
      kind: "review",
      status: "continue",
      steps: [
        {
          step: 1,
          objective: "Wire structured review parsing",
          targets: ["src/workflow.ts"],
          validation: ["bun test ./src/index.test.ts"],
          risks: ["keep backlog fallback intact"],
        },
      ],
    },
  });
});

test("parseTaggedPlanningContract rejects responses without the tagged JSON block", async () => {
  const { parseTaggedPlanningContract } = await import("./output-contract");

  expect(parseTaggedPlanningContract("1) Task understanding\n2) Codebase findings")).toEqual({
    ok: false,
    code: "missing_block",
    message: "Missing tagged JSON block `pi-plan-json`.",
  });
});

test("parseTaggedPlanningContract rejects malformed tagged JSON blocks", async () => {
  const { parseTaggedPlanningContract } = await import("./output-contract");

  const result = parseTaggedPlanningContract(["```pi-plan-json", '{"version": 1,', "```"].join("\n"));

  expect(result.ok).toBe(false);
  if (result.ok) {
    return;
  }

  expect(result.code).toBe("malformed_json");
});

test("parseTaggedPlanningContract rejects invalid step payloads", async () => {
  const { parseTaggedPlanningContract } = await import("./output-contract");

  expect(
    parseTaggedPlanningContract(
      buildTaggedJsonBlock({
        version: 1,
        kind: "plan",
        steps: [
          {
            step: 1,
            objective: "Add a parser module",
            targets: "src/output-contract.ts",
            validation: ["bun test ./src/index.test.ts"],
            risks: [],
          },
        ],
      }),
    ),
  ).toEqual({
    ok: false,
    code: "invalid_schema",
    message: "Step 1 targets must be an array of strings.",
  });
});

test("parseTaggedReviewContract rejects invalid review payloads", async () => {
  const { parseTaggedReviewContract } = await import("./output-contract");

  expect(
    parseTaggedReviewContract(
      buildTaggedJsonBlock({
        version: 1,
        kind: "review",
        status: "continue",
      }),
    ),
  ).toEqual({
    ok: false,
    code: "invalid_schema",
    message: "Plan steps must be an array.",
  });
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

test("buildApprovalReviewState prefers stored structured steps for the approval UI", async () => {
  const { parseTaggedPlanContract } = await import("./output-contract");
  const { buildApprovalReviewState } = await import("./workflow");

  const conflictingPlanText = buildConflictingRichPlanText();
  const parsed = parseTaggedPlanContract(conflictingPlanText);
  expect(parsed.ok).toBe(true);
  if (!parsed.ok) {
    return;
  }

  expect(
    buildApprovalReviewState(
      conflictingPlanText,
      {
        critiqueSummary: "ready",
        wasRevised: true,
      },
      parsed.value,
    ),
  ).toEqual({
    stepCount: 2,
    previewSteps: [
      {
        step: 1,
        label: "A regression test for prompt leakage",
        targetsSummary: "src/index.test.ts, src/workflow.ts",
        validationSummary: "bun test ./src/index.test.ts, bun run typecheck",
      },
      {
        step: 2,
        label: "Approval action UI to show a compact summary",
        targetsSummary: "src/plan-action-ui.ts",
        validationSummary: "bun test ./src/index.test.ts",
      },
    ],
    critiqueSummary: "ready",
    badges: ["compact steps", "validation noted", "assumptions listed"],
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

  expect([...harness.commands.keys()].sort()).toEqual(["autoplan", "plan", "todos"]);
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
  expect(harness.tools.has("ask_user_question")).toBe(true);
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
    "ask_user_question",
  ]);
  expect(harness.sentUserMessages).toHaveLength(1);
  expect(harness.sentUserMessages[0]).toContain("Investigate flaky prompt extraction");
  expect(harness.sentUserMessages[0]).toContain("```pi-plan-json");
  expect(extractRequestId(harness.sentUserMessages[0] ?? "")).toBeTruthy();
});

test("/autoplan starts with the normal top-level planning flow", async () => {
  const harness = createPlanExtensionHarness();

  await harness.runCommand("autoplan", "Rewrite this in Rust");

  expect(harness.getActiveTools()).toEqual([
    "read",
    "bash",
    "grep",
    "find",
    "ls",
    "ask_user_question",
  ]);
  expect(harness.sentUserMessages).toHaveLength(1);
  expect(harness.sentUserMessages[0]).toContain("Rewrite this in Rust");
  expect(harness.sentUserMessages[0]).toContain("```pi-plan-json");
  expect(extractRequestId(harness.sentUserMessages[0] ?? "")).toBeTruthy();
});

test("non-ui /autoplan approve starts the recursive subtask loop", async () => {
  const harness = createPlanExtensionHarness();

  await harness.runCommand("autoplan", "Rewrite this in Rust");

  const topLevelPrompt = harness.sentUserMessages[0] ?? "";
  await harness.emit("agent_end", {
    messages: [
      {
        role: "user",
        content: [{ type: "text", text: topLevelPrompt }],
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

  await harness.runCommand("autoplan", "approve");

  expect(harness.sentUserMessages).toHaveLength(2);
  expect(harness.sentUserMessages[1]).toContain("Current approved high-level task 1");
});

test("top-level /autoplan planning still allows ask_user_question before first approval", async () => {
  const harness = createPlanExtensionHarness();

  await harness.runCommand("autoplan", "Rewrite this in Rust");

  await expect(
    invokeToolCall(harness, { toolName: "ask_user_question", input: { questions: [] } }),
  ).resolves.toBeUndefined();
});

test("top-level /autoplan continue and regenerate keep ask_user_question available before first approval", async () => {
  const continueHarness = createPlanExtensionHarness();

  await continueHarness.runCommand("autoplan", "Rewrite this in Rust");

  const topLevelPrompt = continueHarness.sentUserMessages[0] ?? "";
  await continueHarness.emit("agent_end", {
    messages: [
      {
        role: "user",
        content: [{ type: "text", text: topLevelPrompt }],
      },
      {
        role: "assistant",
        content: [{ type: "text", text: buildPlanText() }],
      },
    ],
  });
  await emitMatchedHiddenResponse(
    continueHarness,
    "1) Verdict: PASS\n2) Issues:\n- none\n3) Required fixes:\n- none\n4) Summary:\n- ready",
  );

  await continueHarness.runCommand("autoplan", "continue tighten scope");
  await expect(
    invokeToolCall(continueHarness, { toolName: "ask_user_question", input: { questions: [] } }),
  ).resolves.toBeUndefined();

  const regenerateHarness = createPlanExtensionHarness();

  await regenerateHarness.runCommand("autoplan", "Rewrite this in Rust");

  const regenerateTopLevelPrompt = regenerateHarness.sentUserMessages[0] ?? "";
  await regenerateHarness.emit("agent_end", {
    messages: [
      {
        role: "user",
        content: [{ type: "text", text: regenerateTopLevelPrompt }],
      },
      {
        role: "assistant",
        content: [{ type: "text", text: buildPlanText() }],
      },
    ],
  });
  await emitMatchedHiddenResponse(
    regenerateHarness,
    "1) Verdict: PASS\n2) Issues:\n- none\n3) Required fixes:\n- none\n4) Summary:\n- ready",
  );

  await regenerateHarness.runCommand("autoplan", "regenerate");
  await expect(
    invokeToolCall(regenerateHarness, { toolName: "ask_user_question", input: { questions: [] } }),
  ).resolves.toBeUndefined();
});

test("/autoplan falls back to the existing backlog when progress review is unparseable", async () => {
  const harness = createPlanExtensionHarness({
    hasUI: true,
    customSelection: { cancelled: false, action: "approve" },
  });

  await harness.runCommand("autoplan", "Rewrite this in Rust");

  const topLevelPrompt = harness.sentUserMessages[0] ?? "";
  await harness.emit("agent_end", {
    messages: [
      {
        role: "user",
        content: [{ type: "text", text: topLevelPrompt }],
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

  const subtaskPrompt = harness.sentUserMessages[1] ?? "";
  await harness.emit("agent_end", {
    messages: [
      {
        role: "user",
        content: [{ type: "text", text: subtaskPrompt }],
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

  await harness.emit("turn_end", {
    message: {
      role: "assistant",
      content: [{ type: "text", text: "Finished the first subtask step [DONE:1]" }],
    },
  });
  await harness.emit("turn_end", {
    message: {
      role: "assistant",
      content: [{ type: "text", text: "Finished the second subtask step [DONE:2]" }],
    },
  });

  const reviewPrompt = String(harness.sentMessages.at(-1)?.content ?? "");
  await harness.emit("agent_end", {
    messages: [
      {
        role: "custom",
        content: reviewPrompt,
      },
      {
        role: "assistant",
        content: [{ type: "text", text: buildUnparseablePlanText() }],
      },
    ],
  });

  const retryReviewPrompt = String(harness.sentMessages.at(-1)?.content ?? "");
  expect(retryReviewPrompt).toContain("```pi-plan-json");
  await harness.emit("agent_end", {
    messages: [
      {
        role: "custom",
        content: retryReviewPrompt,
      },
      {
        role: "assistant",
        content: [{ type: "text", text: buildUnparseablePlanText() }],
      },
    ],
  });

  expect(harness.sentUserMessages.at(-1)).toContain(
    "Current approved high-level task 2: Approval action UI to show a compact summary",
  );
  expect(harness.uiStub.notifications).toContainEqual({
    message: "Autoplan couldn't extract a remaining task list. Asking for a stricter restatement.",
    level: "warning",
  });
  expect(harness.uiStub.notifications).toContainEqual({
    message:
      "Autoplan couldn't update the remaining backlog cleanly, so it will continue with the existing tracked tasks.",
    level: "warning",
  });
});

test("/autoplan ignores Status: COMPLETE while tracked backlog still exists", async () => {
  const harness = createPlanExtensionHarness({
    hasUI: true,
    customSelection: { cancelled: false, action: "approve" },
  });

  await harness.runCommand("autoplan", "Rewrite this in Rust");

  const topLevelPrompt = harness.sentUserMessages[0] ?? "";
  await harness.emit("agent_end", {
    messages: [
      {
        role: "user",
        content: [{ type: "text", text: topLevelPrompt }],
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

  const subtaskPrompt = harness.sentUserMessages[1] ?? "";
  await harness.emit("agent_end", {
    messages: [
      {
        role: "user",
        content: [{ type: "text", text: subtaskPrompt }],
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

  await harness.emit("turn_end", {
    message: {
      role: "assistant",
      content: [{ type: "text", text: "Finished the first subtask step [DONE:1]" }],
    },
  });
  await harness.emit("turn_end", {
    message: {
      role: "assistant",
      content: [{ type: "text", text: "Finished the second subtask step [DONE:2]" }],
    },
  });

  const reviewPrompt = String(harness.sentMessages.at(-1)?.content ?? "");
  await harness.emit("agent_end", {
    messages: [
      {
        role: "custom",
        content: reviewPrompt,
      },
      {
        role: "assistant",
        content: [{ type: "text", text: buildAutoPlanCompleteText() }],
      },
    ],
  });

  expect(harness.sentUserMessages).toHaveLength(5);
  expect(harness.sentUserMessages[4]).toContain(
    "Current approved high-level task 2: Approval action UI to show a compact summary",
  );
});

test("/autoplan auto-plans each approved subtask without asking new questions", async () => {
  const harness = createPlanExtensionHarness({
    hasUI: true,
    customSelection: { cancelled: false, action: "approve" },
  });

  await harness.runCommand("autoplan", "Rewrite this in Rust");

  const topLevelPrompt = harness.sentUserMessages[0] ?? "";
  await harness.emit("agent_end", {
    messages: [
      {
        role: "user",
        content: [{ type: "text", text: topLevelPrompt }],
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

  expect(harness.sentUserMessages).toHaveLength(2);
  expect(harness.sentUserMessages[1]).toContain("Current approved high-level task 1");
  expect(harness.sentUserMessages[1]).toContain("Approved top-level plan context:");
  expect(harness.sentUserMessages[1]).toContain(buildPlanText());
  expect(harness.sentUserMessages[1]).toContain("Do not ask the user questions.");
  expect(harness.sentUserMessages[1]).not.toContain("Complete only step 1:");

  await expect(
    invokeToolCall(harness, { toolName: "ask_user_question", input: { questions: [] } }),
  ).resolves.toEqual({
    block: true,
    reason: "Autoplan subtask planning must not ask the user new questions.",
  });

  const subtaskPrompt = harness.sentUserMessages[1] ?? "";
  await harness.emit("agent_end", {
    messages: [
      {
        role: "user",
        content: [{ type: "text", text: subtaskPrompt }],
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

  expect(harness.sentUserMessages).toHaveLength(3);
  expect(harness.sentUserMessages[2]).toContain(
    "Complete only step 1: Add a regression test for prompt leakage",
  );
  expect(harness.sentUserMessages[2]).toContain("Approved top-level plan context:");
  expect(harness.sentUserMessages[2]).toContain(buildPlanText());
  expect(harness.sentUserMessages[2]).toContain("Do not ask the user questions.");
  expect(harness.sentUserMessages[2]).toContain(
    "Infer the best repo-consistent choice and continue.",
  );

  await expect(
    invokeToolCall(harness, { toolName: "ask_user_question", input: { questions: [] } }),
  ).resolves.toEqual({
    block: true,
    reason: "Autoplan subtask execution must not ask the user new questions.",
  });

  await harness.emit("turn_end", {
    message: {
      role: "assistant",
      content: [{ type: "text", text: "Finished the first subtask step [DONE:1]" }],
    },
  });
  expect(harness.sentUserMessages).toHaveLength(4);
  expect(harness.sentUserMessages[3]).toContain(
    "Complete only step 2: Update the approval action UI to show a compact summary",
  );

  await harness.emit("turn_end", {
    message: {
      role: "assistant",
      content: [{ type: "text", text: "Finished the second subtask step [DONE:2]" }],
    },
  });

  expect(harness.sentMessages.at(-1)).toEqual(
    expect.objectContaining({ customType: "autoplan-review-internal", display: false }),
  );

  await expect(
    invokeToolCall(harness, { toolName: "ask_user_question", input: { questions: [] } }),
  ).resolves.toEqual({
    block: true,
    reason: "Autoplan progress review must not ask the user new questions.",
  });

  const reviewPrompt = String(harness.sentMessages.at(-1)?.content ?? "");
  expect(reviewPrompt).toContain("Approved top-level plan context:");
  expect(reviewPrompt).toContain(buildPlanText());
  await harness.emit("agent_end", {
    messages: [
      {
        role: "custom",
        content: reviewPrompt,
      },
      {
        role: "assistant",
        content: [{ type: "text", text: buildAutoPlanReviewText() }],
      },
    ],
  });

  expect(harness.sentUserMessages).toHaveLength(5);
  expect(harness.sentUserMessages[4]).toContain(
    "Current approved high-level task 2: Finalize the rust module wiring",
  );
});

test("/autoplan subtask planning accepts a valid tagged JSON plan and advances to inner execution", async () => {
  const harness = createPlanExtensionHarness({
    hasUI: true,
    customSelection: { cancelled: false, action: "approve" },
  });

  await harness.runCommand("autoplan", "Rewrite this in Rust");

  const topLevelPrompt = harness.sentUserMessages[0] ?? "";
  await harness.emit("agent_end", {
    messages: [
      {
        role: "user",
        content: [{ type: "text", text: topLevelPrompt }],
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

  const subtaskPrompt = harness.sentUserMessages[1] ?? "";
  await harness.emit("agent_end", {
    messages: [
      {
        role: "user",
        content: [{ type: "text", text: subtaskPrompt }],
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

  expect(harness.sentUserMessages).toHaveLength(3);
  expect(harness.sentUserMessages[2]).toContain(
    "Complete only step 1: Add a regression test for prompt leakage",
  );
});

test("/autoplan retries subtask planning once when the tagged JSON block is missing", async () => {
  const harness = createPlanExtensionHarness({
    hasUI: true,
    customSelection: { cancelled: false, action: "approve" },
  });

  await harness.runCommand("autoplan", "Rewrite this in Rust");

  const topLevelPrompt = harness.sentUserMessages[0] ?? "";
  await harness.emit("agent_end", {
    messages: [
      {
        role: "user",
        content: [{ type: "text", text: topLevelPrompt }],
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

  const subtaskPrompt = harness.sentUserMessages[1] ?? "";
  await harness.emit("agent_end", {
    messages: [
      {
        role: "user",
        content: [{ type: "text", text: subtaskPrompt }],
      },
      {
        role: "assistant",
        content: [{ type: "text", text: buildMarkdownOnlyPlanText() }],
      },
    ],
  });

  expect(harness.sentUserMessages).toHaveLength(3);
  expect(harness.sentUserMessages[2]).toContain(
    "The previous response did not include a valid tagged JSON planning contract.",
  );
  expect(harness.sentUserMessages[2]).toContain("```pi-plan-json");
  expect(harness.uiStub.notifications).toContainEqual({
    message:
      "Autoplan couldn't validate the tagged JSON subtask plan contract. Asking Pi to restate the subtask plan with the required markdown + JSON format.",
    level: "warning",
  });
});

test("/autoplan stops after repeated invalid tagged JSON subtask planning output", async () => {
  const harness = createPlanExtensionHarness({
    hasUI: true,
    customSelection: { cancelled: false, action: "approve" },
  });

  await harness.runCommand("autoplan", "Rewrite this in Rust");

  const topLevelPrompt = harness.sentUserMessages[0] ?? "";
  await harness.emit("agent_end", {
    messages: [
      {
        role: "user",
        content: [{ type: "text", text: topLevelPrompt }],
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

  const subtaskPrompt = harness.sentUserMessages[1] ?? "";
  await harness.emit("agent_end", {
    messages: [
      {
        role: "user",
        content: [{ type: "text", text: subtaskPrompt }],
      },
      {
        role: "assistant",
        content: [{ type: "text", text: buildMalformedTaggedPlanText() }],
      },
    ],
  });

  const retrySubtaskPrompt = harness.sentUserMessages[2] ?? "";
  await harness.emit("agent_end", {
    messages: [
      {
        role: "user",
        content: [{ type: "text", text: retrySubtaskPrompt }],
      },
      {
        role: "assistant",
        content: [{ type: "text", text: buildMalformedTaggedPlanText() }],
      },
    ],
  });

  expect(harness.uiStub.notifications).toContainEqual({
    message: "Autoplan couldn't validate the tagged JSON subtask plan contract after one retry.",
    level: "error",
  });
  expect(harness.uiStub.notifications).toContainEqual({
    message:
      "Autoplan subtask planning kept returning invalid tagged JSON after one retry. Stopping autoplan.",
    level: "error",
  });

  await harness.runCommand("autoplan", "status");
  expect(harness.uiStub.notifications).toContainEqual({
    message: "Autoplan: idle",
    level: "info",
  });
});

test("/autoplan retries non-compliant inner subtask plans once and then stops on a repeated violation", async () => {
  const harness = createPlanExtensionHarness({
    hasUI: true,
    customSelection: { cancelled: false, action: "approve" },
  });

  await harness.runCommand("autoplan", "Rewrite this in Rust");

  const topLevelPrompt = harness.sentUserMessages[0] ?? "";
  await harness.emit("agent_end", {
    messages: [
      {
        role: "user",
        content: [{ type: "text", text: topLevelPrompt }],
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

  const subtaskPrompt = harness.sentUserMessages[1] ?? "";
  await harness.emit("agent_end", {
    messages: [
      {
        role: "user",
        content: [{ type: "text", text: subtaskPrompt }],
      },
      {
        role: "assistant",
        content: [{ type: "text", text: buildNonCompliantAutoPlanSubtaskText() }],
      },
    ],
  });

  expect(harness.sentUserMessages).toHaveLength(3);
  expect(harness.sentUserMessages[2]).toContain(
    "The previous approved-subtask planning response violated the post-approval autoplan policy.",
  );
  expect(harness.sentUserMessages[2]).toContain(
    "Infer the best repo-consistent choice and continue.",
  );
  expect(harness.sentUserMessages[2]).toContain("```pi-plan-json");
  expect(harness.uiStub.notifications).toContainEqual({
    message:
      "Autoplan subtask planning asked for user input or approval. Asking Pi to restate the subtask plan and infer the missing decisions.",
    level: "warning",
  });

  const retrySubtaskPrompt = harness.sentUserMessages[2] ?? "";
  await harness.emit("agent_end", {
    messages: [
      {
        role: "user",
        content: [{ type: "text", text: retrySubtaskPrompt }],
      },
      {
        role: "assistant",
        content: [{ type: "text", text: buildNonCompliantAutoPlanSubtaskText() }],
      },
    ],
  });

  expect(harness.uiStub.notifications).toContainEqual({
    message:
      "Autoplan subtask planning kept asking for user input or approval after one retry. Stopping autoplan.",
    level: "error",
  });

  await harness.runCommand("autoplan", "status");
  expect(harness.uiStub.notifications).toContainEqual({
    message: "Autoplan: idle",
    level: "info",
  });
});

test("/autoplan retries non-compliant hidden reviews once and then stops on a repeated violation", async () => {
  const harness = createPlanExtensionHarness({
    hasUI: true,
    customSelection: { cancelled: false, action: "approve" },
  });

  await harness.runCommand("autoplan", "Rewrite this in Rust");

  const topLevelPrompt = harness.sentUserMessages[0] ?? "";
  await harness.emit("agent_end", {
    messages: [
      {
        role: "user",
        content: [{ type: "text", text: topLevelPrompt }],
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

  const subtaskPrompt = harness.sentUserMessages[1] ?? "";
  await harness.emit("agent_end", {
    messages: [
      {
        role: "user",
        content: [{ type: "text", text: subtaskPrompt }],
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

  await harness.emit("turn_end", {
    message: {
      role: "assistant",
      content: [{ type: "text", text: "Finished the first subtask step [DONE:1]" }],
    },
  });
  await harness.emit("turn_end", {
    message: {
      role: "assistant",
      content: [{ type: "text", text: "Finished the second subtask step [DONE:2]" }],
    },
  });

  const reviewPrompt = String(harness.sentMessages.at(-1)?.content ?? "");
  await harness.emit("agent_end", {
    messages: [
      {
        role: "custom",
        content: reviewPrompt,
      },
      {
        role: "assistant",
        content: [{ type: "text", text: buildNonCompliantAutoPlanReviewText() }],
      },
    ],
  });

  const retryReviewPrompt = String(harness.sentMessages.at(-1)?.content ?? "");
  expect(retryReviewPrompt).toContain(
    "The previous autoplan progress review violated the post-approval autoplan policy.",
  );
  expect(retryReviewPrompt).toContain("Infer the best repo-consistent choice and continue.");
  expect(retryReviewPrompt).toContain("```pi-plan-json");
  expect(harness.uiStub.notifications).toContainEqual({
    message: "Autoplan review asked for user input or approval. Asking for a stricter restatement.",
    level: "warning",
  });

  await harness.emit("agent_end", {
    messages: [
      {
        role: "custom",
        content: retryReviewPrompt,
      },
      {
        role: "assistant",
        content: [{ type: "text", text: buildNonCompliantAutoPlanReviewText() }],
      },
    ],
  });

  expect(harness.uiStub.notifications).toContainEqual({
    message:
      "Autoplan review kept asking for user input or approval after one retry. Stopping autoplan.",
    level: "error",
  });

  await harness.runCommand("autoplan", "status");
  expect(harness.uiStub.notifications).toContainEqual({
    message: "Autoplan: idle",
    level: "info",
  });
});

test("/autoplan retries non-compliant execution turns once and then stops before advancing the inner step", async () => {
  const harness = createPlanExtensionHarness({
    hasUI: true,
    customSelection: { cancelled: false, action: "approve" },
  });

  await harness.runCommand("autoplan", "Rewrite this in Rust");

  const topLevelPrompt = harness.sentUserMessages[0] ?? "";
  await harness.emit("agent_end", {
    messages: [
      {
        role: "user",
        content: [{ type: "text", text: topLevelPrompt }],
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

  const subtaskPrompt = harness.sentUserMessages[1] ?? "";
  await harness.emit("agent_end", {
    messages: [
      {
        role: "user",
        content: [{ type: "text", text: subtaskPrompt }],
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

  await harness.emit("turn_end", {
    message: {
      role: "assistant",
      content: [{ type: "text", text: buildNonCompliantAutoPlanExecutionText() }],
    },
  });

  expect(harness.sentUserMessages).toHaveLength(4);
  expect(harness.sentUserMessages[3]).toContain(
    "The previous inner execution response violated the post-approval autoplan policy.",
  );
  expect(harness.sentUserMessages[3]).toContain(
    "Retry only step 1: Add a regression test for prompt leakage",
  );
  expect(harness.sentUserMessages[3]).toContain(
    "Infer the best repo-consistent choice and continue.",
  );
  expect(harness.uiStub.notifications).toContainEqual({
    message:
      "Autoplan execution asked for user input or approval. Asking Pi to retry the same inner step and infer the missing decisions.",
    level: "warning",
  });

  await harness.emit("turn_end", {
    message: {
      role: "assistant",
      content: [{ type: "text", text: buildNonCompliantAutoPlanExecutionText() }],
    },
  });

  expect(harness.uiStub.notifications).toContainEqual({
    message:
      "Autoplan execution kept asking for user input or approval after one retry. Stopping autoplan.",
    level: "error",
  });
  expect(harness.sentUserMessages).toHaveLength(4);

  await harness.runCommand("autoplan", "status");
  expect(harness.uiStub.notifications).toContainEqual({
    message: "Autoplan: idle",
    level: "info",
  });
});

test("normal /plan execution remains unchanged by autoplan execution-turn recovery", async () => {
  const harness = createPlanExtensionHarness({
    hasUI: true,
    customSelection: { cancelled: false, action: "approve" },
  });

  await enterExecutionState(harness);

  await harness.emit("turn_end", {
    message: {
      role: "assistant",
      content: [{ type: "text", text: buildNonCompliantAutoPlanExecutionText() }],
    },
  });

  expect(harness.sentUserMessages).toHaveLength(2);
  expect(harness.sentUserMessages[1]).toContain(
    "Complete only step 2: Update the approval action UI to show a compact summary",
  );
});

test("/autoplan preserves the approved top-level plan text across review updates and session compaction", async () => {
  const harness = createDirectWorkflowHarness({
    hasUI: true,
    customSelection: { cancelled: false, action: "approve" },
  });
  const approvedPlanText = buildPlanText();

  await enterApprovedAutoPlanState(harness, "Rewrite this in Rust", approvedPlanText);

  expect(getApprovedAutoPlanTextForTesting(harness.workflow)).toBe(approvedPlanText);
  expect(harness.sentUserMessages[1]).toContain("Current approved high-level task 1");

  const subtaskPrompt = harness.sentUserMessages[1] ?? "";
  await harness.handleAgentEnd({
    messages: [
      {
        role: "user",
        content: [{ type: "text", text: subtaskPrompt }],
      },
      {
        role: "assistant",
        content: [{ type: "text", text: buildPlanText() }],
      },
    ],
  });

  const subtaskCritiquePrompt = String(harness.sentMessages.at(-1)?.content ?? "");
  await harness.handleAgentEnd({
    messages: [
      {
        role: "custom",
        content: subtaskCritiquePrompt,
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
  });

  await harness.handleTurnEnd({
    message: {
      role: "assistant",
      content: [{ type: "text", text: "Finished the first subtask step [DONE:1]" }],
    },
  });
  await harness.handleTurnEnd({
    message: {
      role: "assistant",
      content: [{ type: "text", text: "Finished the second subtask step [DONE:2]" }],
    },
  });

  const reviewPrompt = String(harness.sentMessages.at(-1)?.content ?? "");
  await harness.handleAgentEnd({
    messages: [
      {
        role: "custom",
        content: reviewPrompt,
      },
      {
        role: "assistant",
        content: [{ type: "text", text: buildAutoPlanReviewText() }],
      },
    ],
  });

  expect(getApprovedAutoPlanTextForTesting(harness.workflow)).toBe(approvedPlanText);

  await harness.handleSessionCompact(SESSION_COMPACT_EVENT);

  expect(getApprovedAutoPlanTextForTesting(harness.workflow)).toBe(approvedPlanText);
});

test("/autoplan clears the approved top-level plan text on stop, finish, and session reset", async () => {
  const stopHarness = createDirectWorkflowHarness({
    hasUI: true,
    customSelection: { cancelled: false, action: "approve" },
  });
  await enterApprovedAutoPlanState(stopHarness);
  expect(getApprovedAutoPlanTextForTesting(stopHarness.workflow)).toBe(buildPlanText());
  await stopHarness.handleAutoPlanCommand("stop");
  expect(getApprovedAutoPlanTextForTesting(stopHarness.workflow)).toBe("");

  const finishHarness = createDirectWorkflowHarness({
    hasUI: true,
    customSelection: { cancelled: false, action: "approve" },
  });
  await enterApprovedAutoPlanState(finishHarness);
  expect(getApprovedAutoPlanTextForTesting(finishHarness.workflow)).toBe(buildPlanText());
  await (
    finishHarness.workflow as unknown as {
      finishAutoPlan(ctx: ExtensionContext, message: string): Promise<void>;
    }
  ).finishAutoPlan(finishHarness.ctx, "Autoplan complete.");
  expect(getApprovedAutoPlanTextForTesting(finishHarness.workflow)).toBe("");

  const resetHarness = createDirectWorkflowHarness({
    hasUI: true,
    customSelection: { cancelled: false, action: "approve" },
  });
  await enterApprovedAutoPlanState(resetHarness);
  expect(getApprovedAutoPlanTextForTesting(resetHarness.workflow)).toBe(buildPlanText());
  await resetHarness.handleSessionSwitch(SESSION_RESET_EVENTS[0][1]);
  expect(getApprovedAutoPlanTextForTesting(resetHarness.workflow)).toBe("");
});

test("/autoplan continues to the next inner step after a skipped subtask step", async () => {
  const harness = createPlanExtensionHarness({
    hasUI: true,
    customSelection: { cancelled: false, action: "approve" },
  });

  await harness.runCommand("autoplan", "Rewrite this in Rust");

  const topLevelPrompt = harness.sentUserMessages[0] ?? "";
  await harness.emit("agent_end", {
    messages: [
      {
        role: "user",
        content: [{ type: "text", text: topLevelPrompt }],
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

  const subtaskPrompt = harness.sentUserMessages[1] ?? "";
  await harness.emit("agent_end", {
    messages: [
      {
        role: "user",
        content: [{ type: "text", text: subtaskPrompt }],
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

  expect(harness.sentUserMessages[2]).toContain("[SKIPPED:n]");

  await harness.emit("turn_end", {
    message: {
      role: "assistant",
      content: [{ type: "text", text: "Already satisfied [SKIPPED:1]" }],
    },
  });

  expect(harness.sentUserMessages).toHaveLength(4);
  expect(harness.sentUserMessages[3]).toContain(
    "Complete only step 2: Update the approval action UI to show a compact summary",
  );
});

test("/autoplan keeps executing the current subtask when the second inner todo is indented", async () => {
  const harness = createPlanExtensionHarness({
    hasUI: true,
    customSelection: { cancelled: false, action: "approve" },
  });

  await harness.runCommand("autoplan", "Rewrite this in Rust");

  const topLevelPrompt = harness.sentUserMessages[0] ?? "";
  await harness.emit("agent_end", {
    messages: [
      {
        role: "user",
        content: [{ type: "text", text: topLevelPrompt }],
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

  const subtaskPrompt = harness.sentUserMessages[1] ?? "";
  await harness.emit("agent_end", {
    messages: [
      {
        role: "user",
        content: [{ type: "text", text: subtaskPrompt }],
      },
      {
        role: "assistant",
        content: [{ type: "text", text: buildPartiallyIndentedSubtaskPlanText() }],
      },
    ],
  });
  await emitMatchedHiddenResponse(
    harness,
    "1) Verdict: PASS\n2) Issues:\n- none\n3) Required fixes:\n- none\n4) Summary:\n- ready",
  );

  expect(harness.sentUserMessages).toHaveLength(3);
  expect(harness.sentUserMessages[2]).toContain(
    "Complete only step 1: Add a regression test for prompt leakage",
  );

  await harness.emit("turn_end", {
    message: {
      role: "assistant",
      content: [{ type: "text", text: "Finished the first subtask step [DONE:1]" }],
    },
  });

  expect(harness.sentUserMessages).toHaveLength(4);
  expect(harness.sentUserMessages[3]).toContain(
    "Complete only step 2: Update the approval action UI to show a compact summary",
  );
});

test("planning prompt asks Pi to proactively surface change decisions with questionnaires", async () => {
  const harness = createPlanExtensionHarness();

  await harness.runCommand("plan", "Refine the plan approval flow");

  expect(harness.sentUserMessages[0]).toContain(
    "consider important trade-offs while actively surfacing user-controlled decisions",
  );
  expect(harness.sentUserMessages[0]).toContain(
    "Prefer asking over guessing when behavior, UX, API, schema, validation, rollout, compatibility, performance, or migration choices are still open.",
  );
  expect(harness.sentUserMessages[0]).toContain(
    "Use ask_user_question to bundle the key uncertainties into 1-4 focused multiple-choice questions",
  );
  expect(harness.sentUserMessages[0]).toContain("```pi-plan-json");
  expect(harness.sentUserMessages[0]).toContain(
    'The response is invalid if the tagged JSON block is missing, malformed, or schema-invalid.',
  );
});

test("before_agent_start prompt tells plan mode to ask more than one clarifying question when needed", async () => {
  const harness = createPlanExtensionHarness();

  await harness.runCommand("plan", "on");

  const [result] = await harness.emitWithResult("before_agent_start", {
    systemPrompt: "base system prompt",
  });

  expect(result).toEqual(
    expect.objectContaining({
      systemPrompt: expect.stringContaining("Clarify proactively before locking a design"),
    }),
  );
  expect((result as { systemPrompt: string }).systemPrompt).toContain(
    "Ask more than one question when multiple independent choices remain.",
  );
  expect((result as { systemPrompt: string }).systemPrompt).toContain(
    "Prefer asking over guessing when a change could reasonably go multiple ways.",
  );
  expect((result as { systemPrompt: string }).systemPrompt).toContain("```pi-plan-json");
  expect((result as { systemPrompt: string }).systemPrompt).toContain(
    'The response is invalid if the tagged JSON block is missing, malformed, or schema-invalid.',
  );
});

test("before_agent_start uses the tagged JSON contract for autoplan subtask planning", async () => {
  const harness = createPlanExtensionHarness({
    hasUI: true,
    customSelection: { cancelled: false, action: "approve" },
  });

  await harness.runCommand("autoplan", "Rewrite this in Rust");

  const topLevelPrompt = harness.sentUserMessages[0] ?? "";
  await harness.emit("agent_end", {
    messages: [
      {
        role: "user",
        content: [{ type: "text", text: topLevelPrompt }],
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

  const [result] = await harness.emitWithResult("before_agent_start", {
    systemPrompt: "base system prompt",
  });

  expect((result as { systemPrompt: string }).systemPrompt).toContain(
    "[AUTOPLAN SUBTASK PLANNING - READ ONLY]",
  );
  expect((result as { systemPrompt: string }).systemPrompt).toContain("```pi-plan-json");
  expect((result as { systemPrompt: string }).systemPrompt).toContain(
    'The response is invalid if the tagged JSON block is missing, malformed, or schema-invalid.',
  );
});

test("before_agent_start uses the tagged JSON contract for autoplan reviews", async () => {
  const harness = createPlanExtensionHarness({
    hasUI: true,
    customSelection: { cancelled: false, action: "approve" },
  });

  await harness.runCommand("autoplan", "Rewrite this in Rust");

  const topLevelPrompt = harness.sentUserMessages[0] ?? "";
  await harness.emit("agent_end", {
    messages: [
      {
        role: "user",
        content: [{ type: "text", text: topLevelPrompt }],
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

  const subtaskPrompt = harness.sentUserMessages[1] ?? "";
  await harness.emit("agent_end", {
    messages: [
      {
        role: "user",
        content: [{ type: "text", text: subtaskPrompt }],
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

  await harness.emit("turn_end", {
    message: {
      role: "assistant",
      content: [{ type: "text", text: "Finished the first subtask step [DONE:1]" }],
    },
  });
  await harness.emit("turn_end", {
    message: {
      role: "assistant",
      content: [{ type: "text", text: "Finished the second subtask step [DONE:2]" }],
    },
  });

  const [result] = await harness.emitWithResult("before_agent_start", {
    systemPrompt: "base system prompt",
  });

  expect((result as { systemPrompt: string }).systemPrompt).toContain(
    "[AUTOPLAN PROGRESS REVIEW - READ ONLY]",
  );
  expect((result as { systemPrompt: string }).systemPrompt).toContain("```pi-plan-json");
  expect((result as { systemPrompt: string }).systemPrompt).toContain(
    "For review continue responses, the JSON must be: { \"version\": 1, \"kind\": \"review\", \"status\": \"continue\", \"steps\": [...] }.",
  );
});

test("top-level /plan opens approval only when the tagged JSON plan contract is valid", async () => {
  const harness = createPlanExtensionHarness({ hasUI: true });

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

  expect(harness.uiStub.customCalls).toHaveLength(1);
});

test("top-level /plan with valid markdown but no tagged JSON block triggers a strict restatement", async () => {
  const harness = createPlanExtensionHarness({ hasUI: true });

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
        content: [{ type: "text", text: buildMarkdownOnlyPlanText() }],
      },
    ],
  });

  expect(harness.sentUserMessages).toHaveLength(2);
  expect(harness.sentUserMessages[1]).toContain("```pi-plan-json");
  expect(harness.sentMessages).toHaveLength(0);
  expect(harness.uiStub.customCalls).toHaveLength(0);
  expect(harness.uiStub.notifications).toContainEqual({
    message:
      "Couldn't validate the tagged JSON plan contract. Asking Pi to restate the same draft with the required markdown + JSON format.",
    level: "warning",
  });
});

test("top-level /plan with malformed tagged JSON fails visibly after one retry without opening approval", async () => {
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
        content: [{ type: "text", text: buildMalformedTaggedPlanText() }],
      },
    ],
  });

  const retryPrompt = harness.sentUserMessages[1] ?? "";
  await harness.emit("agent_end", {
    messages: [
      {
        role: "user",
        content: [{ type: "text", text: retryPrompt }],
      },
      {
        role: "assistant",
        content: [{ type: "text", text: buildMalformedTaggedPlanText() }],
      },
    ],
  });

  expect(harness.sentUserMessages).toHaveLength(2);
  expect(harness.sentMessages).toHaveLength(0);
  expect(harness.uiStub.customCalls).toHaveLength(0);
  expect(harness.uiStub.notifications).toContainEqual({
    message:
      "Couldn't validate the tagged JSON plan contract after one automatic retry. Still in read-only plan mode.",
    level: "error",
  });
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
  expect(retryPrompt).toContain("```pi-plan-json");
  expect(retryPrompt).toContain(
    "The previous response did not include a valid tagged JSON planning contract.",
  );
  expect(harness.uiStub.notifications).toContainEqual({
    message:
      "Couldn't validate the tagged JSON plan contract. Asking Pi to restate the same draft with the required markdown + JSON format.",
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
    "ask_user_question",
  ]);
  expect(harness.uiStub.notifications).toContainEqual({
    message:
      "Couldn't validate the tagged JSON plan contract after one automatic retry. Still in read-only plan mode.",
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
    "ask_user_question",
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
    "ask_user_question",
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
    "ask_user_question",
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
    "ask_user_question",
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

test("plan mode enables web_search and web_fetch when they are available", async () => {
  const harness = createPlanExtensionHarness({
    extraTools: ["web_search", "web_fetch"],
  });

  await harness.runCommand("plan", "on");

  expect(harness.getActiveTools()).toEqual([
    "read",
    "bash",
    "grep",
    "find",
    "ls",
    "ask_user_question",
    "web_search",
    "web_fetch",
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
  expect(String(harness.sentMessages[1]?.content)).toContain("```pi-plan-json");
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
            text: appendTaggedPlanContract(
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
              ],
              [
                {
                  step: 1,
                  objective: "Add a regression test for prompt leakage",
                  targets: ["src/index.test.ts"],
                  validation: ["bun test"],
                },
                {
                  step: 2,
                  objective: "Update the approval action UI to show a compact summary",
                  targets: ["src/plan-action-ui.ts"],
                  validation: ["bun test"],
                },
              ],
            ),
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
    "ask_user_question",
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
    "ask_user_question",
  ]);
  expect(harness.sentUserMessages).toHaveLength(1);
  expect(harness.sentUserMessages[0]).toContain(
    "Honor this user execution note while implementing the step: keep keyboard flow fast",
  );
  expect(harness.sentUserMessages[0]).not.toContain("Approved top-level plan context:");
  expect(harness.sentUserMessages[0]).not.toContain(
    "Infer the best repo-consistent choice and continue.",
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

test("SKIPPED markers advance execution and render distinctly in progress UI", async () => {
  const harness = createPlanExtensionHarness({
    hasUI: true,
    customSelection: { cancelled: false, action: "approve" },
  });

  await enterExecutionState(harness);

  expect(harness.sentUserMessages[0]).toContain("[SKIPPED:n]");

  await harness.emit("turn_end", {
    message: {
      role: "assistant",
      content: [{ type: "text", text: "Step already satisfied [SKIPPED:1]" }],
    },
  });

  expect(harness.sentUserMessages).toHaveLength(2);
  expect(harness.sentUserMessages[1]).toContain(
    "Complete only step 2: Update the approval action UI to show a compact summary",
  );
  expect(harness.uiStub.statuses.get("plan")).toBe("📋 1/2");
  expect(harness.uiStub.widgets.get("plan-todos")).toEqual([
    "↷ A regression test for prompt leakage",
    "☐ Approval action UI to show a compact summary",
  ]);

  await harness.runCommand("todos");
  expect(harness.uiStub.notifications.at(-1)).toEqual({
    message:
      "Plan progress 1/2\n1. ↷ A regression test for prompt leakage\n2. ○ Approval action UI to show a compact summary",
    level: "info",
  });
});

test("execution prompts use stored structured step details and DONE markers advance", async () => {
  const harness = createPlanExtensionHarness({
    hasUI: true,
    customSelection: { cancelled: false, action: "approve" },
  });

  await harness.runCommand("plan", "on");
  await harness.emit("agent_end", {
    messages: [
      {
        role: "assistant",
        content: [{ type: "text", text: buildConflictingRichPlanText() }],
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
  expect(harness.sentUserMessages[0]).not.toContain("Markdown says the wrong step name");
  expect(harness.sentUserMessages[0]).not.toContain("wrong/path.ts");

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
  expect(harness.sentUserMessages[1]).not.toContain("Markdown says the wrong second step");
  expect(harness.sentUserMessages[1]).not.toContain("wrong/second.ts");
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

test("todos output and widget stay compact while using stored structured plan data", async () => {
  const harness = createPlanExtensionHarness({
    hasUI: true,
    customSelection: { cancelled: false, action: "approve" },
  });

  await harness.runCommand("plan", "on");
  await harness.emit("agent_end", {
    messages: [
      {
        role: "assistant",
        content: [{ type: "text", text: buildConflictingRichPlanText() }],
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
  expect(initialWidgetLines.join("\n")).not.toContain("Markdown says the wrong step name");

  await harness.runCommand("todos");
  expect(harness.uiStub.notifications.at(-1)).toEqual({
    message:
      "Plan progress 0/2\n1. ○ A regression test for prompt leakage\n2. ○ Approval action UI to show a compact summary",
    level: "info",
  });
  expect(harness.uiStub.notifications.at(-1)?.message).not.toContain("src/index.test.ts");
  expect(harness.uiStub.notifications.at(-1)?.message).not.toContain("Validation method");
  expect(harness.uiStub.notifications.at(-1)?.message).not.toContain("Markdown says the wrong step name");

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
  expect(updatedWidgetLines.join("\n")).not.toContain("Markdown says the wrong second step");

  await harness.runCommand("todos");
  expect(harness.uiStub.notifications.at(-1)).toEqual({
    message:
      "Plan progress 1/2\n1. ✓ A regression test for prompt leakage\n2. ○ Approval action UI to show a compact summary",
    level: "info",
  });
  expect(harness.uiStub.notifications.at(-1)?.message).not.toContain("src/index.test.ts");
  expect(harness.uiStub.notifications.at(-1)?.message).not.toContain("Validation method");
  expect(harness.uiStub.notifications.at(-1)?.message).not.toContain("Markdown says the wrong second step");
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
    "ask_user_question",
  ]);
  expect(harness.sentUserMessages).toHaveLength(0);

  await harness.runCommand("todos");
  expect(harness.uiStub.notifications).toContainEqual({
    message: "No tracked plan steps. Create a plan in /plan mode first.",
    level: "info",
  });
});

test("session boundary events reset transient plan state while approval is pending", async () => {
  for (const [eventName, event] of SESSION_RESET_EVENTS) {
    const harness = createPlanExtensionHarness({ hasUI: true });

    await enterApprovalState(harness);

    expect(harness.getActiveTools()).toEqual([
      "read",
      "bash",
      "grep",
      "find",
      "ls",
      "ask_user_question",
    ]);
    expect(harness.uiStub.statuses.get("plan")).toBe("⏸ plan");

    await assertPlanStateReset(harness, eventName, event);
  }
});

test("session boundary events reset transient plan state while approved execution is active", async () => {
  for (const [eventName, event] of SESSION_RESET_EVENTS) {
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
      "ask_user_question",
    ]);
    expect(harness.uiStub.statuses.get("plan")).toBe("📋 0/2");
    expect(harness.uiStub.widgets.get("plan-todos")).toEqual([
      "☐ A regression test for prompt leakage",
      "☐ Approval action UI to show a compact summary",
    ]);

    await assertPlanStateReset(harness, eventName, event);
  }
});

test("session compact preserves transient plan state while approval is pending", async () => {
  const harness = createPlanExtensionHarness({ hasUI: true });

  await enterApprovalState(harness);

  await harness.emit("session_compact", SESSION_COMPACT_EVENT);

  expect(harness.getActiveTools()).toEqual([
    "read",
    "bash",
    "grep",
    "find",
    "ls",
    "ask_user_question",
  ]);
  expect(harness.uiStub.statuses.get("plan")).toBe("⏸ plan");

  await harness.runCommand("plan", "status");
  expect(harness.uiStub.notifications).toContainEqual({
    message: "Plan mode: ON (read-only planning)",
    level: "info",
  });
});

test("session compact preserves the critique->revision flow", async () => {
  const harness = createPlanExtensionHarness({ hasUI: true });

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

  await harness.emit("session_compact", SESSION_COMPACT_EVENT);

  const critiquePrompt = String(harness.sentMessages.at(-1)?.content ?? "");
  await harness.emit("agent_end", {
    messages: [
      {
        role: "custom",
        content: critiquePrompt,
      },
      {
        role: "assistant",
        content: [
          {
            type: "text",
            text: "1) Verdict: REFINE\n2) Issues:\n- split step two\n3) Required fixes:\n- revise it\n4) Summary:\n- needs tightening",
          },
        ],
      },
    ],
  });

  expect(String(harness.sentMessages.at(-1)?.content ?? "")).toContain(
    "Revise the latest plan using the critique below.",
  );
  expect(harness.uiStub.notifications).toContainEqual({
    message: "The critique requested plan refinement. Regenerating the plan.",
    level: "warning",
  });
});

test("session compact preserves transient plan state while approved execution is active", async () => {
  const harness = createPlanExtensionHarness({
    hasUI: true,
    customSelection: { cancelled: false, action: "approve" },
  });

  await enterExecutionState(harness);
  await harness.emit("session_compact", SESSION_COMPACT_EVENT);

  expect(harness.getActiveTools()).toEqual([
    "read",
    "bash",
    "grep",
    "find",
    "ls",
    "edit",
    "write",
    "ask_user_question",
  ]);
  expect(harness.uiStub.statuses.get("plan")).toBe("📋 0/2");
  expect(harness.uiStub.widgets.get("plan-todos")).toEqual([
    "☐ A regression test for prompt leakage",
    "☐ Approval action UI to show a compact summary",
  ]);
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
    "ask_user_question",
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
    "ask_user_question",
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
