# duskpi

`duskpi` is a Nix-packaged Pi distribution.

It wraps upstream Pi with a curated set of skills and the Catppuccin themes, so `nix run .#` gives you a ready-to-use Pi without separate local setup.

## What this distribution includes

- **Skills**
  - Engineering: `chrome-cdp`, `code-naming`, `dispatch`, `duckdb-docs`, `humanizer`, `jujutsu`, `rust-proptest`, `security-audit`, `peekaboo` _(macOS only)_
  - Thinking and business: `bus-pack`, `business-eval`, `code-pkm`, `debrief`, `dichotomy`, `growth-hack`, `lead-magnet`, `mental-models`, `offer-doctor`, `prompt-humans`, `sales-machine-scaffold`
  - [pstack](https://github.com/cursor/plugins/tree/main/pstack): all of poteto's skills, including `poteto-mode`, `architect`, `interrogate`, `unslop`, `how`, `why`, `tdd` and the `principle-*` set
- **Themes**
  - `catppuccin-latte`
  - `catppuccin-frappe`
  - `catppuccin-macchiato`
  - `catppuccin-mocha`

## Quick start

Run it directly from this repo:

```bash
nix run .#
```

Or build the package first:

```bash
nix build .#
./result/bin/pi
```

If you want to install it into your profile:

```bash
nix profile install .#
pi
```

## Skills

- **bus-pack**: continuity packs for roles, systems, and codebases (3-level "hit by a bus" structure)
- **business-eval**: capability-map evaluation of a business, rendered as an interactive HTML report
- **chrome-cdp**: inspect and interact with your live Chrome, Chromium, Brave, Edge, Arc, or Dia session
- **code-naming**: choose and review names that keep actions as verbs and expose domain intent
- **code-pkm**: distill a folder of notes with Tiago Forte's CODE and PARA methods
- **debrief**: post-mortems and retros using the Extreme Ownership doctrine
- **dichotomy**: name the leadership dichotomy in play and the balance to strike
- **dispatch**: split a coding task into small Codex tasks, one jj workspace each, landed as verified commits
- **duckdb-docs**: search DuckDB and DuckLake documentation from the session
- **growth-hack**: staged launch and growth plans (Ryan Holiday's 4-stage framework)
- **humanizer**: make generated text sound less AI-written
- **jev**: build on TypeSafe's Jev System One model: decompose decisions into typed questions, route on calibrated probabilities
- **jujutsu**: correct use of the jj version control system
- **lead-magnet**: lead-generation plans from Hormozi's "$100M Leads"
- **mental-models**: analyze decisions through 5 named mental models, inversion included
- **offer-doctor**: diagnose and rebuild pitches and offers with Hormozi's Value Equation
- **peekaboo**: macOS desktop automation (darwin builds only)
- **prompt-humans**: audit directives to people against a 5-element context checklist
- **rust-proptest**: Rust property testing with hegel
- **sales-machine-scaffold**: build a product-led sales machine from local product files: positioning, 6-stage machine, growth loops, articles, landing specs, sales manual, HCL system spec and an HTML audit report
- **security-audit**: Cloudflare's security audit workflow: reconnaissance, coverage-led hunting, candidate validation and verified findings reports

### pstack

All skills from `cursor/plugins/pstack` are bundled unmodified, except that `poteto-mode` and `make-bot-ui` get their frontmatter `name` rewritten to the lowercase form Pi requires. The pstack guide is shipped under `docs/guide` so `poteto-help`'s links resolve. Start with `/skill:poteto-mode`; ask `/skill:poteto-help` which skill fits a task.

pstack was written for Cursor. Skills that spawn subagents through Cursor's `Task` tool (`poteto-mode`, `swarm`, `arena`, `interrogate`, `reflect`, `no-comments`) and `setup-pstack`'s model configuration assume Cursor features that Pi does not provide.

## Startup behavior

The wrapped `pi` binary passes `--skill $out/skills` and `--theme $out/themes`, so bundled skills and themes are discovered on startup.

## Repository layout

- `skills/`: bundled skill directories. Every directory here is shipped; `duckdb-docs`, `peekaboo`, `sales-machine-scaffold`, `security-audit` and the pstack skills are pulled from upstream flake inputs.
- `themes/`: Catppuccin themes shipped as Pi theme files.

## Nix design

The flake:

- pulls upstream Pi from `numtide/llm-agents.nix`
- builds the `chrome-cdp` CLI and, on macOS, the prebuilt `peekaboo` binary
- vendors local skills, upstream skills (duckdb-docs, pstack, peekaboo, sales-machine-scaffold, security-audit), and themes into one output
- wraps the final `pi` binary so bundled resources are loaded on startup
