import os from "node:os";
import path from "node:path";
import { readFile, stat } from "node:fs/promises";
import { parseRlmArgs, type ParsedRlmArgs } from "./args";

export const DEFAULT_RLM_MAX_BYTES = 8 * 1024 * 1024;
export const DEFAULT_SUPPORTED_EXTENSIONS = [".md", ".markdown", ".mdx", ".txt", ".rst"];

export type RlmRequestErrorCode =
  | "missing_path"
  | "not_found"
  | "not_a_file"
  | "unreadable"
  | "unsupported_input_type"
  | "empty_input"
  | "too_large";

export interface RlmRequestError {
  code: RlmRequestErrorCode;
  message: string;
}

export interface RlmRequest {
  raw: string;
  path: string;
  absolutePath: string;
  question?: string;
  content: string;
  sizeBytes: number;
  extension: string;
}

export type RlmRequestResult =
  | { ok: true; value: RlmRequest }
  | { ok: false; error: RlmRequestError };

export interface ResolveRlmRequestOptions {
  cwd?: string;
  maxBytes?: number;
  supportedExtensions?: string[];
  statImpl?: typeof stat;
  readFileImpl?: typeof readFile;
}

export async function resolveRlmRequest(
  args: unknown,
  options: ResolveRlmRequestOptions = {},
): Promise<RlmRequestResult> {
  const parsed = parseRlmArgs(args);
  if (!parsed.ok) {
    return {
      ok: false,
      error: {
        code: parsed.code,
        message: parsed.message,
      },
    };
  }

  return resolveParsedRlmRequest(parsed.value, options);
}

export async function resolveParsedRlmRequest(
  parsed: ParsedRlmArgs,
  options: ResolveRlmRequestOptions = {},
): Promise<RlmRequestResult> {
  const cwd = options.cwd ?? process.cwd();
  const maxBytes = options.maxBytes ?? DEFAULT_RLM_MAX_BYTES;
  const supportedExtensions = (options.supportedExtensions ?? DEFAULT_SUPPORTED_EXTENSIONS).map(
    (extension) => extension.toLowerCase(),
  );
  const statImpl = options.statImpl ?? stat;
  const readFileImpl = options.readFileImpl ?? readFile;
  const absolutePath = path.resolve(cwd, expandHomeDirectory(parsed.path));
  const extension = path.extname(absolutePath).toLowerCase();

  if (!supportedExtensions.includes(extension)) {
    return failure(
      "unsupported_input_type",
      `RLM currently supports ${supportedExtensions.join(", ")} files; received ${extension || "an extensionless path"}.`,
    );
  }

  let fileStat: Awaited<ReturnType<typeof statImpl>>;
  try {
    fileStat = await statImpl(absolutePath);
  } catch (error) {
    return failure(mapFsErrorToCode(error), formatFsErrorMessage(parsed.path, error));
  }

  if (!fileStat.isFile()) {
    return failure("not_a_file", `RLM expects a file path, but '${parsed.path}' is not a file.`);
  }

  if (fileStat.size === 0) {
    return failure("empty_input", `RLM cannot process an empty file: '${parsed.path}'.`);
  }

  if (fileStat.size > maxBytes) {
    return failure(
      "too_large",
      `RLM currently supports files up to ${maxBytes} bytes; '${parsed.path}' is ${fileStat.size} bytes.`,
    );
  }

  let content: string;
  try {
    content = await readFileImpl(absolutePath, "utf8");
  } catch (error) {
    return failure(mapFsErrorToCode(error), formatFsErrorMessage(parsed.path, error));
  }

  if (content.trim().length === 0) {
    return failure("empty_input", `RLM cannot process a blank file: '${parsed.path}'.`);
  }

  return {
    ok: true,
    value: {
      raw: parsed.raw,
      path: parsed.path,
      absolutePath,
      question: parsed.question,
      content,
      sizeBytes: fileStat.size,
      extension,
    },
  };
}

function expandHomeDirectory(inputPath: string): string {
  if (inputPath === "~") {
    return os.homedir();
  }

  if (inputPath.startsWith("~/") || inputPath.startsWith("~\\")) {
    return path.join(os.homedir(), inputPath.slice(2));
  }

  return inputPath;
}

function failure(code: RlmRequestErrorCode, message: string): RlmRequestResult {
  return {
    ok: false,
    error: { code, message },
  };
}

function mapFsErrorToCode(error: unknown): RlmRequestErrorCode {
  const code = getFsErrorCode(error);
  if (code === "ENOENT") {
    return "not_found";
  }
  return "unreadable";
}

function formatFsErrorMessage(inputPath: string, error: unknown): string {
  const code = getFsErrorCode(error);
  if (code === "ENOENT") {
    return `RLM could not find '${inputPath}'.`;
  }

  return `RLM could not read '${inputPath}'.`;
}

function getFsErrorCode(error: unknown): string | undefined {
  if (!error || typeof error !== "object") {
    return undefined;
  }

  const candidate = error as { code?: unknown };
  return typeof candidate.code === "string" ? candidate.code : undefined;
}
