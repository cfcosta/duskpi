const DESTRUCTIVE_PATTERNS = [
  /\brm\b/i,
  /\brmdir\b/i,
  /\bmv\b/i,
  /\bcp\b/i,
  /\bmkdir\b/i,
  /\btouch\b/i,
  /\bchmod\b/i,
  /\bchown\b/i,
  /\bchgrp\b/i,
  /\bln\b/i,
  /\btee\b/i,
  /\btruncate\b/i,
  /\bdd\b/i,
  /\bshred\b/i,
  /(^|[^<])>(?!>)/,
  />>/,
  /\bnpm\s+(install|uninstall|update|ci|link|publish)\b/i,
  /\byarn\s+(add|remove|install|publish)\b/i,
  /\bpnpm\s+(add|remove|install|publish)\b/i,
  /\bpip\s+(install|uninstall)\b/i,
  /\bapt(-get)?\s+(install|remove|purge|update|upgrade)\b/i,
  /\bbrew\s+(install|uninstall|upgrade)\b/i,
  /\bgit\s+(add|commit|push|pull|merge|rebase|reset|checkout|branch\s+-[dD]|stash|cherry-pick|revert|tag|init|clone)\b/i,
  /\bsudo\b/i,
  /\bsu\b/i,
  /\bkill\b/i,
  /\bpkill\b/i,
  /\bkillall\b/i,
  /\breboot\b/i,
  /\bshutdown\b/i,
  /\bsystemctl\s+(start|stop|restart|enable|disable)\b/i,
  /\bservice\s+\S+\s+(start|stop|restart)\b/i,
  /\b(vim?|nano|emacs|code|subl)\b/i,
];

const SAFE_PATTERNS = [
  /^\s*cat\b/,
  /^\s*head\b/,
  /^\s*tail\b/,
  /^\s*less\b/,
  /^\s*more\b/,
  /^\s*grep\b/,
  /^\s*find\b/,
  /^\s*ls\b/,
  /^\s*pwd\b/,
  /^\s*echo\b/,
  /^\s*printf\b/,
  /^\s*wc\b/,
  /^\s*sort\b/,
  /^\s*uniq\b/,
  /^\s*diff\b/,
  /^\s*file\b/,
  /^\s*stat\b/,
  /^\s*du\b/,
  /^\s*df\b/,
  /^\s*tree\b/,
  /^\s*which\b/,
  /^\s*whereis\b/,
  /^\s*type\b/,
  /^\s*env\b/,
  /^\s*printenv\b/,
  /^\s*uname\b/,
  /^\s*whoami\b/,
  /^\s*id\b/,
  /^\s*date\b/,
  /^\s*cal\b/,
  /^\s*uptime\b/,
  /^\s*ps\b/,
  /^\s*top\b/,
  /^\s*htop\b/,
  /^\s*free\b/,
  /^\s*git\s+(status|log|diff|show|branch|remote|config\s+--get)\b/i,
  /^\s*git\s+ls-/i,
  /^\s*npm\s+(list|ls|view|info|search|outdated|audit)\b/i,
  /^\s*yarn\s+(list|info|why|audit)\b/i,
  /^\s*node\s+--version\b/i,
  /^\s*python\s+--version\b/i,
  /^\s*jq\b/,
  /^\s*sed\s+-n\b/i,
  /^\s*awk\b/,
  /^\s*rg\b/,
  /^\s*fd\b/,
];

export function isSafeReadOnlyCommand(command: string): boolean {
  const isDestructive = DESTRUCTIVE_PATTERNS.some((pattern) => pattern.test(command));
  if (isDestructive) return false;
  return SAFE_PATTERNS.some((pattern) => pattern.test(command));
}

export function normalizeArg(input: string): string {
  return input.trim().toLowerCase();
}

export function parseCritiqueVerdict(text: string): "PASS" | "REFINE" | "REJECT" | undefined {
  const lines = text.split(/\r?\n/);
  for (const line of lines) {
    const normalizedLine = line.replace(/\*+/g, "").trim();
    const match = normalizedLine.match(
      /(?:^\d+[.)]\s*)?Verdict\s*(?::|-|–|—)?\s*(PASS|REFINE|REJECT)\b/i,
    );
    if (match) {
      return match[1]?.toUpperCase() as "PASS" | "REFINE" | "REJECT";
    }
  }

  return undefined;
}

export interface TodoItem {
  step: number;
  text: string;
  completed: boolean;
}

export interface PlanStep {
  step: number;
  objective: string;
  label: string;
  targets: string[];
  validation: string[];
  risks: string[];
}

type PlanStepMetadataField = keyof Pick<PlanStep, "targets" | "validation" | "risks">;

function normalizeStructuredLine(text: string): string {
  return text.replace(/\*+/g, "").trim();
}

function normalizePlanFieldText(text: string): string {
  return text
    .replace(/\*{1,2}([^*]+)\*{1,2}/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

function isPlanBoundaryLine(text: string): boolean {
  return /^(goal understanding(?: \(brief\))?|task understanding|evidence gathered|codebase findings|approach options \/ trade-offs|uncertainties? \/ assumptions|open questions? \/ assumptions|risks? and rollback notes?|ready to execute when approved\.?|end with: "ready to execute when approved\.?")$/i.test(
    normalizeStructuredLine(text),
  );
}

function isPlanHeaderLine(line: string): boolean {
  return /^(?:\d+[.)]\s*)?Plan:\s*$/i.test(normalizeStructuredLine(line));
}

function isSkippablePlanStepText(text: string): boolean {
  return (
    text.length <= 5 ||
    !/[a-z]/i.test(text) ||
    /^(step objective|target files\/components|validation method|risks? and rollback notes?|evidence gathered|uncertainties? \/ assumptions|ready to execute when approved\.?)$/i.test(
      text,
    ) ||
    text.startsWith("`") ||
    text.startsWith("/") ||
    text.startsWith("-")
  );
}

function parsePlanMetadataField(
  text: string,
): { field: PlanStepMetadataField; value?: string } | undefined {
  const normalized = text.replace(/^\s*[-*]\s*/, "").trim();
  const match = normalized.match(
    /^(target files\/components|validation method|risks? and rollback notes?)\s*(?::\s*(.*))?$/i,
  );
  if (!match) {
    return undefined;
  }

  const field = /^target/i.test(match[1] ?? "")
    ? "targets"
    : /^validation/i.test(match[1] ?? "")
      ? "validation"
      : "risks";

  return {
    field,
    value: match[2]?.trim(),
  };
}

function appendPlanMetadata(step: PlanStep, field: PlanStepMetadataField, value: string): void {
  const cleaned = normalizePlanFieldText(value.replace(/^\s*[-*]\s*/, ""));
  if (cleaned.length === 0) {
    return;
  }

  step[field].push(cleaned);
}

export function cleanStepText(text: string): string {
  let cleaned = normalizePlanFieldText(text)
    .replace(
      /^(Use|Run|Execute|Create|Write|Read|Check|Verify|Update|Modify|Add|Remove|Delete|Install)\s+(the\s+)?/i,
      "",
    )
    .trim();

  if (cleaned.length > 0) {
    cleaned = cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
  }
  if (cleaned.length > 80) {
    cleaned = `${cleaned.slice(0, 77)}...`;
  }
  return cleaned;
}

export function extractPlanSteps(message: string): PlanStep[] {
  const steps: PlanStep[] = [];
  const lines = message.split(/\r?\n/);
  const planHeaderIndex = lines.findIndex((line) => isPlanHeaderLine(line));

  if (planHeaderIndex === -1) {
    return steps;
  }

  let stepIndent: number | undefined;
  let currentStep: PlanStep | undefined;
  let activeField: PlanStepMetadataField | undefined;

  const finalizeCurrentStep = () => {
    if (!currentStep) {
      return;
    }

    if (currentStep.label.length > 3) {
      steps.push(currentStep);
    }

    currentStep = undefined;
    activeField = undefined;
  };

  for (const line of lines.slice(planHeaderIndex + 1)) {
    if (line.trim().length === 0) {
      activeField = undefined;
      continue;
    }

    const numberedMatch = line.match(/^(\s*)(\d+)[.)]\s+(.*)$/);
    if (numberedMatch) {
      const indent = numberedMatch[1]?.length ?? 0;
      const text = normalizePlanFieldText(numberedMatch[3] ?? "");

      if (stepIndent === undefined) {
        if (isPlanBoundaryLine(text)) {
          break;
        }
        if (isSkippablePlanStepText(text)) {
          continue;
        }
        stepIndent = indent;
      }

      if (indent < stepIndent) {
        break;
      }

      if (indent === stepIndent) {
        if (isPlanBoundaryLine(text)) {
          break;
        }
        if (isSkippablePlanStepText(text)) {
          continue;
        }

        finalizeCurrentStep();
        currentStep = {
          step: Number(numberedMatch[2]),
          objective: text,
          label: cleanStepText(text),
          targets: [],
          validation: [],
          risks: [],
        };
        activeField = undefined;
        continue;
      }

      if (currentStep && activeField) {
        appendPlanMetadata(currentStep, activeField, numberedMatch[3] ?? "");
      }
      continue;
    }

    if (!currentStep) {
      continue;
    }

    const indent = line.match(/^(\s*)/)?.[1]?.length ?? 0;
    if (stepIndent !== undefined && indent <= stepIndent) {
      if (isPlanBoundaryLine(line)) {
        break;
      }
      activeField = undefined;
      continue;
    }

    const metadata = parsePlanMetadataField(line);
    if (metadata) {
      activeField = metadata.field;
      if (metadata.value) {
        appendPlanMetadata(currentStep, metadata.field, metadata.value);
      }
      continue;
    }

    const listItemMatch = line.match(/^\s*[-*]\s+(.*)$/);
    if (listItemMatch && activeField) {
      appendPlanMetadata(currentStep, activeField, listItemMatch[1] ?? "");
      continue;
    }

    if (activeField) {
      appendPlanMetadata(currentStep, activeField, line);
    }
  }

  finalizeCurrentStep();
  return steps;
}

export function extractTodoItems(message: string): TodoItem[] {
  return extractPlanSteps(message).map((step) => ({
    step: step.step,
    text: step.label,
    completed: false,
  }));
}

export function extractDoneSteps(message: string): number[] {
  const steps: number[] = [];
  for (const match of message.matchAll(/\[DONE:(\d+)\]/gi)) {
    const step = Number(match[1]);
    if (Number.isFinite(step)) {
      steps.push(step);
    }
  }
  return steps;
}

export function markCompletedSteps(text: string, items: TodoItem[]): number {
  const doneSteps = extractDoneSteps(text);
  for (const step of doneSteps) {
    const item = items.find((candidate) => candidate.step === step);
    if (item) {
      item.completed = true;
    }
  }
  return doneSteps.length;
}
