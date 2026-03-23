export interface ParsedRlmArgs {
  raw: string;
  path: string;
  question?: string;
}

export type ParsedRlmArgsResult =
  | { ok: true; value: ParsedRlmArgs }
  | { ok: false; code: "missing_path"; message: string };

export function parseRlmArgs(args: unknown): ParsedRlmArgsResult {
  const raw = typeof args === "string" ? args.trim() : "";
  if (raw.length === 0) {
    return {
      ok: false,
      code: "missing_path",
      message: "Usage: /rlm <path> [question]",
    };
  }

  const quoted = parseQuotedPath(raw);
  if (quoted) {
    return {
      ok: true,
      value: {
        raw,
        path: quoted.path,
        question: normalizeOptionalText(quoted.remainder),
      },
    };
  }

  const [path, ...rest] = raw.split(/\s+/);
  if (!path) {
    return {
      ok: false,
      code: "missing_path",
      message: "Usage: /rlm <path> [question]",
    };
  }

  return {
    ok: true,
    value: {
      raw,
      path,
      question: normalizeOptionalText(rest.join(" ")),
    },
  };
}

function parseQuotedPath(raw: string): { path: string; remainder: string } | undefined {
  const quote = raw[0];
  if (quote !== '"' && quote !== "'") {
    return undefined;
  }

  let value = "";
  let escaped = false;

  for (let index = 1; index < raw.length; index += 1) {
    const char = raw[index]!;
    if (escaped) {
      value += char;
      escaped = false;
      continue;
    }

    if (char === "\\") {
      escaped = true;
      continue;
    }

    if (char === quote) {
      return {
        path: value,
        remainder: raw.slice(index + 1).trim(),
      };
    }

    value += char;
  }

  return {
    path: raw.slice(1),
    remainder: "",
  };
}

function normalizeOptionalText(value: string | undefined): string | undefined {
  const normalized = (value ?? "").trim();
  return normalized.length > 0 ? normalized : undefined;
}
