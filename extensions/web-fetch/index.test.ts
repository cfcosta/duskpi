import { afterEach, expect, mock, test } from "bun:test";
import type { ExtensionContext } from "../../packages/workflow-core/src/index";

class MockText {
  text: string;

  constructor(text: string) {
    this.text = text;
  }
}

mock.module("@mariozechner/pi-tui", () => ({
  Text: MockText,
}));

mock.module("@sinclair/typebox", () => ({
  Type: {
    Object: (value: unknown) => value,
    String: (value: unknown) => value,
    Optional: (value: unknown) => value,
    Integer: (value: unknown) => value,
  },
}));

mock.module("@mariozechner/pi-coding-agent", () => {
  const DEFAULT_MAX_LINES = 2000;
  const DEFAULT_MAX_BYTES = 50 * 1024;

  return {
    DEFAULT_MAX_LINES,
    DEFAULT_MAX_BYTES,
    formatSize(bytes: number) {
      if (bytes < 1024) return `${bytes}B`;
      if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
      return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
    },
    truncateHead(content: string, options: { maxLines?: number; maxBytes?: number } = {}) {
      const maxLines = options.maxLines ?? DEFAULT_MAX_LINES;
      const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
      const totalBytes = Buffer.byteLength(content, "utf-8");
      const lines = content.split("\n");
      const totalLines = lines.length;

      if (totalLines <= maxLines && totalBytes <= maxBytes) {
        return {
          content,
          truncated: false,
          truncatedBy: null,
          totalLines,
          totalBytes,
          outputLines: totalLines,
          outputBytes: totalBytes,
          lastLinePartial: false,
          firstLineExceedsLimit: false,
          maxLines,
          maxBytes,
        };
      }

      const firstLineBytes = Buffer.byteLength(lines[0] ?? "", "utf-8");
      if (firstLineBytes > maxBytes) {
        return {
          content: "",
          truncated: true,
          truncatedBy: "bytes",
          totalLines,
          totalBytes,
          outputLines: 0,
          outputBytes: 0,
          lastLinePartial: false,
          firstLineExceedsLimit: true,
          maxLines,
          maxBytes,
        };
      }

      const outputLinesArr: string[] = [];
      let outputBytesCount = 0;
      let truncatedBy: "lines" | "bytes" = "lines";

      for (let i = 0; i < lines.length && i < maxLines; i += 1) {
        const line = lines[i] ?? "";
        const lineBytes = Buffer.byteLength(line, "utf-8") + (i > 0 ? 1 : 0);
        if (outputBytesCount + lineBytes > maxBytes) {
          truncatedBy = "bytes";
          break;
        }
        outputLinesArr.push(line);
        outputBytesCount += lineBytes;
      }

      if (outputLinesArr.length >= maxLines && outputBytesCount <= maxBytes) {
        truncatedBy = "lines";
      }

      const outputContent = outputLinesArr.join("\n");
      return {
        content: outputContent,
        truncated: true,
        truncatedBy,
        totalLines,
        totalBytes,
        outputLines: outputLinesArr.length,
        outputBytes: Buffer.byteLength(outputContent, "utf-8"),
        lastLinePartial: false,
        firstLineExceedsLimit: false,
        maxLines,
        maxBytes,
      };
    },
  };
});

const lookupMock = mock(async (_hostname: string) => [{ address: "93.184.216.34", family: 4 }]);
mock.module("node:dns/promises", () => ({
  lookup: lookupMock,
}));

const { default: fetchExtension } = await import("./index");

interface RegisteredTool {
  name: string;
  execute: (...args: any[]) => Promise<unknown> | unknown;
  renderResult?: (...args: any[]) => unknown;
}

interface RegisteredCommand {
  description: string;
  handler: (args: unknown, ctx: ExtensionContext) => Promise<void> | void;
}

function createContext(options: { hasUI?: boolean; editorValue?: string; isIdle?: boolean } = {}) {
  const notifications: Array<{ message: string; level?: string }> = [];
  const statuses: Array<{ id: string; status: string | undefined }> = [];
  const ctx = {
    hasUI: options.hasUI ?? false,
    isIdle() {
      return options.isIdle ?? true;
    },
    ui: {
      theme: {
        fg: (_color: string, text: string) => text,
        strikethrough: (text: string) => text,
      },
      notify(message: string, level?: string) {
        notifications.push({ message, level });
      },
      setStatus(id: string, status: string | undefined) {
        statuses.push({ id, status });
      },
      setWidget() {},
      async select() {
        return undefined;
      },
      async editor() {
        return options.editorValue;
      },
      async custom() {
        return undefined as never;
      },
      setTheme() {
        return { success: true } as const;
      },
    },
  } satisfies ExtensionContext;

  return { ctx, notifications, statuses };
}

function createHarness() {
  const tools = new Map<string, RegisteredTool>();
  const commands = new Map<string, RegisteredCommand>();
  const sentMessages: Array<{
    customType?: string;
    content?: unknown;
    display?: boolean;
    details?: unknown;
  }> = [];
  const sentUserMessages: Array<{ content: unknown; options?: unknown }> = [];
  const pi = {
    registerTool(definition: RegisteredTool) {
      tools.set(definition.name, definition);
    },
    registerCommand(name: string, definition: RegisteredCommand) {
      commands.set(name, definition);
    },
    sendMessage(message: {
      customType?: string;
      content?: unknown;
      display?: boolean;
      details?: unknown;
    }) {
      sentMessages.push(message);
    },
    sendUserMessage(content: unknown, options?: unknown) {
      sentUserMessages.push({ content, options });
    },
  };

  fetchExtension(pi as never);

  return {
    tools,
    commands,
    sentMessages,
    sentUserMessages,
    getTool(name: string) {
      const tool = tools.get(name);
      expect(tool).toBeDefined();
      return tool!;
    },
    getCommand(name: string) {
      const command = commands.get(name);
      expect(command).toBeDefined();
      return command!;
    },
  };
}

const { ctx } = createContext();
const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  lookupMock.mockClear();
});

test("registers fetch_content and /web-fetch", () => {
  const harness = createHarness();
  expect(harness.tools.has("fetch_content")).toBe(true);
  expect(harness.commands.has("web-fetch")).toBe(true);
});

test("fetch_content fetches a page and extracts readable content", async () => {
  globalThis.fetch = mock(async (input: RequestInfo | URL) => {
    const url = String(input);
    expect(url).toBe("https://example.com/article");

    return new Response(
      "<html><head><title>Example title</title></head><body><article><h1>Example title</h1><p>Hello world.</p><p>Readable text.</p></article></body></html>",
      { status: 200, headers: { "content-type": "text/html" } },
    );
  }) as typeof fetch;

  const harness = createHarness();
  const tool = harness.getTool("fetch_content");
  const result = (await tool.execute(
    "tool-call-1",
    { url: "https://example.com/article", max_chars: 5000 },
    new AbortController().signal,
    undefined,
    ctx,
  )) as {
    content: Array<{ type: string; text: string }>;
    details: { title?: string; content: string; final_url?: string };
  };

  expect(lookupMock).toHaveBeenCalledWith("example.com", { all: true });
  expect(result.details.title).toBe("Example title");
  expect(result.details.content).toContain("Hello world.");
  expect(result.details.final_url).toBe("https://example.com/article");
  expect(result.content[0]?.text).toContain("Fetched content from: https://example.com/article");
});

test("/web-fetch injects fetched content into session context", async () => {
  globalThis.fetch = mock(
    async () =>
      new Response(
        "<html><body><main><h1>Docs</h1><p>One paragraph.</p><p>Two paragraph.</p></main></body></html>",
        { status: 200, headers: { "content-type": "text/html" } },
      ),
  ) as typeof fetch;

  const harness = createHarness();
  const command = harness.getCommand("web-fetch");

  await command.handler("https://example.com/docs", createContext().ctx);

  expect(harness.sentMessages).toHaveLength(0);
  expect(harness.sentUserMessages).toHaveLength(1);
  expect(String(harness.sentUserMessages[0]?.content)).toContain(
    "Fetched readable content from https://example.com/docs.",
  );
  expect(String(harness.sentUserMessages[0]?.content)).toContain("One paragraph.");
});

test("/web-fetch prompts for a URL when none is provided", async () => {
  globalThis.fetch = mock(
    async () =>
      new Response(
        "<html><body><article><h1>Prompted</h1><p>Fetched via editor.</p></article></body></html>",
        { status: 200, headers: { "content-type": "text/html" } },
      ),
  ) as typeof fetch;

  const harness = createHarness();
  const command = harness.getCommand("web-fetch");
  const { ctx: interactiveCtx } = createContext({
    hasUI: true,
    editorValue: "https://example.com/prompted",
  });

  await command.handler("", interactiveCtx);

  expect(harness.sentUserMessages).toHaveLength(1);
  expect(String(harness.sentUserMessages[0]?.content)).toContain(
    "Fetched readable content from https://example.com/prompted.",
  );
});

test("fetch_content returns an error for blocked local URLs", async () => {
  const harness = createHarness();
  const tool = harness.getTool("fetch_content");
  const result = (await tool.execute(
    "tool-call-2",
    { url: "http://localhost/private" },
    new AbortController().signal,
    undefined,
    ctx,
  )) as { content: Array<{ type: string; text: string }> };

  expect(result.content[0]?.text).toContain("blocked host");
});

test("fetch_content truncates long multiline output like read", async () => {
  const lines = Array.from({ length: 2500 }, (_, i) => `<p>Line ${i + 1}</p>`).join("");
  globalThis.fetch = mock(
    async () =>
      new Response(`<html><body><article><h1>Many lines</h1>${lines}</article></body></html>`, {
        status: 200,
        headers: { "content-type": "text/html" },
      }),
  ) as typeof fetch;

  const harness = createHarness();
  const tool = harness.getTool("fetch_content");
  const result = (await tool.execute(
    "tool-call-3",
    { url: "https://example.com/many-lines", max_chars: 50000 },
    new AbortController().signal,
    undefined,
    ctx,
  )) as { content: Array<{ type: string; text: string }> };

  expect(result.content[0]?.text).toContain("[Showing lines 1-");
  expect(result.content[0]?.text).toContain("Use fetch_content with a lower max_chars value");
});

test("fetch_content renderResult collapses multiline output", async () => {
  const harness = createHarness();
  const tool = harness.getTool("fetch_content");
  const rendered = tool.renderResult?.(
    {
      content: [{ type: "text", text: "First line\nSecond line\nThird line" }],
      details: {},
    },
    { expanded: false, isPartial: false },
    {
      fg: (_color: string, text: string) => text,
    },
  ) as MockText;

  expect(rendered.text).toContain("First line");
  expect(rendered.text).toContain("2 more lines");
  expect(rendered.text).not.toContain("Second line");
});

test("fetch_content renderResult expands to the full fetched text", async () => {
  const harness = createHarness();
  const tool = harness.getTool("fetch_content");
  const rendered = tool.renderResult?.(
    {
      content: [
        {
          type: "text",
          text: "Fetched content from: https://example.com\n\n[Showing lines 1-1 of 3.]",
        },
      ],
      details: {
        url: "https://example.com",
        final_url: "https://example.com",
        title: "Example",
        content: "Line one\nLine two\nLine three",
        content_length: 26,
        truncated: false,
      },
    },
    { expanded: true, isPartial: false },
    {
      fg: (_color: string, text: string) => text,
    },
  ) as MockText;

  expect(rendered.text).toContain("Line one");
  expect(rendered.text).toContain("Line two");
  expect(rendered.text).toContain("Line three");
  expect(rendered.text).not.toContain("[Showing lines");
});
