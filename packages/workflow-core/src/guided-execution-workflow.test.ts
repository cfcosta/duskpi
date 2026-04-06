import test from "node:test";
import assert from "node:assert/strict";
import {
  GuidedExecutionWorkflow,
  type GuidedExecutionWorkflowOptions,
} from "./guided-execution-workflow";
import type {
  ExtensionAPI,
  ExtensionContext,
  ExtensionTheme,
  ExtensionUICustomFactory,
} from "./index";

interface TestExecutionUnit {
  id: string;
  title: string;
  dependsOn: string[];
}

function createContext() {
  const notifications: Array<{ level: string; message: string }> = [];
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
      notify(message: string, level = "info") {
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

  return { ctx, notifications };
}

function createApi() {
  const sentUserMessages: string[] = [];
  const sentCustomMessages: Array<{
    customType?: string;
    content?: unknown;
    display?: boolean;
    triggerTurn?: boolean;
    deliverAs?: string;
  }> = [];

  const api: ExtensionAPI = {
    sendMessage(message, options) {
      sentCustomMessages.push({
        customType: message.customType,
        content: message.content,
        display: message.display,
        triggerTurn: options?.triggerTurn,
        deliverAs: options?.deliverAs,
      });
    },
    sendUserMessage(message) {
      if (typeof message !== "string") {
        throw new Error("GuidedExecutionWorkflow tests expect string prompts");
      }
      sentUserMessages.push(message);
    },
    async exec() {
      return { stdout: "", stderr: "", code: 0, killed: false };
    },
    registerCommand() {},
    registerMessageRenderer() {},
    registerTool() {},
    registerShortcut() {},
    getActiveTools() {
      return ["read", "bash"];
    },
    getAllTools() {
      return [];
    },
    setActiveTools() {},
    on() {},
  };

  return { api, sentUserMessages, sentCustomMessages };
}

function buildWorkflowOptions(
  overrides: Partial<GuidedExecutionWorkflowOptions<TestExecutionUnit>> = {},
): GuidedExecutionWorkflowOptions<TestExecutionUnit> {
  return {
    id: "guided-execution-test",
    buildPlanningPrompt: ({ goal }) => (goal ? `Plan for ${goal}` : "Plan for current task"),
    approval: {
      async selectAction() {
        return { action: "approve" };
      },
    },
    execution: {
      parseApprovedPlan() {
        return {
          ok: true as const,
          approvedPlanSummary: "Approved execution plan.",
          executionUnits: [
            {
              id: "guided-shell",
              title: "Adopt GuidedWorkflow",
              dependsOn: [],
            },
          ],
        };
      },
      formatExecutionItemText(executionUnit) {
        return `${executionUnit.id}: ${executionUnit.title}`;
      },
      buildExecutionUnitPrompt({ executionUnit }) {
        return `EXECUTE ${executionUnit.id}`;
      },
      buildExecutionRunResultPrompt({ result }) {
        return `RUN RESULT ${result.summary}`;
      },
      buildExecutionSchedulePrompt({ schedule }) {
        return `SCHEDULE RESULT ${schedule.status}`;
      },
      executor: {
        async executeUnit({ executionUnit }) {
          return {
            unitId: executionUnit.id,
            status: "completed" as const,
            summary: `Integrated ${executionUnit.id}`,
            changedFiles: [executionUnit.title],
            validations: [],
          };
        },
      },
    },
    text: {
      alreadyRunning: "already running",
    },
    ...overrides,
  };
}

function textMessage(text: string) {
  return { role: "assistant", content: [{ type: "text", text }] };
}

test("GuidedExecutionWorkflow executes a single approved unit and surfaces the run-result prompt", async () => {
  const { api, sentUserMessages } = createApi();
  const { ctx } = createContext();
  const executeCalls: Array<{ id: string; step?: number; totalSteps?: number; summary?: string }> =
    [];

  const workflow = new GuidedExecutionWorkflow(
    api,
    buildWorkflowOptions({
      execution: {
        ...buildWorkflowOptions().execution,
        executor: {
          async executeUnit({ executionUnit, step, totalSteps, approvedPlanSummary }) {
            executeCalls.push({
              id: executionUnit.id,
              step,
              totalSteps,
              summary: approvedPlanSummary,
            });
            return {
              unitId: executionUnit.id,
              status: "completed" as const,
              summary: `Integrated ${executionUnit.id}`,
              changedFiles: [executionUnit.title],
              validations: [],
            };
          },
        },
      },
    }),
  );

  await workflow.handleCommand("scope", ctx);
  const result = await workflow.handleAgentEnd(
    {
      messages: [
        { role: "user", content: [{ type: "text", text: sentUserMessages[0]! }] },
        textMessage("approved-plan-text"),
      ],
    },
    ctx,
  );

  assert.deepEqual(result, { kind: "ok" });
  assert.deepEqual(executeCalls, [
    { id: "guided-shell", step: 1, totalSteps: 1, summary: "Approved execution plan." },
  ]);
  assert.deepEqual(workflow.getStateSnapshot(), {
    phase: "executing",
    goal: undefined,
    pendingRequestId: undefined,
    awaitingResponse: false,
  });
  assert.deepEqual(
    workflow.getExecutionSnapshot().items.map((item) => item.text),
    ["guided-shell: Adopt GuidedWorkflow"],
  );
  assert.equal(sentUserMessages.at(-1), "RUN RESULT Integrated guided-shell");
});

test("GuidedExecutionWorkflow uses the shared scheduler path for multi-unit plans", async () => {
  const { api, sentUserMessages } = createApi();
  const { ctx } = createContext();
  const executeCalls: Array<{ id: string; step?: number; totalSteps?: number }> = [];

  const workflow = new GuidedExecutionWorkflow(
    api,
    buildWorkflowOptions({
      execution: {
        ...buildWorkflowOptions().execution,
        parseApprovedPlan() {
          return {
            ok: true as const,
            approvedPlanSummary: "Approved execution plan.",
            executionUnits: [
              { id: "unit-a", title: "Unit A", dependsOn: [] },
              { id: "unit-b", title: "Unit B", dependsOn: [] },
            ],
          };
        },
        formatExecutionItemText(executionUnit) {
          return `${executionUnit.id}: ${executionUnit.title}`;
        },
        buildExecutionSchedulePrompt({ schedule, executionUnits }) {
          return `SCHEDULE RESULT ${schedule.status} ${executionUnits.map((unit) => unit.id).join(",")}`;
        },
        executor: {
          async executeUnit({ executionUnit, step, totalSteps }) {
            executeCalls.push({ id: executionUnit.id, step, totalSteps });
            return {
              unitId: executionUnit.id,
              status: "completed" as const,
              summary: `Integrated ${executionUnit.id}`,
              changedFiles: [executionUnit.title],
              validations: [],
            };
          },
        },
      },
    }),
  );

  await workflow.handleCommand("scope", ctx);
  await workflow.handleAgentEnd(
    {
      messages: [
        { role: "user", content: [{ type: "text", text: sentUserMessages[0]! }] },
        textMessage("approved-plan-text"),
      ],
    },
    ctx,
  );

  assert.deepEqual(executeCalls, [
    { id: "unit-a", step: 1, totalSteps: 2 },
    { id: "unit-b", step: 2, totalSteps: 2 },
  ]);
  assert.deepEqual(
    workflow.getExecutionSnapshot().items.map((item) => item.text),
    ["unit-a: Unit A", "unit-b: Unit B"],
  );
  assert.equal(sentUserMessages.at(-1), "SCHEDULE RESULT completed unit-a,unit-b");
});

test("GuidedExecutionWorkflow reports parse failures as the execution prompt when the approved plan is invalid", async () => {
  const { api, sentUserMessages } = createApi();
  const { ctx } = createContext();

  const workflow = new GuidedExecutionWorkflow(
    api,
    buildWorkflowOptions({
      execution: {
        ...buildWorkflowOptions().execution,
        parseApprovedPlan() {
          return { ok: false as const, message: "Approved plan could not be parsed." };
        },
      },
    }),
  );

  await workflow.handleCommand("scope", ctx);
  await workflow.handleAgentEnd(
    {
      messages: [
        { role: "user", content: [{ type: "text", text: sentUserMessages[0]! }] },
        textMessage("bad-plan-text"),
      ],
    },
    ctx,
  );

  assert.deepEqual(workflow.getExecutionSnapshot().items, []);
  assert.equal(sentUserMessages.length, 1);
});
