# test-audit extension

## Runtime modules

- `index.ts`: extension bootstrap and command registration.
- `workflow.ts`: test-audit workflow policy built on generic `PhaseWorkflow`.
- `prompting.ts`: test-audit prompt contract and prompt rendering.
- `messages.ts`: argument/message adapters.
- `prompts/*.md`: test-gap finder/skeptic/arbiter/fixer prompts.

## Lifecycle guarantees

- Only one active run at a time.
- Analysis phases block write-capable tools.
- Empty assistant output retries are bounded.
- Refinement attempts are bounded.
