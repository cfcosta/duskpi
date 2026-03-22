# plan architecture notes

This file tracks the repo-local architecture of the vendored `plan` extension inside `duskpi`.

## Current shape

- `src/index.ts` is only the bootstrap layer. It registers `plan` through `registerGuidedWorkflowExtension(...)` and wires `/todos` to the workflow instance.
- `src/workflow.ts` defines `PiPlanWorkflow`, a thin `GuidedWorkflow` consumer with `plan`-specific policy and UI hooks.
- Shared guided state in `packages/workflow-core` owns:
  - correlated planning requests
  - hidden critique and revision orchestration
  - approval action dispatch
  - execution item tracking and `[DONE:n]` syncing
  - forwarded session lifecycle hooks for `session_start`, `session_switch`, `session_fork`, `session_compact`, and `session_shutdown`
- Local `plan` code still owns:
  - plan-mode tool switching and restore behavior
  - plan-specific system prompts and critique text
  - one-shot parse recovery when a draft lacks a parseable `Plan:` section
  - non-UI approval fallback commands while approval is pending
  - structured plan-step parsing and compact todo derivation from guided execution snapshots
  - `PlanActionComponent` and `AskUserQuestionComponent`, which now carry width-aware render caching and nested `Editor` focus propagation
  - approval preview formatting and execution prompt hydration from full plan text
  - user-facing notifications and command text

## User-visible behavior

- `/plan` keeps planning read-only until approval.
- While considering changes, the planner should proactively ask clarifying questionnaires for open user-owned decisions instead of only asking on hard blockers.
- Every draft plan gets a hidden critique pass before the approval UI appears.
- If a draft still does not contain a parseable `Plan:` section, the extension automatically asks Pi once to restate the same draft using the required contract and an explicit `Plan:` section. A second failure stays read-only and surfaces a visible error instead of opening approval.
- The approval UI now shows the first few compact step labels plus file/component and validation hints when the plan includes them.
- If approval is pending without an interactive UI, `/plan approve`, `/plan continue <note>`, `/plan regenerate`, and `/plan exit` act as command-line approval fallbacks.
- Approved execution runs one step per turn, reuses the original step objective, and includes parsed files, validation notes, and rollback notes when available.
- `/todos`, footer status, and widget output are now execution-only surfaces derived from guided execution snapshots, so they stay intentionally compact even when the underlying plan stores richer per-step metadata.
- `session_switch`, `session_fork`, and `session_compact` all reset transient plan state, restore normal tools, and clear UI status/widget output instead of carrying draft state across boundaries.

## Shared-workflow boundary

- `PhaseWorkflow` remains the shared runtime for `bug-fix`, `refactor`, `test-audit`, and `owasp-fix`.
- `GuidedWorkflow` exists alongside it for planning flows that need hidden turns, approval state, execution tracking, and session lifecycle hooks.
- The richer approval and execution detail added here stays local to `extensions/plan`; shared `workflow-core` execution item types remain unchanged.
- This vendored copy is repo-local and private; upstream publishing docs do not apply here.

## Validation

```bash
cd extensions/plan && bun install && bun run check
cd packages/workflow-core && bun install && bun run check
```
