# duskpi

`duskpi` is a Nix-packaged Pi distribution.

Instead of treating Pi as a bare upstream binary and layering configuration on top, this repo ships a ready-to-run Pi package with opinionated workflows, prompts, skills, and themes already bundled.

If you want a Pi that comes with structured bug-fixing, refactor review, security review, planning mode, curated skills, and Catppuccin themes out of the box, this is the package.

## What this distribution includes

The default package bundles upstream Pi together with repo-owned resources:

- **Workflow extensions**
  - `/bug-fix`
  - `/owasp-fix`
  - `/test-audit`
  - `/refactor`
- **Planning extension**
  - `/plan`
  - `/todos`
- **Side-question extension**
  - `/btw`
- **Search command**
  - `/web-search`
- **Prompt templates**
  - `/fetch`
  - `/innovate`
  - `/jj-commit`
- **Custom tools**
  - `web_search`
- **Skills**
  - `chrome-cdp`
  - `design-taste-frontend`
  - `fetch`
  - `humanizer`
  - `rust-proptest`
  - `visual-explainer`
- **Themes**
  - `catppuccin-latte`
  - `catppuccin-frappe`
  - `catppuccin-macchiato`
  - `catppuccin-mocha`

It also activates `catppuccin-mocha` automatically at startup through a bundled extension.

Theme loading follows two paths:

- the package manifest advertises bundled themes from `themes/`
- the wrapped `pi` binary passes `--theme $out/themes` so `nix run .#` can discover them immediately

That keeps theme discovery explicit while still letting the startup extension switch to the package default theme by name.

## What makes it a distribution

The package is not just a folder of extras.

`packages.<system>.default` wraps upstream Pi and preloads the bundled resources so they are available immediately when you run it. That means `nix run .#` behaves like a complete Pi environment, not a half-configured base install.

In practice, the distribution gives you:

- a `pi` binary
- bundled extensions under `extensions/`
- bundled prompt templates under `prompts/`
- bundled skills under `skills/`
- bundled themes under `themes/`
- package metadata that Pi can understand
- startup wiring so the important resources are loaded automatically

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

## What you can do with it

### 1. Use structured workflows instead of one-off prompts

This distribution ships several multi-step extensions that guide Pi through more deliberate workflows.

#### `/bug-fix`

Runs an adversarial bug-finding and fixing workflow.

Use it when you want Pi to:

- search for likely defects first
- challenge its own findings
- arbitrate which bugs are real
- then implement fixes

#### `/owasp-fix`

Security-focused workflow around OWASP-style findings.

Use it when you want Pi to:

- inspect code for security issues
- reduce false positives through adversarial review
- only fix issues that survive scrutiny

#### `/test-audit`

Test-gap and test-quality workflow.

Use it when you want Pi to:

- inspect what is untested
- challenge weak test ideas
- produce a tighter, verified testing plan
- then implement tests or fixes

#### `/refactor`

Refactor workflow with explicit skepticism before execution.

Use it when you want Pi to:

- map refactor candidates
- challenge whether they are actually worth doing
- narrow the blast radius
- then execute only the approved refactor plan

These four workflow-style extensions share the `PhaseWorkflow` runtime in `packages/workflow-core/`, so they keep the same phase-driven behavior and safety hooks.

The bundled `plan` extension uses the same package's `GuidedWorkflow` runtime instead. That guided path covers read-only planning, hidden critique and revision turns, approval callbacks, step tracking, and session cleanup.

### 2. Switch into explicit planning mode

The bundled `plan` extension adds:

- `/plan`
- `/todos`

Use `/plan` when you want Pi to stay read-only while it investigates, proposes an execution plan, runs an internal critique pass, and waits for approval before switching back to execution.

This is useful when you want:

- more safety before edits
- a concrete step list
- a review point before execution
- tracked step-by-step execution after approval

### 3. Ask side questions without interrupting the main task

The bundled `/btw` extension opens an ephemeral overlay for quick side questions.

Use it when you want to:

- ask a focused repo question while Pi keeps working
- sanity-check a design detail without polluting the main thread
- get a quick answer based on the current session context and recent tool activity

The side answer is tool-less by design and is intended to feel lightweight and disposable.

![Screenshot of the `/btw` side-question overlay while the main task keeps running](resources/btw.png)

### 4. Use prompt templates for recurring tasks

The distribution ships prompt templates that expand into reusable workflows.

- `/fetch` for pulling readable content from one or more URLs through the bundled fetch skill
- `/innovate` for ideation and solution exploration
- `/jj-commit` for commit-message and jujutsu-oriented commit flow guidance

These are available immediately because the package preloads them.

### 4b. Use `/web-search` for direct web queries

The distribution also ships a `/web-search` command that runs the bundled `web_search` implementation directly and prints the results into the session without asking the agent to interpret the command first.

Use it when you want a command-style entrypoint with immediate search output instead of asking in freeform prose.

### 5. Use specialized skills without extra setup

The bundled skills cover common high-value tasks:

- **chrome-cdp** for inspecting and interacting with your live Chrome, Chromium, or Brave session
- **design-taste-frontend** for stronger UI/UX and frontend design decisions
- **fetch** for extracting readable content from web pages with Trafilatura
- **humanizer** for making generated text sound less AI-written
- **rust-proptest** for Rust property testing
- **visual-explainer** for turning complex technical material into visual HTML explainers

## Startup behavior

This package intentionally changes startup from “plain Pi” to “distro Pi”.

When `pi` starts from this package, the wrapper preloads bundled resources so commands, templates, and themes are available without needing a separate local Pi setup.

That is why commands like these should be present right away:

- `/bug-fix`
- `/owasp-fix`
- `/test-audit`
- `/refactor`
- `/plan`
- `/todos`
- `/btw`
- `/web-search`
- `/fetch`
- `/innovate`

The Catppuccin theme is activated by the bundled `catppuccin` extension, which reads the package's `pi.theme` value and calls `setTheme()` after the wrapped binary has already exposed the bundled theme files.

## Repository layout

### `extensions/`

Pi extensions bundled into the distribution.

Notable entries:

- `bug-fix`
- `owasp-fix`
- `test-audit`
- `refactor`
- `catppuccin`
- `plan` (repo-local private extension vendored under `extensions/plan`)
- `btw`

### `packages/workflow-core/`

Shared runtime package used by both workflow families in this repo.

It holds the reusable orchestration pieces for:

- `PhaseWorkflow` for `/bug-fix`, `/owasp-fix`, `/test-audit`, and `/refactor`
- `GuidedWorkflow` for `/plan`
- registration helpers for both workflow styles
- prompt loading and message parsing helpers
- extension-facing API abstractions and local typings

See `packages/workflow-core/README.md` for the current architecture split.

### `prompts/`

Prompt templates loaded by Pi.

### `skills/`

Bundled skill directories and curated skill integrations.

### `themes/`

Catppuccin themes shipped as Pi theme files.

## Nix design

This repo is built as a flake and exposes a package per supported system.

The flake:

- pulls upstream Pi from `numtide/llm-agents.nix`
- builds third-party resources needed by this distribution
- vendors local extensions, skills, prompts, and themes into one output
- wraps the final `pi` binary so bundled resources are loaded on startup

`plan` is vendored directly into `extensions/plan` as a repo-local private extension, so you can modify it locally like the other bundled extensions without treating this copy as a separately published package.

## Why this repo exists

The goal is not to fork Pi.

The goal is to ship a sharper default Pi:

- more structured workflows
- better prompting ergonomics
- stronger review and planning modes
- good built-in themes
- one installable package instead of a pile of ad hoc setup

If upstream Pi is the base terminal coding harness, `duskpi` is a batteries-included distribution on top of it.
