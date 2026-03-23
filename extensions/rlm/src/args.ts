export interface ParsedRlmArgs {
  raw: string;
  question: string;
}

export type ParsedRlmArgsResult =
  | { ok: true; value: ParsedRlmArgs }
  | { ok: false; code: "missing_question"; message: string };

export function parseRlmArgs(args: unknown): ParsedRlmArgsResult {
  const raw = typeof args === "string" ? args.trim() : "";
  if (raw.length === 0) {
    return {
      ok: false,
      code: "missing_question",
      message: "Usage: /rlm <question>",
    };
  }

  return {
    ok: true,
    value: {
      raw,
      question: raw,
    },
  };
}
