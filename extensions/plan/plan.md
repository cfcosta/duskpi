# plan extension local notes

## Current shape

- `src/index.ts`
  - registers the guided workflow extension under `/plan`
  - registers `/todos`
- `src/workflow.ts`
  - read-only planning prompt injection
  - capability-aware tool filtering for plan mode
  - strict bash read-only safety checks
  - runtime v2 tagged JSON contract orchestration for plans, reviews, and execution results
  - normalized coordination metadata capture and reuse across approval, execution, and autoplan flows
  - approval action dispatch
  - checkpoint-aware autoplan prompt/enforcement state
  - execution prompt generation and structured execution-result guidance
  - session lifecycle cleanup hooks
- `src/utils.ts`
  - command safety heuristics
  - normalized plan metadata helpers
  - compact todo label cleanup and progress helpers

## Supported behavior

- `/plan` keeps planning read-only until approval.
- Planning, review, and execution now use a tagged `pi-plan-json` **runtime v2** contract.
- Every draft plan gets a hidden critique pass before the approval UI appears.
- If a draft still does not contain a valid tagged `pi-plan-json` block for the required markdown + JSON contract, the extension automatically asks Pi once to restate the same draft using the required contract and an explicit `Plan:` section. A second failure stays read-only and surfaces a visible error instead of opening approval.
- The approval UI now shows compact step labels plus strategy, dependency, checkpoint, assumption, file/component, and validation summaries when the structured plan metadata includes them.
- A structured dashboard widget now replaces the old plain todo-only widget surface whenever validated `pi-plan-json` plan/review metadata exists.
- The dashboard is compact by default, supports `ctrl+x` expand/collapse, and supports `ctrl+shift+x` fullscreen overlay rendering.
- The dashboard now covers top-level `/plan`, top-level `/autoplan` approval, inner autoplan subtasks, and autoplan review states.
- If approval is pending without an interactive UI, `/plan approve`, `/plan continue <note>`, `/plan regenerate`, and `/plan exit` act as command-line approval fallbacks.
- `/autoplan` reuses the top-level `/plan` approval flow once. Top-level autoplan planning before that first approval may still ask clarification questions, including continue/regenerate revisions.
- After the first `/autoplan` approval, inner subtask planning, hidden progress review, and inner execution stay autonomous between declared checkpoint or integration moments and may only surface user interruption at those approved moments.
- `/autoplan` keeps going from the previously approved backlog if a hidden progress-review response is missing, ambiguous, or unparseable.
- Execution prompts now include stored coordination context plus structured target files/components, validation, and rollback notes from the approved plan metadata.
- Guided execution progress now syncs from tagged `execution_result` payloads instead of `[DONE:n]` / `[SKIPPED:n]` markers.
- `/todos` stays intentionally compact even when the underlying plan carries richer coordination metadata, while the widget itself now renders a structured dashboard summary when validated structured state exists.

## Architectural notes

- `packages/workflow-core/src/phase-workflow.ts` still powers the phase-based extensions.
- `GuidedWorkflow` exists alongside it for planning flows that need hidden turns, approval state, execution tracking, and session lifecycle hooks.
- Shared `workflow-core` now provides capability metadata on tools and syncs execution progress from structured `execution_result` payloads; the plan extension consumes those shared surfaces but still owns plan-specific prompts, approval rendering, metadata normalization, and autoplan policy.
- `session_switch` and `session_fork` reset transient plan state, restore normal tools, and clear UI status/widget output instead of carrying draft state across boundaries.
- `session_compact` preserves active plan state in the same session so hidden critique/revision turns, checkpoint-aware autoplan state, and approved execution do not stall after compaction.

## Local validation

Focused redesign verification:

```bash
cd extensions/plan && bun test src/index.test.ts src/plan-action-ui.test.ts src/output-contract.test.ts
cd ../packages/workflow-core && bun test ./src/guided-workflow.test.ts ./src/register-guided-workflow-extension.test.ts
```

Full local extension check:

```bash
cd extensions/plan && bun install && bun run check
```
