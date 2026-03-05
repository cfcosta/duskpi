# dusk-skills

My personal collection of skills.

## Bug finder extension

The `extensions/bug-finder` module is self-contained:

- Runtime code lives in `extensions/bug-finder/index.ts`.
- Runtime prompts are co-located in `extensions/bug-finder/prompts/*.md`.
- `packages.<system>.pi-bug-fix` in `flake.nix` copies the extension directory as-is, without build-time prompt renaming.

This keeps prompt ownership and runtime boundaries explicit.
