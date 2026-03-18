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
  - status and widget lifecycle cleanup on session boundaries
- Local `plan` code still owns:
  - plan-mode tool switching and restore behavior
  - plan-specific system prompts and critique text
  - structured plan-step parsing and compact todo derivation
  - approval preview formatting and execution prompt hydration from full plan text
  - the inline approval action UI
  - user-facing notifications and command text

## User-visible behavior

- `/plan` keeps planning read-only until approval.
- Every draft plan gets a hidden critique pass before the approval UI appears.
- The approval UI now shows the first few compact step labels plus file/component and validation hints when the plan includes them.
- Approved execution runs one step per turn, reuses the original step objective, and includes parsed files, validation notes, and rollback notes when available.
- `/todos`, status text, and widget output stay intentionally compact even when the underlying plan stores richer per-step metadata.

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
