import {
  extractLastAssistantText,
  extractLastUserText,
  parseTrimmedStringArg,
} from "../../packages/workflow-core/src/index";

export function parseScopeArg(args: unknown): string | undefined {
  return parseTrimmedStringArg(args);
}

export function extractLastAssistantTextFromMessages(messages: unknown[]): string | undefined {
  return extractLastAssistantText(messages);
}

export const extractAssistantText = extractLastAssistantTextFromMessages;

export { extractLastUserText };
