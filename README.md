# dusk-skills

My personal collection of skills.

## Bug fix extension

The `extensions/bug-fix` module is split into entrypoint + reusable workflow runtime:

- Extension entrypoint and bug-specific policy live in `extensions/bug-fix/*.ts`.
- Shared workflow primitives live in `packages/workflow-core/src/*` (no bug-fix-specific modules).
- Runtime prompts are co-located in `extensions/bug-fix/prompts/*.md`.
- `packages.<system>.pi-bug-fix` in `flake.nix` copies both `extensions/bug-fix` and `packages/workflow-core`.

This keeps prompt ownership explicit while enabling reuse across workflow-style extensions.
