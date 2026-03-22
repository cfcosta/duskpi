---
name: web-fetch
description: Fetches a web page and extracts the readable main content with Trafilatura. Use when you need clean article text, markdown, or JSON from one or more URLs without opening a browser.
---

# Web Fetch

Fetch web pages and extract their readable main content with Trafilatura.

This skill expects a packaged `trafilatura` CLI at a fixed path.

## CLI path (required)

```bash
export FETCHCLI="##TRAFILATURA##"
```

- In packaged builds, this resolves to the installed CLI path.
- Always run commands through `"$FETCHCLI"`.
- Prefer direct URL fetches over crawling unless the user explicitly asks for broader site discovery.

## Prerequisite check (required)

Before proposing a workflow, verify the configured CLI exists and is executable:

```bash
export FETCHCLI="##TRAFILATURA##"
[ -x "$FETCHCLI" ]
```

If it is not executable, pause and ask the user to rebuild or reinstall the packaged `trafilatura` CLI, then retry.

## Quick start

```bash
export FETCHCLI="##TRAFILATURA##"
"$FETCHCLI" -u https://example.com/article --markdown
"$FETCHCLI" -u https://example.com/article --markdown --with-metadata
"$FETCHCLI" -u https://example.com/article --json --with-metadata
"$FETCHCLI" -u https://example.com/article --output-format txt
```

## Common patterns

### Clean markdown

Use this by default when the user wants readable extracted content:

```bash
export FETCHCLI="##TRAFILATURA##"
"$FETCHCLI" -u "$URL" --markdown --with-metadata --no-comments
```

### Structured JSON

Use this when downstream processing needs machine-readable fields:

```bash
export FETCHCLI="##TRAFILATURA##"
"$FETCHCLI" -u "$URL" --json --with-metadata --no-comments
```

### Plain text

```bash
export FETCHCLI="##TRAFILATURA##"
"$FETCHCLI" -u "$URL" --output-format txt --no-comments
```

### Higher precision or recall

```bash
export FETCHCLI="##TRAFILATURA##"
"$FETCHCLI" -u "$URL" --markdown --precision
"$FETCHCLI" -u "$URL" --markdown --recall
```

- Prefer `--precision` when the page has lots of navigation or clutter.
- Prefer `--recall` when extraction seems too short or overly aggressive.

### Target a specific language

```bash
export FETCHCLI="##TRAFILATURA##"
"$FETCHCLI" -u "$URL" --markdown --target-language en
```

### Batch fetch multiple URLs

```bash
export FETCHCLI="##TRAFILATURA##"
printf '%s\n' \
  'https://example.com/post-1' \
  'https://example.com/post-2' \
  > urls.txt
"$FETCHCLI" -i urls.txt --markdown --with-metadata -o fetched-pages/
```

## Useful options

- `-u <url>`: fetch one URL directly
- `--markdown`: markdown output
- `--json`: JSON output
- `--output-format txt`: plain-text output
- `--with-metadata`: include metadata like title, URL, and date when available
- `--no-comments`: skip extracted comment sections
- `--no-tables`: drop tables when they are noisy or not needed
- `--precision`: favor cleaner extraction
- `--recall`: favor more complete extraction
- `--target-language <code>`: constrain extraction to a language
- `--archived`: try the Internet Archive if the original fetch fails

## Notes

- Some pages extract poorly because they are heavily scripted, blocked, or not article-like.
- If extraction is empty or obviously incomplete, retry with `--recall`, then consider `--archived`.
- Use direct fetches for known URLs. Do not crawl or explore a whole site unless the user asked for that.
- Trafilatura is for readable content extraction, not full browser automation.

## When to use

- Fetching the readable content of a specific article or documentation page
- Converting a page into markdown or JSON for further analysis
- Pulling clean text from a URL without opening an interactive browser
- Lightweight web content retrieval where search is unnecessary
