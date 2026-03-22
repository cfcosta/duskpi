import { Text } from "@mariozechner/pi-tui";
import { Type } from "@sinclair/typebox";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import type {
  ExtensionAPI,
  ExtensionContext,
  ExtensionToolResult,
} from "../../packages/workflow-core/src/index";

const KAGI_SEARCH_URL = "https://kagi.com/api/v0/search";
const DEFAULT_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

const HTML_COMMENT_RE = /<!--[\s\S]*?-->/g;
const NOISE_TAG_RE =
  /<(script|style|noscript|svg|iframe|nav|header|footer|aside)\b[^>]*>[\s\S]*?<\/\1>/gi;
const BLOCK_TAG_RE =
  /<\/?(p|div|section|article|main|h[1-6]|li|ul|ol|blockquote|pre|tr|table|hr|br)\b[^>]*>/gi;
const TAG_RE = /<[^>]+>/g;
const TITLE_RE = /<title[^>]*>([\s\S]*?)<\/title>/i;
const MULTI_NEWLINE_RE = /\n{3,}/g;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

interface WebSearchParams {
  query: string;
  max_results?: number;
  include_content?: boolean;
  max_content_chars?: number;
  timeout_sec?: number;
}

interface ApiMeta {
  id?: string;
  node?: string;
  ms?: number;
  api_balance?: number;
}

interface ApiThumbnail {
  url?: string;
  width?: number;
  height?: number;
}

interface KagiApiItem {
  t: number;
  url?: string;
  title?: string;
  snippet?: string;
  published?: string;
  thumbnail?: ApiThumbnail;
  list?: string[];
}

interface KagiSearchResponse {
  meta: ApiMeta;
  data: KagiApiItem[];
}

interface WebSearchResultItem {
  title: string;
  link: string;
  snippet: string;
  published?: string;
  thumbnail?: ApiThumbnail;
  content?: string;
  content_error?: string;
}

interface WebSearchDetails {
  query: string;
  meta?: ApiMeta;
  results: WebSearchResultItem[];
  related_searches?: string[];
}

const WebSearchParamsSchema = Type.Object({
  query: Type.String({
    description: "Focused web search query.",
    minLength: 1,
  }),
  max_results: Type.Optional(
    Type.Integer({
      description: "Maximum number of search results to return.",
      minimum: 1,
      maximum: 10,
      default: 5,
    }),
  ),
  include_content: Type.Optional(
    Type.Boolean({
      description:
        "Fetch readable content from each result page. Use only when snippets are not enough because this is slower.",
      default: false,
    }),
  ),
  max_content_chars: Type.Optional(
    Type.Integer({
      description: "Maximum extracted characters per result when include_content is true.",
      minimum: 250,
      maximum: 10000,
      default: 4000,
    }),
  ),
  timeout_sec: Type.Optional(
    Type.Integer({
      description: "HTTP timeout in seconds for Kagi requests and page fetches.",
      minimum: 1,
      maximum: 60,
      default: 15,
    }),
  ),
});

function clampInteger(
  value: number | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  if (!Number.isFinite(value)) {
    return fallback;
  }
  return Math.max(minimum, Math.min(maximum, Math.trunc(value as number)));
}

function trimText(value: string | undefined): string {
  return (value ?? "").trim();
}

function errorResult(message: string): ExtensionToolResult<WebSearchDetails> {
  return {
    content: [{ type: "text", text: message }],
    details: {
      query: "",
      results: [],
    },
  };
}

function decodeHtmlEntities(input: string): string {
  return input.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (entity, code: string) => {
    const normalized = code.toLowerCase();
    switch (normalized) {
      case "amp":
        return "&";
      case "lt":
        return "<";
      case "gt":
        return ">";
      case "quot":
        return '"';
      case "apos":
      case "#39":
        return "'";
      case "nbsp":
        return " ";
      default:
        if (normalized.startsWith("#x")) {
          const value = Number.parseInt(normalized.slice(2), 16);
          return Number.isFinite(value) ? String.fromCodePoint(value) : entity;
        }
        if (normalized.startsWith("#")) {
          const value = Number.parseInt(normalized.slice(1), 10);
          return Number.isFinite(value) ? String.fromCodePoint(value) : entity;
        }
        return entity;
    }
  });
}

function cleanLine(text: string): string {
  return text.trim().split(/\s+/).filter(Boolean).join(" ");
}

function truncateText(text: string, limit: number): string {
  if (limit <= 0) {
    return "";
  }
  const chars = Array.from(text);
  if (chars.length <= limit) {
    return text;
  }
  return chars.slice(0, limit).join("");
}

function extractTitle(htmlDoc: string): string {
  const match = htmlDoc.match(TITLE_RE);
  if (!match?.[1]) {
    return "";
  }
  return cleanLine(decodeHtmlEntities(match[1]));
}

function extractReadableText(htmlDoc: string): string {
  const withoutComments = htmlDoc.replace(HTML_COMMENT_RE, " ");
  const withoutNoise = withoutComments.replace(NOISE_TAG_RE, "\n");
  const withBlockBreaks = withoutNoise.replace(BLOCK_TAG_RE, "\n");
  const withoutTags = withBlockBreaks.replace(TAG_RE, " ");
  const decoded = decodeHtmlEntities(withoutTags).replace(/\r/g, "");

  const lines = decoded
    .split("\n")
    .map((line) => cleanLine(line))
    .filter((line) => line.length > 0);

  if (lines.length === 0) {
    return "";
  }

  return lines.join("\n\n").replace(MULTI_NEWLINE_RE, "\n\n").trim();
}

function formatMultilineBlock(text: string, indent: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => `${indent}${line}`);
}

function buildResultText(details: WebSearchDetails): string {
  const lines: string[] = [];
  lines.push(`Web search for: ${details.query}`);

  if (typeof details.meta?.ms === "number" && details.meta.ms > 0) {
    lines.push(`Kagi latency: ${details.meta.ms} ms`);
  }
  if (typeof details.meta?.api_balance === "number") {
    lines.push(`API balance: $${details.meta.api_balance.toFixed(4)}`);
  }

  if (details.results.length === 0) {
    lines.push("No results found.");
  } else {
    lines.push("");
    for (const [index, result] of details.results.entries()) {
      lines.push(
        `${index + 1}. ${trimText(result.title) || trimText(result.link) || "Untitled result"}`,
      );
      if (trimText(result.link)) {
        lines.push(`   URL: ${result.link}`);
      }
      if (trimText(result.published)) {
        lines.push(`   Published: ${result.published}`);
      }
      if (trimText(result.snippet)) {
        lines.push(`   Snippet: ${result.snippet}`);
      }
      if (trimText(result.content)) {
        lines.push("   Content:");
        lines.push(...formatMultilineBlock(result.content, "     "));
      } else if (trimText(result.content_error)) {
        lines.push(`   Content error: ${result.content_error}`);
      }
      if (index < details.results.length - 1) {
        lines.push("");
      }
    }
  }

  if ((details.related_searches?.length ?? 0) > 0) {
    lines.push("");
    lines.push("Related searches:");
    for (const term of details.related_searches ?? []) {
      lines.push(`- ${term}`);
    }
  }

  return lines.join("\n").trim();
}

function getKagiAPIKey(): string {
  return process.env.KAGI_API_KEY?.trim() ?? "";
}

function createTimeoutSignal(parentSignal: AbortSignal, timeoutMs: number) {
  const controller = new AbortController();
  const onAbort = () => controller.abort(parentSignal.reason);
  parentSignal.addEventListener("abort", onAbort);
  const timeout = setTimeout(() => controller.abort(new Error("request timed out")), timeoutMs);

  return {
    signal: controller.signal,
    dispose() {
      clearTimeout(timeout);
      parentSignal.removeEventListener("abort", onAbort);
    },
  };
}

async function fetchText(
  url: string,
  init: RequestInit,
  signal: AbortSignal,
  timeoutMs: number,
): Promise<Response> {
  const timeout = createTimeoutSignal(signal, timeoutMs);
  try {
    return await fetch(url, {
      ...init,
      signal: timeout.signal,
    });
  } finally {
    timeout.dispose();
  }
}

function isBlockedIPv4(ip: string): boolean {
  const parts = ip.split(".").map((part) => Number.parseInt(part, 10));
  if (parts.length !== 4 || parts.some((part) => Number.isNaN(part) || part < 0 || part > 255)) {
    return true;
  }

  const [a, b] = parts;
  if (a === 0 || a >= 224) return true;
  if (a === 10 || a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  return false;
}

function isBlockedIPv6(ip: string): boolean {
  const normalized = ip.toLowerCase();
  return (
    normalized === "::" ||
    normalized === "::1" ||
    normalized.startsWith("fc") ||
    normalized.startsWith("fd") ||
    normalized.startsWith("fe8") ||
    normalized.startsWith("fe9") ||
    normalized.startsWith("fea") ||
    normalized.startsWith("feb") ||
    normalized.startsWith("ff")
  );
}

function isBlockedIPAddress(ip: string): boolean {
  const family = isIP(ip);
  if (family === 4) {
    return isBlockedIPv4(ip);
  }
  if (family === 6) {
    return isBlockedIPv6(ip);
  }
  return true;
}

async function validateRemoteURL(rawURL: string): Promise<URL> {
  let parsed: URL;
  try {
    parsed = new URL(trimText(rawURL));
  } catch (error) {
    throw new Error(`invalid URL: ${error instanceof Error ? error.message : String(error)}`);
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(
      `invalid URL scheme ${JSON.stringify(parsed.protocol.replace(/:$/, ""))} (only http/https are allowed)`,
    );
  }

  const host = parsed.hostname.trim().toLowerCase();
  if (!host) {
    throw new Error("invalid URL: missing hostname");
  }
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) {
    throw new Error(`blocked host ${JSON.stringify(host)}: local hostnames are not allowed`);
  }

  if (isIP(host)) {
    if (isBlockedIPAddress(host)) {
      throw new Error(`blocked private or local IP address: ${host}`);
    }
    return parsed;
  }

  const resolved = await lookup(host, { all: true });
  const allowed = resolved.filter((entry) => !isBlockedIPAddress(entry.address));
  if (allowed.length === 0) {
    throw new Error(`blocked host ${JSON.stringify(host)}: resolves to private or local IP`);
  }

  return parsed;
}

async function fetchPageContent(
  url: string,
  maxChars: number,
  signal: AbortSignal,
  timeoutMs: number,
) {
  let current = await validateRemoteURL(url);

  for (let redirectCount = 0; redirectCount <= 10; redirectCount += 1) {
    const response = await fetchText(
      current.toString(),
      {
        headers: {
          "User-Agent": DEFAULT_USER_AGENT,
          Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "Accept-Language": "en-US,en;q=0.9",
        },
        redirect: "manual",
      },
      signal,
      timeoutMs,
    );

    if (REDIRECT_STATUSES.has(response.status)) {
      const location = response.headers.get("location");
      if (!location) {
        throw new Error(`HTTP ${response.status}: missing redirect location`);
      }
      current = await validateRemoteURL(new URL(location, current).toString());
      continue;
    }

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const html = await response.text();
    const title = extractTitle(html);
    const content = extractReadableText(html);
    if (!trimText(content)) {
      throw new Error("could not extract readable content");
    }

    return {
      title,
      content: maxChars > 0 ? truncateText(content, maxChars) : "",
    };
  }

  throw new Error("stopped after 10 redirects");
}

async function fetchSearchResults(
  query: string,
  maxResults: number,
  signal: AbortSignal,
  timeoutMs: number,
): Promise<KagiSearchResponse> {
  const apiKey = getKagiAPIKey();
  if (!apiKey) {
    throw new Error(
      "KAGI_API_KEY environment variable is required (https://kagi.com/settings/api)",
    );
  }

  const params = new URLSearchParams({
    q: query,
    limit: String(maxResults),
  });

  const response = await fetchText(
    `${KAGI_SEARCH_URL}?${params.toString()}`,
    {
      headers: {
        Authorization: `Bot ${apiKey}`,
        "User-Agent": DEFAULT_USER_AGENT,
        Accept: "application/json",
      },
    },
    signal,
    timeoutMs,
  );

  const body = await response.text();
  if (!response.ok) {
    const summary = body.trim().slice(0, 500);
    throw new Error(`HTTP ${response.status}: ${summary}`);
  }

  return JSON.parse(body) as KagiSearchResponse;
}

function toWebSearchDetails(query: string, response: KagiSearchResponse): WebSearchDetails {
  const details: WebSearchDetails = {
    query,
    meta: response.meta,
    results: [],
    related_searches: [],
  };

  for (const item of response.data ?? []) {
    if (item.t === 0) {
      details.results.push({
        title: item.title ?? "",
        link: item.url ?? "",
        snippet: item.snippet ?? "",
        published: item.published,
        thumbnail: item.thumbnail,
      });
    } else if (item.t === 1) {
      details.related_searches?.push(...(item.list ?? []));
    }
  }

  return details;
}

async function executeWebSearch(
  params: WebSearchParams,
  signal: AbortSignal,
): Promise<ExtensionToolResult<WebSearchDetails>> {
  const query = trimText(params.query);
  if (!query) {
    return errorResult("Error: query is required");
  }

  const maxResults = clampInteger(params.max_results, 5, 1, 10);
  const includeContent = params.include_content === true;
  const maxContentChars = clampInteger(params.max_content_chars, 4000, 250, 10000);
  const timeoutMs = clampInteger(params.timeout_sec, 15, 1, 60) * 1000;

  let details: WebSearchDetails;
  try {
    const response = await fetchSearchResults(query, maxResults, signal, timeoutMs);
    details = toWebSearchDetails(query, response);
  } catch (error) {
    return errorResult(`Error: ${error instanceof Error ? error.message : String(error)}`);
  }

  if (includeContent) {
    for (const result of details.results) {
      if (!trimText(result.link)) {
        continue;
      }
      try {
        const page = await fetchPageContent(result.link, maxContentChars, signal, timeoutMs);
        if (!trimText(result.title) && trimText(page.title)) {
          result.title = page.title;
        }
        result.content = page.content;
      } catch (error) {
        result.content_error = error instanceof Error ? error.message : String(error);
      }
    }
  }

  return {
    content: [{ type: "text", text: buildResultText(details) }],
    details,
  };
}

function sendCommandMessage(pi: ExtensionAPI, content: string, details?: WebSearchDetails): void {
  pi.sendMessage({
    customType: "web-search-result",
    content,
    display: true,
    details,
  });
}

export default function webSearchExtension(pi: ExtensionAPI): void {
  pi.registerCommand("web-search", {
    description: "Search the web and print results directly",
    handler: async (args, ctx) => {
      const initialQuery = trimText(typeof args === "string" ? args : "");
      let query = initialQuery;

      if (!query && ctx.hasUI) {
        query = trimText(await ctx.ui.editor("Search query:", ""));
      }

      if (!query) {
        if (ctx.hasUI) {
          ctx.ui.notify("Usage: /web-search <query>", "warning");
        } else {
          sendCommandMessage(pi, "Usage: /web-search <query>");
        }
        return;
      }

      ctx.ui.setStatus("web-search", `Searching web for: ${query}`);
      try {
        const result = await executeWebSearch({ query }, new AbortController().signal);
        const contentText = result.content[0]?.text ?? "";
        sendCommandMessage(pi, contentText, result.details);
        if (contentText.startsWith("Error:")) {
          ctx.ui.notify(contentText, "error");
        }
      } finally {
        ctx.ui.setStatus("web-search", undefined);
      }
    },
  });

  pi.registerTool<WebSearchParams, WebSearchDetails>({
    name: "web_search",
    label: "web_search",
    description:
      "Search the web via Kagi and optionally extract readable content from the returned pages.",
    promptSnippet:
      "Search the web for documentation, current facts, or other external references via Kagi.",
    promptGuidelines: [
      "Use this tool when you need information outside the repo, such as official docs, APIs, release notes, or current facts.",
      "Keep queries focused and prefer small result counts.",
      "Set include_content to true only when result snippets are not enough and you need readable page text from the returned links.",
    ],
    parameters: WebSearchParamsSchema,

    async execute(
      _toolCallId: string,
      params: WebSearchParams,
      signal: AbortSignal,
      _onUpdate: ((update: ExtensionToolResult<WebSearchDetails>) => void) | undefined,
      _ctx: ExtensionContext,
    ) {
      return executeWebSearch(params, signal);
    },

    renderCall(args, theme) {
      const query = trimText(args.query);
      const limit = clampInteger(args.max_results, 5, 1, 10);
      const suffix = args.include_content ? theme.fg("accent", " +content") : "";
      const text = `${theme.fg("toolTitle", "web_search ")}${theme.fg("muted", `\"${query}\"`)}${theme.fg("dim", ` (${limit})`)}${suffix}`;
      return new Text(text, 0, 0);
    },

    renderResult(result, _options, _theme) {
      const details = result.details;
      if (!details) {
        const text = result.content[0];
        return new Text(text?.type === "text" ? text.text : "", 0, 0);
      }
      return new Text(buildResultText(details), 0, 0);
    },
  });
}
