# pi-plan extension

Vendored planning extension used by `duskpi`.

This directory is the repo-local copy bundled under `extensions/pi-plan`. It is not treated as a standalone npm/git package in this repo; external install and release instructions from the upstream package do not apply here.

## What it adds

- **Default mode:** execute directly (YOLO)
- **Plan mode:** read-only investigation + concrete execution plan
- **/todos:** check current tracked plan progress
- **Execution starts only after approval** from the plan-mode UI prompt
- **Every draft plan gets an internal hidden critique pass** before approval is offered
- **Approved execution auto-advances step-by-step** with one `jj` commit per plan step

```txt
/plan on
/plan Refactor command parser to support aliases
```

## Why

Sometimes you want speed, sometimes you want safety.

This extension gives both:

- **No global slowdown** in normal workflows (default remains execution-first)
- **Structured planning mode** only when you request it
- **Read-only guardrails** while planning (tool + shell protections)
- **Explicit approval handoff** before implementation begins

## Repo-local usage

`pi-plan` is bundled by this repository and loaded through the `duskpi` package configuration.

For local development from this folder:

```bash
bun install
bun run check
```

## Quick Start

### 1) Start planning mode

```txt
/plan on
```

Then ask your task in the same session:

```txt
Implement release-note generator with changelog validation
```

### 2) One-shot plan command

```txt
/plan Implement release-note generator with changelog validation
```

This enables plan mode (if needed) and immediately sends the task.

### 3) Approve or continue planning

After a plan is generated, Pi first runs an internal hidden critique pass. The critique/revision prompts stay out of the visible chat, while plan-status notifications still appear normally. Once the plan passes critique, you’ll get a richer approval menu with:

- a compact review summary (step count + first extracted steps)
- critique summary / quality badges when available
- direct hotkeys (`A/C/R/X`, plus `E` to edit a note)
- **Approve and execute now** _(optional inline note supported)_
- **Continue from proposed plan** _(optional inline note; if omitted, Pi asks for modification input and waits.)_
- **Regenerate plan** _(fresh plan from scratch, no note required)_
- **Exit plan mode**

Choosing **Approve and execute now** automatically:

1. exits plan mode,
2. restores normal tools,
3. triggers implementation for the next open step,
4. expects one atomic `jj` commit for that step,
5. then automatically prompts the next remaining step until the todo list is complete.

## Modes

| Mode           | Behavior                                                 | Safety policy                            |
| -------------- | -------------------------------------------------------- | ---------------------------------------- |
| Default (YOLO) | Executes directly unless you explicitly request planning | No extra restrictions                    |
| Plan (`/plan`) | Gathers evidence and returns an execution plan           | Read-only tools + mutating action blocks |

## Plan-Mode Guardrails

### Tool restrictions

In plan mode:

- Mutating tools are blocked: `edit`, `write`, `ast_rewrite`
- Active tools are switched to a read-only subset when available

### Bash restrictions

`bash` commands are filtered through a read-only policy:

- ✅ inspection commands (examples): `ls`, `cat`, `grep`, `find`, `git status`, `git log`
- ❌ mutating commands (examples): `rm`, `mv`, `npm install`, `git commit`, redirection writes (`>`, `>>`)

## Plan Output Contract

In plan mode, the system prompt enforces this structure:

1. Goal understanding
2. Evidence gathered (files/symbols/docs checked)
3. Uncertainties / assumptions
4. Plan (step objective, target files/components, validation)
5. Risks and rollback notes
6. End with: `Ready to execute when approved.`

Before approval is shown, Pi also critiques the draft plan for atomicity, ordering, specificity, validation quality, executability, and metadata noise. That critique loop runs through hidden extension messages rather than visible user-chat turns. Weak plans are automatically sent back for refinement.

## Commands

### Plan workflow

- `/plan` — toggle plan mode on/off
- `/plan on` — enable plan mode
- `/plan off` — disable plan mode
- `/plan status` — show current status
- `/plan <task>` — enable mode if needed and start planning for `<task>`
- `/todos` — show tracked plan progress (`✓`/`○`) from extracted `Plan:` steps and `[DONE:n]` markers
- approved execution runs one step per turn, requires an atomic `jj commit` for that step, then auto-continues to the next remaining todo
- after each planning turn, the plan-mode action menu includes:
  - a compact review summary for the extracted plan
  - critique summary / badges when available
  - quick action hotkeys: `A` approve, `C` continue, `R` regenerate, `X` exit, `E` edit note
  - `Approve and execute now` _(optional inline note supported)_
  - `Continue from proposed plan` _(inline note optional via `Tab`/`E`; without note, Pi prompts for modification input and waits)_
  - `Regenerate plan` _(no additional note required)_

## Project Structure

- `index.ts` - extension entry re-export
- `src/index.ts` - plan mode orchestration, `/todos`, and command wiring
- `src/plan-action-ui.ts` - approval action UI
- `src/utils.ts` - read-only bash checks + plan step extraction/progress helpers
- `src/index.test.ts` - extension regression coverage
- `plan.md` - package-level feature plan notes
