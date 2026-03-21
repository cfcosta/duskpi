---
name: kagi-search
description: Fast web search and content extraction via the Kagi Search API. Uses a packaged Go CLI at a fixed install path and supports JSON output.
---

# Kagi Search

Fast web search and page-content extraction using the official Kagi Search API.

This skill expects a packaged `kagi-search` binary at a fixed path.

## Kagi Search CLI path (required)

```bash
export KAGI_SEARCH_CLI="##KAGI-SEARCH##"
```

- In packaged builds, this resolves to the installed CLI path.
- Always run commands through `"$KAGI_SEARCH_CLI"`.
- The source for this skill also includes the original Go project and wrapper script, but the packaged build should use the compiled binary directly.

## Prerequisite check (required)

Before proposing a workflow, verify the configured CLI exists and is executable:

```bash
export KAGI_SEARCH_CLI="##KAGI-SEARCH##"
[ -x "$KAGI_SEARCH_CLI" ]
```

If it is not executable, pause and ask the user to install or rebuild the packaged `kagi-search` CLI, then retry.

## Setup

Requires a Kagi account with API access enabled.

1. Create an account at https://kagi.com/signup
2. Navigate to Settings -> Advanced -> API portal: https://kagi.com/settings/api
3. Generate an API token
4. Add funds to your API balance at https://kagi.com/settings/billing_api
5. Export your API key in your shell profile:
   ```bash
   export KAGI_API_KEY="your-api-key-here"
   ```

## Quick start

```bash
export KAGI_SEARCH_CLI="##KAGI-SEARCH##"
"$KAGI_SEARCH_CLI" search "golang context cancellation"
"$KAGI_SEARCH_CLI" search "nix buildGoModule" -n 5
"$KAGI_SEARCH_CLI" search "pi coding agent skills" --content
"$KAGI_SEARCH_CLI" search "kagi search api" --json
"$KAGI_SEARCH_CLI" search "latest bun release" --show-balance
"$KAGI_SEARCH_CLI" content https://example.com/article
"$KAGI_SEARCH_CLI" balance --json
```

## Search

```bash
export KAGI_SEARCH_CLI="##KAGI-SEARCH##"
"$KAGI_SEARCH_CLI" search "query"                              # Basic search (10 results)
"$KAGI_SEARCH_CLI" search "query" -n 20                        # More results (max 100)
"$KAGI_SEARCH_CLI" search "query" --content                    # Include extracted page content
"$KAGI_SEARCH_CLI" search "query" --json                       # JSON output
"$KAGI_SEARCH_CLI" search "query" --show-balance               # Show API balance for this call
"$KAGI_SEARCH_CLI" search "query" -n 5 --content --json        # Combined options
```

### Search options

- `-n <num>` - Number of results (default: 10, max: 100)
- `--content` - Fetch and include page content for each result
- `--json` - Emit JSON output
- `--show-balance` - Print API balance to stderr for this call
- `--timeout <sec>` - HTTP timeout in seconds (default: 15)
- `--max-content-chars <num>` - Max chars per fetched result content (default: 5000)

## Extract page content

```bash
export KAGI_SEARCH_CLI="##KAGI-SEARCH##"
"$KAGI_SEARCH_CLI" content https://example.com/article
"$KAGI_SEARCH_CLI" content https://example.com/article --json
```

### Content options

- `--json` - Emit JSON output
- `--timeout <sec>` - HTTP timeout in seconds (default: 20)
- `--max-chars <num>` - Max chars to output (default: 20000)

## API balance

Balance is not printed by default. You can either:

- add `--show-balance` to `search`
- run the dedicated command:

```bash
export KAGI_SEARCH_CLI="##KAGI-SEARCH##"
"$KAGI_SEARCH_CLI" balance
"$KAGI_SEARCH_CLI" balance --json
```

## Output

### Default text output

`search` prints readable text blocks, and `content` prints extracted content.

### JSON output

`search --json` returns:

- `query`
- `meta` (includes API metadata like `ms`, `api_balance` when provided)
- `results[]` with `title`, `link`, `snippet`, optional `published`, optional `content`
- `related_searches[]`

`content --json` returns:

- `url`
- `title`
- `content`
- `error` (only when extraction fails)

## When to use

- Searching for documentation or API references
- Looking up facts or current information
- Fetching readable content from specific URLs
- Any task requiring web search without interactive browsing

## Notes

- Search results inherit your Kagi account settings, including personalization and blocked or promoted sites
- Results may include related search suggestions (`t:1` objects)
- Content extraction uses `codeberg.org/readeck/go-readability/v2`
- In this repo, the CLI is built by Nix and installed with the default package
