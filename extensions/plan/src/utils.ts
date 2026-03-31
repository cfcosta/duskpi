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
  skipped?: boolean;
}

function normalizePlanFieldText(text: string): string {
  return text
    .replace(/\*{1,2}([^*]+)\*{1,2}/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
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

export function extractSkippedSteps(message: string): number[] {
  const steps: number[] = [];
  for (const match of message.matchAll(/\[SKIPPED:(\d+)\]/gi)) {
    const step = Number(match[1]);
    if (Number.isFinite(step)) {
      steps.push(step);
    }
  }
  return steps;
}

export function markTodoItemsCompleted(items: TodoItem[], completedSteps: number[]): number {
  for (const step of completedSteps) {
    const item = items.find((candidate) => candidate.step === step);
    if (item) {
      item.completed = true;
      item.skipped = false;
    }
  }
  return completedSteps.length;
}

export function markTodoItemsSkipped(items: TodoItem[], skippedSteps: number[]): number {
  for (const step of skippedSteps) {
    const item = items.find((candidate) => candidate.step === step);
    if (item) {
      item.skipped = true;
      item.completed = false;
    }
  }
  return skippedSteps.length;
}

export function markCompletedSteps(text: string, items: TodoItem[]): number {
  return markTodoItemsCompleted(items, extractDoneSteps(text));
}

export type AutoPlanOutputComplianceIssue =
  | "asks_user_decision"
  | "requests_approval"
  | "defers_instead_of_inferring";

const AUTOPLAN_ASKS_USER_DECISION_PATTERNS = [
  /\bneed (your|user) (input|decision|choice|clarification|feedback)\b/i,
  /\bi need (you|the user) to decide\b/i,
  /\bask (the )?user\b/i,
  /\bwhat would you like\b/i,
  /\blet me know (which|whether|what)\b/i,
  /\bplease choose\b/i,
  /\bwhich option\b/i,
];

const AUTOPLAN_REQUESTS_APPROVAL_PATTERNS = [
  /\bdo you approve\b/i,
  /\bplease approve\b/i,
  /\bneed(?:s)? approval\b/i,
  /\brequest approval\b/i,
  /\bawait(?:ing)? approval\b/i,
  /\bapproval (?:from you|is required)\b/i,
  /\bbefore proceeding[, ]+approve\b/i,
];

const AUTOPLAN_DEFERS_INSTEAD_OF_INFERRING_PATTERNS = [
  /\b(?:can(?:not|'t)|cannot) proceed until\b/i,
  /\bwaiting for (?:your|user) (?:input|decision|approval)\b/i,
  /\bonce you (?:confirm|decide|choose)\b/i,
  /\bafter you (?:confirm|decide|choose)\b/i,
  /\bneed more information\b/i,
  /\bneed clarification\b/i,
  /\bwithout (?:that|your) (?:decision|input|approval)\b/i,
];

export function detectAutoPlanOutputComplianceIssues(
  text: string,
): AutoPlanOutputComplianceIssue[] {
  const issues: AutoPlanOutputComplianceIssue[] = [];

  if (AUTOPLAN_ASKS_USER_DECISION_PATTERNS.some((pattern) => pattern.test(text))) {
    issues.push("asks_user_decision");
  }
  if (AUTOPLAN_REQUESTS_APPROVAL_PATTERNS.some((pattern) => pattern.test(text))) {
    issues.push("requests_approval");
  }
  if (AUTOPLAN_DEFERS_INSTEAD_OF_INFERRING_PATTERNS.some((pattern) => pattern.test(text))) {
    issues.push("defers_instead_of_inferring");
  }

  return issues;
}
