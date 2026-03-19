# workflow-core

Shared runtime package for the workflow extensions bundled in this repo.

This package exists so the extension logic that really is shared stays shared. It now exposes two orchestration styles because `duskpi` ships two different workflow families.

| Runtime          | Used by                                              | Best fit                                                                                           |
| ---------------- | ---------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `PhaseWorkflow`  | `/bug-fix`, `/owasp-fix`, `/test-audit`, `/refactor` | fixed multi-phase analysis, skepticism, arbitration, and execution flows                           |
| `GuidedWorkflow` | vendored `/plan` in `extensions/plan`                | read-only planning, hidden critique/revision turns, approval callbacks, and step-by-step execution |

## Main exports

- `PhaseWorkflow`
- `GuidedWorkflow`
- `registerPhaseWorkflowExtension(...)`
- `registerGuidedWorkflowExtension(...)`
- `loadPromptFiles(...)`
- message parsing helpers from `message-content.ts`
- extension-facing API typings from `extension-api.ts`

## `PhaseWorkflow`

Use `PhaseWorkflow` when an extension has a stable sequence of named phases and each phase can be expressed as a prompt plus response handling.

Current repo consumers:

- `extensions/bug-fix`
- `extensions/owasp-fix`
- `extensions/test-audit`
- `extensions/refactor`

## `GuidedWorkflow`

Use `GuidedWorkflow` when the extension needs a more interactive planning lifecycle than the fixed phase model supports.

Current shared capabilities:

- correlated planning requests via embedded workflow request ids
- bounded recovery when assistant output is empty or invalid during planning, critique, or revision turns
- hidden critique and revision follow-ups through `sendMessage(...)`
- planning-time tool and shell safety hooks
- approval callbacks for approve, continue, regenerate, and exit
- execution item extraction and next-step prompt building
- `[DONE:n]` progress syncing
- forwarded guided session lifecycle hooks for `session_start`, `session_switch`, `session_fork`, `session_compact`, and `session_shutdown`
- session-boundary cleanup hooks so guided consumers can reset transient state when sessions switch, fork, compact, or shut down

Current repo consumer:

- `extensions/plan`

## Design boundary

`GuidedWorkflow` was added alongside `PhaseWorkflow`, not as a replacement for it. The phase-based extensions stay on the existing runtime. `plan` uses the guided runtime because it needs hidden turns, approval state, execution tracking, and session lifecycle hooks that do not fit the older fixed-phase model.

## Validation

```bash
bun install
bun run check
```
