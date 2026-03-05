# bug-fix extension

## Runtime modules

- `index.ts`: extension bootstrap and API registration only.
- `workflow.ts`: bug-fix workflow definition built on generic `PhaseWorkflow` from `packages/workflow-core`.
- `prompting.ts`: bug-fix prompt contract and prompt rendering.
- `messages.ts`: bug-fix argument/message adapters over generic workflow-core message helpers.
- `packages/workflow-core/src/phase-workflow.ts`: reusable phase orchestration state machine.
- `packages/workflow-core/src/prompt-loader.ts`: reusable prompt bundle loader.
- `packages/workflow-core/src/message-content.ts`: reusable message parsing helpers.

## Lifecycle guarantees

- Only one active run at a time.
- Analysis phases block `Edit` and `Write` tools.
- Empty assistant output retries are bounded (`MAX_EMPTY_OUTPUT_RETRIES`).
- Refinement attempts are bounded (`MAX_REFINEMENT_ATTEMPTS`).
