import type {
  ExtensionAPI,
  ExtensionContext,
  ExtensionToolResult,
} from "../../../packages/workflow-core/src/index";
import {
  Editor,
  type EditorTheme,
  Key,
  matchesKey,
  type TUI,
  truncateToWidth,
  Markdown,
  type MarkdownTheme,
  Text,
  wrapTextWithAnsi,
} from "@mariozechner/pi-tui";
import { Type } from "@sinclair/typebox";

export interface AskUserQuestionOption {
  label: string;
  description: string;
  preview?: string;
}

export interface AskUserQuestionInput {
  question: string;
  header: string;
  options: AskUserQuestionOption[];
  multiSelect: boolean;
}

export interface QuestionAnnotation {
  preview?: string;
  notes?: string;
}

export interface AskUserQuestionResultDetails {
  questions: AskUserQuestionInput[];
  answers: Record<string, string>;
  annotations?: Record<string, QuestionAnnotation>;
  cancelled: boolean;
}

export interface AskUserQuestionQuestionConfig {
  question: string;
  header?: string;
  options: AskUserQuestionOption[];
  multiSelect?: boolean;
}

export interface AskUserQuestionToolParams {
  questions: AskUserQuestionQuestionConfig[];
}

export interface NormalizedOption extends AskUserQuestionOption {
  isOther?: boolean;
}

export interface NormalizedQuestion {
  id: string;
  question: string;
  header: string;
  options: NormalizedOption[];
  multiSelect: boolean;
}

export interface SelectionState {
  optionLabels: string[];
  optionIndexes: number[];
  customText?: string;
  previews: Record<string, string>;
}

const MAX_HEADER_LENGTH = 12;
const SPLIT_PREVIEW_MIN_WIDTH = 96;
const PREVIEW_PANEL_GAP = 2;
const PANEL_HORIZONTAL_PADDING = 1;

type AskUserQuestionTheme = ExtensionContext["ui"]["theme"];
type AskUserQuestionDone = (result: AskUserQuestionResultDetails) => void;

function repeat(char: string, count: number): string {
  return count > 0 ? char.repeat(count) : "";
}

function wrapLines(text: string, width: number): string[] {
  if (width <= 0) {
    return [""];
  }
  const wrapped = wrapTextWithAnsi(text, width);
  return wrapped.length > 0 ? wrapped.map((line) => truncateToWidth(line, width)) : [""];
}

function createMarkdownTheme(theme: {
  fg(color: string, text: string): string;
  strikethrough(text: string): string;
}): MarkdownTheme {
  return {
    heading: (text) => theme.fg("mdHeading", text),
    link: (text) => theme.fg("mdLink", text),
    linkUrl: (text) => theme.fg("mdLinkUrl", text),
    code: (text) => theme.fg("mdCode", text),
    codeBlock: (text) => theme.fg("mdCodeBlock", text),
    codeBlockBorder: (text) => theme.fg("mdCodeBlockBorder", text),
    quote: (text) => theme.fg("mdQuote", text),
    quoteBorder: (text) => theme.fg("mdQuoteBorder", text),
    hr: (text) => theme.fg("mdHr", text),
    listBullet: (text) => theme.fg("mdListBullet", text),
    bold: (text) => `\x1b[1m${text}\x1b[22m`,
    italic: (text) => `\x1b[3m${text}\x1b[23m`,
    underline: (text) => `\x1b[4m${text}\x1b[24m`,
    strikethrough: (text) => theme.strikethrough(text),
  };
}

function renderPanel(
  width: number,
  title: string,
  bodyLines: string[],
  theme: {
    fg(color: string, text: string): string;
  },
  borderColor: string = "borderMuted",
): string[] {
  if (width <= 2) {
    return [truncateToWidth(bodyLines[0] ?? "", Math.max(1, width))];
  }

  const innerWidth = Math.max(1, width - 2);
  const contentWidth = Math.max(1, innerWidth - PANEL_HORIZONTAL_PADDING * 2);
  const lines: string[] = [];

  const topBorder = theme.fg(borderColor, `┌${repeat("─", innerWidth)}┐`);
  const bottomBorder = theme.fg(borderColor, `└${repeat("─", innerWidth)}┘`);
  const titleText = truncateToWidth(theme.fg("muted", title), contentWidth);
  const titleLine = `${theme.fg(borderColor, "│")}${repeat(" ", PANEL_HORIZONTAL_PADDING)}${truncateToWidth(titleText, contentWidth, "...", true)}${repeat(" ", PANEL_HORIZONTAL_PADDING)}${theme.fg(borderColor, "│")}`;

  lines.push(topBorder);
  lines.push(titleLine);

  if (bodyLines.length > 0) {
    lines.push(
      `${theme.fg(borderColor, "│")}${repeat(" ", PANEL_HORIZONTAL_PADDING)}${repeat(" ", contentWidth)}${repeat(" ", PANEL_HORIZONTAL_PADDING)}${theme.fg(borderColor, "│")}`,
    );
    for (const line of bodyLines) {
      lines.push(
        `${theme.fg(borderColor, "│")}${repeat(" ", PANEL_HORIZONTAL_PADDING)}${truncateToWidth(line, contentWidth, "...", true)}${repeat(" ", PANEL_HORIZONTAL_PADDING)}${theme.fg(borderColor, "│")}`,
      );
    }
  }

  lines.push(bottomBorder);
  return lines;
}

function joinColumns(
  leftLines: string[],
  rightLines: string[],
  leftWidth: number,
  rightWidth: number,
  gap: number,
): string[] {
  const lines: string[] = [];
  const rowCount = Math.max(leftLines.length, rightLines.length);
  for (let index = 0; index < rowCount; index += 1) {
    const left = truncateToWidth(leftLines[index] ?? "", leftWidth, "...", true);
    const right = truncateToWidth(rightLines[index] ?? "", rightWidth, "...", true);
    lines.push(`${left}${repeat(" ", gap)}${right}`);
  }
  return lines;
}

const AskUserQuestionOptionSchema = Type.Object({
  label: Type.String({
    description: "The display text for this option that the user will see and select.",
  }),
  description: Type.String({
    description: "Explanation of what this option means or what will happen if chosen.",
  }),
  preview: Type.Optional(
    Type.String({
      description:
        "Optional preview content for the focused option. Use for mockups, code snippets, or comparisons.",
    }),
  ),
});

const AskUserQuestionQuestionSchema = Type.Object({
  question: Type.String({
    description:
      "The complete question to ask the user. Keep it specific and end it with a question mark.",
  }),
  header: Type.Optional(
    Type.String({
      description:
        "Very short label shown in the questionnaire tab bar, e.g. 'Scope', 'Auth', 'Approach'.",
    }),
  ),
  options: Type.Array(AskUserQuestionOptionSchema, {
    description:
      "The available choices for this question. Provide 2-4 concrete options. Do not include an 'Other' option; it is added automatically.",
  }),
  multiSelect: Type.Optional(
    Type.Boolean({
      description: "Allow the user to select multiple options instead of only one.",
    }),
  ),
});

const AskUserQuestionParams = Type.Object({
  questions: Type.Array(AskUserQuestionQuestionSchema, {
    description: "Questions to ask the user (1-4 questions).",
  }),
});

function errorResult(
  message: string,
  questions: AskUserQuestionInput[] = [],
): {
  content: Array<{ type: "text"; text: string }>;
  details: AskUserQuestionResultDetails;
} {
  return {
    content: [{ type: "text", text: message }],
    details: {
      questions,
      answers: {},
      cancelled: true,
    },
  };
}

export function normalizeQuestions(
  rawQuestions: AskUserQuestionQuestionConfig[],
): { ok: true; questions: NormalizedQuestion[] } | { ok: false; message: string } {
  if (rawQuestions.length === 0) {
    return { ok: false, message: "Error: No questions provided" };
  }

  if (rawQuestions.length > 4) {
    return { ok: false, message: "Error: AskUserQuestion accepts at most 4 questions" };
  }

  const seenQuestions = new Set<string>();

  const questions: NormalizedQuestion[] = [];
  for (const [index, rawQuestion] of rawQuestions.entries()) {
    const question = rawQuestion.question.trim();
    if (question.length === 0) {
      return { ok: false, message: `Error: Question ${index + 1} is empty` };
    }

    if (seenQuestions.has(question)) {
      return { ok: false, message: `Error: Duplicate question text: ${question}` };
    }
    seenQuestions.add(question);

    if (rawQuestion.options.length < 2 || rawQuestion.options.length > 4) {
      return {
        ok: false,
        message: `Error: Question ${index + 1} must have between 2 and 4 options`,
      };
    }

    const seenLabels = new Set<string>();
    const options: NormalizedOption[] = rawQuestion.options.map((option) => {
      const label = option.label.trim();
      if (label.length === 0) {
        throw new Error(`Question ${index + 1} has an empty option label`);
      }
      if (seenLabels.has(label)) {
        throw new Error(`Question ${index + 1} has duplicate option label: ${label}`);
      }
      seenLabels.add(label);
      return {
        label,
        description: option.description.trim(),
        preview: option.preview,
      } satisfies NormalizedOption;
    });

    options.push({
      label: "Type something.",
      description: "Write your own answer instead of choosing one of the suggested options.",
      isOther: true,
    });

    questions.push({
      id: `q${index + 1}`,
      question,
      header: (rawQuestion.header?.trim() || `Q${index + 1}`).slice(0, MAX_HEADER_LENGTH),
      options,
      multiSelect: rawQuestion.multiSelect === true,
    });
  }

  return { ok: true, questions };
}

function getSelectionState(
  selections: Map<string, SelectionState>,
  questionId: string,
): SelectionState {
  return (
    selections.get(questionId) ?? {
      optionLabels: [],
      optionIndexes: [],
      previews: {},
    }
  );
}

export function buildResultDetails(
  questions: NormalizedQuestion[],
  selections: Map<string, SelectionState>,
  cancelled: boolean,
): AskUserQuestionResultDetails {
  const answers: Record<string, string> = {};
  const annotations: Record<string, QuestionAnnotation> = {};

  for (const question of questions) {
    const selection = selections.get(question.id);
    if (!selection) {
      continue;
    }

    const values = [...selection.optionLabels];
    if (selection.customText?.trim()) {
      values.push(selection.customText.trim());
    }
    if (values.length === 0) {
      continue;
    }

    answers[question.question] = values.join(", ");

    const previews = Object.values(selection.previews);
    if (previews.length > 0 || selection.customText?.trim()) {
      annotations[question.question] = {
        ...(previews.length > 0 ? { preview: previews.join("\n\n") } : {}),
        ...(selection.customText?.trim() ? { notes: selection.customText.trim() } : {}),
      };
    }
  }

  return {
    questions: questions.map((question) => ({
      question: question.question,
      header: question.header,
      options: question.options.filter((option) => !option.isOther),
      multiSelect: question.multiSelect,
    })),
    answers,
    ...(Object.keys(annotations).length > 0 ? { annotations } : {}),
    cancelled,
  };
}

export function buildResultContent(details: AskUserQuestionResultDetails): string {
  const parts = Object.entries(details.answers).map(([question, answer]) => {
    const annotation = details.annotations?.[question];
    const chunks = [`"${question}"="${answer}"`];
    if (annotation?.preview) {
      chunks.push(`selected preview:\n${annotation.preview}`);
    }
    if (annotation?.notes) {
      chunks.push(`user notes: ${annotation.notes}`);
    }
    return chunks.join(" ");
  });

  if (parts.length === 0) {
    return "User cancelled the questionnaire";
  }

  return `User has answered your questions: ${parts.join(", ")}. You can now continue with the user's answers in mind.`;
}

function buildQuestionnaireCallSummary(
  questions: AskUserQuestionQuestionConfig[] | undefined,
  theme: AskUserQuestionTheme,
): string {
  const safeQuestions = questions ?? [];
  const labels = safeQuestions
    .map((question, index) => question.header?.trim() || `Q${index + 1}`)
    .join(", ");

  let text = theme.fg("toolTitle", "AskUserQuestion ");
  text += theme.fg("muted", `${safeQuestions.length} question${safeQuestions.length === 1 ? "" : "s"}`);
  if (labels) {
    text += theme.fg("dim", ` (${truncateToWidth(labels, 40)})`);
  }
  return text;
}

function buildQuestionnaireResultLines(
  details: AskUserQuestionResultDetails,
  theme: AskUserQuestionTheme,
): string[] {
  if (details.cancelled) {
    return [theme.fg("warning", "Cancelled")];
  }

  const lines: string[] = [];
  for (const question of details.questions) {
    const answer = details.answers[question.question];
    if (!answer) {
      continue;
    }

    const annotation = details.annotations?.[question.question];
    const hasSuggestedOptionMatch = question.options.some((option) => answer.includes(option.label));
    const label = question.header || question.question;
    const renderedAnswer = !hasSuggestedOptionMatch && annotation?.notes
      ? `${theme.fg("muted", "(wrote) ")}${annotation.notes}`
      : answer;
    lines.push(`${theme.fg("success", "✓ ")}${theme.fg("accent", label)}: ${renderedAnswer}`);
  }

  if (lines.length > 0) {
    return lines;
  }

  const text = details.answers && Object.keys(details.answers).length === 0
    ? "User cancelled the questionnaire"
    : buildResultContent(details);
  return [text];
}

export class AskUserQuestionComponent {
  private currentTab = 0;
  private optionIndex = 0;
  private inputMode = false;
  private inputQuestionId: string | undefined;
  private cachedWidth: number | undefined;
  private cachedLines: string[] | undefined;
  private readonly selections = new Map<string, SelectionState>();
  private readonly editor: Editor;
  private readonly previewMarkdown: Markdown;

  constructor(
    private readonly renderTui: TUI,
    private readonly theme: AskUserQuestionTheme,
    private readonly done: AskUserQuestionDone,
    private readonly questions: NormalizedQuestion[],
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
    this.editor = new Editor(renderTui, editorTheme);
    this.editor.onSubmit = (value) => {
      const question = this.questions.find((candidate) => candidate.id === this.inputQuestionId);
      if (!question) {
        return;
      }

      const trimmed = value.trim();
      if (trimmed.length === 0) {
        this.inputMode = false;
        this.inputQuestionId = undefined;
        this.editor.setText("");
        this.refresh();
        return;
      }

      this.saveCustomAnswer(question, trimmed);
      this.inputMode = false;
      this.inputQuestionId = undefined;
      this.editor.setText("");
      if (!question.multiSelect) {
        this.advanceAfterAnswer();
        return;
      }
      this.refresh();
    };

    this.previewMarkdown = new Markdown("", 0, 0, createMarkdownTheme(theme), {
      color: (text: string) => theme.fg("text", text),
    });
  }

  render(width: number): string[] {
    if (this.cachedLines && this.cachedWidth === width) {
      return this.cachedLines;
    }

    const lines: string[] = [];
    const addLine = (text: string) => {
      lines.push(truncateToWidth(text, width));
    };

    addLine(this.theme.fg("accent", "─".repeat(width)));

    if (this.isMultiQuestion()) {
      const tabs: string[] = ["← "];
      for (const [index, question] of this.questions.entries()) {
        const active = index === this.currentTab;
        const answered = Boolean(
          getSelectionState(this.selections, question.id).optionLabels.length > 0 ||
            getSelectionState(this.selections, question.id).customText?.trim(),
        );
        const marker = answered ? "■" : "□";
        const text = ` ${marker} ${question.header} `;
        tabs.push(
          this.theme.fg(active ? "accent" : answered ? "success" : "muted", `${text} `),
        );
      }
      const submitActive = this.currentTab === this.questions.length;
      const canSubmit = this.allAnswered();
      const submitText = " ✓ Submit ";
      tabs.push(
        `${this.theme.fg(submitActive ? "accent" : canSubmit ? "success" : "dim", submitText)}→`,
      );
      addLine(` ${tabs.join("")}`);
      lines.push("");
    }

    if (this.currentTab === this.questions.length) {
      addLine(this.theme.fg("accent", " Ready to submit"));
      lines.push("");
      for (const question of this.questions) {
        const selection = getSelectionState(this.selections, question.id);
        const values = [...selection.optionLabels];
        if (selection.customText?.trim()) {
          values.push(`(wrote) ${selection.customText.trim()}`);
        }
        if (values.length > 0) {
          addLine(
            `${this.theme.fg("muted", ` ${question.header}: `)}${this.theme.fg("text", values.join(", "))}`,
          );
        }
      }
      lines.push("");
      if (this.allAnswered()) {
        addLine(this.theme.fg("success", " Press Enter to submit"));
      } else {
        const missing = this.questions
          .filter((question) => {
            const selection = getSelectionState(this.selections, question.id);
            return !(selection.optionLabels.length > 0 || selection.customText?.trim());
          })
          .map((question) => question.header)
          .join(", ");
        addLine(this.theme.fg("warning", ` Unanswered: ${missing}`));
      }
    } else {
      const question = this.currentQuestion();
      const option = question?.options[this.optionIndex];
      if (question) {
        this.renderQuestionView(width, question, option, lines);
      }
    }

    lines.push("");
    if (this.inputMode) {
      addLine(this.theme.fg("dim", " Enter to save • Esc to close the editor"));
    } else if (this.currentTab !== this.questions.length) {
      const question = this.currentQuestion();
      const baseHelp = question?.multiSelect
        ? " ↑↓ navigate • Space toggle • Enter continue • Esc cancel"
        : " ↑↓ navigate • Enter select • Esc cancel";
      const fullHelp = this.isMultiQuestion() ? ` Tab/←→ switch •${baseHelp.slice(1)}` : baseHelp;
      addLine(this.theme.fg("dim", fullHelp));
    }
    addLine(this.theme.fg("accent", "─".repeat(width)));

    this.cachedWidth = width;
    this.cachedLines = lines;
    return lines;
  }

  handleInput(data: string): void {
    if (this.inputMode) {
      if (matchesKey(data, Key.escape)) {
        this.inputMode = false;
        this.inputQuestionId = undefined;
        this.editor.setText("");
        this.refresh();
        return;
      }
      this.editor.handleInput(data);
      this.refresh();
      return;
    }

    if (this.isMultiQuestion()) {
      const totalTabs = this.questions.length + 1;
      if (matchesKey(data, Key.tab) || matchesKey(data, Key.right)) {
        this.currentTab = (this.currentTab + 1) % totalTabs;
        this.optionIndex = 0;
        this.refresh();
        return;
      }
      if (matchesKey(data, Key.shift("tab")) || matchesKey(data, Key.left)) {
        this.currentTab = (this.currentTab - 1 + totalTabs) % totalTabs;
        this.optionIndex = 0;
        this.refresh();
        return;
      }
    }

    if (this.currentTab === this.questions.length) {
      if (matchesKey(data, Key.enter) && this.allAnswered()) {
        this.submit(false);
        return;
      }
      if (matchesKey(data, Key.escape)) {
        this.submit(true);
      }
      return;
    }

    const question = this.currentQuestion();
    if (!question) {
      this.submit(true);
      return;
    }

    if (matchesKey(data, Key.up)) {
      this.optionIndex = Math.max(0, this.optionIndex - 1);
      this.refresh();
      return;
    }
    if (matchesKey(data, Key.down)) {
      this.optionIndex = Math.min(question.options.length - 1, this.optionIndex + 1);
      this.refresh();
      return;
    }

    const option = question.options[this.optionIndex];
    if (!option) {
      return;
    }

    if (question.multiSelect && data === " ") {
      if (option.isOther) {
        this.enterInputMode(question);
      } else {
        this.toggleMultiSelection(question, option, this.optionIndex);
      }
      this.refresh();
      return;
    }

    if (matchesKey(data, Key.enter)) {
      if (question.multiSelect) {
        if (option.isOther) {
          if (getSelectionState(this.selections, question.id).customText?.trim()) {
            this.advanceAfterAnswer();
          } else {
            this.enterInputMode(question);
            this.refresh();
          }
          return;
        }

        const selection = getSelectionState(this.selections, question.id);
        if (selection.optionLabels.length === 0 && !selection.customText?.trim()) {
          this.toggleMultiSelection(question, option, this.optionIndex);
        }
        this.advanceAfterAnswer();
        return;
      }

      if (option.isOther) {
        this.setSingleSelection(question, option, this.optionIndex);
        this.enterInputMode(question);
        this.refresh();
        return;
      }

      this.setSingleSelection(question, option, this.optionIndex);
      this.advanceAfterAnswer();
      return;
    }

    if (matchesKey(data, Key.escape)) {
      this.submit(true);
    }
  }

  invalidate(): void {
    this.cachedWidth = undefined;
    this.cachedLines = undefined;
  }

  private refresh(): void {
    this.invalidate();
    this.renderTui.requestRender();
  }

  private currentQuestion(): NormalizedQuestion | undefined {
    return this.questions[this.currentTab];
  }

  private isMultiQuestion(): boolean {
    return this.questions.length > 1;
  }

  private allAnswered(): boolean {
    return this.questions.every((question) => {
      const selection = this.selections.get(question.id);
      return Boolean(
        selection &&
          (selection.optionLabels.length > 0 ||
            (selection.customText && selection.customText.trim())),
      );
    });
  }

  private submit(cancelled: boolean): void {
    this.done(buildResultDetails(this.questions, this.selections, cancelled));
  }

  private advanceAfterAnswer(): void {
    if (!this.isMultiQuestion()) {
      this.submit(false);
      return;
    }

    if (this.currentTab < this.questions.length - 1) {
      this.currentTab += 1;
    } else {
      this.currentTab = this.questions.length;
    }
    this.optionIndex = 0;
    this.refresh();
  }

  private setSingleSelection(
    question: NormalizedQuestion,
    option: NormalizedOption,
    index: number,
  ): void {
    const previous = getSelectionState(this.selections, question.id);
    this.selections.set(question.id, {
      optionLabels: option.isOther ? [] : [option.label],
      optionIndexes: option.isOther ? [] : [index + 1],
      ...(option.isOther && previous.customText ? { customText: previous.customText } : {}),
      previews: option.preview ? { [option.label]: option.preview } : {},
    });
  }

  private toggleMultiSelection(
    question: NormalizedQuestion,
    option: NormalizedOption,
    index: number,
  ): void {
    const selection = getSelectionState(this.selections, question.id);
    const labelIndex = selection.optionLabels.indexOf(option.label);
    if (labelIndex >= 0) {
      selection.optionLabels.splice(labelIndex, 1);
      selection.optionIndexes.splice(labelIndex, 1);
      delete selection.previews[option.label];
    } else {
      selection.optionLabels.push(option.label);
      selection.optionIndexes.push(index + 1);
      if (option.preview) {
        selection.previews[option.label] = option.preview;
      }
    }
    this.selections.set(question.id, selection);
  }

  private saveCustomAnswer(question: NormalizedQuestion, value: string): void {
    const selection = getSelectionState(this.selections, question.id);
    selection.customText = value;
    this.selections.set(question.id, selection);
  }

  private enterInputMode(question: NormalizedQuestion): void {
    this.inputMode = true;
    this.inputQuestionId = question.id;
    this.editor.setText(getSelectionState(this.selections, question.id).customText ?? "");
  }

  private renderOptionsLines(width: number, question: NormalizedQuestion): string[] {
    const lines: string[] = [];
    const selection = getSelectionState(this.selections, question.id);

    for (const [index, option] of question.options.entries()) {
      const selected = index === this.optionIndex;
      const prefix = selected ? this.theme.fg("accent", "> ") : "  ";
      const checked =
        selection.optionLabels.includes(option.label) ||
        (option.isOther && Boolean(selection.customText?.trim()));
      const multiMarker = question.multiSelect ? (checked ? "[x] " : "[ ] ") : "";
      const optionLabel = option.isOther && this.inputMode ? `${option.label} ✎` : option.label;
      const color = selected ? "accent" : checked ? "success" : "text";

      lines.push(
        ...wrapLines(
          prefix + this.theme.fg(color, `${index + 1}. ${multiMarker}${optionLabel}`),
          width,
        ),
      );
      if (option.description) {
        lines.push(...wrapLines(`   ${this.theme.fg("muted", option.description)}`, width));
      }
      if (selected && option.preview && width >= 24) {
        lines.push(...wrapLines(`   ${this.theme.fg("dim", "Preview available →")}`, width));
      }
      if (index < question.options.length - 1) {
        lines.push("");
      }
    }

    return lines;
  }

  private buildSelectionSummaryLines(question: NormalizedQuestion, width: number): string[] {
    const selection = getSelectionState(this.selections, question.id);
    const values = [...selection.optionLabels];
    if (selection.customText?.trim()) {
      values.push(`(wrote) ${selection.customText.trim()}`);
    }
    if (values.length === 0) {
      return wrapLines(this.theme.fg("dim", "No answer selected yet."), width);
    }
    return [
      ...wrapLines(
        this.theme.fg("muted", question.multiSelect ? "Current answer" : "Selected answer"),
        width,
      ),
      ...wrapLines(this.theme.fg("text", values.join(", ")), width),
    ];
  }

  private renderPreviewBody(
    width: number,
    question: NormalizedQuestion,
    option: NormalizedOption | undefined,
  ): string[] {
    const lines: string[] = [];
    const addWrapped = (text: string) => {
      lines.push(...wrapLines(text, width));
    };

    if (this.inputMode) {
      addWrapped(this.theme.fg("muted", "Write your own answer"));
      lines.push("");
      addWrapped(this.theme.fg("dim", "Press Enter to save the answer for this question."));
      lines.push("");
      for (const line of this.editor.render(Math.max(1, width))) {
        lines.push(truncateToWidth(line, width));
      }
      return lines;
    }

    if (!option) {
      return wrapLines(
        this.theme.fg("dim", "Move through the options to inspect a preview."),
        width,
      );
    }

    addWrapped(this.theme.fg(option.isOther ? "warning" : "accent", option.label));
    if (option.description) {
      lines.push("");
      addWrapped(this.theme.fg("muted", option.description));
    }

    const summary = this.buildSelectionSummaryLines(question, width);
    if (summary.length > 0) {
      lines.push("");
      lines.push(...summary);
    }

    if (option.preview) {
      lines.push("");
      addWrapped(this.theme.fg("muted", "Preview"));
      lines.push("");
      this.previewMarkdown.setText(option.preview);
      lines.push(
        ...this.previewMarkdown
          .render(Math.max(1, width))
          .map((line) => truncateToWidth(line, width)),
      );
      return lines;
    }

    lines.push("");
    if (option.isOther) {
      addWrapped(
        this.theme.fg(
          "dim",
          "Use this when none of the suggested options fit and you need to describe your own approach.",
        ),
      );
    } else {
      addWrapped(this.theme.fg("dim", "No structured preview was provided for this option."));
    }
    return lines;
  }

  private renderQuestionView(
    width: number,
    question: NormalizedQuestion,
    option: NormalizedOption | undefined,
    lines: string[],
  ): void {
    lines.push(...wrapLines(this.theme.fg("text", ` ${question.question}`), width));
    lines.push("");

    const canSplit = width >= SPLIT_PREVIEW_MIN_WIDTH;
    if (canSplit) {
      const leftWidth = Math.max(34, Math.floor((width - PREVIEW_PANEL_GAP) * 0.46));
      const rightWidth = Math.max(34, width - PREVIEW_PANEL_GAP - leftWidth);
      const leftBodyWidth = Math.max(1, leftWidth - 2 - PANEL_HORIZONTAL_PADDING * 2);
      const rightBodyWidth = Math.max(1, rightWidth - 2 - PANEL_HORIZONTAL_PADDING * 2);
      const leftPanel = renderPanel(
        leftWidth,
        "Choices",
        this.renderOptionsLines(leftBodyWidth, question),
        this.theme,
        "accent",
      );
      const rightPanel = renderPanel(
        rightWidth,
        this.inputMode ? "Custom answer" : "Preview",
        this.renderPreviewBody(rightBodyWidth, question, option),
        this.theme,
        this.inputMode ? "warning" : "borderMuted",
      );
      lines.push(...joinColumns(leftPanel, rightPanel, leftWidth, rightWidth, PREVIEW_PANEL_GAP));
      return;
    }

    const stackedBodyWidth = Math.max(1, width - 2 - PANEL_HORIZONTAL_PADDING * 2);
    lines.push(
      ...renderPanel(
        width,
        "Choices",
        this.renderOptionsLines(stackedBodyWidth, question),
        this.theme,
        "accent",
      ),
    );
    lines.push("");
    lines.push(
      ...renderPanel(
        width,
        this.inputMode ? "Custom answer" : "Preview",
        this.renderPreviewBody(stackedBodyWidth, question, option),
        this.theme,
        this.inputMode ? "warning" : "borderMuted",
      ),
    );
  }
}

export function registerAskUserQuestionTool(pi: ExtensionAPI): void {
  pi.registerTool({
    name: "AskUserQuestion",
    label: "AskUserQuestion",
    description:
      "Ask the user multiple-choice clarification questions with suggested options. The user can always choose 'Type something.' to provide a custom answer.",
    promptSnippet:
      "Ask the user 1-4 focused clarification questions with 2-4 suggested options each. The user always gets an automatic Other/free-text path.",
    promptGuidelines: [
      "Use this tool when a short list of concrete choices would help the user answer quickly.",
      "In plan mode, use this tool to clarify requirements or choose between approaches before finalizing the plan.",
      "Do not use this tool to ask whether the plan is ready or whether you should proceed; the plan approval UI handles that.",
    ],
    parameters: AskUserQuestionParams,

    async execute(
      _toolCallId: string,
      params: AskUserQuestionToolParams,
      _signal: AbortSignal,
      _onUpdate: ((update: ExtensionToolResult<AskUserQuestionResultDetails>) => void) | undefined,
      ctx: ExtensionContext,
    ) {
      if (!ctx.hasUI) {
        return errorResult("Error: UI not available (running in non-interactive mode)");
      }

      let normalized;
      try {
        normalized = normalizeQuestions(params.questions);
      } catch (error) {
        return errorResult(`Error: ${error instanceof Error ? error.message : String(error)}`);
      }

      if (!normalized.ok) {
        return errorResult(normalized.message);
      }

      const questions = normalized.questions;
      const result = await ctx.ui.custom<AskUserQuestionResultDetails>((tui, theme, _kb, done) => {
        return new AskUserQuestionComponent(tui as TUI, theme, done, questions);
      });

      const contentText = buildResultContent(result);
      return {
        content: [{ type: "text", text: contentText }],
        details: result,
      };
    },

    renderCall(args, theme) {
      return new Text(buildQuestionnaireCallSummary(args.questions, theme), 0, 0);
    },

    renderResult(result, _options, theme) {
      const details = result.details as AskUserQuestionResultDetails | undefined;
      if (!details) {
        const text = result.content[0];
        return new Text(text?.type === "text" ? text.text : "", 0, 0);
      }

      return new Text(buildQuestionnaireResultLines(details, theme).join("\n"), 0, 0);
    },
  });
}
