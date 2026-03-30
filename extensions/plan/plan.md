# plan extension local notes

## Current shape

- `src/index.ts`
  - registers the guided workflow extension under `/plan`
  - registers `/todos`
- `src/workflow.ts`
  - read-only planning prompt injection
  - tool filtering for plan mode
  - bash read-only safety checks
  - plan extraction and todo tracking
  - approval action dispatch
  - execution prompt generation
  - session lifecycle cleanup hooks
- `src/utils.ts`
  - command safety heuristics
  - plan step extraction
  - todo label cleanup and progress helpers

## Supported behavior

- `/plan` keeps planning read-only until approval.
- Every draft plan gets a hidden critique pass before the approval UI appears.
- If a draft still does not contain a parseable `Plan:` section, the extension automatically asks Pi once to restate the same draft using the required contract and an explicit `Plan:` section. A second failure stays read-only and surfaces a visible error instead of opening approval.
- The approval UI now shows the first few compact step labels plus file/component and validation hints when the plan includes them.
- If approval is pending without an interactive UI, `/plan approve`, `/plan continue <note>`, `/plan regenerate`, and `/plan exit` act as command-line approval fallbacks.
- `/autoplan` reuses the top-level `/plan` approval flow once. Top-level autoplan planning before that first approval may still ask clarification questions, including continue/regenerate revisions.
- After the first `/autoplan` approval, inner subtask planning, hidden progress review, and inner execution no longer ask new user questions or approvals. They reuse the approved top-level plan text as canonical context and infer the best repo-consistent choice instead.
- `/autoplan` keeps going from the previously approved backlog if a hidden progress-review response is missing, ambiguous, or unparseable.
- Execution prompts now include structured target files/components, validation, and rollback notes when present in the source plan.
- `/todos` and the widget intentionally stay compact even when the underlying plan carries richer step metadata.

## Architectural notes

- `packages/workflow-core/src/phase-workflow.ts` still powers the phase-based extensions.
- `GuidedWorkflow` exists alongside it for planning flows that need hidden turns, approval state, execution tracking, and session lifecycle hooks.
- The richer approval and execution detail added here stays local to `extensions/plan`; shared `workflow-core` execution item types remain unchanged.
- `session_switch` and `session_fork` reset transient plan state, restore normal tools, and clear UI status/widget output instead of carrying draft state across boundaries.
- `session_compact` preserves active plan state in the same session so hidden critique/revision turns and approved execution do not stall after compaction.

## Local validation

```bash
cd extensions/plan && bun install && bun run check
```
