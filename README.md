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
- **Prompt templates**
  - `/innovate`
  - `/jj-commit`
- **Skills**
  - `design-taste-frontend`
  - `humanizer`
  - `playwright`
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

These workflow-style extensions share a common runtime in `packages/workflow-core/`, so they behave consistently.

### 2. Switch into explicit planning mode

The bundled `pi-plan` extension adds:

- `/plan`
- `/todos`

Use `/plan` when you want Pi to stay read-only while it investigates and proposes an execution plan. Once the plan looks right, you can approve implementation.

This is useful when you want:

- more safety before edits
- a concrete step list
- a review point before execution

### 3. Use prompt templates for recurring tasks

The distribution ships prompt templates that expand into reusable workflows.

- `/innovate` for ideation and solution exploration
- `/jj-commit` for commit-message and jujutsu-oriented commit flow guidance

These are available immediately because the package preloads them.

### 4. Use specialized skills without extra setup

The bundled skills cover common high-value tasks:

- **design-taste-frontend** for stronger UI/UX and frontend design decisions
- **humanizer** for making generated text sound less AI-written
- **playwright** for browser automation and UI debugging
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
- `/innovate`

The Catppuccin theme is activated by the bundled `pi-catppuccin` extension, which reads the package's `pi.theme` value and calls `setTheme()` after the wrapped binary has already exposed the bundled theme files.

## Repository layout

### `extensions/`

Pi extensions bundled into the distribution.

Notable entries:

- `bug-fix`
- `owasp-fix`
- `test-audit`
- `refactor`
- `pi-catppuccin`
- `pi-plan` (vendored from `devkade/pi-plan` and built in Nix)

### `packages/workflow-core/`

Shared runtime used by the workflow-style extensions.

This holds the reusable orchestration pieces for:

- prompt loading
- workflow phases
- message parsing
- extension-facing abstractions

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

`pi-plan` is included as a flake input and built inside Nix, then re-exported as part of this distribution's bundled extensions.

## Why this repo exists

The goal is not to fork Pi.

The goal is to ship a sharper default Pi:

- more structured workflows
- better prompting ergonomics
- stronger review and planning modes
- good built-in themes
- one installable package instead of a pile of ad hoc setup

If upstream Pi is the base terminal coding harness, `duskpi` is a batteries-included distribution on top of it.
