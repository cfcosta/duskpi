import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  PhaseWorkflow,
  PromptLoadError,
  extractLastAssistantText,
  extractLastUserText,
  getLastAssistantTextResult,
  loadPromptFiles,
  parseTrimmedStringArg,
  registerPhaseWorkflowExtension,
  type PromptLoadResult,
  type PromptSnapshot,
  type SessionCompactEvent,
  type SessionForkEvent,
  type SessionSwitchEvent,
} from "./index";

test("parseTrimmedStringArg trims non-empty strings", () => {
  assert.equal(parseTrimmedStringArg("  src  "), "src");
});

test("parseTrimmedStringArg ignores blank and non-string args", () => {
  assert.equal(parseTrimmedStringArg("   "), undefined);
  assert.equal(parseTrimmedStringArg(undefined), undefined);
  assert.equal(parseTrimmedStringArg({}), undefined);
});

test("extractLastAssistantText joins text blocks from the last assistant message", () => {
  const result = extractLastAssistantText([
    { role: "assistant", content: [{ type: "text", text: "first" }] },
    {
      role: "assistant",
      content: [
        { type: "text", text: "second" },
        { type: "text", text: "third" },
      ],
    },
  ]);

  assert.equal(result, "second\nthird");
});

test("extractLastAssistantText returns undefined when the last assistant message has no text blocks", () => {
  const result = extractLastAssistantText([
    { role: "assistant", content: [{ type: "tool_result", text: "ignored" }] },
  ]);

  assert.equal(result, undefined);
});

test("extractLastAssistantText ignores stale assistant output when the last message is from the user", () => {
  const result = extractLastAssistantText([
    { role: "assistant", content: [{ type: "text", text: "stale" }] },
    { role: "user", content: [{ type: "text", text: "new prompt" }] },
  ]);

  assert.equal(result, undefined);
});

test("extractLastUserText returns the most recent user text message", () => {
  const result = extractLastUserText([
    { role: "user", content: [{ type: "text", text: "first request" }] },
    { role: "assistant", content: [{ type: "text", text: "response" }] },
    { role: "user", content: [{ type: "text", text: "latest request" }] },
  ]);

  assert.equal(result, "latest request");
});

test("getLastAssistantTextResult distinguishes ok/empty/invalid payloads", () => {
  const ok = getLastAssistantTextResult([
    { role: "assistant", content: [{ type: "text", text: "hello" }] },
  ]);
  assert.equal(ok.kind, "ok");

  const empty = getLastAssistantTextResult([
    { role: "assistant", content: [{ type: "tool_result", text: "ignored" }] },
  ]);
  assert.equal(empty.kind, "empty");

  const invalid = getLastAssistantTextResult([{ role: "assistant", content: "bad-shape" }]);
  assert.equal(invalid.kind, "invalid_payload");
});

test("loadPromptFiles returns discriminated success/failure", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "workflow-core-prompts-"));
  fs.writeFileSync(path.join(tempDir, "a.md"), "A");
  fs.writeFileSync(path.join(tempDir, "b.md"), "B");

  const ok = loadPromptFiles(tempDir, { a: "a.md", b: "b.md" });
  assert.equal(ok.ok, true);

  const bad = loadPromptFiles(tempDir, { missing: "missing.md" });
  assert.equal(bad.ok, false);
  if (!bad.ok) {
    assert.equal(bad.error.code, "PROMPT_READ_FAILED");
  }
});

const DEFAULT_PROMPTS = {
  finder: "F",
  arbiter: "A",
  fixer: "X",
};

type TestPromptResult =
  | PromptSnapshot<typeof DEFAULT_PROMPTS>
  | PromptLoadResult<typeof DEFAULT_PROMPTS>;

type PhasePromptArgs = {
  phase: string;
  prompts: typeof DEFAULT_PROMPTS;
  reports: Record<string, string>;
  scope?: string;
  refinement?: string;
};

function createPhaseWorkflowHarness(options?: {
  selectChoice?: string;
  selectChoices?: string[];
  editorValue?: string;
  editorValues?: string[];
  promptProvider?: () => TestPromptResult;
  parseScopeArg?: (args: unknown) => string | undefined;
  buildPrompt?: (args: PhasePromptArgs) => string;
}) {
  const sentMessages: string[] = [];
  const notifications: Array<{ level: string; message: string }> = [];
  const statusUpdates: Array<{ id: string; status: string | undefined }> = [];
  const widgetUpdates: Array<{ id: string; widget: unknown }> = [];
  const buildPromptCalls: PhasePromptArgs[] = [];
  const selectChoices = [...(options?.selectChoices ?? [])];
  const editorValues = [...(options?.editorValues ?? [])];

  const workflow = new PhaseWorkflow(
    {
      sendUserMessage(message: string) {
        sentMessages.push(message);
      },
    } as never,
    {
      id: "wf-test",
      analysisPhases: ["finder", "arbiter"],
      executionPhase: "fixer",
      phaseLabels: {
        finder: "Finder",
        arbiter: "Arbiter",
        fixer: "Fixer",
      },
      promptProvider: options?.promptProvider ?? (() => ({ prompts: DEFAULT_PROMPTS })),
      parseScopeArg: options?.parseScopeArg ?? (() => undefined),
      buildPrompt: (args) => {
        const snapshot: PhasePromptArgs = {
          ...args,
          reports: { ...args.reports },
        };
        buildPromptCalls.push(snapshot);
        return options?.buildPrompt?.(snapshot) ?? args.phase;
      },
      text: {
        unavailable: (error) => error?.message ?? "unavailable",
        alreadyRunning: "running",
        analysisWriteBlocked: "blocked",
        complete: "complete",
        cancelled: "cancelled",
        selectTitle: "title",
        executeOption: "execute",
        refineOption: "refine",
        cancelOption: "cancel",
        refineEditorLabel: "label",
        sendFailed: () => "send-failed",
        missingOutputRetry: () => "retry",
        missingOutputStopped: () => "stopped",
      },
    },
  );

  const ctx = {
    ui: {
      notify(message: string, level: string) {
        notifications.push({ message, level });
      },
      setStatus(id: string, status: string | undefined) {
        statusUpdates.push({ id, status });
      },
      setWidget(id: string, widget: unknown) {
        widgetUpdates.push({ id, widget });
      },
      async select() {
        return selectChoices.shift() ?? options?.selectChoice ?? "cancel";
      },
      async editor() {
        return editorValues.shift() ?? options?.editorValue ?? "";
      },
    },
  };

  return {
    workflow,
    ctx: ctx as never,
    sentMessages,
    notifications,
    statusUpdates,
    widgetUpdates,
    buildPromptCalls,
  };
}

function createAgentEndEvent(prompt: string, assistantText: string) {
  return {
    messages: [
      { role: "user", content: [{ type: "text", text: prompt }] },
      { role: "assistant", content: [{ type: "text", text: assistantText }] },
    ],
  };
}

function replaceRequestId(prompt: string, requestId: string): string {
  return prompt.replace(
    /<!--\s*workflow-request-id:[^>]+\s*-->/i,
    `<!-- workflow-request-id:${requestId} -->`,
  );
}

const PHASE_SESSION_BOUNDARY_EVENTS = [
  ["session_switch", { reason: "resume", previousSessionFile: "/tmp/previous.pi" }],
  ["session_fork", { previousSessionFile: "/tmp/previous.pi" }],
  ["session_compact", { compactionEntry: { id: "compact-1" }, fromExtension: false }],
  ["session_shutdown", { reason: "exit" }],
] as const;

async function assertPhaseWorkflowResetOnLifecycleEvent(
  eventName: (typeof PHASE_SESSION_BOUNDARY_EVENTS)[number][0],
  event: (typeof PHASE_SESSION_BOUNDARY_EVENTS)[number][1],
) {
  const { workflow, ctx, sentMessages, notifications, statusUpdates, widgetUpdates } =
    createPhaseWorkflowHarness();

  const firstRun = await workflow.handleCommand("scope", ctx);
  assert.deepEqual(firstRun, { kind: "ok" });
  assert.equal(sentMessages.length, 1);

  const blockedWhileActive = await workflow.handleCommand("scope", ctx);
  assert.deepEqual(blockedWhileActive, { kind: "blocked", reason: "already_running" });
  assert.deepEqual(notifications.at(-1), { level: "warning", message: "running" });

  const handlers = {
    session_switch: workflow.handleSessionSwitch.bind(workflow),
    session_fork: workflow.handleSessionFork.bind(workflow),
    session_compact: workflow.handleSessionCompact.bind(workflow),
    session_shutdown: workflow.handleSessionShutdown.bind(workflow),
  };

  const lifecycleResult = await handlers[eventName](event as never, ctx);
  assert.equal(lifecycleResult, undefined);
  assert.deepEqual(statusUpdates.at(-1), { id: "wf-test", status: undefined });
  assert.deepEqual(widgetUpdates.at(-1), { id: "wf-test", widget: undefined });

  const restarted = await workflow.handleCommand("scope", ctx);
  assert.deepEqual(restarted, { kind: "ok" });
  assert.equal(sentMessages.length, 2);
}

test("registerPhaseWorkflowExtension resolves prompts and wires workflow handlers", async () => {
  const commands: Record<
    string,
    { description: string; handler: (args: unknown, ctx: unknown) => unknown }
  > = {};
  const listeners: Record<string, (event: unknown, ctx: unknown) => unknown> = {};
  const forwarded: Array<{ type: string; args?: unknown; event?: unknown; ctx?: unknown }> = [];
  const loadPromptCalls: string[] = [];

  let capturedPromptProvider: (() => PromptLoadResult<typeof DEFAULT_PROMPTS>) | undefined;
  let createWorkflowCalls = 0;

  const workflow = {
    handleCommand(args: unknown, ctx: unknown) {
      forwarded.push({ type: "command", args, ctx });
      return "command-result";
    },
    handleToolCall(event: { toolName?: string; input?: unknown }) {
      forwarded.push({ type: "tool_call", event });
      return "tool-result";
    },
    handleAgentEnd(event: { messages?: unknown[] }, ctx: unknown) {
      forwarded.push({ type: "agent_end", event, ctx });
      return "agent-end-result";
    },
    handleSessionStart(event: { restored?: boolean }, ctx: unknown) {
      forwarded.push({ type: "session_start", event, ctx });
      return "session-start-result";
    },
    handleSessionSwitch(event: SessionSwitchEvent, ctx: unknown) {
      forwarded.push({ type: "session_switch", event, ctx });
      return "session-switch-result";
    },
    handleSessionFork(event: SessionForkEvent, ctx: unknown) {
      forwarded.push({ type: "session_fork", event, ctx });
      return "session-fork-result";
    },
    handleSessionCompact(event: SessionCompactEvent, ctx: unknown) {
      forwarded.push({ type: "session_compact", event, ctx });
      return "session-compact-result";
    },
    handleSessionShutdown(event: { reason?: string }, ctx: unknown) {
      forwarded.push({ type: "session_shutdown", event, ctx });
      return "session-shutdown-result";
    },
  };

  const api = {
    sendUserMessage() {},
    registerCommand(
      name: string,
      command: { description: string; handler: (args: unknown, ctx: unknown) => unknown },
    ) {
      commands[name] = command;
    },
    on(name: string, handler: (event: unknown, ctx: unknown) => unknown) {
      listeners[name] = handler;
    },
  };

  const returnedWorkflow = registerPhaseWorkflowExtension(api as never, {
    moduleUrl: "file:///tmp/duskpi/extensions/bug-fix/index.ts",
    commandName: "bug-fix",
    description: "Bug fix",
    loadPrompts(promptDirectory: string) {
      loadPromptCalls.push(promptDirectory);
      return { ok: true, prompts: DEFAULT_PROMPTS };
    },
    createWorkflow(apiArg, promptProvider) {
      createWorkflowCalls += 1;
      capturedPromptProvider = promptProvider;
      assert.equal(apiArg, api);
      return workflow;
    },
  });

  const ctx = { ui: {} };

  assert.equal(returnedWorkflow, workflow);
  assert.equal(createWorkflowCalls, 1);
  assert.ok(capturedPromptProvider);
  assert.equal(loadPromptCalls.length, 0);
  assert.deepEqual(capturedPromptProvider!(), { ok: true, prompts: DEFAULT_PROMPTS });
  assert.deepEqual(loadPromptCalls, [path.resolve("/tmp/duskpi/extensions/bug-fix", "prompts")]);
  assert.equal(commands["bug-fix"]?.description, "Bug fix");
  assert.ok(listeners.tool_call);
  assert.ok(listeners.agent_end);
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
    fromExtension: false,
  };

  assert.equal(commands["bug-fix"]?.handler("scope", ctx as never), "command-result");
  assert.equal(
    listeners.tool_call?.({ toolName: "Read", input: { command: "ls -la" } }, undefined as never),
    "tool-result",
  );
  assert.equal(listeners.agent_end?.({ messages: ["report"] }, ctx as never), "agent-end-result");
  assert.equal(listeners.session_start?.({ restored: true }, ctx as never), "session-start-result");
  assert.equal(listeners.session_switch?.(sessionSwitchEvent, ctx as never), "session-switch-result");
  assert.equal(listeners.session_fork?.(sessionForkEvent, ctx as never), "session-fork-result");
  assert.equal(
    listeners.session_compact?.(sessionCompactEvent, ctx as never),
    "session-compact-result",
  );
  assert.equal(
    listeners.session_shutdown?.({ reason: "exit" }, ctx as never),
    "session-shutdown-result",
  );
  assert.deepEqual(forwarded, [
    { type: "command", args: "scope", ctx },
    { type: "tool_call", event: { toolName: "Read", input: { command: "ls -la" } } },
    { type: "agent_end", event: { messages: ["report"] }, ctx },
    { type: "session_start", event: { restored: true }, ctx },
    { type: "session_switch", event: sessionSwitchEvent, ctx },
    { type: "session_fork", event: sessionForkEvent, ctx },
    { type: "session_compact", event: sessionCompactEvent, ctx },
    { type: "session_shutdown", event: { reason: "exit" }, ctx },
  ]);
});

test("PhaseWorkflow accepts prompt snapshots with prompts", async () => {
  const { workflow, ctx, sentMessages } = createPhaseWorkflowHarness({
    promptProvider: () => ({ prompts: DEFAULT_PROMPTS }),
  });

  const result = await workflow.handleCommand(undefined, ctx);

  assert.equal(result.kind, "ok");
  assert.equal(sentMessages.length, 1);
});

test("PhaseWorkflow reports snapshot prompt-provider errors", async () => {
  const failure = new Error("snapshot-failure");
  const { workflow, ctx, notifications } = createPhaseWorkflowHarness({
    promptProvider: () => ({ error: failure }),
  });

  const result = await workflow.handleCommand(undefined, ctx);

  assert.equal(result.kind, "blocked");
  assert.equal(result.reason, "prompts_unavailable");
  assert.deepEqual(notifications.at(-1), { level: "error", message: "snapshot-failure" });
});

test("PhaseWorkflow accepts raw prompt-load results with prompts", async () => {
  const { workflow, ctx, sentMessages } = createPhaseWorkflowHarness({
    promptProvider: () => ({ ok: true, prompts: DEFAULT_PROMPTS }),
  });

  const result = await workflow.handleCommand(undefined, ctx);

  assert.equal(result.kind, "ok");
  assert.equal(sentMessages.length, 1);
});

test("PhaseWorkflow reports raw prompt-load failures", async () => {
  const failure = new PromptLoadError("PROMPT_READ_FAILED", "load-result-failure");
  const { workflow, ctx, notifications } = createPhaseWorkflowHarness({
    promptProvider: () => ({ ok: false, error: failure }),
  });

  const result = await workflow.handleCommand(undefined, ctx);

  assert.equal(result.kind, "blocked");
  assert.equal(result.reason, "prompts_unavailable");
  assert.deepEqual(notifications.at(-1), { level: "error", message: "load-result-failure" });
});

test("PhaseWorkflow keeps request-id and prompt-body correlation unchanged", async () => {
  const { workflow, ctx, sentMessages } = createPhaseWorkflowHarness();

  await workflow.handleCommand(undefined, ctx);
  assert.equal(sentMessages.length, 1);

  const wrongRequestResult = await workflow.handleAgentEnd(
    createAgentEndEvent(replaceRequestId(sentMessages[0]!, "wf-test-999"), "finder-report"),
    ctx,
  );
  assert.deepEqual(wrongRequestResult, { kind: "blocked", reason: "unmatched_agent_end" });
  assert.equal(sentMessages.length, 1);

  const wrongPromptResult = await workflow.handleAgentEnd(
    createAgentEndEvent(sentMessages[0]!.replace("finder", "finder-modified"), "finder-report"),
    ctx,
  );
  assert.deepEqual(wrongPromptResult, { kind: "blocked", reason: "unmatched_agent_end" });
  assert.equal(sentMessages.length, 1);

  const matchedResult = await workflow.handleAgentEnd(
    createAgentEndEvent(sentMessages[0]!, "finder-report"),
    ctx,
  );
  assert.deepEqual(matchedResult, { kind: "ok" });
  assert.equal(sentMessages.length, 2);
});

test("PhaseWorkflow preserves analysis-to-execution prompt inputs", async () => {
  const { workflow, ctx, sentMessages, buildPromptCalls } = createPhaseWorkflowHarness({
    selectChoice: "execute",
    parseScopeArg: parseTrimmedStringArg,
    buildPrompt: ({ phase, reports, scope, refinement }) => {
      return JSON.stringify({ phase, reports, scope, refinement });
    },
  });

  await workflow.handleCommand("  src/app  ", ctx);
  await workflow.handleAgentEnd(createAgentEndEvent(sentMessages[0]!, "finder-report"), ctx);
  await workflow.handleAgentEnd(createAgentEndEvent(sentMessages[1]!, "arbiter-report"), ctx);

  assert.equal(sentMessages.length, 3);
  assert.deepEqual(buildPromptCalls, [
    {
      phase: "finder",
      prompts: DEFAULT_PROMPTS,
      reports: {},
      scope: "src/app",
      refinement: undefined,
    },
    {
      phase: "arbiter",
      prompts: DEFAULT_PROMPTS,
      reports: { finder: "finder-report" },
      scope: "src/app",
      refinement: undefined,
    },
    {
      phase: "fixer",
      prompts: DEFAULT_PROMPTS,
      reports: { finder: "finder-report", arbiter: "arbiter-report" },
      scope: "src/app",
      refinement: undefined,
    },
  ]);
});

test("PhaseWorkflow preserves the last-analysis refinement loop", async () => {
  const { workflow, ctx, sentMessages, buildPromptCalls } = createPhaseWorkflowHarness({
    selectChoices: ["refine", "execute"],
    editorValue: "tighten validation",
  });

  await workflow.handleCommand(undefined, ctx);
  await workflow.handleAgentEnd(createAgentEndEvent(sentMessages[0]!, "finder-report"), ctx);
  await workflow.handleAgentEnd(createAgentEndEvent(sentMessages[1]!, "arbiter-initial"), ctx);
  await workflow.handleAgentEnd(createAgentEndEvent(sentMessages[2]!, "arbiter-refined"), ctx);

  assert.equal(sentMessages.length, 4);
  assert.deepEqual(buildPromptCalls[2], {
    phase: "arbiter",
    prompts: DEFAULT_PROMPTS,
    reports: { finder: "finder-report", arbiter: "arbiter-initial" },
    scope: undefined,
    refinement: "tighten validation",
  });
  assert.deepEqual(buildPromptCalls[3], {
    phase: "fixer",
    prompts: DEFAULT_PROMPTS,
    reports: { finder: "finder-report", arbiter: "arbiter-refined" },
    scope: undefined,
    refinement: undefined,
  });
});

test("PhaseWorkflow preserves execution completion cleanup", async () => {
  const { workflow, ctx, sentMessages, notifications, statusUpdates, widgetUpdates } =
    createPhaseWorkflowHarness({ selectChoice: "execute" });

  await workflow.handleCommand(undefined, ctx);
  await workflow.handleAgentEnd(createAgentEndEvent(sentMessages[0]!, "finder-report"), ctx);
  await workflow.handleAgentEnd(createAgentEndEvent(sentMessages[1]!, "arbiter-report"), ctx);

  const result = await workflow.handleAgentEnd(
    createAgentEndEvent(sentMessages[2]!, "execution-complete"),
    ctx,
  );

  assert.deepEqual(result, { kind: "ok" });
  assert.deepEqual(notifications.at(-1), { level: "info", message: "complete" });
  assert.deepEqual(statusUpdates.at(-1), { id: "wf-test", status: undefined });
  assert.deepEqual(widgetUpdates.at(-1), { id: "wf-test", widget: undefined });
});

test("PhaseWorkflow handles invalid assistant payload with explicit error", async () => {
  const { workflow, ctx, sentMessages, notifications } = createPhaseWorkflowHarness();

  await workflow.handleCommand(undefined, ctx);
  assert.equal(sentMessages.length, 1);

  const result = await workflow.handleAgentEnd(
    { messages: [{ role: "assistant", content: "invalid" }] },
    ctx,
  );

  assert.equal(result.kind, "recoverable_error");
  assert.equal(result.reason, "invalid_agent_payload");
  assert.equal(notifications.at(-1)?.level, "error");
});

test("PhaseWorkflow session_start remains a no-op while active", async () => {
  const { workflow, ctx, sentMessages } = createPhaseWorkflowHarness();

  await workflow.handleCommand("scope", ctx);

  const result = await workflow.handleSessionStart({ restored: true }, ctx);

  assert.equal(result, undefined);
  assert.equal(sentMessages.length, 1);

  const blockedWhileActive = await workflow.handleCommand("scope", ctx);
  assert.deepEqual(blockedWhileActive, { kind: "blocked", reason: "already_running" });
});

for (const [eventName, event] of PHASE_SESSION_BOUNDARY_EVENTS) {
  test(`PhaseWorkflow resets active runs on ${eventName}`, async () => {
    await assertPhaseWorkflowResetOnLifecycleEvent(eventName, event);
  });
}

test("PhaseWorkflow blocks mutating bash during analysis", async () => {
  const { workflow, ctx } = createPhaseWorkflowHarness();

  await workflow.handleCommand(undefined, ctx);

  const result = await workflow.handleToolCall({
    toolName: "Bash",
    input: { command: "rm -rf tmp" },
  });

  assert.deepEqual(result, {
    block: true,
    reason: "Workflow analysis phase blocked a potentially mutating bash command: rm -rf tmp",
  });
});

test("PhaseWorkflow allows safe read-only bash during analysis", async () => {
  const { workflow, ctx } = createPhaseWorkflowHarness();

  await workflow.handleCommand(undefined, ctx);

  const result = await workflow.handleToolCall({
    toolName: "Bash",
    input: { command: "ls -la" },
  });

  assert.equal(result, undefined);
});

test("PhaseWorkflow allows clearly read-only tools during analysis", async () => {
  const { workflow, ctx } = createPhaseWorkflowHarness();

  await workflow.handleCommand(undefined, ctx);

  const result = await workflow.handleToolCall({ toolName: "Read" });

  assert.equal(result, undefined);
});

test("PhaseWorkflow stops blocking write-capable tools after entering execution", async () => {
  const { workflow, ctx } = createPhaseWorkflowHarness({ selectChoice: "execute" });

  await workflow.handleCommand(undefined, ctx);
  await workflow.handleAgentEnd(
    { messages: [{ role: "assistant", content: [{ type: "text", text: "finder-report" }] }] },
    ctx,
  );
  await workflow.handleAgentEnd(
    { messages: [{ role: "assistant", content: [{ type: "text", text: "arbiter-report" }] }] },
    ctx,
  );

  const result = await workflow.handleToolCall({ toolName: "Write" });

  assert.equal(result, undefined);
});
