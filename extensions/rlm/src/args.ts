export const DEFAULT_RLM_PROMPT_PROFILE = "default";
export const SUPPORTED_RLM_PROMPT_PROFILES = ["default", "qwen3-8b"] as const;
export const DEFAULT_RLM_SUBCALL_POLICY = "enabled";
export const SUPPORTED_RLM_SUBCALL_POLICIES = ["enabled", "disabled"] as const;

export type RlmPromptProfile = (typeof SUPPORTED_RLM_PROMPT_PROFILES)[number];
export type RlmSubcallPolicy = (typeof SUPPORTED_RLM_SUBCALL_POLICIES)[number];

export interface ParsedRlmArgs {
  raw: string;
  question: string;
  promptProfile: RlmPromptProfile;
  childPromptProfile: RlmPromptProfile;
  subcallPolicy: RlmSubcallPolicy;
}

export type ParsedRlmArgsResult =
  | { ok: true; value: ParsedRlmArgs }
  | {
      ok: false;
      code: "missing_question" | "invalid_prompt_profile" | "invalid_subcall_policy";
      message: string;
    };

export function parseRlmArgs(args: unknown): ParsedRlmArgsResult {
  const raw = typeof args === "string" ? args.trim() : "";
  if (raw.length === 0) {
    return missingQuestionResult();
  }

  let remaining = raw;
  let promptProfile: RlmPromptProfile = DEFAULT_RLM_PROMPT_PROFILE;
  let childPromptProfile: RlmPromptProfile = DEFAULT_RLM_PROMPT_PROFILE;
  let subcallPolicy: RlmSubcallPolicy = DEFAULT_RLM_SUBCALL_POLICY;

  while (remaining.length > 0) {
    if (consumeBareFlag(remaining, "--no-subcalls")) {
      subcallPolicy = "disabled";
      remaining = remaining.slice("--no-subcalls".length).trimStart();
      continue;
    }

    const parsedFlag = parseLeadingFlag(remaining);
    if (!parsedFlag) {
      break;
    }

    remaining = parsedFlag.rest.trimStart();
    switch (parsedFlag.name) {
      case "prompt-profile":
      case "profile": {
        if (!isRlmPromptProfile(parsedFlag.value)) {
          return invalidPromptProfileResult();
        }
        promptProfile = parsedFlag.value;
        if (childPromptProfile === DEFAULT_RLM_PROMPT_PROFILE) {
          childPromptProfile = parsedFlag.value;
        }
        break;
      }
      case "child-prompt-profile": {
        if (!isRlmPromptProfile(parsedFlag.value)) {
          return invalidPromptProfileResult();
        }
        childPromptProfile = parsedFlag.value;
        break;
      }
      case "subcalls": {
        const normalized = normalizeSubcallPolicy(parsedFlag.value);
        if (!normalized) {
          return invalidSubcallPolicyResult();
        }
        subcallPolicy = normalized;
        break;
      }
      default:
        break;
    }
  }

  const question = remaining.trim();
  if (question.length === 0) {
    return missingQuestionResult();
  }

  return {
    ok: true,
    value: {
      raw,
      question,
      promptProfile,
      childPromptProfile,
      subcallPolicy,
    },
  };
}

export function isRlmPromptProfile(value: string): value is RlmPromptProfile {
  return SUPPORTED_RLM_PROMPT_PROFILES.includes(value as RlmPromptProfile);
}

function parseLeadingFlag(
  input: string,
): { name: string; value: string; rest: string } | undefined {
  const match = input.match(
    /^--(?<name>prompt-profile|profile|child-prompt-profile|subcalls)(?:=(?<inline>\S+)|\s+(?<separate>\S+))(?<rest>(?:\s+[\s\S]*)?)$/,
  );
  if (!match) {
    return undefined;
  }

  const value = (match.groups?.inline ?? match.groups?.separate ?? "").trim();
  if (value.length === 0) {
    return undefined;
  }

  return {
    name: match.groups?.name ?? "",
    value,
    rest: match.groups?.rest ?? "",
  };
}

function normalizeSubcallPolicy(value: string): RlmSubcallPolicy | undefined {
  const normalized = value.trim().toLowerCase();
  if (normalized === "enabled" || normalized === "on") {
    return "enabled";
  }
  if (normalized === "disabled" || normalized === "off") {
    return "disabled";
  }
  return undefined;
}

function consumeBareFlag(input: string, flag: string): boolean {
  return input === flag || input.startsWith(`${flag} `);
}

function missingQuestionResult(): ParsedRlmArgsResult {
  return {
    ok: false,
    code: "missing_question",
    message:
      "Usage: /rlm [--prompt-profile <default|qwen3-8b>] [--child-prompt-profile <default|qwen3-8b>] [--subcalls <enabled|disabled>] <question>",
  };
}

function invalidPromptProfileResult(): ParsedRlmArgsResult {
  return {
    ok: false,
    code: "invalid_prompt_profile",
    message:
      "Usage: /rlm [--prompt-profile <default|qwen3-8b>] [--child-prompt-profile <default|qwen3-8b>] [--subcalls <enabled|disabled>] <question>",
  };
}

function invalidSubcallPolicyResult(): ParsedRlmArgsResult {
  return {
    ok: false,
    code: "invalid_subcall_policy",
    message:
      "Usage: /rlm [--prompt-profile <default|qwen3-8b>] [--child-prompt-profile <default|qwen3-8b>] [--subcalls <enabled|disabled>] <question>",
  };
}
