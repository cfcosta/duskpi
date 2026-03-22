import { Text } from "@mariozechner/pi-tui";
import { Type } from "@sinclair/typebox";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { DOMParser } from "./vendor/linkedom-worker.js";
import type {
  ExtensionAPI,
  ExtensionContext,
  ExtensionToolResult,
} from "../../packages/workflow-core/src/index";

type ReadabilityArticle = {
  title?: string;
  byline?: string;
  siteName?: string;
  excerpt?: string;
  textContent?: string;
  content?: string;
};

type ReadabilityConstructor = new (
  doc: Document,
  options?: { keepClasses?: boolean },
) => {
  parse(): ReadabilityArticle | null;
};

function resolveReadabilityConstructor(value: unknown): ReadabilityConstructor | undefined {
  if (typeof value === "function") {
    return value as ReadabilityConstructor;
  }

  if (!value || typeof value !== "object") {
    return undefined;
  }

  const candidate = value as {
    default?: unknown;
    Readability?: unknown;
  };

  return (
    resolveReadabilityConstructor(candidate.default) ||
    resolveReadabilityConstructor(candidate.Readability)
  );
}

const readabilityModule = await import("./vendor/Readability.cjs");
const Readability = resolveReadabilityConstructor(readabilityModule);

if (!Readability) {
  throw new Error("Could not load Readability.js constructor");
}

const DEFAULT_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const HTML_COMMENT_RE = /<!--[\s\S]*?-->/g;
const NOISE_TAG_RE =
  /<(script|style|noscript|svg|iframe|nav|header|footer|aside)\b[^>]*>[\s\S]*?<\/\1>/gi;
const BLOCK_TAG_RE =
  /<\/?(p|div|section|article|main|h[1-6]|li|ul|ol|blockquote|pre|tr|table|hr|br)\b[^>]*>/gi;
const TAG_RE = /<[^>]+>/g;
const MULTI_NEWLINE_RE = /\n{3,}/g;

interface FetchParams {
  url: string;
  max_chars?: number;
  timeout_sec?: number;
}

interface FetchDetails {
  url: string;
  final_url?: string;
  title?: string;
  byline?: string;
  site_name?: string;
  excerpt?: string;
  content: string;
  content_length?: number;
  truncated?: boolean;
}

const FetchParamsSchema = Type.Object({
  url: Type.String({
    description: "HTTP or HTTPS URL to fetch and extract readable content from.",
    minLength: 1,
  }),
  max_chars: Type.Optional(
    Type.Integer({
      description: "Maximum characters of extracted readable content to return.",
      minimum: 500,
      maximum: 50000,
      default: 12000,
    }),
  ),
  timeout_sec: Type.Optional(
    Type.Integer({
      description: "HTTP timeout in seconds.",
      minimum: 1,
      maximum: 60,
      default: 20,
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

function cleanLine(text: string): string {
  return text.trim().split(/\s+/).filter(Boolean).join(" ");
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

function normalizeExtractedText(text: string): string {
  const lines = text
    .replace(/\r/g, "")
    .split("\n")
    .map((line) => cleanLine(line))
    .filter((line) => line.length > 0);

  if (lines.length === 0) {
    return cleanLine(text);
  }

  return lines.join("\n\n").replace(MULTI_NEWLINE_RE, "\n\n").trim();
}

function extractTextFromHTML(htmlDoc: string): string {
  const withoutComments = htmlDoc.replace(HTML_COMMENT_RE, " ");
  const withoutNoise = withoutComments.replace(NOISE_TAG_RE, "\n");
  const withBlockBreaks = withoutNoise.replace(BLOCK_TAG_RE, "\n");
  const withoutTags = withBlockBreaks.replace(TAG_RE, " ");
  const decoded = decodeHtmlEntities(withoutTags);

  return normalizeExtractedText(decoded);
}

function truncateText(text: string, limit: number): { text: string; truncated: boolean } {
  if (limit <= 0) {
    return { text: "", truncated: text.length > 0 };
  }

  const chars = Array.from(text);
  if (chars.length <= limit) {
    return { text, truncated: false };
  }

  return {
    text: chars.slice(0, limit).join("").trimEnd(),
    truncated: true,
  };
}

function formatMultilineBlock(text: string, indent: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => `${indent}${line}`);
}

function errorResult(url: string, message: string): ExtensionToolResult<FetchDetails> {
  return {
    content: [{ type: "text", text: message }],
    details: {
      url,
      content: "",
    },
  };
}

function buildFetchResultText(details: FetchDetails): string {
  const lines: string[] = [];
  lines.push(`Fetched content from: ${details.final_url || details.url}`);

  if (trimText(details.title)) {
    lines.push(`Title: ${details.title}`);
  }
  if (trimText(details.byline)) {
    lines.push(`Byline: ${details.byline}`);
  }
  if (trimText(details.site_name)) {
    lines.push(`Site: ${details.site_name}`);
  }
  if (typeof details.content_length === "number") {
    lines.push(`Length: ${details.content_length} chars`);
  }
  if (details.truncated) {
    lines.push("Note: content was truncated to fit the configured limit.");
  }
  if (trimText(details.excerpt)) {
    lines.push(`Excerpt: ${details.excerpt}`);
  }

  lines.push("");
  lines.push("Content:");
  lines.push(...formatMultilineBlock(details.content, "  "));

  return lines.join("\n").trim();
}

function createContextInjectionText(details: FetchDetails): string {
  const lines: string[] = [];
  lines.push(`Fetched readable content from ${details.final_url || details.url}.`);

  if (trimText(details.title)) {
    lines.push(`Title: ${details.title}`);
  }
  if (trimText(details.byline)) {
    lines.push(`Byline: ${details.byline}`);
  }
  if (trimText(details.site_name)) {
    lines.push(`Site: ${details.site_name}`);
  }
  if (trimText(details.excerpt)) {
    lines.push(`Excerpt: ${details.excerpt}`);
  }
  if (details.truncated) {
    lines.push("The extracted content was truncated.");
  }

  lines.push("");
  lines.push("Fetched content:");
  lines.push(details.content);

  return lines.join("\n").trim();
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

async function fetchHTML(url: string, signal: AbortSignal, timeoutMs: number) {
  let current = await validateRemoteURL(url);

  for (let redirectCount = 0; redirectCount <= 10; redirectCount += 1) {
    let response: Response;
    try {
      response = await fetchText(
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
    } catch (error) {
      const message = error instanceof Error ? trimText(error.message) : String(error);
      const cause =
        error instanceof Error && error.cause instanceof Error
          ? trimText(error.cause.message)
          : error instanceof Error && typeof error.cause === "string"
            ? trimText(error.cause)
            : "";
      throw new Error(cause ? `${message}: ${cause}` : message);
    }

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
    if (!trimText(html)) {
      throw new Error("received empty HTML document");
    }

    return {
      finalURL: current.toString(),
      html,
    };
  }

  throw new Error("stopped after 10 redirects");
}

function extractReadableContent(
  html: string,
  url: string,
): Omit<FetchDetails, "url" | "final_url"> {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const article = new Readability(doc, {
    keepClasses: false,
  }).parse() as ReadabilityArticle | null;

  if (!article) {
    throw new Error(`could not extract readable content from ${url}`);
  }

  const htmlContent = trimText(article.content);
  const textContent = trimText(article.textContent);
  const normalized =
    trimText(htmlContent ? extractTextFromHTML(htmlContent) : "") ||
    normalizeExtractedText(textContent);

  if (!normalized) {
    throw new Error(`could not extract readable content from ${url}`);
  }

  return {
    title: trimText(article.title),
    byline: trimText(article.byline),
    site_name: trimText(article.siteName),
    excerpt: trimText(article.excerpt),
    content: normalized,
    content_length: Array.from(normalized).length,
  };
}

async function executeFetch(
  params: FetchParams,
  signal: AbortSignal,
): Promise<ExtensionToolResult<FetchDetails>> {
  const url = trimText(params.url);
  if (!url) {
    return errorResult("", "Error: url is required");
  }

  const maxChars = clampInteger(params.max_chars, 12000, 500, 50000);
  const timeoutMs = clampInteger(params.timeout_sec, 20, 1, 60) * 1000;

  let fetched: { finalURL: string; html: string };
  try {
    fetched = await fetchHTML(url, signal, timeoutMs);
  } catch (error) {
    return errorResult(url, `Error: ${error instanceof Error ? error.message : String(error)}`);
  }

  let details: FetchDetails;
  try {
    const extracted = extractReadableContent(fetched.html, fetched.finalURL);
    const truncated = truncateText(extracted.content, maxChars);
    details = {
      url,
      final_url: fetched.finalURL,
      title: extracted.title,
      byline: extracted.byline,
      site_name: extracted.site_name,
      excerpt: extracted.excerpt,
      content: truncated.text,
      content_length: extracted.content_length,
      truncated: truncated.truncated,
    };
  } catch (error) {
    return errorResult(url, `Error: ${error instanceof Error ? error.message : String(error)}`);
  }

  return {
    content: [{ type: "text", text: buildFetchResultText(details) }],
    details,
  };
}

function sendFetchedContextMessage(
  pi: ExtensionAPI,
  ctx: ExtensionContext,
  details: FetchDetails,
): void {
  const content = createContextInjectionText(details);
  const isIdle =
    typeof (ctx as { isIdle?: unknown }).isIdle === "function"
      ? Boolean((ctx as { isIdle: () => boolean }).isIdle())
      : true;

  if (isIdle) {
    pi.sendUserMessage(content);
  } else {
    pi.sendUserMessage(content, { deliverAs: "followUp" });
  }
}

export default function fetchExtension(pi: ExtensionAPI): void {
  pi.registerCommand("web-fetch", {
    description: "Fetch a URL, extract readable content, and add it to the session context",
    handler: async (args, ctx) => {
      let url = trimText(typeof args === "string" ? args : "");
      if (!url && ctx.hasUI) {
        url = trimText(await ctx.ui.editor("URL to fetch:", ""));
      }

      if (!url) {
        ctx.ui.notify("Usage: /web-fetch <url>", "warning");
        return;
      }

      ctx.ui.setStatus("web-fetch", `Fetching: ${url}`);
      try {
        const result = await executeFetch({ url }, new AbortController().signal);
        const details = result.details;
        const text = result.content[0]?.text ?? "";
        if (!details || text.startsWith("Error:")) {
          pi.sendMessage({
            customType: "fetch-content",
            content: text,
            display: true,
            details,
          });
          ctx.ui.notify(text, "error");
          return;
        }

        sendFetchedContextMessage(pi, ctx, details);
      } finally {
        ctx.ui.setStatus("web-fetch", undefined);
      }
    },
  });

  pi.registerTool<FetchParams, FetchDetails>({
    name: "fetch_content",
    label: "fetch_content",
    description: "Fetch a specific URL and extract readable main content via Readability.",
    promptSnippet:
      "Fetch readable content from a specific URL when you already know the page to inspect.",
    promptGuidelines: [
      "Use this tool when you already have a concrete URL and need readable page content without browser automation.",
      "Prefer web_search first when you need discovery; use fetch_content once you know the exact page to inspect.",
      "Keep fetched content short enough to fit the task and lower max_chars when only a quick excerpt is needed.",
    ],
    parameters: FetchParamsSchema,

    async execute(
      _toolCallId: string,
      params: FetchParams,
      signal: AbortSignal,
      _onUpdate: ((update: ExtensionToolResult<FetchDetails>) => void) | undefined,
      _ctx: ExtensionContext,
    ) {
      return executeFetch(params, signal);
    },

    renderCall(args, theme) {
      const url = trimText(args.url);
      const maxChars = clampInteger(args.max_chars, 12000, 500, 50000);
      const text = `${theme.fg("toolTitle", "fetch_content ")}${theme.fg("accent", url)}${theme.fg("dim", ` (${maxChars} chars)`)}`;
      return new Text(text, 0, 0);
    },

    renderResult(result, _options, _theme) {
      const text = result.content[0];
      return new Text(text?.type === "text" ? text.text : "", 0, 0);
    },
  });
}
