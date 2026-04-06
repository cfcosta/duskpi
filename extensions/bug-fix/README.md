# bug-fix extension

## Current command and runtime shape

- User-facing command: `/bugfix`
- Extension folder and package name: `bug-fix`
- Shared runtime home: `packages/workflow-core`

`/bugfix` now uses `GuidedExecutionWorkflow` plus shared execution helpers from workflow-core.

## Runtime modules

- `index.ts`: extension bootstrap and guided command registration for `/bugfix`.
- `workflow.ts`: bug-fix workflow definition built on `GuidedExecutionWorkflow` from `packages/workflow-core`.
- `contract.ts`: bug-fix-local approved-plan contract and execution-unit dependency ordering.
- `worker-result.ts`: bug-fix-local worker-result parsing and validation.
- `prompting.ts`: bug-fix prompt contract and prompt rendering.
- `packages/workflow-core/src/guided-execution-workflow.ts`: shared guided execution runtime shell.
- `packages/workflow-core/src/execution-manager.ts`: shared execution-manager path for single approved units.
- `packages/workflow-core/src/execution-scheduler.ts`: shared dependency-layer scheduler for multi-unit plans.
- `packages/workflow-core/src/worker-runner.ts`: shared isolated worker runner.
- `packages/workflow-core/src/workspace-manager.ts`: shared `jj workspace` lifecycle wrapper.
- `packages/workflow-core/src/prompt-loader.ts`: reusable prompt bundle loader.
- `packages/workflow-core/src/message-content.ts`: reusable message parsing helpers.

## Lifecycle guarantees

- Only one active `/bugfix` run at a time.
- Planning/analysis blocks write-capable tools and mutating bash commands.
- Approved plans are parsed from the bug-fix-local structured contract.
- Single approved units run through the shared execution manager.
- Multi-unit approved plans can run in dependency layers, with independent units dispatched in parallel within a layer.
- Assistant output recovery during guided planning is bounded.
