import { afterEach, expect, mock, test } from "bun:test";
import type { ExtensionContext } from "../../packages/workflow-core/src/index";

mock.module("@mariozechner/pi-tui", () => ({
  Text: class {
    constructor(..._args: unknown[]) {}
  },
}));

mock.module("@sinclair/typebox", () => ({
  Type: {
    Object: (value: unknown) => value,
    String: (value: unknown) => value,
    Optional: (value: unknown) => value,
    Integer: (value: unknown) => value,
    Boolean: (value: unknown) => value,
  },
}));

const lookupMock = mock(async (_hostname: string) => [{ address: "93.184.216.34", family: 4 }]);
mock.module("node:dns/promises", () => ({
  lookup: lookupMock,
}));

const { default: webSearchExtension } = await import("./index");

interface RegisteredTool {
  name: string;
  execute: (...args: any[]) => Promise<unknown> | unknown;
}

interface RegisteredCommand {
  description: string;
  handler: (args: unknown, ctx: ExtensionContext) => Promise<void> | void;
}

function createContext(options: { hasUI?: boolean; editorValue?: string } = {}) {
  const notifications: Array<{ message: string; level?: string }> = [];
  const ctx = {
    hasUI: options.hasUI ?? false,
    ui: {
      theme: {
        fg: (_color: string, text: string) => text,
        strikethrough: (text: string) => text,
      },
      notify(message: string, level?: string) {
        notifications.push({ message, level });
      },
      setStatus() {},
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

  return { ctx, notifications };
}

function createHarness() {
  const tools = new Map<string, RegisteredTool>();
  const commands = new Map<string, RegisteredCommand>();
  const sentUserMessages: string[] = [];
  const pi = {
    registerTool(definition: RegisteredTool) {
      tools.set(definition.name, definition);
    },
    registerCommand(name: string, definition: RegisteredCommand) {
      commands.set(name, definition);
    },
    sendUserMessage(message: string) {
      sentUserMessages.push(message);
    },
  };

  webSearchExtension(pi as never);

  return {
    tools,
    commands,
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
const originalKagiAPIKey = process.env.KAGI_API_KEY;

afterEach(() => {
  globalThis.fetch = originalFetch;
  lookupMock.mockClear();
  if (originalKagiAPIKey === undefined) {
    delete process.env.KAGI_API_KEY;
  } else {
    process.env.KAGI_API_KEY = originalKagiAPIKey;
  }
});

test("registers the web_search tool and /web-search command", () => {
  const harness = createHarness();
  expect(harness.tools.has("web_search")).toBe(true);
  expect(harness.commands.has("web-search")).toBe(true);
});

test("/web-search sends a focused user message", async () => {
  const harness = createHarness();
  const command = harness.getCommand("web-search");

  await command.handler("pi coding agent github", createContext().ctx);

  expect(harness.sentUserMessages).toHaveLength(1);
  expect(harness.sentUserMessages[0]).toContain(
    "Use the web_search tool to search for: pi coding agent github",
  );
  expect(harness.sentUserMessages[0]).toContain("Keep max_results small");
});

test("/web-search prompts for a query when none is provided", async () => {
  const harness = createHarness();
  const command = harness.getCommand("web-search");
  const { ctx: interactiveCtx } = createContext({ hasUI: true, editorValue: "golang context" });

  await command.handler("", interactiveCtx);

  expect(harness.sentUserMessages).toHaveLength(1);
  expect(harness.sentUserMessages[0]).toContain(
    "Use the web_search tool to search for: golang context",
  );
});

test("web_search calls the Kagi API directly and formats results", async () => {
  process.env.KAGI_API_KEY = "test-key";

  globalThis.fetch = mock(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    expect(url).toContain("https://kagi.com/api/v0/search?");
    expect(url).toContain("q=golang+context+cancellation");
    expect(url).toContain("limit=3");
    expect(init?.headers).toEqual(
      expect.objectContaining({
        Authorization: "Bot test-key",
      }),
    );

    return new Response(
      JSON.stringify({
        meta: { ms: 42, api_balance: 7.5 },
        data: [
          {
            t: 0,
            url: "https://pkg.go.dev/context",
            title: "Go context package",
            snippet:
              "Package context carries deadlines, cancellation signals, and other request-scoped values.",
          },
          {
            t: 1,
            list: ["golang context timeout"],
          },
        ],
      }),
      {
        status: 200,
        headers: { "content-type": "application/json" },
      },
    );
  }) as typeof fetch;

  const harness = createHarness();
  const tool = harness.getTool("web_search");
  const result = (await tool.execute(
    "tool-call-1",
    {
      query: "golang context cancellation",
      max_results: 3,
    },
    new AbortController().signal,
    undefined,
    ctx,
  )) as {
    content: Array<{ type: string; text: string }>;
    details: { results: Array<{ link: string }> };
  };

  expect(result.content[0]?.text).toContain("Web search for: golang context cancellation");
  expect(result.content[0]?.text).toContain("https://pkg.go.dev/context");
  expect(result.content[0]?.text).toContain("Related searches:");
  expect(result.details.results[0]?.link).toBe("https://pkg.go.dev/context");
});

test("web_search can fetch readable content from returned pages", async () => {
  process.env.KAGI_API_KEY = "test-key";

  globalThis.fetch = mock(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.startsWith("https://kagi.com/api/v0/search?")) {
      return new Response(
        JSON.stringify({
          meta: { ms: 12 },
          data: [
            {
              t: 0,
              url: "https://example.com/post",
              title: "",
              snippet: "An example article",
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }

    expect(url).toBe("https://example.com/post");
    return new Response(
      "<html><head><title>Example article</title></head><body><main><p>Hello world.</p><p>Readable text.</p></main></body></html>",
      { status: 200, headers: { "content-type": "text/html" } },
    );
  }) as typeof fetch;

  const harness = createHarness();
  const tool = harness.getTool("web_search");
  const result = (await tool.execute(
    "tool-call-2",
    {
      query: "example article",
      include_content: true,
      max_content_chars: 2000,
    },
    new AbortController().signal,
    undefined,
    ctx,
  )) as {
    content: Array<{ type: string; text: string }>;
    details: { results: Array<{ title: string; content?: string }> };
  };

  expect(lookupMock).toHaveBeenCalledWith("example.com", { all: true });
  expect(result.details.results[0]?.title).toBe("Example article");
  expect(result.details.results[0]?.content).toContain("Hello world.");
  expect(result.content[0]?.text).toContain("Content:");
});

test("web_search returns a tool error when the API key is missing", async () => {
  delete process.env.KAGI_API_KEY;

  const harness = createHarness();
  const tool = harness.getTool("web_search");
  const result = (await tool.execute(
    "tool-call-3",
    { query: "pi coding agent" },
    new AbortController().signal,
    undefined,
    ctx,
  )) as { content: Array<{ type: string; text: string }> };

  expect(result.content[0]?.text).toContain("KAGI_API_KEY");
});
