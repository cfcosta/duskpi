# workflow-core

Shared runtime package for the workflow extensions bundled in this repo.

This package is now the shared execution home for the migrated workflow family. It exposes three layers that build on each other instead of forcing every extension to keep its own orchestration shell.

| Runtime / helper            | Used by                                | Best fit                                                                                                   |
| --------------------------- | -------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `PhaseWorkflow`             | `/owasp-fix`                           | fixed multi-phase analysis and execution flows that still use the older runtime                            |
| `GuidedWorkflow`            | vendored `/plan` in `extensions/plan`  | read-only planning, hidden critique/revision turns, approval callbacks, and step-by-step execution         |
| `GuidedExecutionWorkflow`   | `/bugfix`, `/refactor`, `/test-audit`  | guided planning plus approved-plan parsing, execution-unit handoff, execution-result prompts, and scheduling |
| execution helpers           | `/bugfix`, `/refactor`, `/test-audit`  | shared `ExecutionManager`, `ExecutionScheduler`, `WorkerRunner`, and `JjWorkspaceManager` building blocks |

## Main exports

- `PhaseWorkflow`
- `GuidedWorkflow`
- `GuidedExecutionWorkflow`
- `ExecutionManager`
- `ExecutionScheduler`
- `WorkerRunner`
- `JjWorkspaceManager`
- `registerPhaseWorkflowExtension(...)`
- `registerGuidedWorkflowExtension(...)`
- `loadPromptFiles(...)`
- message parsing helpers from `message-content.ts`
- extension-facing API typings from `extension-api.ts`

## `PhaseWorkflow`

Use `PhaseWorkflow` when an extension still has a stable sequence of named phases and has not been migrated to the guided execution runtime.

Current repo consumer:

- `extensions/owasp-fix`

Its correlation semantics intentionally remain more permissive than `GuidedWorkflow` for compatibility with the older phase-based flow. `PhaseWorkflow` rejects mismatched request ids, rejects mismatched prompt bodies, and also rejects user prompts that omit the request id marker, but it still accepts assistant-only `agent_end` payloads when no user prompt is present.

## `GuidedWorkflow`

Use `GuidedWorkflow` when the extension needs an interactive planning lifecycle without the shared execution handoff layer.

Current shared capabilities:

- correlated planning requests via embedded workflow request ids
- bounded recovery when assistant output is empty or invalid during planning, critique, or revision turns
- hidden critique and revision follow-ups through `sendMessage(...)`
- planning-time tool and shell safety hooks
- approval callbacks for approve, continue, regenerate, and exit
- execution item extraction and next-step prompt building
- `pi-plan-json` execution-result progress syncing
- forwarded guided session lifecycle hooks for `session_start`, `session_switch`, `session_fork`, `session_compact`, and `session_shutdown`
- session-boundary cleanup hooks so guided consumers can reset transient state when sessions switch, fork, compact, or shut down

Current repo consumer:

- `extensions/plan`

## `GuidedExecutionWorkflow`

Use `GuidedExecutionWorkflow` when the extension needs the guided planning lifecycle and also wants workflow-core to own approved-plan execution handoff.

Current repo consumers:

- `extensions/bug-fix` for the `/bugfix` command
- `extensions/refactor` for `/refactor`
- `extensions/test-audit` for `/test-audit`

Shared capabilities on top of `GuidedWorkflow`:

- parse extension-local approved-plan contracts into explicit execution units
- format execution items for the guided execution widget/state
- hand single units to a shared executor path
- hand multi-unit plans to dependency-layer scheduling so independent units can run in parallel within a layer
- surface execution-manager and scheduler results back as prompts that emit `pi-plan-json` execution-result blocks
- keep shared orchestration in workflow-core while letting each extension keep its own tagged JSON contracts and prompts

## Execution helpers

The migrated execution family also shares these workflow-core helpers:

- `ExecutionManager` for workspace setup, worker execution, and integration handoff
- `ExecutionScheduler` for dependency-layer batching and parallel execution within a layer
- `WorkerRunner` for isolated `pi --mode json --no-session` subprocess execution
- `JjWorkspaceManager` for `jj workspace` lifecycle management

Extensions are expected to keep their own approved-plan and worker-result schemas locally. workflow-core shares orchestration, not extension-specific contracts.

## Design boundary

`GuidedExecutionWorkflow` does not replace `GuidedWorkflow`; it composes with it. That split keeps `/plan` on the lighter guided runtime while `/bugfix`, `/refactor`, and `/test-audit` reuse the shared execution stack. `/owasp-fix` intentionally remains on `PhaseWorkflow` in this pass.

## Validation

```bash
bun install
bun run check
```
