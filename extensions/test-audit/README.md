# test-audit extension

## Current command and runtime shape

- User-facing command: `/test-audit`
- Shared runtime home: `packages/workflow-core`

`/test-audit` now uses `GuidedExecutionWorkflow` plus the shared execution stack in workflow-core.

## Runtime modules

- `index.ts`: extension bootstrap and guided command registration for `/test-audit`.
- `workflow.ts`: test-audit workflow definition built on `GuidedExecutionWorkflow`.
- `contract.ts`: test-audit-local approved-plan contract and execution-unit dependency ordering.
- `worker-result.ts`: test-audit-local worker-result parsing and validation.
- `prompting.ts`: test-audit prompt contract and prompt rendering.
- `prompts/*.md`: test-gap finder, skeptic, arbiter, and fixer prompts.
- `packages/workflow-core/src/guided-execution-workflow.ts`: shared guided execution runtime shell.
- `packages/workflow-core/src/execution-manager.ts`: shared execution-manager path for single approved units.
- `packages/workflow-core/src/execution-scheduler.ts`: shared dependency-layer scheduler for multi-unit plans.
- `packages/workflow-core/src/worker-runner.ts`: shared isolated worker runner.
- `packages/workflow-core/src/workspace-manager.ts`: shared `jj workspace` lifecycle wrapper.

## Lifecycle guarantees

- Only one active `/test-audit` run at a time.
- Planning/analysis blocks write-capable tools and mutating bash commands.
- Approved plans are parsed from the test-audit-local structured contract.
- Single approved units run through the shared execution manager.
- Multi-unit approved plans can run in dependency layers, with independent test-improvement units dispatched in parallel within a layer.
- Assistant output recovery during guided planning is bounded.
