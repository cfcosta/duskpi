import type { ExtensionUIContext } from "@mariozechner/pi-coding-agent";
import { Editor, type EditorTheme, Key, matchesKey, truncateToWidth } from "@mariozechner/pi-tui";

export type PlanNextAction = "approve" | "continue" | "regenerate" | "exit";

export interface PlanApprovalPreviewStep {
  step: number;
  label: string;
  targetsSummary?: string;
  validationSummary?: string;
}

export interface PlanApprovalDetails {
  stepCount: number;
  previewSteps: PlanApprovalPreviewStep[];
  critiqueSummary?: string;
  badges?: string[];
  wasRevised?: boolean;
}

export interface PlanNextActionResult {
  cancelled: boolean;
  action?: PlanNextAction;
  note?: string;
}

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

export async function selectPlanNextActionWithInlineNote(
  ui: ExtensionUIContext,
  details?: PlanApprovalDetails,
): Promise<PlanNextActionResult> {
  return ui.custom<PlanNextActionResult>((tui, theme, _keybindings, done) => {
    let cursorIndex = 0;
    let editingAction: PlanNextAction | undefined;
    let notesByAction: Partial<Record<PlanNextAction, string>> = {};
    let cachedRenderedLines: string[] | undefined;

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
    const noteEditor = new Editor(tui, editorTheme);

    const requestUiRerender = () => {
      cachedRenderedLines = undefined;
      tui.requestRender();
    };

    const getSelectedAction = (): PlanNextAction => ACTION_OPTIONS[cursorIndex]?.value ?? "approve";

    const getNormalizedNote = (action: PlanNextAction): string =>
      normalizeNote(notesByAction[action] ?? "");

    const openNoteEditor = (action: PlanNextAction) => {
      if (!EDITABLE_ACTIONS.has(action)) {
        return;
      }
      editingAction = action;
      noteEditor.setText(notesByAction[action] ?? "");
      requestUiRerender();
    };

    noteEditor.onChange = (value) => {
      if (!editingAction) {
        return;
      }
      notesByAction = { ...notesByAction, [editingAction]: value };
      requestUiRerender();
    };

    noteEditor.onSubmit = (value) => {
      if (!editingAction) {
        return;
      }

      const action = editingAction;
      notesByAction = { ...notesByAction, [action]: value };
      const normalized = getNormalizedNote(action);
      if (normalized.length === 0) {
        editingAction = undefined;
        requestUiRerender();
        return;
      }

      done({
        cancelled: false,
        action,
        note: normalized,
      });
    };

    const render = (width: number): string[] => {
      if (cachedRenderedLines) {
        return cachedRenderedLines;
      }

      const renderedLines: string[] = [];
      const addLine = (line = "") => renderedLines.push(truncateToWidth(line, width));

      addLine(theme.fg("accent", "─".repeat(width)));
      addLine(theme.fg("text", " Plan mode: next action"));
      addLine();

      if (details) {
        addLine(
          theme.fg(
            "muted",
            ` Review summary • ${details.stepCount} step${details.stepCount === 1 ? "" : "s"}`,
          ),
        );
        for (const step of details.previewSteps.slice(0, 3)) {
          addLine(theme.fg("text", `  • ${step.step}. ${step.label}`));
          if (step.targetsSummary) {
            addLine(theme.fg("dim", `    files: ${step.targetsSummary}`));
          }
          if (step.validationSummary) {
            addLine(theme.fg("dim", `    validate: ${step.validationSummary}`));
          }
        }
        if (details.previewSteps.length === 0) {
          addLine(theme.fg("dim", "  • No extracted steps available"));
        }

        const badges = [
          ...(details.wasRevised ? ["revised after critique"] : []),
          ...(details.badges ?? []),
        ];
        if (badges.length > 0) {
          addLine(theme.fg("dim", ` Badges: ${badges.join(" • ")}`));
        }
        if (details.critiqueSummary) {
          addLine(theme.fg("dim", ` Critique: ${details.critiqueSummary}`));
        }
        addLine();
      }

      const maxInlineLabelLength = Math.max(20, width - 8);
      for (let optionIndex = 0; optionIndex < ACTION_OPTIONS.length; optionIndex++) {
        const option = ACTION_OPTIONS[optionIndex];
        const isCursorOption = optionIndex === cursorIndex;
        const isEditingThisOption = editingAction === option.value && isCursorOption;
        const optionLabel = EDITABLE_ACTIONS.has(option.value)
          ? buildActionOptionLabel(
              option.label,
              notesByAction[option.value] ?? "",
              isEditingThisOption,
              maxInlineLabelLength,
            )
          : option.label;
        const cursorPrefix = isCursorOption ? theme.fg("accent", "→ ") : "  ";
        const bullet = isCursorOption ? "●" : "○";
        const optionColor = isCursorOption ? "accent" : "text";
        addLine(`${cursorPrefix}${theme.fg(optionColor, `${bullet} ${optionLabel}`)}`);
      }

      addLine();
      addLine(theme.fg("dim", ` ${ACTION_DESCRIPTIONS[getSelectedAction()]}`));
      addLine();

      if (editingAction) {
        addLine(theme.fg("dim", " Typing note inline • Enter submit • Tab/Esc stop editing"));
      } else if (EDITABLE_ACTIONS.has(getSelectedAction())) {
        const selectedAction = getSelectedAction();
        const actionVerb = getNormalizedNote(selectedAction).length > 0 ? "edit note" : "add note";
        addLine(
          theme.fg(
            "dim",
            " ↑↓ move • Enter select • A/C/R/X quick actions • E or Tab " +
              actionVerb +
              " • Esc cancel",
          ),
        );
      } else {
        addLine(theme.fg("dim", " ↑↓ move • Enter select • A/C/R/X quick actions • Esc cancel"));
      }

      addLine(theme.fg("accent", "─".repeat(width)));
      cachedRenderedLines = renderedLines;
      return renderedLines;
    };

    const handleInput = (data: string) => {
      if (editingAction) {
        if (matchesKey(data, Key.tab) || matchesKey(data, Key.escape)) {
          editingAction = undefined;
          requestUiRerender();
          return;
        }
        noteEditor.handleInput(data);
        requestUiRerender();
        return;
      }

      if (matchesKey(data, Key.up) || isPlainKey(data, "k")) {
        cursorIndex = Math.max(0, cursorIndex - 1);
        requestUiRerender();
        return;
      }

      if (matchesKey(data, Key.down) || isPlainKey(data, "j")) {
        cursorIndex = Math.min(ACTION_OPTIONS.length - 1, cursorIndex + 1);
        requestUiRerender();
        return;
      }

      if (matchesKey(data, Key.tab) || isPlainKey(data, "e")) {
        openNoteEditor(getSelectedAction());
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
        done({
          cancelled: false,
          action: quickAction,
          note: EDITABLE_ACTIONS.has(quickAction)
            ? getNormalizedNote(quickAction) || undefined
            : undefined,
        });
        return;
      }

      if (matchesKey(data, Key.enter)) {
        const selected = getSelectedAction();
        done({
          cancelled: false,
          action: selected,
          note: EDITABLE_ACTIONS.has(selected)
            ? getNormalizedNote(selected) || undefined
            : undefined,
        });
        return;
      }

      if (matchesKey(data, Key.escape)) {
        done({ cancelled: true });
      }
    };

    return {
      render,
      invalidate: () => {
        cachedRenderedLines = undefined;
      },
      handleInput,
    };
  });
}
