# plan extension

Vendored planning extension used by `duskpi`.

This directory is the repo-local copy bundled under `extensions/plan`. It is not treated as a standalone npm or git package in this repo, so upstream install and release instructions do not apply here.

## What it adds

- default execution-first mode (YOLO)
- read-only `/plan` mode for investigation and plan drafting
- an internal hidden critique and revision pass before approval
- an approval menu with approve, continue, regenerate, and exit actions
- approval previews that show compact step summaries plus file and validation hints when available
- `/todos` progress reporting that stays compact even when the plan contains richer step metadata
- step-by-step approved execution with one `jj` commit per plan step
- execution prompts that reuse the original step objective plus files, validation, and rollback notes when the plan includes them
- status and todo-widget output backed by shared guided workflow state

```txt
/plan on
/plan Refactor command parser to support aliases
```

## Why

Sometimes you want speed. Sometimes you want a review point before the first edit.

`plan` gives you both:

- default workflows stay fast because normal mode still executes directly
- planning mode stays read-only until you approve execution
- every draft plan gets a critique pass before the approval UI appears
- approved plans run one step at a time with tracked progress

## Repo architecture

In `duskpi`, `plan` is the repo's `GuidedWorkflow` consumer.

- `src/index.ts` is a thin bootstrap that registers the guided workflow extension and the separate `/todos` command.
- `src/workflow.ts` defines `PiPlanWorkflow`, which configures the shared guided lifecycle for planning, critique, approval, execution, status rendering, and session cleanup.
- `packages/workflow-core/src/guided-workflow.ts` owns the shared state for request correlation, hidden follow-up turns, execution tracking, and lifecycle reset.
- Local `plan` code still owns plan-specific prompts, structured plan-step parsing and compact-label derivation, plan-mode tool switching, the inline approval UI, and user-facing notifications.

## Repo-local usage

`plan` is bundled by this repository and loaded through the `duskpi` package configuration.

For local development from this folder:

```bash
bun install
bun run check
```

## Quick start

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

This enables plan mode if needed and immediately starts the planning request.

### 3) Review, refine, or approve

After a plan is generated, Pi first runs an internal hidden critique pass. The critique and revision prompts stay out of the visible chat, while status notifications still appear normally. Once the plan passes critique, you get an approval menu with:

- a compact review summary built from the first extracted plan steps
- per-step file/component and validation hints when the plan includes them
- critique summary and quality badges when available
- direct hotkeys (`A/C/R/X`, plus `E` to edit a note)
- **Approve and execute now** _(optional inline note supported)_
- **Continue from proposed plan** _(optional inline note; if omitted, Pi asks for modification input and waits)_
- **Regenerate plan** _(fresh plan from scratch, no note required)_
- **Exit plan mode**

Choosing **Approve and execute now** automatically:

1. exits plan mode,
2. restores normal tools,
3. triggers implementation for the next open step,
4. includes the original step objective plus any parsed files, validation notes, and rollback notes in the execution prompt,
5. expects one atomic `jj` commit for that step,
6. then prompts the next remaining step until the todo list is complete.

## Modes

| Mode           | Behavior                                                 | Safety policy                               |
| -------------- | -------------------------------------------------------- | ------------------------------------------- |
| Default (YOLO) | Executes directly unless you explicitly request planning | No extra restrictions                       |
| Plan (`/plan`) | Gathers evidence and returns an execution plan           | Read-only tools plus mutating action blocks |

## Plan-mode guardrails

### Tool restrictions

In plan mode:

- mutating tools are blocked: `edit`, `write`, `ast_rewrite`
- active tools are switched to a read-only subset when available

### Bash restrictions

`bash` commands are filtered through a read-only policy:

- allowed examples: `ls`, `grep`, `find`, `git status`, `git log`
- blocked examples: `rm`, `mv`, `npm install`, `git commit`, redirection writes (`>`, `>>`)

### Clarification questions

If plan mode hits a real ambiguity that would change the design, the agent can use `AskUserQuestion` to ask an interactive questionnaire instead of dropping into plain prose. This mirrors Claude Code's clarification flow more closely:

- 1-4 questions per questionnaire
- 2-4 suggested options per question
- automatic free-text fallback via `Type something.`
- tabbed navigation when there is more than one question
- a dedicated preview pane for the focused option, with markdown-style rendering for richer previews
- side-by-side choices/preview layout on wide terminals, with a stacked fallback on narrow terminals

## Plan output contract

In plan mode, the system prompt now follows a Claude Code-style planning flow and enforces this structure:

1. Task understanding
2. Codebase findings (files, symbols, patterns, docs checked)
3. Approach options and trade-offs
4. Open questions and assumptions
5. Plan (step objective, target files or components, validation)
6. End with: `Ready to execute when approved.`

Before approval is shown, Pi critiques the draft plan for atomicity, ordering, specificity, validation quality, executability, and metadata noise. Weak plans are automatically sent back for refinement through hidden extension messages.

When a plan includes nested step metadata like target files/components, validation method, or risks and rollback notes, the extension now preserves that structure for approval previews and execution prompts while keeping `/todos` and the widget intentionally one-line and compact.

## Commands

### Plan workflow

- `/plan` — toggle plan mode on or off
- `/plan on` — enable plan mode
- `/plan off` — disable plan mode
- `/plan status` — show current status
- `/plan <task>` — enable mode if needed and start planning for `<task>`
- `/todos` — show tracked plan progress (`✓` and `○`) from extracted `Plan:` steps and `[DONE:n]` markers, using compact labels even if the underlying plan stores richer metadata
- approved execution runs one step per turn, requires one atomic `jj` commit for that step, then auto-continues to the next remaining todo
- after each planning turn, the action menu includes:
  - a compact review summary for the extracted plan
  - per-step file/component and validation hints when present in the plan
  - critique summary and badges when available
  - quick action hotkeys: `A` approve, `C` continue, `R` regenerate, `X` exit, `E` edit note
  - `Approve and execute now` _(optional inline note supported; execution reuses the original step objective and available files/validation/rollback notes)_
  - `Continue from proposed plan` _(inline note optional via `Tab` or `E`; without a note, Pi prompts for modification input and waits)_
  - `Regenerate plan` _(no additional note required)_

## Project structure

- `index.ts` - extension entry re-export
- `src/index.ts` - guided bootstrap and `/todos` command wiring
- `src/workflow.ts` - `PiPlanWorkflow` built on shared `GuidedWorkflow`
- `src/plan-action-ui.ts` - approval action UI
- `src/utils.ts` - read-only bash checks, structured plan-step parsing, and compact todo derivation helpers
- `src/index.test.ts` - extension regression coverage
- `plan.md` - repo-local architecture and feature notes
- `packages/workflow-core/src/guided-workflow.ts` - shared guided runtime used by this extension
- `packages/workflow-core/src/register-guided-workflow-extension.ts` - guided extension registration helper
