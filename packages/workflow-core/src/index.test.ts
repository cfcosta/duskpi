import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  PhaseWorkflow,
  PromptLoadError,
  getLastAssistantTextResult,
  loadPromptFiles,
  parseTrimmedStringArg,
  registerPhaseWorkflowExtension,
  type PromptLoadResult,
  type PromptSnapshot,
} from "./index";

test("parseTrimmedStringArg trims strings and ignores non-strings", () => {
  assert.equal(parseTrimmedStringArg("  src  "), "src");
  assert.equal(parseTrimmedStringArg("   "), undefined);
  assert.equal(parseTrimmedStringArg(undefined), undefined);
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

function createPhaseWorkflowHarness(options?: {
  selectChoice?: string;
  promptProvider?: () => TestPromptResult;
}) {
  const sentMessages: string[] = [];
  const notifications: Array<{ level: string; message: string }> = [];

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
      parseScopeArg: () => undefined,
      buildPrompt: ({ phase }) => phase,
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
      setStatus() {},
      setWidget() {},
      async select() {
        return options?.selectChoice ?? "cancel";
      },
      async editor() {
        return "";
      },
    },
  };

  return { workflow, ctx: ctx as never, sentMessages, notifications };
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
    handleToolCall(event: { toolName?: string }) {
      forwarded.push({ type: "tool_call", event });
      return "tool-result";
    },
    handleAgentEnd(event: { messages?: unknown[] }, ctx: unknown) {
      forwarded.push({ type: "agent_end", event, ctx });
      return "agent-end-result";
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
  assert.equal(commands["bug-fix"]?.handler("scope", ctx as never), "command-result");
  assert.equal(listeners.tool_call?.({ toolName: "Read" }, undefined as never), "tool-result");
  assert.equal(listeners.agent_end?.({ messages: ["report"] }, ctx as never), "agent-end-result");
  assert.deepEqual(forwarded, [
    { type: "command", args: "scope", ctx },
    { type: "tool_call", event: { toolName: "Read" } },
    { type: "agent_end", event: { messages: ["report"] }, ctx },
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

test("PhaseWorkflow allows bash during analysis when the tool name is not write-capable", async () => {
  const { workflow, ctx } = createPhaseWorkflowHarness();

  await workflow.handleCommand(undefined, ctx);

  const result = await workflow.handleToolCall({ toolName: "Bash" });

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
