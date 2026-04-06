import type { ExtensionUIContext } from "@mariozechner/pi-coding-agent";
import {
  Editor,
  type EditorTheme,
  Key,
  matchesKey,
  type TUI,
  truncateToWidth,
} from "@mariozechner/pi-tui";

export type PlanNextAction = "approve" | "continue" | "regenerate" | "exit";

export interface PlanApprovalPreviewStep {
  step: number;
  label: string;
  targetsSummary?: string;
  validationSummary?: string;
  dependsOnSummary?: string;
  checkpointsSummary?: string;
}

export interface PlanApprovalDetails {
  stepCount: number;
  previewSteps: PlanApprovalPreviewStep[];
  strategySummary?: string;
  assumptionsSummary?: string;
  dependenciesSummary?: string;
  checkpointsSummary?: string;
  critiqueSummary?: string;
  badges?: string[];
  wasRevised?: boolean;
}

export interface PlanNextActionResult {
  cancelled: boolean;
  action?: PlanNextAction;
  note?: string;
}

type PlanActionTheme = ExtensionUIContext["theme"];

type PlanActionDone = (result: PlanNextActionResult) => void;

const ACTION_OPTIONS: ReadonlyArray<{ label: string; value: PlanNextAction }> = [
  { label: "Approve and execute now", value: "approve" },
  { label: "Continue from proposed plan", value: "continue" },
  { label: "Regenerate plan", value: "regenerate" },
  { label: "Exit plan mode", value: "exit" },
];

const EDITABLE_ACTIONS = new Set<PlanNextAction>(["approve", "continue"]);

const ACTION_DESCRIPTIONS: Record<PlanNextAction, string> = {
  approve:
    "Next: exit read-only mode, restore normal tools, start the first open step, and enforce one jj commit for that step.",
  continue:
    "Next: stay in read-only mode and refine the proposed plan. Add an optional note to narrow scope or request changes.",
  regenerate:
    "Next: discard the tracked draft review state and ask Pi to rebuild the full plan from scratch.",
  exit: "Next: leave plan mode without execution and clear the current tracked planning progress.",
};

function normalizeNote(input: string): string {
  return input.replace(/\s+/g, " ").trim();
}

function truncateInline(text: string, maxLength: number): string {
  if (text.length <= maxLength) {
    return text;
  }

  if (maxLength <= 1) {
    return "…";
  }

  return `${text.slice(0, maxLength - 1)}…`;
}

function buildActionOptionLabel(
  baseLabel: string,
  note: string,
  isEditing: boolean,
  maxLength: number,
): string {
  const normalized = normalizeNote(note);
  if (normalized.length === 0 && !isEditing) {
    return baseLabel;
  }

  const suffix = isEditing ? `${normalized}▍` : normalized;
  return truncateInline(`${baseLabel} — note: ${suffix}`, maxLength);
}

function isPlainKey(data: string, key: string): boolean {
  return data.length === 1 && data.toLowerCase() === key;
}

export class PlanActionComponent {
  private cursorIndex = 0;
  private editingAction: PlanNextAction | undefined;
  private notesByAction: Partial<Record<PlanNextAction, string>> = {};
  private cachedWidth: number | undefined;
  private cachedRenderedLines: string[] | undefined;
  private readonly noteEditor: Editor;
  private _focused = false;

  constructor(
    private readonly tui: TUI,
    private readonly theme: PlanActionTheme,
    private readonly done: PlanActionDone,
    private readonly details?: PlanApprovalDetails,
  ) {
    const editorTheme: EditorTheme = {
      borderColor: (text) => theme.fg("accent", text),
      selectList: {
        selectedPrefix: (text) => theme.fg("accent", text),
        selectedText: (text) => theme.fg("accent", text),
        description: (text) => theme.fg("muted", text),
        scrollInfo: (text) => theme.fg("dim", text),
        noMatch: (text) => theme.fg("warning", text),
      },
    };

    this.noteEditor = new Editor(tui, editorTheme);
    this.noteEditor.onChange = (value) => {
      if (!this.editingAction) {
        return;
      }

      this.notesByAction = { ...this.notesByAction, [this.editingAction]: value };
      this.requestUiRerender();
    };

    this.noteEditor.onSubmit = (value) => {
      if (!this.editingAction) {
        return;
      }

      const action = this.editingAction;
      this.notesByAction = { ...this.notesByAction, [action]: value };
      const normalized = this.getNormalizedNote(action);
      if (normalized.length === 0) {
        this.editingAction = undefined;
        this.requestUiRerender();
        return;
      }

      this.done({
        cancelled: false,
        action,
        note: normalized,
      });
    };
  }

  get focused(): boolean {
    return this._focused;
  }

  set focused(value: boolean) {
    this._focused = value;
    this.noteEditor.focused = value;
  }

  render(width: number): string[] {
    if (this.cachedRenderedLines && this.cachedWidth === width) {
      return this.cachedRenderedLines;
    }

    const renderedLines: string[] = [];
    const addLine = (line = "") => renderedLines.push(truncateToWidth(line, width));

    addLine(this.theme.fg("accent", "─".repeat(width)));
    addLine(this.theme.fg("text", " Plan mode: next action"));
    addLine();

    if (this.details) {
      addLine(
        this.theme.fg(
          "muted",
          ` Review summary • ${this.details.stepCount} step${this.details.stepCount === 1 ? "" : "s"}`,
        ),
      );
      if (this.details.strategySummary) {
        addLine(this.theme.fg("dim", ` Strategy: ${this.details.strategySummary}`));
      }
      if (this.details.dependenciesSummary) {
        addLine(this.theme.fg("dim", ` Dependencies: ${this.details.dependenciesSummary}`));
      }
      if (this.details.checkpointsSummary) {
        addLine(this.theme.fg("dim", ` Checkpoints: ${this.details.checkpointsSummary}`));
      }
      if (this.details.assumptionsSummary) {
        addLine(this.theme.fg("dim", ` Assumptions: ${this.details.assumptionsSummary}`));
      }
      for (const step of this.details.previewSteps.slice(0, 3)) {
        addLine(this.theme.fg("text", `  • ${step.step}. ${step.label}`));
        if (step.targetsSummary) {
          addLine(this.theme.fg("dim", `    files: ${step.targetsSummary}`));
        }
        if (step.validationSummary) {
          addLine(this.theme.fg("dim", `    validate: ${step.validationSummary}`));
        }
        if (step.dependsOnSummary) {
          addLine(this.theme.fg("dim", `    depends on: ${step.dependsOnSummary}`));
        }
        if (step.checkpointsSummary) {
          addLine(this.theme.fg("dim", `    checkpoints: ${step.checkpointsSummary}`));
        }
      }
      if (this.details.previewSteps.length === 0) {
        addLine(this.theme.fg("dim", "  • No extracted steps available"));
      }

      const badges = [
        ...(this.details.wasRevised ? ["revised after critique"] : []),
        ...(this.details.badges ?? []),
      ];
      if (badges.length > 0) {
        addLine(this.theme.fg("dim", ` Badges: ${badges.join(" • ")}`));
      }
      if (this.details.critiqueSummary) {
        addLine(this.theme.fg("dim", ` Critique: ${this.details.critiqueSummary}`));
      }
      addLine();
    }

    const maxInlineLabelLength = Math.max(20, width - 8);
    for (let optionIndex = 0; optionIndex < ACTION_OPTIONS.length; optionIndex++) {
      const option = ACTION_OPTIONS[optionIndex];
      const isCursorOption = optionIndex === this.cursorIndex;
      const isEditingThisOption = this.editingAction === option.value && isCursorOption;
      const optionLabel = EDITABLE_ACTIONS.has(option.value)
        ? buildActionOptionLabel(
            option.label,
            this.notesByAction[option.value] ?? "",
            isEditingThisOption,
            maxInlineLabelLength,
          )
        : option.label;
      const cursorPrefix = isCursorOption ? this.theme.fg("accent", "→ ") : "  ";
      const bullet = isCursorOption ? "●" : "○";
      const optionColor = isCursorOption ? "accent" : "text";
      addLine(`${cursorPrefix}${this.theme.fg(optionColor, `${bullet} ${optionLabel}`)}`);
    }

    addLine();
    addLine(this.theme.fg("dim", ` ${ACTION_DESCRIPTIONS[this.getSelectedAction()]}`));
    addLine();

    if (this.editingAction) {
      addLine(this.theme.fg("dim", " Typing note inline • Enter submit • Tab/Esc stop editing"));
    } else if (EDITABLE_ACTIONS.has(this.getSelectedAction())) {
      const selectedAction = this.getSelectedAction();
      const actionVerb =
        this.getNormalizedNote(selectedAction).length > 0 ? "edit note" : "add note";
      addLine(
        this.theme.fg(
          "dim",
          " ↑↓ move • Enter select • A/C/R/X quick actions • E or Tab " +
            actionVerb +
            " • Esc cancel",
        ),
      );
    } else {
      addLine(this.theme.fg("dim", " ↑↓ move • Enter select • A/C/R/X quick actions • Esc cancel"));
    }

    addLine(this.theme.fg("accent", "─".repeat(width)));
    this.cachedWidth = width;
    this.cachedRenderedLines = renderedLines;
    return renderedLines;
  }

  handleInput(data: string): void {
    if (this.editingAction) {
      if (matchesKey(data, Key.tab) || matchesKey(data, Key.escape)) {
        this.editingAction = undefined;
        this.requestUiRerender();
        return;
      }
      this.noteEditor.handleInput(data);
      this.requestUiRerender();
      return;
    }

    if (matchesKey(data, Key.up) || isPlainKey(data, "k")) {
      this.cursorIndex = Math.max(0, this.cursorIndex - 1);
      this.requestUiRerender();
      return;
    }

    if (matchesKey(data, Key.down) || isPlainKey(data, "j")) {
      this.cursorIndex = Math.min(ACTION_OPTIONS.length - 1, this.cursorIndex + 1);
      this.requestUiRerender();
      return;
    }

    if (matchesKey(data, Key.tab) || isPlainKey(data, "e")) {
      this.openNoteEditor(this.getSelectedAction());
      return;
    }

    const quickAction = isPlainKey(data, "a")
      ? "approve"
      : isPlainKey(data, "c")
        ? "continue"
        : isPlainKey(data, "r")
          ? "regenerate"
          : isPlainKey(data, "x")
            ? "exit"
            : undefined;
    if (quickAction) {
      this.done({
        cancelled: false,
        action: quickAction,
        note: EDITABLE_ACTIONS.has(quickAction)
          ? this.getNormalizedNote(quickAction) || undefined
          : undefined,
      });
      return;
    }

    if (matchesKey(data, Key.enter)) {
      const selected = this.getSelectedAction();
      this.done({
        cancelled: false,
        action: selected,
        note: EDITABLE_ACTIONS.has(selected)
          ? this.getNormalizedNote(selected) || undefined
          : undefined,
      });
      return;
    }

    if (matchesKey(data, Key.escape)) {
      this.done({ cancelled: true });
    }
  }

  invalidate(): void {
    this.cachedWidth = undefined;
    this.cachedRenderedLines = undefined;
  }

  private requestUiRerender(): void {
    this.invalidate();
    this.tui.requestRender();
  }

  private getSelectedAction(): PlanNextAction {
    return ACTION_OPTIONS[this.cursorIndex]?.value ?? "approve";
  }

  private getNormalizedNote(action: PlanNextAction): string {
    return normalizeNote(this.notesByAction[action] ?? "");
  }

  private openNoteEditor(action: PlanNextAction): void {
    if (!EDITABLE_ACTIONS.has(action)) {
      return;
    }
    this.editingAction = action;
    this.noteEditor.setText(this.notesByAction[action] ?? "");
    this.requestUiRerender();
  }
}

export async function selectPlanNextActionWithInlineNote(
  ui: ExtensionUIContext,
  details?: PlanApprovalDetails,
): Promise<PlanNextActionResult> {
  return ui.custom<PlanNextActionResult>((tui, theme, _keybindings, done) => {
    return new PlanActionComponent(tui as TUI, theme, done, details);
  });
}
