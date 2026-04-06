# plan extension

Vendored planning extension used by `duskpi`.

This directory is the repo-local copy bundled under `extensions/plan`. It is not treated as a standalone npm or git package in this repo, so upstream install and release instructions do not apply here.

## What it adds

- default execution-first mode (YOLO)
- read-only `/plan` mode for investigation and plan drafting
- `/autoplan` for long-term goals: approve one top-level plan, then recursively re-plan and execute each approved subtask
- a runtime `pi-plan-json` **v2** contract for plans, reviews, and execution results
- an internal hidden critique and revision pass before approval
- one automatic draft-reformat retry when Pi returns a plan without a valid tagged `pi-plan-json` contract block
- an approval menu with approve, continue, regenerate, and exit actions
- non-UI approval fallback commands while approval is pending: `/plan approve`, `/plan continue <note>`, `/plan regenerate`, `/plan exit`
- approval previews that now show coordination strategy, dependency, checkpoint, and assumption summaries in addition to compact step details
- a structured plan dashboard widget that reuses validated `pi-plan-json` metadata for `/plan`, top-level `/autoplan`, inner autoplan subtasks, and autoplan progress review states
- autoresearch-style dashboard controls: compact by default, `ctrl+x` to expand/collapse, and `ctrl+shift+x` for a fullscreen overlay
- normalized plan metadata capture so task geometry, coordination pattern, dependencies, checkpoints, assumptions, and escalation triggers survive approval and execution reuse
- `/todos` progress reporting that stays compact during approved execution even when the underlying plan carries richer coordination metadata
- step-by-step approved execution with one `jj` commit per plan step plus a structured tagged `execution_result` payload for progress syncing
- execution prompts that reuse the approved step objective plus files, validation, rollback notes, and stored coordination context from the plan metadata
- capability-aware read-only tool selection in plan mode, with strict fallback behavior for older unannotated tools
- transient plan state reset on `session_switch` and `session_fork`, while `session_compact` now preserves active plan/autoplan flows in the same session

```txt
/plan on
/plan Refactor command parser to support aliases
/autoplan Rewrite this subsystem in Rust
```

## Why

Sometimes you want speed. Sometimes you want a review point before the first edit.

`plan` gives you both:

- default workflows stay fast because normal mode still executes directly
- planning mode stays read-only until you approve execution
- every draft plan gets a critique pass before the approval UI appears
- malformed drafts get one automatic restatement retry before the extension surfaces a visible failure
- approved plans run one step at a time with tracked progress
- validated structured plans and reviews now drive a persistent dashboard widget instead of a plain todo-only widget surface
- session switches and forks do not carry stale transient plan state into the next boundary
- same-session compaction preserves active plan/autoplan flows so critique, revision, approval, execution, and dashboard state can continue

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

After a plan is generated, Pi first runs an internal hidden critique pass. The critique and revision prompts stay out of the visible chat, while status notifications still appear normally. If Pi responds with a draft that still does not contain a valid tagged `pi-plan-json` block for the required contract, the extension automatically asks for one restatement using the required contract before surfacing a visible failure. Once a valid structured plan exists, the dashboard widget switches from the old plain todo surface to a compact structured summary driven only by validated `pi-plan-json` payloads; markdown-only or invalid drafts stay dashboard-free. Once the plan passes critique, you get an approval menu with:

- a compact review summary built from the first extracted plan steps
- per-step file/component and validation hints when the plan includes them
- critique summary and quality badges when available
- direct hotkeys (`A/C/R/X`, plus `E` to edit a note)
- **Approve and execute now** _(optional inline note supported)_
- **Continue from proposed plan** _(optional inline note; if omitted, Pi asks for modification input and waits)_
- **Regenerate plan** _(fresh plan from scratch, no note required)_
- **Exit plan mode**

If you press `Esc` to cancel an in-flight planning response, Pi now stays in read-only plan mode and waits for your next message as steering input instead of auto-retrying the interrupted draft.

While that structured dashboard is visible:

- compact mode is the default widget
- `ctrl+x` toggles between compact and expanded dashboard rendering
- `ctrl+shift+x` opens the same structured dashboard in a fullscreen overlay
- the dashboard covers top-level `/plan`, top-level `/autoplan` approval, inner autoplan subtask work, and autoplan review states whenever validated structured payloads exist

Choosing **Approve and execute now** automatically:

1. exits plan mode,
2. restores normal tools,
3. triggers implementation for the next open step,
4. includes the approved step objective plus stored coordination context, files, validation notes, and rollback notes in the execution prompt,
5. expects one atomic `jj` commit for that step,
6. expects a tagged `execution_result` JSON block under `pi-plan-json` after the commit so progress can be synced structurally,
7. then prompts the next remaining step until the todo list is complete.

If no interactive UI is available while approval is pending, the same approval state can be resolved through slash commands instead:

- `/plan approve`
- `/plan continue <note>`
- `/plan regenerate`
- `/plan exit`

## Modes

| Mode                   | Behavior                                                                                              | Safety policy                                          |
| ---------------------- | ----------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| Default (YOLO)         | Executes directly unless you explicitly request planning                                              | No extra restrictions                                  |
| Plan (`/plan`)         | Gathers evidence and returns an execution plan                                                        | Read-only tools plus mutating action blocks            |
| Autoplan (`/autoplan`) | Gets one user-approved top-level plan, then re-plans and executes each approved subtask automatically | Read-only while planning, normal tools while executing |

## Plan-mode guardrails

### Tool restrictions

In plan mode:

- capability-marked mutating tools are blocked before execution, even when their names are not part of the legacy hard-coded write list
- active tools are switched to a capability-aware read-only subset when metadata is available
- older unannotated tools still fall back to the repo-local allowlist so common inspection tools keep working during the transition
- when available, external research can use `web_search` for discovery and `web_fetch` for reading exact pages

### Bash restrictions

`bash` commands are filtered through a strict read-only policy:

- allowed examples: `ls`, `grep`, `find`, `git status`, `git log`
- blocked examples: `rm`, `mv`, `npm install`, `git commit`, redirection writes (`>`, `>>`)
- blocked shell control forms now also include pipes, command chaining, command substitution, process substitution, and multiline shell input, even when the base command looks read-only

### Clarification questions

While considering changes, plan mode should actively surface user-owned decisions instead of silently guessing. If behavior, UX, API, schema, compatibility, rollout, validation, performance, or migration choices are still open, the agent should use `ask_user_question` to ask an interactive questionnaire before finalizing the plan. This mirrors Claude Code's clarification flow more closely:

For `/autoplan`, that clarification behavior is intentionally split in two:

- before the first approval, the top-level autoplan planning rounds may still ask clarification questions, including top-level continue/regenerate revisions
- after the first approval, inner autoplan subtask planning, hidden progress review, and inner execution stay autonomous **between** declared checkpoint or integration moments
- when the approved top-level metadata explicitly marks a checkpoint or integration moment, inner autoplan planning, review, or execution may surface a user interruption there; outside those declared moments, the extension treats user-input or approval-seeking behavior as a policy violation and triggers the stricter recovery prompts instead

- 1-4 questions per questionnaire, with more than one question when multiple independent choices remain
- 2-4 suggested options per question
- automatic free-text fallback via `Type something.`
- tabbed navigation when there is more than one question
- a dedicated preview pane for the focused option, with markdown-style rendering for richer previews
- side-by-side choices/preview layout on wide terminals, with a stacked fallback on narrow terminals
- explicit `PlanActionComponent` and `AskUserQuestionComponent` classes now back the approval and questionnaire UIs, so width-aware caching and nested editor focus propagation live in dedicated components instead of anonymous render objects

## Plan output contract

In plan mode, the system prompt now follows a Claude Code-style planning flow and enforces this structure:

1. Task understanding
2. Codebase findings (files, symbols, patterns, docs checked)
3. Approach options and trade-offs
4. Open questions and assumptions
5. Plan (step objective, target files or components, validation)
6. End with: `Ready to execute when approved.`
7. After the markdown plan, include a fenced tagged JSON block using `pi-plan-json`.

### Runtime v2 tagged JSON payloads

The runtime contract is now version 2.

#### Plan payload

```json
{
  "version": 2,
  "kind": "plan",
  "taskGeometry": "shared_artifact",
  "coordinationPattern": "checkpointed_execution",
  "assumptions": ["..."],
  "escalationTriggers": ["..."],
  "checkpoints": [
    {
      "id": "checkpoint-1",
      "title": "Review metadata capture",
      "kind": "checkpoint",
      "step": 1,
      "why": "..."
    }
  ],
  "steps": [
    {
      "step": 1,
      "kind": "implement",
      "objective": "...",
      "targets": ["..."],
      "validation": ["..."],
      "risks": ["..."],
      "dependsOn": [],
      "checkpointIds": ["checkpoint-1"]
    }
  ]
}
```

#### Review payload

- continue reviews use `kind: "review"`, `status: "continue"`, `summary`, coordination metadata, checkpoints, and steps
- complete reviews use `kind: "review"`, `status: "complete"`, and `summary`

#### Execution result payload

Approved execution now syncs progress from structured tagged JSON instead of `[DONE:n]` / `[SKIPPED:n]` markers:

```json
{
  "version": 2,
  "kind": "execution_result",
  "scope": "plan",
  "step": 1,
  "status": "done",
  "summary": "...",
  "changedTargets": ["..."],
  "validationsRun": ["..."],
  "checkpointsReached": ["..."]
}
```

For `/autoplan`, execution results may also include `scope: "autoplan"` and `outerStep`.

Before approval is shown, Pi critiques the draft plan for atomicity, ordering, specificity, validation quality, executability, and metadata noise. Weak plans are automatically sent back for refinement through hidden extension messages. If Pi returns a draft without a valid tagged `pi-plan-json` block, the extension sends one automatic restatement request that preserves the same intent but explicitly asks for the required markdown + tagged JSON contract. If the second draft is still invalid, approval is not opened and plan mode stays read-only with a visible failure notification.

When a plan includes coordination metadata like task geometry, coordination pattern, dependencies, checkpoints, assumptions, escalation triggers, target files/components, validation methods, or rollback notes, the extension preserves that structure for approval previews, dashboard rendering, autoplan prompt state, execution prompts, and recovery behavior while keeping `/todos` intentionally compact. The dashboard itself is structured-only: it renders only from validated `pi-plan-json` plan/review payloads and clears on resets when no valid structured state remains.

## Commands

### Plan workflow

- `/plan` — toggle plan mode on or off
- `/plan on` — enable plan mode
- `/plan off` — disable plan mode
- `/plan status` — show current status
- `/plan <task>` — enable mode if needed and start planning for `<task>`
- `/autoplan <goal>` — create a top-level plan for a long-term goal, wait for the usual approval, then recursively plan and execute each approved subtask; top-level planning before the first approval may still ask clarification questions when needed, and post-approval inner turns only allow interruption at declared checkpoint or integration moments from the approved top-level metadata
- `/autoplan status` — show the current autoplan loop state
- `/autoplan stop` — stop the current autoplan loop and clear its transient state
- `/plan approve` — when approval is pending and no interactive UI is available, approve and start execution
- `/plan continue <note>` — when approval is pending and no interactive UI is available, continue planning with a required note
- `/plan regenerate` — when approval is pending and no interactive UI is available, rebuild the plan from scratch
- `/plan exit` — when approval is pending and no interactive UI is available, leave plan mode and clear tracked plan state
- `/todos` — show tracked approved-execution progress (`✓`, `○`, and `↷`) from guided execution items, using compact labels even if the underlying plan stores richer metadata and trimming older items when needed to keep the current step visible
- approved execution runs one step per turn, requires one atomic `jj` commit for that step, then a tagged `execution_result` payload, then auto-continues to the next remaining todo
- after each planning turn, the action menu includes:
  - a compact review summary for the extracted plan
  - strategy, dependency, checkpoint, and assumption summaries when present in the structured plan metadata
  - per-step file/component, validation, dependency, and checkpoint hints when present in the plan
  - critique summary and badges when available
  - quick action hotkeys: `A` approve, `C` continue, `R` regenerate, `X` exit, `E` edit note
  - `Approve and execute now` _(optional inline note supported; execution reuses the original step objective and available files/validation/rollback notes)_
  - `Continue from proposed plan` _(inline note optional via `Tab` or `E`; without a note, Pi prompts for modification input and waits)_
  - `Regenerate plan` _(no additional note required)_

### Session boundary behavior

When `session_switch` or `session_fork` fires, the extension resets transient plan state instead of trying to carry it across boundaries.

That reset restores the normal tool set, clears footer status and the todo widget, and leaves `/todos` empty until a new approved execution starts in the new session state.

When `session_compact` fires inside the same session, the extension now preserves active plan/autoplan state so hidden critique or revision turns and approved execution can continue after compaction. For `/autoplan`, that preserved state now includes the approved top-level plan text, which is reused as the canonical context for inner subtask planning, hidden progress review, and post-approval execution prompts even if the mutable high-level backlog is rewritten later in the loop.

## Project structure

- `index.ts` - extension entry re-export
- `src/index.ts` - guided bootstrap and `/todos` command wiring
- `src/workflow.ts` - `PiPlanWorkflow` built on shared `GuidedWorkflow`
- `src/plan-action-ui.ts` - `PlanActionComponent` approval UI
- `src/ask-user-question-tool.ts` - `ask_user_question` tool plus `AskUserQuestionComponent`
- `src/utils.ts` - read-only bash checks, structured plan-step parsing, and compact todo derivation helpers
- `src/index.test.ts` - extension regression coverage
- `plan.md` - repo-local architecture and feature notes
- `packages/workflow-core/src/guided-workflow.ts` - shared guided runtime used by this extension
- `packages/workflow-core/src/register-guided-workflow-extension.ts` - guided extension registration helper
