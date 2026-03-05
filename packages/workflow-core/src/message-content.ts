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

export function extractLastAssistantText(messages: unknown[]): string | undefined {
  return extractLastRoleText(messages, "assistant");
}

export function extractLastUserText(messages: unknown[]): string | undefined {
  return extractLastRoleText(messages, "user");
}

function isTextContentBlock(block: TextBlock): block is TextContentBlock {
  return block.type === "text" && typeof block.text === "string";
}
