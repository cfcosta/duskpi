---
name: chrome-cdp
description: Interact with the user's local Chrome session via a Bun-backed `chrome-cdp` CLI at a fixed install path, but only after the user explicitly asks to inspect, debug, or interact with a page in Chrome
---

# Chrome CDP

Use Chrome DevTools Protocol commands through a fixed `chrome-cdp` CLI path. This connects to the user's live Chrome session, including tabs they already have open and accounts they are already logged into.

It talks directly to Chrome over CDP WebSocket, not through Puppeteer or a separate browser instance. The CLI keeps a per-tab daemon alive once a tab is approved, which makes repeat commands fast and reliable even when many tabs are open.

## Chrome CDP CLI path (required)

This skill expects `chrome-cdp` to be available at a fixed install path:

```bash
export CDPCLI="##CHROME-CDP##"
```

- In packaged builds, this resolves to the installed CLI path.
- Always run commands through `$CDPCLI`.
- The packaged CLI is run with Bun under the hood; do not invoke `scripts/cdp.mjs` directly.

## Prerequisite check (required)

Before proposing any workflow, verify the configured CLI exists and is executable:

```bash
export CDPCLI="##CHROME-CDP##"
[ -x "$CDPCLI" ]
```

If it is not executable, pause and ask the user to install/configure Chrome CDP at the configured path, then retry.

## Chrome setup (required)

Chrome remote debugging must be enabled first:

1. Open `chrome://inspect/#remote-debugging`
2. Toggle remote debugging on

Without that, the CLI cannot connect.

## Quick start

```bash
export CDPCLI="##CHROME-CDP##"
"$CDPCLI" list
"$CDPCLI" snap 6BE827FA
"$CDPCLI" shot 6BE827FA
"$CDPCLI" click 6BE827FA "button[type=submit]"
"$CDPCLI" type 6BE827FA "hello world"
```

`<target>` is a unique targetId prefix from `list`. The CLI rejects ambiguous prefixes.

## Core workflow

1. Run `list` to find the page.
2. Pick the unique target prefix.
3. Use `snap` to inspect page structure.
4. On first access to a tab, ask the user to approve Chrome's "Allow debugging" prompt if it appears.
5. Use `click`, `type`, `eval`, `html`, or `nav` to interact.
6. Capture artifacts with `shot` when useful.
7. Run `stop` when you're done if you want to tear down daemons immediately.

After first approval, the daemon keeps the tab session open, so follow-up commands usually do not prompt again. Idle daemons auto-exit after about 20 minutes.

Minimal loop:

```bash
export CDPCLI="##CHROME-CDP##"
"$CDPCLI" list
"$CDPCLI" snap 6BE827FA
"$CDPCLI" click 6BE827FA "a[href='/settings']"
"$CDPCLI" snap 6BE827FA
```

## Commands

### List open pages

```bash
export CDPCLI="##CHROME-CDP##"
"$CDPCLI" list
```

### Accessibility tree snapshot

```bash
export CDPCLI="##CHROME-CDP##"
"$CDPCLI" snap <target>
```

### Screenshot

```bash
export CDPCLI="##CHROME-CDP##"
"$CDPCLI" shot <target> [file]
```

If no file is given, the default output path is `/tmp/screenshot.png`.

### Evaluate JavaScript

```bash
export CDPCLI="##CHROME-CDP##"
"$CDPCLI" eval <target> "document.title"
```

### Other commands

```bash
export CDPCLI="##CHROME-CDP##"
"$CDPCLI" html    <target> [selector]
"$CDPCLI" nav     <target> <url>
"$CDPCLI" net     <target>
"$CDPCLI" click   <target> <selector>
"$CDPCLI" clickxy <target> <x> <y>
"$CDPCLI" type    <target> <text>
"$CDPCLI" loadall <target> <selector> [ms]
"$CDPCLI" evalraw <target> <method> [json]
"$CDPCLI" stop    [target]
```

## Coordinates

`shot` saves an image at native resolution: image pixels = CSS pixels × DPR. CDP input events like `clickxy` use CSS pixels.

```text
CSS px = screenshot image px / DPR
```

`shot` prints the DPR for the current page. On a Retina display with DPR=2, divide screenshot coordinates by 2.

## Tips

- Prefer `snap` over `html` when you want page structure rather than raw markup.
- Use `type`, not `eval`, for text entry in cross-origin iframes.
- Use `click` or `clickxy` to focus an input before `type` when needed.
- If you need repeated DOM extraction, prefer one stable `eval` over multiple index-based `eval` calls.

## Guardrails

- Only use this skill after the user has explicitly asked you to inspect, debug, or interact with Chrome.
- Start with `list`, then use the shortest unambiguous target prefix it shows.
- Prefer `snap` before `eval`, and prefer `snap` over `html`, when you need to understand page structure.
- Avoid index-based DOM selection across multiple `eval` calls when the page can change between calls.
- Use `type` rather than `eval` for text entry, especially with cross-origin iframes.
- The first access to a tab may trigger Chrome's "Allow debugging" modal. Ask the user to approve it.
- Remember that approved tabs keep a daemon alive for a while; use `stop` if you want to tear it down immediately.
- This tool operates on the user's real Chrome profile. Be cautious with destructive actions.
- When capturing artifacts in this repo, use `output/chrome-cdp/` and avoid introducing new top-level artifact folders.
