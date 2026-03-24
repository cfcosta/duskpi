export const DEFAULT_RLM_PROMPT_PROFILE = "default";
export const SUPPORTED_RLM_PROMPT_PROFILES = ["default", "qwen3-8b"] as const;

export type RlmPromptProfile = (typeof SUPPORTED_RLM_PROMPT_PROFILES)[number];

export interface ParsedRlmArgs {
  raw: string;
  question: string;
  promptProfile: RlmPromptProfile;
}

export type ParsedRlmArgsResult =
  | { ok: true; value: ParsedRlmArgs }
  | { ok: false; code: "missing_question" | "invalid_prompt_profile"; message: string };

export function parseRlmArgs(args: unknown): ParsedRlmArgsResult {
  const raw = typeof args === "string" ? args.trim() : "";
  if (raw.length === 0) {
    return {
      ok: false,
      code: "missing_question",
      message: "Usage: /rlm [--prompt-profile <default|qwen3-8b>] <question>",
    };
  }

  const parsedFlag = parsePromptProfileFlag(raw);
  if (!parsedFlag) {
    return {
      ok: true,
      value: {
        raw,
        question: raw,
        promptProfile: DEFAULT_RLM_PROMPT_PROFILE,
      },
    };
  }

  if (!parsedFlag.profile) {
    return {
      ok: false,
      code: "invalid_prompt_profile",
      message: `Usage: /rlm [--prompt-profile <${SUPPORTED_RLM_PROMPT_PROFILES.join("|")}>] <question>`,
    };
  }

  if (parsedFlag.question.length === 0) {
    return {
      ok: false,
      code: "missing_question",
      message: "Usage: /rlm [--prompt-profile <default|qwen3-8b>] <question>",
    };
  }

  return {
    ok: true,
    value: {
      raw,
      question: parsedFlag.question,
      promptProfile: parsedFlag.profile,
    },
  };
}

function parsePromptProfileFlag(
  raw: string,
): { profile?: RlmPromptProfile; question: string } | undefined {
  const match = raw.match(
    /^--(?:prompt-profile|profile)(?:=(?<inline>[A-Za-z0-9._-]+)|\s+(?<separate>[A-Za-z0-9._-]+))(?:\s+(?<question>[\s\S]*))?$/,
  );
  if (!match) {
    return undefined;
  }

  const requestedProfile = (match.groups?.inline ?? match.groups?.separate ?? "").trim();
  if (!isPromptProfile(requestedProfile)) {
    return {
      profile: undefined,
      question: (match.groups?.question ?? "").trim(),
    };
  }

  return {
    profile: requestedProfile,
    question: (match.groups?.question ?? "").trim(),
  };
}

function isPromptProfile(value: string): value is RlmPromptProfile {
  return SUPPORTED_RLM_PROMPT_PROFILES.includes(value as RlmPromptProfile);
}
