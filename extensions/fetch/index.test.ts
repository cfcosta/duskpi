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

const lookupMock = mock(async (_hostname: string) => [{ address: "93.184.216.34", family: 4 }]);
mock.module("node:dns/promises", () => ({
  lookup: lookupMock,
}));

const { default: fetchExtension } = await import("./index");

interface RegisteredTool {
  name: string;
  execute: (...args: any[]) => Promise<unknown> | unknown;
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

test("registers fetch_content and /fetch", () => {
  const harness = createHarness();
  expect(harness.tools.has("fetch_content")).toBe(true);
  expect(harness.commands.has("fetch")).toBe(true);
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

test("/fetch injects fetched content into session context", async () => {
  globalThis.fetch = mock(
    async () =>
      new Response(
        "<html><body><main><h1>Docs</h1><p>One paragraph.</p><p>Two paragraph.</p></main></body></html>",
        { status: 200, headers: { "content-type": "text/html" } },
      ),
  ) as typeof fetch;

  const harness = createHarness();
  const command = harness.getCommand("fetch");

  await command.handler("https://example.com/docs", createContext().ctx);

  expect(harness.sentMessages).toHaveLength(0);
  expect(harness.sentUserMessages).toHaveLength(1);
  expect(String(harness.sentUserMessages[0]?.content)).toContain(
    "Fetched readable content from https://example.com/docs.",
  );
  expect(String(harness.sentUserMessages[0]?.content)).toContain("One paragraph.");
});

test("/fetch prompts for a URL when none is provided", async () => {
  globalThis.fetch = mock(
    async () =>
      new Response(
        "<html><body><article><h1>Prompted</h1><p>Fetched via editor.</p></article></body></html>",
        { status: 200, headers: { "content-type": "text/html" } },
      ),
  ) as typeof fetch;

  const harness = createHarness();
  const command = harness.getCommand("fetch");
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
