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
} from "@mariozechner/pi-tui";
import { Markdown, type MarkdownTheme } from "@mariozechner/pi-tui/dist/components/markdown.js";
import { wrapTextWithAnsi } from "@mariozechner/pi-tui/dist/utils.js";
import { Type } from "@sinclair/typebox";

interface AskUserQuestionOption {
  label: string;
  description: string;
  preview?: string;
}

interface AskUserQuestionInput {
  question: string;
  header: string;
  options: AskUserQuestionOption[];
  multiSelect: boolean;
}

interface QuestionAnnotation {
  preview?: string;
  notes?: string;
}

interface AskUserQuestionResultDetails {
  questions: AskUserQuestionInput[];
  answers: Record<string, string>;
  annotations?: Record<string, QuestionAnnotation>;
  cancelled: boolean;
}

interface AskUserQuestionToolParams {
  questions: Array<{
    question: string;
    header?: string;
    options: AskUserQuestionOption[];
    multiSelect?: boolean;
  }>;
}

interface NormalizedOption extends AskUserQuestionOption {
  isOther?: boolean;
}

interface NormalizedQuestion {
  id: string;
  question: string;
  header: string;
  options: NormalizedOption[];
  multiSelect: boolean;
}

interface SelectionState {
  optionLabels: string[];
  optionIndexes: number[];
  customText?: string;
  previews: Record<string, string>;
}

const MAX_HEADER_LENGTH = 12;
const SPLIT_PREVIEW_MIN_WIDTH = 96;
const PREVIEW_PANEL_GAP = 2;
const PANEL_HORIZONTAL_PADDING = 1;

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

function normalizeQuestions(
  rawQuestions: Array<{
    question: string;
    header?: string;
    options: AskUserQuestionOption[];
    multiSelect?: boolean;
  }>,
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

function buildResultDetails(
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

function buildResultContent(details: AskUserQuestionResultDetails): string {
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
        const renderTui = tui as TUI;
        let currentTab = 0;
        let optionIndex = 0;
        let inputMode = false;
        let inputQuestionId: string | undefined;
        let cachedLines: string[] | undefined;
        const selections = new Map<string, SelectionState>();
        const totalTabs = questions.length + 1;
        const isMultiQuestion = questions.length > 1;

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
        const editor = new Editor(renderTui, editorTheme);

        const refresh = () => {
          cachedLines = undefined;
          renderTui.requestRender();
        };

        const currentQuestion = (): NormalizedQuestion | undefined => {
          return questions[currentTab];
        };

        const allAnswered = (): boolean => {
          return questions.every((question) => {
            const selection = selections.get(question.id);
            return Boolean(
              selection &&
              (selection.optionLabels.length > 0 ||
                (selection.customText && selection.customText.trim())),
            );
          });
        };

        const submit = (cancelled: boolean) => {
          done(buildResultDetails(questions, selections, cancelled));
        };

        const advanceAfterAnswer = () => {
          if (!isMultiQuestion) {
            submit(false);
            return;
          }

          if (currentTab < questions.length - 1) {
            currentTab += 1;
          } else {
            currentTab = questions.length;
          }
          optionIndex = 0;
          refresh();
        };

        const setSingleSelection = (
          question: NormalizedQuestion,
          option: NormalizedOption,
          index: number,
        ) => {
          const previous = getSelectionState(selections, question.id);
          selections.set(question.id, {
            optionLabels: option.isOther ? [] : [option.label],
            optionIndexes: option.isOther ? [] : [index + 1],
            ...(option.isOther && previous.customText ? { customText: previous.customText } : {}),
            previews: option.preview ? { [option.label]: option.preview } : {},
          });
        };

        const toggleMultiSelection = (
          question: NormalizedQuestion,
          option: NormalizedOption,
          index: number,
        ) => {
          const selection = getSelectionState(selections, question.id);
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
          selections.set(question.id, selection);
        };

        const saveCustomAnswer = (question: NormalizedQuestion, value: string) => {
          const selection = getSelectionState(selections, question.id);
          selection.customText = value;
          selections.set(question.id, selection);
        };

        const enterInputMode = (question: NormalizedQuestion) => {
          inputMode = true;
          inputQuestionId = question.id;
          editor.setText(getSelectionState(selections, question.id).customText ?? "");
        };

        editor.onSubmit = (value) => {
          const question = questions.find((candidate) => candidate.id === inputQuestionId);
          if (!question) {
            return;
          }

          const trimmed = value.trim();
          if (trimmed.length === 0) {
            inputMode = false;
            inputQuestionId = undefined;
            editor.setText("");
            refresh();
            return;
          }

          saveCustomAnswer(question, trimmed);
          inputMode = false;
          inputQuestionId = undefined;
          editor.setText("");
          if (!question.multiSelect) {
            advanceAfterAnswer();
            return;
          }
          refresh();
        };

        const previewMarkdown = new Markdown("", 0, 0, createMarkdownTheme(theme), {
          color: (text: string) => theme.fg("text", text),
        });

        const renderOptionsLines = (width: number, question: NormalizedQuestion): string[] => {
          const lines: string[] = [];
          const selection = getSelectionState(selections, question.id);

          for (const [index, option] of question.options.entries()) {
            const selected = index === optionIndex;
            const prefix = selected ? theme.fg("accent", "> ") : "  ";
            const checked =
              selection.optionLabels.includes(option.label) ||
              (option.isOther && Boolean(selection.customText?.trim()));
            const multiMarker = question.multiSelect ? (checked ? "[x] " : "[ ] ") : "";
            const optionLabel = option.isOther && inputMode ? `${option.label} ✎` : option.label;
            const color = selected ? "accent" : checked ? "success" : "text";

            lines.push(
              ...wrapLines(
                prefix + theme.fg(color, `${index + 1}. ${multiMarker}${optionLabel}`),
                width,
              ),
            );
            if (option.description) {
              lines.push(...wrapLines(`   ${theme.fg("muted", option.description)}`, width));
            }
            if (selected && option.preview && width >= 24) {
              lines.push(...wrapLines(`   ${theme.fg("dim", "Preview available →")}`, width));
            }
            if (index < question.options.length - 1) {
              lines.push("");
            }
          }

          return lines;
        };

        const buildSelectionSummaryLines = (
          question: NormalizedQuestion,
          width: number,
        ): string[] => {
          const selection = getSelectionState(selections, question.id);
          const values = [...selection.optionLabels];
          if (selection.customText?.trim()) {
            values.push(`(wrote) ${selection.customText.trim()}`);
          }
          if (values.length === 0) {
            return wrapLines(theme.fg("dim", "No answer selected yet."), width);
          }
          return [
            ...wrapLines(
              theme.fg("muted", question.multiSelect ? "Current answer" : "Selected answer"),
              width,
            ),
            ...wrapLines(theme.fg("text", values.join(", ")), width),
          ];
        };

        const renderPreviewBody = (
          width: number,
          question: NormalizedQuestion,
          option: NormalizedOption | undefined,
        ): string[] => {
          const lines: string[] = [];
          const addWrapped = (text: string) => {
            lines.push(...wrapLines(text, width));
          };

          if (inputMode) {
            addWrapped(theme.fg("muted", "Write your own answer"));
            lines.push("");
            addWrapped(theme.fg("dim", "Press Enter to save the answer for this question."));
            lines.push("");
            for (const line of editor.render(Math.max(1, width))) {
              lines.push(truncateToWidth(line, width));
            }
            return lines;
          }

          if (!option) {
            return wrapLines(
              theme.fg("dim", "Move through the options to inspect a preview."),
              width,
            );
          }

          addWrapped(theme.fg(option.isOther ? "warning" : "accent", option.label));
          if (option.description) {
            lines.push("");
            addWrapped(theme.fg("muted", option.description));
          }

          const summary = buildSelectionSummaryLines(question, width);
          if (summary.length > 0) {
            lines.push("");
            lines.push(...summary);
          }

          if (option.preview) {
            lines.push("");
            addWrapped(theme.fg("muted", "Preview"));
            lines.push("");
            previewMarkdown.setText(option.preview);
            lines.push(
              ...previewMarkdown
                .render(Math.max(1, width))
                .map((line) => truncateToWidth(line, width)),
            );
            return lines;
          }

          lines.push("");
          if (option.isOther) {
            addWrapped(
              theme.fg(
                "dim",
                "Use this when none of the suggested options fit and you need to describe your own approach.",
              ),
            );
          } else {
            addWrapped(theme.fg("dim", "No structured preview was provided for this option."));
          }
          return lines;
        };

        const renderQuestionView = (
          width: number,
          question: NormalizedQuestion,
          option: NormalizedOption | undefined,
          lines: string[],
        ) => {
          lines.push(...wrapLines(theme.fg("text", ` ${question.question}`), width));
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
              renderOptionsLines(leftBodyWidth, question),
              theme,
              "accent",
            );
            const rightPanel = renderPanel(
              rightWidth,
              inputMode ? "Custom answer" : "Preview",
              renderPreviewBody(rightBodyWidth, question, option),
              theme,
              inputMode ? "warning" : "borderMuted",
            );
            lines.push(
              ...joinColumns(leftPanel, rightPanel, leftWidth, rightWidth, PREVIEW_PANEL_GAP),
            );
            return;
          }

          const stackedBodyWidth = Math.max(1, width - 2 - PANEL_HORIZONTAL_PADDING * 2);
          lines.push(
            ...renderPanel(
              width,
              "Choices",
              renderOptionsLines(stackedBodyWidth, question),
              theme,
              "accent",
            ),
          );
          lines.push("");
          lines.push(
            ...renderPanel(
              width,
              inputMode ? "Custom answer" : "Preview",
              renderPreviewBody(stackedBodyWidth, question, option),
              theme,
              inputMode ? "warning" : "borderMuted",
            ),
          );
        };

        const handleInput = (data: string) => {
          if (inputMode) {
            if (matchesKey(data, Key.escape)) {
              inputMode = false;
              inputQuestionId = undefined;
              editor.setText("");
              refresh();
              return;
            }
            editor.handleInput(data);
            refresh();
            return;
          }

          if (isMultiQuestion) {
            if (matchesKey(data, Key.tab) || matchesKey(data, Key.right)) {
              currentTab = (currentTab + 1) % totalTabs;
              optionIndex = 0;
              refresh();
              return;
            }
            if (matchesKey(data, Key.shift("tab")) || matchesKey(data, Key.left)) {
              currentTab = (currentTab - 1 + totalTabs) % totalTabs;
              optionIndex = 0;
              refresh();
              return;
            }
          }

          if (currentTab === questions.length) {
            if (matchesKey(data, Key.enter) && allAnswered()) {
              submit(false);
              return;
            }
            if (matchesKey(data, Key.escape)) {
              submit(true);
            }
            return;
          }

          const question = currentQuestion();
          if (!question) {
            submit(true);
            return;
          }

          if (matchesKey(data, Key.up)) {
            optionIndex = Math.max(0, optionIndex - 1);
            refresh();
            return;
          }
          if (matchesKey(data, Key.down)) {
            optionIndex = Math.min(question.options.length - 1, optionIndex + 1);
            refresh();
            return;
          }

          const option = question.options[optionIndex];
          if (!option) {
            return;
          }

          if (question.multiSelect && data === " ") {
            if (option.isOther) {
              enterInputMode(question);
            } else {
              toggleMultiSelection(question, option, optionIndex);
            }
            refresh();
            return;
          }

          if (matchesKey(data, Key.enter)) {
            if (question.multiSelect) {
              if (option.isOther) {
                if (getSelectionState(selections, question.id).customText?.trim()) {
                  advanceAfterAnswer();
                } else {
                  enterInputMode(question);
                  refresh();
                }
                return;
              }

              const selection = getSelectionState(selections, question.id);
              if (selection.optionLabels.length === 0 && !selection.customText?.trim()) {
                toggleMultiSelection(question, option, optionIndex);
              }
              advanceAfterAnswer();
              return;
            }

            if (option.isOther) {
              setSingleSelection(question, option, optionIndex);
              enterInputMode(question);
              refresh();
              return;
            }

            setSingleSelection(question, option, optionIndex);
            advanceAfterAnswer();
            return;
          }

          if (matchesKey(data, Key.escape)) {
            submit(true);
          }
        };

        const render = (width: number): string[] => {
          if (cachedLines) {
            return cachedLines;
          }

          const lines: string[] = [];
          const addLine = (text: string) => {
            lines.push(truncateToWidth(text, width));
          };

          addLine(theme.fg("accent", "─".repeat(width)));

          if (isMultiQuestion) {
            const tabs: string[] = ["← "];
            for (const [index, question] of questions.entries()) {
              const active = index === currentTab;
              const answered = Boolean(
                getSelectionState(selections, question.id).optionLabels.length > 0 ||
                getSelectionState(selections, question.id).customText?.trim(),
              );
              const marker = answered ? "■" : "□";
              const text = ` ${marker} ${question.header} `;
              tabs.push(theme.fg(active ? "accent" : answered ? "success" : "muted", `${text} `));
            }
            const submitActive = currentTab === questions.length;
            const canSubmit = allAnswered();
            const submitText = " ✓ Submit ";
            tabs.push(
              `${theme.fg(submitActive ? "accent" : canSubmit ? "success" : "dim", submitText)}→`,
            );
            addLine(` ${tabs.join("")}`);
            lines.push("");
          }

          if (currentTab === questions.length) {
            addLine(theme.fg("accent", " Ready to submit"));
            lines.push("");
            for (const question of questions) {
              const selection = getSelectionState(selections, question.id);
              const values = [...selection.optionLabels];
              if (selection.customText?.trim()) {
                values.push(`(wrote) ${selection.customText.trim()}`);
              }
              if (values.length > 0) {
                addLine(
                  `${theme.fg("muted", ` ${question.header}: `)}${theme.fg("text", values.join(", "))}`,
                );
              }
            }
            lines.push("");
            if (allAnswered()) {
              addLine(theme.fg("success", " Press Enter to submit"));
            } else {
              const missing = questions
                .filter((question) => {
                  const selection = getSelectionState(selections, question.id);
                  return !(selection.optionLabels.length > 0 || selection.customText?.trim());
                })
                .map((question) => question.header)
                .join(", ");
              addLine(theme.fg("warning", ` Unanswered: ${missing}`));
            }
          } else {
            const question = currentQuestion();
            const option = question?.options[optionIndex];
            if (question) {
              renderQuestionView(width, question, option, lines);
            }
          }

          lines.push("");
          if (inputMode) {
            addLine(theme.fg("dim", " Enter to save • Esc to close the editor"));
          } else if (currentTab !== questions.length) {
            const question = currentQuestion();
            const baseHelp = question?.multiSelect
              ? " ↑↓ navigate • Space toggle • Enter continue • Esc cancel"
              : " ↑↓ navigate • Enter select • Esc cancel";
            const fullHelp = isMultiQuestion ? ` Tab/←→ switch •${baseHelp.slice(1)}` : baseHelp;
            addLine(theme.fg("dim", fullHelp));
          }
          addLine(theme.fg("accent", "─".repeat(width)));

          cachedLines = lines;
          return lines;
        };

        return {
          render,
          invalidate: () => {
            cachedLines = undefined;
          },
          handleInput,
        };
      });

      const contentText = buildResultContent(result);
      return {
        content: [{ type: "text", text: contentText }],
        details: result,
      };
    },
  });
}
