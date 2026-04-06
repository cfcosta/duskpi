import { expect, mock, test } from "bun:test";

mock.module("@mariozechner/pi-tui", () => ({
  matchesKey: (data: string, key: string) => data === key,
  truncateToWidth: (text: string, width: number) => {
    if (text.length <= width) {
      return text;
    }

    if (width <= 1) {
      return "…";
    }

    return `${text.slice(0, width - 1)}…`;
  },
}));

const { FullscreenPlanDashboardComponent, renderPlanDashboardLines } = await import(
  "./plan-dashboard-ui"
);

function createTheme() {
  return {
    fg: (_color: string, text: string) => text,
    strikethrough: (text: string) => text,
  };
}

function createTui() {
  return {
    requestRenderCalls: 0,
    requestRender() {
      this.requestRenderCalls += 1;
    },
  };
}

function createSnapshot() {
  return {
    title: "plan dashboard",
    scopeLabel: "/plan",
    stateLabel: "approval",
    summary: "Structured review is ready for approval.",
    taskGeometry: "shared_artifact",
    coordinationPattern: "checkpointed_execution",
    assumptions: [
      "Only valid tagged JSON should render.",
      "The dashboard replaces the old widget surface.",
    ],
    checkpoints: ["Repo-local shortcut API exposed (checkpoint)"],
    dependencies: ["2 ← 1", "3 ← 2"],
    badges: ["compact steps", "validation noted"],
    critiqueSummary: "Looks ready after the latest refinement.",
    steps: [
      {
        step: 1,
        label: "Expose registerShortcut in workflow-core",
        kind: "implement",
        status: "done",
        targets: ["packages/workflow-core/src/extension-api.ts"],
        validation: ["bun test ./src/register-guided-workflow-extension.test.ts"],
        checkpoints: ["Repo-local shortcut API exposed (checkpoint)"],
      },
      {
        step: 2,
        label: "Upgrade the plan test harness for rich widgets",
        kind: "implement",
        status: "pending",
        targets: ["extensions/plan/src/index.test.ts"],
        validation: ["bun test ./src/index.test.ts"],
        dependsOn: [1],
      },
      {
        step: 3,
        label: "Create the structured plan dashboard component",
        kind: "implement",
        status: "skipped",
        targets: ["extensions/plan/src/plan-dashboard-ui.ts"],
        validation: ["bun test ./src/plan-dashboard-ui.test.ts"],
        risks: ["One renderer may blur distinct dashboard states."],
        dependsOn: [2],
      },
    ],
  };
}

test("renderPlanDashboardLines renders a compact dashboard summary", () => {
  const lines = renderPlanDashboardLines(createSnapshot(), "compact", 120, createTheme() as never);

  expect(lines.join("\n")).toContain("📋 plan dashboard approval • 2/3");
  expect(lines.join("\n")).toContain("shared_artifact • checkpointed_execution");
  expect(lines.join("\n")).toContain("Structured review is ready for approval.");
  expect(lines.join("\n")).toContain("☐ 2. Upgrade the plan test harness for rich widgets");
});

test("renderPlanDashboardLines renders expanded dashboard metadata and step details", () => {
  const lines = renderPlanDashboardLines(createSnapshot(), "expanded", 140, createTheme() as never);
  const rendered = lines.join("\n");

  expect(rendered).toContain("State: approval • 2/3 complete");
  expect(rendered).toContain("Scope: /plan");
  expect(rendered).toContain("Strategy: shared_artifact • checkpointed_execution");
  expect(rendered).toContain("Assumptions: Only valid tagged JSON should render., The dashboard replaces the old widget surface.");
  expect(rendered).toContain("Checkpoints: Repo-local shortcut API exposed (checkpoint)");
  expect(rendered).toContain("Dependencies: 2 ← 1, 3 ← 2");
  expect(rendered).toContain("Badges: compact steps, validation noted");
  expect(rendered).toContain("Critique: Looks ready after the latest refinement.");
  expect(rendered).toContain("☑ 1. Expose registerShortcut in workflow-core");
  expect(rendered).toContain("☐ 2. Upgrade the plan test harness for rich widgets");
  expect(rendered).toContain("↷ 3. Create the structured plan dashboard component");
  expect(rendered).toContain("files: extensions/plan/src/index.test.ts");
  expect(rendered).toContain("validate: bun test ./src/plan-dashboard-ui.test.ts");
  expect(rendered).toContain("risks: One renderer may blur distinct dashboard states.");
});

test("renderPlanDashboardLines truncates narrow compact output", () => {
  const lines = renderPlanDashboardLines(createSnapshot(), "compact", 30, createTheme() as never);

  expect(lines.some((line) => line.includes("…"))).toBe(true);
});

test("renderPlanDashboardLines omits the inline header for fullscreen mode", () => {
  const lines = renderPlanDashboardLines(createSnapshot(), "fullscreen", 120, createTheme() as never);

  expect(lines[0]).toContain("State: approval • 2/3 complete");
  expect(lines.join("\n")).not.toContain("─── plan dashboard ");
});

test("FullscreenPlanDashboardComponent caches by width and scrolls content", () => {
  const tui = createTui();
  const component = new FullscreenPlanDashboardComponent(
    tui as never,
    createTheme() as never,
    {
      ...createSnapshot(),
      steps: Array.from({ length: 10 }, (_value, index) => ({
        step: index + 1,
        label: `Task ${index + 1} for fullscreen scrolling`,
        status: index < 2 ? "done" : "pending",
      })),
    },
    { viewportRows: 4 },
  );

  const first = component.render(80);
  const second = component.render(80);
  expect(second).toBe(first);
  expect(first.at(-1)).toContain("scroll • esc close");

  component.handleInput("j");

  const afterScroll = component.render(80);
  expect(afterScroll).not.toBe(first);
  expect(afterScroll.at(-1)).toContain("2-5/");
  expect(tui.requestRenderCalls).toBe(1);
});

test("FullscreenPlanDashboardComponent closes on escape", () => {
  const tui = createTui();
  let closed = 0;
  const component = new FullscreenPlanDashboardComponent(
    tui as never,
    createTheme() as never,
    createSnapshot(),
    {
      viewportRows: 5,
      onClose() {
        closed += 1;
      },
    },
  );

  component.handleInput("escape");

  expect(closed).toBe(1);
  expect(tui.requestRenderCalls).toBe(0);
});
