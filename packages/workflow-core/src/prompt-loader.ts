import * as fs from "node:fs";
import * as path from "node:path";

export class PromptLoadError extends Error {
  constructor(
    public readonly code: "PROMPT_READ_FAILED",
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "PromptLoadError";
  }
}

export type PromptLoadResult<T> =
  | {
      ok: true;
      prompts: T;
    }
  | {
      ok: false;
      error: PromptLoadError;
    };

export function loadPromptFiles<Keys extends string>(
  promptDirectory: string,
  fileNames: Record<Keys, string>,
): PromptLoadResult<Record<Keys, string>> {
  try {
    const prompts = Object.fromEntries(
      Object.entries(fileNames).map(([key, fileName]) => [
        key,
        readPromptFile(promptDirectory, fileName),
      ]),
    ) as Record<Keys, string>;

    return { ok: true, prompts };
  } catch (error) {
    return buildPromptLoadFailure(promptDirectory, error);
  }
}

function buildPromptLoadFailure(promptDirectory: string, error: unknown): PromptLoadResult<never> {
  const reason = error instanceof Error ? `${error.name}: ${error.message}` : "unknown I/O error";
  return {
    ok: false,
    error: new PromptLoadError(
      "PROMPT_READ_FAILED",
      `failed to load prompt bundle from '${promptDirectory}': ${reason}`,
      { cause: error instanceof Error ? error : undefined },
    ),
  };
}

function readPromptFile(promptDirectory: string, fileName: string): string {
  const filePath = path.join(promptDirectory, fileName);
  const content = fs.readFileSync(filePath, "utf-8").trim();

  if (!content) {
    throw new Error(`prompt file '${filePath}' is empty`);
  }

  return content;
}
