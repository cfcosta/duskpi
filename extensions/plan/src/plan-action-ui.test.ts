import { expect, mock, test } from "bun:test";

mock.module("@mariozechner/pi-tui", () => ({
  Editor: class {
    focused = false;
    onChange?: (value: string) => void;
    onSubmit?: (value: string) => void;
    private text = "";

    constructor(..._args: unknown[]) {}

    setText(value: string) {
      this.text = value;
      this.onChange?.(value);
    }

    handleInput(data: string) {
      if (data.startsWith("submit:")) {
        this.text = data.slice("submit:".length);
        this.onChange?.(this.text);
        this.onSubmit?.(this.text);
      }
    }

    render(_width: number) {
      return [this.text];
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
  wrapTextWithAnsi: (text: string) => [text],
}));

const { PlanActionComponent, selectPlanNextActionWithInlineNote } =
  await import("./plan-action-ui");

type PlanNextActionResult = Awaited<ReturnType<typeof selectPlanNextActionWithInlineNote>>;

type PlanApprovalDetails = ConstructorParameters<typeof PlanActionComponent>[3];

function createTheme() {
  return {
    fg: (_color: string, text: string) => text,
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

function createApprovalDetails(): NonNullable<PlanApprovalDetails> {
  return {
    stepCount: 3,
    strategySummary: "shared_artifact • checkpointed_execution",
    assumptionsSummary:
      "The stored metadata stays canonical through approval and execution prompt generation.",
    dependenciesSummary: "2 dependency edges across steps 2 and 3",
    checkpointsSummary: "metadata capture checkpoint, approval integration checkpoint",
    previewSteps: [
      {
        step: 1,
        label:
          "A very long regression test for prompt leakage in the guided workflow approval surface",
        targetsSummary: "src/index.test.ts, src/workflow.ts, src/plan-action-ui.ts",
        validationSummary: "bun test ./src/index.test.ts, bun run typecheck",
        dependsOnSummary: "none",
        checkpointsSummary: "metadata capture checkpoint",
      },
    ],
    critiqueSummary: "Needs a concise but still fairly long summary to exercise truncation.",
    badges: ["compact steps", "validation noted", "rollback noted"],
    wasRevised: true,
  };
}

async function runSelectionSimulation(
  simulate: (component: InstanceType<typeof PlanActionComponent>) => void,
  details?: NonNullable<PlanApprovalDetails>,
): Promise<PlanNextActionResult> {
  const ui = {
    async custom<T>(
      factory: (
        tui: unknown,
        theme: ReturnType<typeof createTheme>,
        keybindings: unknown,
        done: (result: T) => void,
      ) => unknown,
    ): Promise<T> {
      const tui = createTui();
      const theme = createTheme();
      let resolved!: T;
      const component = factory(tui, theme, {}, (result) => {
        resolved = result;
      }) as InstanceType<typeof PlanActionComponent>;
      simulate(component);
      return resolved;
    },
  };

  return selectPlanNextActionWithInlineNote(ui as never, details);
}

test("PlanActionComponent caches rendered output per width", () => {
  const component = new PlanActionComponent(
    createTui() as never,
    createTheme() as never,
    () => {},
    createApprovalDetails(),
  );

  const wideFirst = component.render(100);
  const wideSecond = component.render(100);
  const narrow = component.render(40);

  expect(wideSecond).toBe(wideFirst);
  expect(wideFirst.join("\n")).toContain("Review summary • 3 steps");
  expect(wideFirst.join("\n")).toContain("Strategy: shared_artifact • checkpointed_execution");
  expect(wideFirst.join("\n")).toContain("Dependencies: 2 dependency edges across steps 2 and 3");
  expect(wideFirst.join("\n")).toContain("Checkpoints: metadata capture checkpoint, approval integration checkpoint");
  expect(wideFirst.join("\n")).toContain("Assumptions: The stored metadata stays canonical through approval and execution prompt generation.");
  expect(wideFirst.join("\n")).toContain("depends on: none");
  expect(wideFirst.join("\n")).toContain("checkpoints: metadata capture checkpoint");
  expect(narrow).not.toBe(wideFirst);
  expect(narrow.join("\n")).not.toEqual(wideFirst.join("\n"));
  expect(narrow.some((line) => line.includes("…"))).toBe(true);
});

test("selectPlanNextActionWithInlineNote returns approve on default enter", async () => {
  const result = await runSelectionSimulation((component) => {
    component.handleInput("enter");
  });

  expect(result).toEqual({
    cancelled: false,
    action: "approve",
    note: undefined,
  });
});

test("selectPlanNextActionWithInlineNote preserves continue selection payloads", async () => {
  const result = await runSelectionSimulation((component) => {
    component.handleInput("down");
    component.handleInput("enter");
  });

  expect(result).toEqual({
    cancelled: false,
    action: "continue",
    note: undefined,
  });
});

test("selectPlanNextActionWithInlineNote preserves quick-action payloads", async () => {
  const result = await runSelectionSimulation((component) => {
    component.handleInput("r");
  });

  expect(result).toEqual({
    cancelled: false,
    action: "regenerate",
    note: undefined,
  });
});

test("PlanActionComponent forwards focus state to the nested editor", () => {
  const component = new PlanActionComponent(
    createTui() as never,
    createTheme() as never,
    () => {},
    createApprovalDetails(),
  );

  const editor = (component as unknown as { noteEditor: { focused: boolean } }).noteEditor;

  component.focused = true;
  expect(editor.focused).toBe(true);

  component.focused = false;
  expect(editor.focused).toBe(false);
});

test("selectPlanNextActionWithInlineNote preserves inline note submission payloads after focus propagation", async () => {
  const result = await runSelectionSimulation((component) => {
    component.focused = true;
    component.handleInput("tab");
    component.handleInput("submit:  keep keyboard flow fast  ");
  });

  expect(result).toEqual({
    cancelled: false,
    action: "approve",
    note: "keep keyboard flow fast",
  });
});
