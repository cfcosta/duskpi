import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  PhaseWorkflow,
  getLastAssistantTextResult,
  loadPromptFiles,
  parseTrimmedStringArg,
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

function createPhaseWorkflowHarness(options?: { selectChoice?: string }) {
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
      promptProvider: () => ({ prompts: { finder: "F", arbiter: "A", fixer: "X" } }),
      parseScopeArg: () => undefined,
      buildPrompt: ({ phase }) => phase,
      text: {
        unavailable: () => "unavailable",
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
