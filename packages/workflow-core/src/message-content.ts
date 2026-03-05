interface TextBlock {
  type?: unknown;
  text?: unknown;
}

interface TextContentBlock extends TextBlock {
  type: "text";
  text: string;
}

interface MessageLike {
  role?: unknown;
  content?: unknown;
}

export function parseTrimmedStringArg(args: unknown): string | undefined {
  if (typeof args !== "string") {
    return undefined;
  }

  const value = args.trim();
  return value.length > 0 ? value : undefined;
}

export function extractLastRoleText(
  messages: unknown[],
  role: "user" | "assistant",
): string | undefined {
  const typedMessages = messages.filter((message): message is MessageLike => {
    return typeof message === "object" && message !== null;
  });

  const message =
    role === "assistant"
      ? typedMessages.at(-1)
      : [...typedMessages].reverse().find((entry) => entry.role === "user");

  if (!message || message.role !== role || !Array.isArray(message.content)) {
    return undefined;
  }

  const text = message.content
    .filter((block): block is TextBlock => typeof block === "object" && block !== null)
    .filter(isTextContentBlock)
    .map((block) => block.text)
    .join("\n")
    .trim();

  return text.length > 0 ? text : undefined;
}

export type LastAssistantTextResult =
  | { kind: "ok"; text: string }
  | { kind: "empty" }
  | { kind: "invalid_payload" }
  | { kind: "no_assistant_message" };

export function getLastAssistantTextResult(messages: unknown[]): LastAssistantTextResult {
  const typedMessages = messages.filter((message): message is MessageLike => {
    return typeof message === "object" && message !== null;
  });

  const message = typedMessages.at(-1);
  if (!message) {
    return { kind: "no_assistant_message" };
  }

  if (message.role !== "assistant") {
    return { kind: "no_assistant_message" };
  }

  if (!Array.isArray(message.content)) {
    return { kind: "invalid_payload" };
  }

  const typedContentBlocks = message.content.filter((block): block is TextBlock => {
    return typeof block === "object" && block !== null;
  });

  if (typedContentBlocks.length !== message.content.length) {
    return { kind: "invalid_payload" };
  }

  const text = typedContentBlocks
    .filter(isTextContentBlock)
    .map((block) => block.text)
    .join("\n")
    .trim();

  if (text.length === 0) {
    return { kind: "empty" };
  }

  return { kind: "ok", text };
}

export function extractLastAssistantText(messages: unknown[]): string | undefined {
  const result = getLastAssistantTextResult(messages);
  return result.kind === "ok" ? result.text : undefined;
}

export function extractLastUserText(messages: unknown[]): string | undefined {
  return extractLastRoleText(messages, "user");
}

function isTextContentBlock(block: TextBlock): block is TextContentBlock {
  return block.type === "text" && typeof block.text === "string";
}
