import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import owaspFix from "./index";
import { OwaspWorkflow } from "./workflow";
import { buildPrompt, loadPrompts } from "./prompting";

type NotifyLevel = "info" | "warning" | "error";

function assertPhaseWorkflowListenerSurface(
  listeners: Record<string, (...args: unknown[]) => Promise<unknown>>,
) {
  assert.deepEqual(Object.keys(listeners).sort(), [
    "agent_end",
    "session_compact",
    "session_fork",
    "session_shutdown",
    "session_start",
    "session_switch",
    "tool_call",
  ]);
  assert.equal(listeners.before_agent_start, undefined);
  assert.equal(listeners.turn_end, undefined);
}

function createHarness(options?: {
  selectChoice?: string;
  editorValue?: string;
  failSendCount?: number;
}) {
  const sentMessages: string[] = [];
  const notifications: Array<{ message: string; level: NotifyLevel }> = [];
  const statuses: Array<string | undefined> = [];
  const widgets: Array<string | undefined> = [];

  let failSendCount = options?.failSendCount ?? 0;

  const api = {
    sendUserMessage(message: string) {
      if (failSendCount > 0) {
        failSendCount -= 1;
        throw new Error("send failed");
      }

      sentMessages.push(message);
    },
  };

  const ctx = {
    ui: {
      notify(message: string, level: NotifyLevel) {
        notifications.push({ message, level });
      },
      setStatus(_id: string, status: string | undefined) {
        statuses.push(status);
      },
      setWidget(_id: string, widget: string | undefined) {
        widgets.push(widget);
      },
      async select() {
        return options?.selectChoice ?? "Cancel";
      },
      async editor() {
        return options?.editorValue ?? "";
      },
    },
  };

  const prompts = {
    finder: "FINDER",
    skeptic: "SKEPTIC",
    arbiter: "ARBITER",
    fixer: "FIXER",
  };

  const workflow = new OwaspWorkflow(api as never, () => ({ ok: true, prompts }));

  return { workflow, ctx: ctx as never, sentMessages, notifications, statuses, widgets };
}

test("workflow advances through finder and skeptic phases", async () => {
  const { workflow, ctx, sentMessages } = createHarness();

  await workflow.handleCommand("  src  ", ctx);
  assert.equal(sentMessages.length, 1);
  assert.match(sentMessages[0], /FINDER/);
  assert.match(sentMessages[0], /Focus on: src/);

  await workflow.handleAgentEnd(
    {
      messages: [
        { role: "user", content: [{ type: "text", text: sentMessages[0] }] },
        { role: "assistant", content: [{ type: "text", text: "findings" }] },
      ],
    },
    ctx,
  );
  assert.equal(sentMessages.length, 2);
  assert.match(sentMessages[1], /SKEPTIC/);
  assert.match(sentMessages[1], /findings/);

  await workflow.handleAgentEnd(
    {
      messages: [
        { role: "user", content: [{ type: "text", text: sentMessages[1] }] },
        { role: "assistant", content: [{ type: "text", text: "skeptic-notes" }] },
      ],
    },
    ctx,
  );
  assert.equal(sentMessages.length, 3);
  assert.match(sentMessages[2], /ARBITER/);
  assert.match(sentMessages[2], /skeptic-notes/);
});

test("workflow ignores agent_end events that do not match pending prompt", async () => {
  const { workflow, ctx, sentMessages } = createHarness();

  await workflow.handleCommand("", ctx);
  assert.equal(sentMessages.length, 1);

  const mismatched = await workflow.handleAgentEnd(
    {
      messages: [
        { role: "user", content: [{ type: "text", text: "some other prompt" }] },
        { role: "assistant", content: [{ type: "text", text: "wrong response" }] },
      ],
    },
    ctx,
  );

  assert.equal(mismatched.kind, "blocked");
  assert.equal(mismatched.reason, "unmatched_agent_end");
  assert.equal(sentMessages.length, 1);

  await workflow.handleAgentEnd(
    {
      messages: [
        { role: "user", content: [{ type: "text", text: sentMessages[0] }] },
        { role: "assistant", content: [{ type: "text", text: "finder-report" }] },
      ],
    },
    ctx,
  );

  assert.equal(sentMessages.length, 2);
  assert.match(sentMessages[1], /SKEPTIC/);
});

test("workflow stops after bounded empty-output retries", async () => {
  const { workflow, ctx, sentMessages, notifications } = createHarness();

  await workflow.handleCommand("", ctx);
  assert.equal(sentMessages.length, 1);

  for (let i = 0; i < 3; i += 1) {
    await workflow.handleAgentEnd(
      { messages: [{ role: "assistant", content: [{ type: "tool_result", text: "nope" }] }] },
      ctx,
    );
  }

  assert.equal(notifications.at(-1)?.level, "info");
  assert.match(notifications.at(-1)?.message ?? "", /stopped: no assistant output/);
});

test("workflow blocks rerun while active", async () => {
  const { workflow, ctx, notifications } = createHarness();

  await workflow.handleCommand("first", ctx);
  await workflow.handleCommand("second", ctx);

  assert.equal(notifications.at(-1)?.level, "warning");
  assert.match(notifications.at(-1)?.message ?? "", /already running/);
});

test("workflow recovers cleanly when sendUserMessage throws", async () => {
  const { workflow, ctx, notifications } = createHarness({ failSendCount: 1 });

  const firstRun = await workflow.handleCommand("", ctx);
  assert.equal(firstRun.kind, "recoverable_error");
  assert.equal(notifications.at(-1)?.level, "error");
  assert.match(notifications.at(-1)?.message ?? "", /failed to send prompt/i);

  const secondRun = await workflow.handleCommand("", ctx);
  assert.equal(secondRun.kind, "ok");
});

test("workflow executes fixer phase with latest arbiter output", async () => {
  const { workflow, ctx, sentMessages, widgets } = createHarness({
    selectChoice: "Execute fixes (secure TDD workflow)",
  });

  await workflow.handleCommand("", ctx);
  await workflow.handleAgentEnd(
    { messages: [{ role: "assistant", content: [{ type: "text", text: "finder-report" }] }] },
    ctx,
  );
  await workflow.handleAgentEnd(
    { messages: [{ role: "assistant", content: [{ type: "text", text: "skeptic-report" }] }] },
    ctx,
  );
  await workflow.handleAgentEnd(
    { messages: [{ role: "assistant", content: [{ type: "text", text: "arbiter-v1" }] }] },
    ctx,
  );

  assert.equal(widgets.at(-1), undefined);
  assert.match(sentMessages.at(-1) ?? "", /FIXER/);
  assert.match(sentMessages.at(-1) ?? "", /arbiter-v1/);
});

test("workflow limits refinement attempts", async () => {
  const { workflow, ctx, notifications } = createHarness({
    selectChoice: "Refine the analysis",
    editorValue: "make it sharper",
  });

  await workflow.handleCommand("", ctx);
  await workflow.handleAgentEnd(
    { messages: [{ role: "assistant", content: [{ type: "text", text: "finder-report" }] }] },
    ctx,
  );
  await workflow.handleAgentEnd(
    { messages: [{ role: "assistant", content: [{ type: "text", text: "skeptic-report" }] }] },
    ctx,
  );

  for (let i = 0; i < 4; i += 1) {
    await workflow.handleAgentEnd(
      { messages: [{ role: "assistant", content: [{ type: "text", text: `arbiter-${i}` }] }] },
      ctx,
    );
  }

  assert.equal(notifications.at(-1)?.level, "info");
  assert.match(notifications.at(-1)?.message ?? "", /cancelled/i);
});

test("analysis phases block write-capable tools and only allow safe bash", async () => {
  const { workflow, ctx } = createHarness();

  await workflow.handleCommand("", ctx);

  const writeResult = await workflow.handleToolCall({ toolName: "Write" });
  const lowerEditResult = await workflow.handleToolCall({ toolName: "edit" });
  const multiEditResult = await workflow.handleToolCall({ toolName: "MultiEdit" });
  const mutatingBashResult = await workflow.handleToolCall({
    toolName: "Bash",
    input: { command: "rm -rf tmp" },
  });
  const readOnlyBashResult = await workflow.handleToolCall({
    toolName: "Bash",
    input: { command: "ls -la" },
  });

  assert.equal(writeResult?.block, true);
  assert.equal(lowerEditResult?.block, true);
  assert.equal(multiEditResult?.block, true);
  assert.deepEqual(mutatingBashResult, {
    block: true,
    reason: "Workflow analysis phase blocked a potentially mutating bash command: rm -rf tmp",
  });
  assert.equal(readOnlyBashResult, undefined);
});

test("loadPrompts loads prompt bundle from a valid directory", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "owasp-fix-prompts-"));
  fs.writeFileSync(path.join(tempDir, "finder.md"), "finder");
  fs.writeFileSync(path.join(tempDir, "skeptic.md"), "skeptic");
  fs.writeFileSync(path.join(tempDir, "arbiter.md"), "arbiter");
  fs.writeFileSync(path.join(tempDir, "fixer.md"), "fixer");

  const result = loadPrompts(tempDir);

  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.prompts.finder, "finder");
  }
});

test("loadPrompts returns structured error when files are missing", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "owasp-fix-prompts-missing-"));
  fs.writeFileSync(path.join(tempDir, "finder.md"), "finder");

  const result = loadPrompts(tempDir);

  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.equal(result.error.code, "PROMPT_READ_FAILED");
    assert.match(result.error.message, /failed to load prompt bundle/);
  }
});

test("buildPrompt includes refinement contract for arbiter mode", () => {
  const prompt = buildPrompt({
    phase: "arbiter",
    prompts: {
      finder: "FINDER",
      skeptic: "SKEPTIC",
      arbiter: "ARBITER",
      fixer: "FIXER",
    },
    reports: {
      finder: "finder-report",
      skeptic: "skeptic-report",
      arbiter: "arbiter-report",
    },
    refinement: "tighten exploit validation",
  });

  assert.match(prompt, /## Existing Arbitration/);
  assert.match(prompt, /arbiter-report/);
  assert.match(prompt, /## Refinement Request/);
  assert.match(prompt, /tighten exploit validation/);
});

test("workflow reports invalid assistant payload instead of retrying as empty output", async () => {
  const { workflow, ctx, sentMessages, notifications } = createHarness();

  await workflow.handleCommand("", ctx);
  assert.equal(sentMessages.length, 1);

  const result = await workflow.handleAgentEnd(
    { messages: [{ role: "assistant", content: "invalid-payload-shape" }] },
    ctx,
  );

  assert.equal(result.kind, "recoverable_error");
  assert.equal(result.reason, "invalid_agent_payload");
  assert.equal(notifications.at(-1)?.level, "error");
  assert.match(notifications.at(-1)?.message ?? "", /invalid assistant payload/i);
});

test("real finder prompt requires repo triage and code-evidenced findings", () => {
  const promptDirectory = path.join(path.dirname(new URL(import.meta.url).pathname), "prompts");
  const loaded = loadPrompts(promptDirectory);

  assert.equal(loaded.ok, true);
  if (!loaded.ok) {
    return;
  }

  assert.match(loaded.prompts.finder, /classify the application or repository type/i);
  assert.match(loaded.prompts.finder, /APPLICABLE or NOT APPLICABLE/i);
  assert.match(loaded.prompts.finder, /No findings is acceptable/i);
  assert.match(loaded.prompts.finder, /exact file, function, handler, route, query, or code path/i);
  assert.match(
    loaded.prompts.finder,
    /attacker-controlled input across the relevant trust boundary to the security-sensitive sink or decision point/i,
  );
  assert.match(
    loaded.prompts.finder,
    /Do not report missing best practices, generic hardening advice, or theoretical weaknesses unless you can show a plausible exploit path in this codebase/i,
  );
  assert.match(loaded.prompts.finder, /Broken Access Control/i);
  assert.match(loaded.prompts.finder, /Security Misconfiguration/i);
  assert.match(loaded.prompts.finder, /Cryptographic Failures/i);
  assert.match(loaded.prompts.finder, /Injection/i);
  assert.match(loaded.prompts.finder, /Insecure Design/i);
  assert.match(loaded.prompts.finder, /Authentication Failures/i);
  assert.match(loaded.prompts.finder, /Software or Data Integrity Failures/i);
  assert.match(loaded.prompts.finder, /Security Logging and Alerting Failures/i);
  assert.match(loaded.prompts.finder, /Mishandling of exceptional conditions/i);
  assert.match(loaded.prompts.finder, /Software Supply Chain Failures/i);
});

test("real skeptic prompt rejects weak security findings", () => {
  const promptDirectory = path.join(path.dirname(new URL(import.meta.url).pathname), "prompts");
  const loaded = loadPrompts(promptDirectory);

  assert.equal(loaded.ok, true);
  if (!loaded.ok) {
    return;
  }

  assert.match(loaded.prompts.skeptic, /hypothetical-only attack path/i);
  assert.match(loaded.prompts.skeptic, /claims that do not involve attacker-controlled input/i);
  assert.match(
    loaded.prompts.skeptic,
    /authorization or authentication findings that do not identify a reachable protected resource or a plausible bypass path/i,
  );
  assert.match(
    loaded.prompts.skeptic,
    /logging, design, or configuration claims inferred only from missing code or missing context/i,
  );
  assert.match(
    loaded.prompts.skeptic,
    /dependency or supply-chain claims without concrete version, usage, or update-path evidence/i,
  );
  assert.match(
    loaded.prompts.skeptic,
    /downgrade severity and confidence when exploitability is weak, partial, or assumption-heavy/i,
  );
});

test("real arbiter prompt requires repo-specific fix-now triage", () => {
  const promptDirectory = path.join(path.dirname(new URL(import.meta.url).pathname), "prompts");
  const loaded = loadPrompts(promptDirectory);

  assert.equal(loaded.ok, true);
  if (!loaded.ok) {
    return;
  }

  assert.match(loaded.prompts.arbiter, /why the OWASP category applies in this repository/i);
  assert.match(loaded.prompts.arbiter, /why the issue is real here and not just a generic weakness/i);
  assert.match(loaded.prompts.arbiter, /exact code path or resource at risk/i);
  assert.match(loaded.prompts.arbiter, /minimal remediation scope/i);
  assert.match(
    loaded.prompts.arbiter,
    /dismiss the finding when the current evidence is not sufficient to justify fixing it now/i,
  );
  assert.match(
    loaded.prompts.arbiter,
    /prioritize by actual risk and evidentiary strength, not by category label alone/i,
  );
});

test("owaspFix command wiring uses real prompt files end-to-end", async () => {
  const commands: Record<string, { handler: (args: unknown, ctx: unknown) => Promise<unknown> }> =
    {};
  const listeners: Record<string, (...args: unknown[]) => Promise<unknown>> = {};
  const sentMessages: string[] = [];

  const api = {
    registerCommand(
      name: string,
      config: { handler: (args: unknown, ctx: unknown) => Promise<unknown> },
    ) {
      commands[name] = config;
    },
    on(name: string, handler: (...args: unknown[]) => Promise<unknown>) {
      listeners[name] = handler;
    },
    sendUserMessage(message: string) {
      sentMessages.push(message);
    },
  };

  const ctx = {
    ui: {
      notify() {},
      setStatus() {},
      setWidget() {},
      async select() {
        return "Cancel";
      },
      async editor() {
        return "";
      },
    },
  };

  owaspFix(api as never);

  await commands["owasp-fix"]?.handler("", ctx as never);
  assert.match(
    sentMessages[0] ?? "",
    /You are a security-finding agent focused on OWASP Top 10 2025 risks/,
  );

  await listeners.agent_end?.(
    { messages: [{ role: "assistant", content: [{ type: "text", text: "finder-report" }] }] },
    ctx,
  );
  assert.match(sentMessages[1] ?? "", /You are an adversarial security reviewer/);
});

test("owaspFix registers only phase-workflow command and event handlers", () => {
  const commands: Record<string, { handler: (args: unknown, ctx: unknown) => Promise<unknown> }> =
    {};
  const listeners: Record<string, (...args: unknown[]) => Promise<unknown>> = {};

  const api = {
    registerCommand(
      name: string,
      config: { handler: (args: unknown, ctx: unknown) => Promise<unknown> },
    ) {
      commands[name] = config;
    },
    on(name: string, handler: (...args: unknown[]) => Promise<unknown>) {
      listeners[name] = handler;
    },
    sendUserMessage() {},
  };

  owaspFix(api as never);

  assert.ok(commands["owasp-fix"]);
  assertPhaseWorkflowListenerSurface(listeners);
});
