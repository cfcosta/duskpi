---
name: chrome-cdp
description: Interact with the user's local Chromium-based browser sessions (Chrome, Chromium, Brave, Edge, Arc, Dia) via a Bun-backed `chrome-cdp` CLI at a fixed install path, but only after the user explicitly asks to inspect, debug, or interact with a page in a browser. Supports multiple browsers with `--browser` and `--port` flags.
---

# Chrome CDP

Use Chrome DevTools Protocol commands through a fixed `chrome-cdp` CLI path. This connects to the user's live Chromium-based browser session, including tabs they already have open and accounts they are already logged into.

It talks directly to the browser over CDP WebSocket, not through Puppeteer or a separate browser instance. The CLI now runs a master daemon per browser port, so Chrome's "Allow debugging" prompt should fire once per session instead of once per tab.

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

## Browser setup (required)

Enable remote debugging in a Chromium-based browser first.

### Common setups

| Browser | How to enable | Default port |
| --- | --- | --- |
| **Chrome** | Toggle at `chrome://inspect/#remote-debugging` | 9222 |
| **Chromium** | Launch with `--remote-debugging-port=9226` or enable remote debugging in its inspect page if available | 9226 |
| **Brave** | Launch with `--remote-debugging-port=9224` | 9224 |
| **Edge** | Launch with `--remote-debugging-port=9225` | 9225 |
| **Arc** | Launch with `--remote-debugging-port=9227` | 9227 |
| **Dia** | Launch with `--remote-debugging-port=9223` | 9223 |

Notes:
- Chrome's inspect-page toggle is preferred for the user's real profile.
- Chrome may show an "Allow remote debugging" prompt the first time the master daemon connects.
- Other Chromium-based browsers launched with `--remote-debugging-port` typically do not show that popup.
- On newer Chromium-based builds, launch-flag setups may also need `--remote-allow-origins=*`.
- Without remote debugging, the CLI cannot connect.

## Quick start

```bash
export CDPCLI="##CHROME-CDP##"
"$CDPCLI" list
"$CDPCLI" --browser chromium list
"$CDPCLI" --browser brave list
"$CDPCLI" --port 9224 list
"$CDPCLI" snap 6BE827FA
"$CDPCLI" shot 6BE827FA
"$CDPCLI" click 6BE827FA "button[type=submit]"
"$CDPCLI" type 6BE827FA "hello world"
```

`<target>` is a unique targetId prefix from `list`. The CLI rejects ambiguous prefixes.

## Architecture

A master daemon is created per browser port.

That means:
- Chrome's "Allow debugging" prompt should fire once per browser session, not once per tab
- multiple commands can reuse the same browser connection
- multiple agents can connect to the same master daemon socket
- idle daemons auto-exit after about 20 minutes
- the daemon socket path is `/tmp/cdp-master-<port>.sock`

## Selecting a browser

Use one of these approaches:

```bash
export CDPCLI="##CHROME-CDP##"

# Target by browser name
"$CDPCLI" --browser chrome list
"$CDPCLI" --browser chromium list
"$CDPCLI" --browser brave list

# Target by debug port
"$CDPCLI" --port 9222 list
"$CDPCLI" --port 9224 list

# Persist a default target for later commands
"$CDPCLI" use chromium
"$CDPCLI" use 9224
"$CDPCLI" use auto
```

You can also use environment variables:

```bash
export CDPCLI="##CHROME-CDP##"
CDP_BROWSER=chromium "$CDPCLI" list
CDP_PORT=9224 "$CDPCLI" list
```

Prefer `--port` for multi-agent workflows, since the saved session is shared.

## Core workflow

1. Run `list` to find the page.
2. Pick the unique target prefix.
3. Use `snap` to inspect page structure.
4. On first access to a Chrome-backed session, ask the user to approve Chrome's "Allow debugging" prompt if it appears.
5. Use `click`, `type`, `eval`, `html`, or `nav` to interact.
6. Capture artifacts with `shot` when useful.
7. Run `stop` when you're done if you want to tear down daemons immediately.

Minimal loop:

```bash
export CDPCLI="##CHROME-CDP##"
"$CDPCLI" --browser chromium list
"$CDPCLI" snap 6BE827FA
"$CDPCLI" click 6BE827FA "a[href='/settings']"
"$CDPCLI" snap 6BE827FA
```

## Commands

### List open pages

```bash
export CDPCLI="##CHROME-CDP##"
"$CDPCLI" list
"$CDPCLI" --browser brave list
```

### Open a new tab

```bash
export CDPCLI="##CHROME-CDP##"
"$CDPCLI" open https://example.com
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
- Only loaded tabs appear in `list`; suspended tabs may not appear until the user activates them.
- For multi-browser or multi-agent work, prefer explicit `--browser` or `--port` flags.

## Guardrails

- Only use this skill after the user has explicitly asked you to inspect, debug, or interact with a browser.
- Start with `list`, then use the shortest unambiguous target prefix it shows.
- Prefer `snap` before `eval`, and prefer `snap` over `html`, when you need to understand page structure.
- Avoid index-based DOM selection across multiple `eval` calls when the page can change between calls.
- Use `type` rather than `eval` for text entry, especially with cross-origin iframes.
- The first access to a Chrome-backed session may trigger Chrome's "Allow debugging" modal. Ask the user to approve it.
- Remember that approved sessions keep a master daemon alive for a while; use `stop` if you want to tear it down immediately.
- This tool operates on the user's real browser profile. Be cautious with destructive actions.
- When capturing artifacts in this repo, use `output/chrome-cdp/` and avoid introducing new top-level artifact folders.
