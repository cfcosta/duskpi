# refactor extension

## Current runtime shape

`/refactor` now uses `GuidedExecutionWorkflow` from `packages/workflow-core` instead of the older `PhaseWorkflow` shell.

The implemented flow is:

1. **Mapper planning** — generate a structured refactor plan
2. **Hidden skeptic critique** — challenge the mapper output
3. **Hidden arbiter revision** — revise the plan when critique requests refinement
4. **Approval** — the user approves, continues, regenerates, or exits
5. **Execution handoff**
   - single approved units run through the refactor execution manager
   - multi-unit approved plans run through dependency-layer scheduling
6. **Manager-owned integration** — workspace execution results are surfaced back through the workflow with explicit conflict/failure gating

## Runtime modules

- `index.ts`: extension bootstrap and guided command registration for `/refactor`
- `workflow.ts`: `/refactor` GuidedExecutionWorkflow shell, approval flow, and execution handoff
- `contract.ts`: structured approved-plan contract and dependency ordering helpers
- `prompting.ts`: prompt loading plus mapper/skeptic/arbiter/executor/worker prompt rendering
- `worker-result.ts`: structured worker-result parsing and validation
- `workspace-manager.ts`: `jj workspace` lifecycle wrapper for worker workspaces
- `worker-runner.ts`: isolated `pi` subprocess runner for worker execution in workspace roots
- `execution-manager.ts`: single-unit execution path, integration handling, and conflict gating
- `execution-scheduler.ts`: dependency-layer batching for parallel worker execution
- `packages/workflow-core/src/guided-execution-workflow.ts`: shared guided execution runtime shell
- `packages/workflow-core/src/guided-workflow.ts`: shared guided planning/runtime substrate
- `packages/workflow-core/src/prompt-loader.ts`: reusable prompt bundle loader
- `packages/workflow-core/src/message-content.ts`: reusable message parsing helpers

## Implemented guarantees

- Only one active `/refactor` run at a time
- Planning stays read-only and blocks write-capable tools plus mutating bash commands
- Planning responses are request-correlated through workflow request ids
- Hidden critique and revision turns stay inside the guided workflow shell
- Approved plans are parsed from the refactor-local structured contract
- Execution units are ordered by declared dependencies before execution
- Single approved units run in isolated jj workspaces through the execution manager
- Multi-unit approved plans run in dependency layers, with independent units dispatched in parallel within a layer
- Integration and merge/conflict handling are manager-owned gates rather than worker-owned decisions
- Workspace cleanup is attempted after execution even when worker or integration failures occur
