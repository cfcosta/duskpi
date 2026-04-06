import type { ExtensionTheme } from "../../../packages/workflow-core/src/index";
import { matchesKey, truncateToWidth, type TUI } from "@mariozechner/pi-tui";

export type PlanDashboardMode = "compact" | "expanded" | "fullscreen";
export type PlanDashboardStepStatus = "pending" | "done" | "skipped";

export interface PlanDashboardStepView {
  step: number;
  label: string;
  kind?: string;
  status?: PlanDashboardStepStatus;
  targets?: string[];
  validation?: string[];
  risks?: string[];
  dependsOn?: number[];
  checkpoints?: string[];
}

export interface PlanDashboardSnapshot {
  title: string;
  scopeLabel?: string;
  stateLabel?: string;
  summary?: string;
  taskGeometry?: string;
  coordinationPattern?: string;
  assumptions?: string[];
  checkpoints?: string[];
  dependencies?: string[];
  badges?: string[];
  critiqueSummary?: string;
  steps: PlanDashboardStepView[];
}

export interface FullscreenPlanDashboardOptions {
  viewportRows?: number;
  onClose?: () => void;
}

function summarizeValues(values: string[] | undefined, limit = 2): string | undefined {
  const normalized = (values ?? []).map((value) => value.trim()).filter((value) => value.length > 0);
  if (normalized.length === 0) {
    return undefined;
  }

  const visible = normalized.slice(0, limit);
  const remaining = normalized.length - visible.length;
  return remaining > 0 ? `${visible.join(", ")} (+${remaining} more)` : visible.join(", ");
}

function summarizeNumbers(values: number[] | undefined, limit = 3): string | undefined {
  if (!values || values.length === 0) {
    return undefined;
  }

  return summarizeValues(values.map((value) => String(value)), limit);
}

function getCompletedSteps(steps: PlanDashboardStepView[]): number {
  return steps.filter((step) => step.status === "done" || step.status === "skipped").length;
}

function getCurrentStep(steps: PlanDashboardStepView[]): PlanDashboardStepView | undefined {
  return steps.find((step) => step.status !== "done" && step.status !== "skipped") ?? steps.at(-1);
}

function statusIcon(status: PlanDashboardStepStatus | undefined, theme: ExtensionTheme): string {
  if (status === "done") {
    return theme.fg("success", "☑");
  }
  if (status === "skipped") {
    return theme.fg("warning", "↷");
  }
  return theme.fg("muted", "☐");
}

function renderHeaderLine(
  title: string,
  width: number,
  theme: ExtensionTheme,
  hint?: string,
): string {
  const suffix = hint ? theme.fg("dim", ` ${hint}`) : "";
  const prefix = theme.fg("borderMuted", "───") + theme.fg("accent", ` ${title} `);
  const hintLength = hint?.length ?? 0;
  const fillLen = Math.max(0, width - 3 - title.length - 2 - hintLength);
  return truncateToWidth(
    prefix + theme.fg("borderMuted", "─".repeat(fillLen)) + suffix,
    width,
  );
}

function buildCompactLines(
  snapshot: PlanDashboardSnapshot,
  width: number,
  theme: ExtensionTheme,
): string[] {
  const totalSteps = snapshot.steps.length;
  const completedSteps = getCompletedSteps(snapshot.steps);
  const currentStep = getCurrentStep(snapshot.steps);
  const state = snapshot.stateLabel ? ` ${snapshot.stateLabel}` : "";
  const progress = totalSteps > 0 ? ` ${completedSteps}/${totalSteps}` : " 0 steps";
  const lines = [
    truncateToWidth(theme.fg("accent", "📋") + theme.fg("text", ` ${snapshot.title}`) + theme.fg("muted", `${state} •${progress}`), width),
  ];

  const strategy = [snapshot.taskGeometry, snapshot.coordinationPattern].filter(Boolean).join(" • ");
  if (strategy) {
    lines.push(truncateToWidth(theme.fg("dim", strategy), width));
  }

  if (snapshot.summary) {
    lines.push(truncateToWidth(theme.fg("muted", snapshot.summary), width));
  }

  if (currentStep) {
    lines.push(
      truncateToWidth(
        `${statusIcon(currentStep.status, theme)} ${theme.fg("text", `${currentStep.step}. ${currentStep.label}`)}`,
        width,
      ),
    );
  } else {
    lines.push(truncateToWidth(theme.fg("dim", "No structured plan steps yet."), width));
  }

  return lines;
}

function buildExpandedLines(
  snapshot: PlanDashboardSnapshot,
  width: number,
  theme: ExtensionTheme,
  options: { includeHeader?: boolean } = {},
): string[] {
  const lines: string[] = [];
  const totalSteps = snapshot.steps.length;
  const completedSteps = getCompletedSteps(snapshot.steps);
  const strategy = [snapshot.taskGeometry, snapshot.coordinationPattern].filter(Boolean).join(" • ");
  const checkpointsSummary = summarizeValues(snapshot.checkpoints, 3);
  const dependenciesSummary = summarizeValues(snapshot.dependencies, 3);
  const assumptionsSummary = summarizeValues(snapshot.assumptions, 3);
  const badgesSummary = summarizeValues(snapshot.badges, 4);

  if (options.includeHeader !== false) {
    lines.push(renderHeaderLine(snapshot.title, width, theme));
  }
  lines.push(
    truncateToWidth(
      theme.fg("muted", ` State: ${snapshot.stateLabel ?? "idle"}`) +
        theme.fg("dim", ` • ${completedSteps}/${totalSteps} complete`),
      width,
    ),
  );

  if (snapshot.scopeLabel) {
    lines.push(truncateToWidth(theme.fg("dim", ` Scope: ${snapshot.scopeLabel}`), width));
  }
  if (strategy) {
    lines.push(truncateToWidth(theme.fg("dim", ` Strategy: ${strategy}`), width));
  }
  if (snapshot.summary) {
    lines.push(truncateToWidth(theme.fg("text", ` Summary: ${snapshot.summary}`), width));
  }
  if (assumptionsSummary) {
    lines.push(truncateToWidth(theme.fg("dim", ` Assumptions: ${assumptionsSummary}`), width));
  }
  if (checkpointsSummary) {
    lines.push(truncateToWidth(theme.fg("dim", ` Checkpoints: ${checkpointsSummary}`), width));
  }
  if (dependenciesSummary) {
    lines.push(truncateToWidth(theme.fg("dim", ` Dependencies: ${dependenciesSummary}`), width));
  }
  if (badgesSummary) {
    lines.push(truncateToWidth(theme.fg("dim", ` Badges: ${badgesSummary}`), width));
  }
  if (snapshot.critiqueSummary) {
    lines.push(truncateToWidth(theme.fg("dim", ` Critique: ${snapshot.critiqueSummary}`), width));
  }

  lines.push("");
  if (snapshot.steps.length === 0) {
    lines.push(truncateToWidth(theme.fg("dim", " No structured plan steps yet."), width));
    return lines;
  }

  for (const step of snapshot.steps) {
    lines.push(
      truncateToWidth(
        `${statusIcon(step.status, theme)} ${theme.fg("text", `${step.step}. ${step.label}`)}`,
        width,
      ),
    );

    if (step.kind) {
      lines.push(truncateToWidth(theme.fg("dim", `    kind: ${step.kind}`), width));
    }

    const targets = summarizeValues(step.targets, 3);
    if (targets) {
      lines.push(truncateToWidth(theme.fg("dim", `    files: ${targets}`), width));
    }

    const validation = summarizeValues(step.validation, 3);
    if (validation) {
      lines.push(truncateToWidth(theme.fg("dim", `    validate: ${validation}`), width));
    }

    const dependsOn = summarizeNumbers(step.dependsOn, 4);
    if (dependsOn) {
      lines.push(truncateToWidth(theme.fg("dim", `    depends on: ${dependsOn}`), width));
    }

    const checkpoints = summarizeValues(step.checkpoints, 3);
    if (checkpoints) {
      lines.push(truncateToWidth(theme.fg("dim", `    checkpoints: ${checkpoints}`), width));
    }

    const risks = summarizeValues(step.risks, 2);
    if (risks) {
      lines.push(truncateToWidth(theme.fg("dim", `    risks: ${risks}`), width));
    }
  }

  return lines;
}

export function renderPlanDashboardLines(
  snapshot: PlanDashboardSnapshot,
  mode: PlanDashboardMode,
  width: number,
  theme: ExtensionTheme,
): string[] {
  if (mode === "compact") {
    return buildCompactLines(snapshot, width, theme);
  }

  return buildExpandedLines(snapshot, width, theme, {
    includeHeader: mode !== "fullscreen",
  });
}

export class FullscreenPlanDashboardComponent {
  private scrollOffset = 0;
  private cachedWidth: number | undefined;
  private cachedLines: string[] | undefined;

  constructor(
    private readonly tui: TUI,
    private readonly theme: ExtensionTheme,
    private readonly snapshot: PlanDashboardSnapshot,
    private readonly options: FullscreenPlanDashboardOptions = {},
  ) {}

  render(width: number): string[] {
    if (this.cachedLines && this.cachedWidth === width) {
      return this.cachedLines;
    }

    const content = renderPlanDashboardLines(this.snapshot, "fullscreen", width, this.theme);
    const viewportRows = this.getViewportRows();
    const maxScroll = Math.max(0, content.length - viewportRows);
    if (this.scrollOffset > maxScroll) {
      this.scrollOffset = maxScroll;
    }

    const lines: string[] = [];
    lines.push(renderHeaderLine(this.snapshot.title, width, this.theme));

    const visible = content.slice(this.scrollOffset, this.scrollOffset + viewportRows);
    for (const line of visible) {
      lines.push(truncateToWidth(line, width));
    }

    for (let index = visible.length; index < viewportRows; index += 1) {
      lines.push("");
    }

    const scrollInfo =
      content.length > viewportRows
        ? ` ${this.scrollOffset + 1}-${Math.min(this.scrollOffset + viewportRows, content.length)}/${content.length}`
        : "";
    const helpText = ` ↑↓/j/k scroll • esc close${scrollInfo} `;
    const footerFill = Math.max(0, width - helpText.length);
    lines.push(
      truncateToWidth(
        this.theme.fg("borderMuted", "─".repeat(footerFill)) + this.theme.fg("dim", helpText),
        width,
      ),
    );

    this.cachedWidth = width;
    this.cachedLines = lines;
    return lines;
  }

  handleInput(data: string): void {
    const viewportRows = this.getViewportRows();
    const contentLength = renderPlanDashboardLines(
      this.snapshot,
      "fullscreen",
      this.cachedWidth ?? 120,
      this.theme,
    ).length;
    const maxScroll = Math.max(0, contentLength - viewportRows);

    if (matchesKey(data, "escape") || data === "q") {
      this.options.onClose?.();
      return;
    }

    if (matchesKey(data, "up") || data === "k") {
      this.scrollOffset = Math.max(0, this.scrollOffset - 1);
    } else if (matchesKey(data, "down") || data === "j") {
      this.scrollOffset = Math.min(maxScroll, this.scrollOffset + 1);
    } else if (matchesKey(data, "pageUp") || data === "u") {
      this.scrollOffset = Math.max(0, this.scrollOffset - viewportRows);
    } else if (matchesKey(data, "pageDown") || data === "d") {
      this.scrollOffset = Math.min(maxScroll, this.scrollOffset + viewportRows);
    } else if (data === "g") {
      this.scrollOffset = 0;
    } else if (data === "G") {
      this.scrollOffset = maxScroll;
    } else {
      return;
    }

    this.invalidate();
    this.tui.requestRender();
  }

  invalidate(): void {
    this.cachedWidth = undefined;
    this.cachedLines = undefined;
  }

  private getViewportRows(): number {
    const fallbackRows = process.stdout.rows || 24;
    return Math.max(4, this.options.viewportRows ?? fallbackRows - 4);
  }
}
