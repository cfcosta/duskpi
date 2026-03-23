# rlm extension

Recursive Language Model-inspired workflow for long local documents and notes in `duskpi`.

## What it adds

- `/rlm`

Use it when you want Pi to reason over a large local note or text document through an extension-managed environment instead of placing the whole file into the root prompt at once.

## Current behavior

The current implementation is Pi-native and focused on long documents/notes first.

It currently supports:

- normalized request parsing for local text-like files
- an extension-owned persistent document environment
- metadata-first prompting
- bounded `read_segment` and `search_document` actions
- hidden recursive sub-calls with intermediate variable storage
- safety budgets for recursion depth, iterations, slice sizes, and final-result sizes
- lightweight active-run status and lifecycle reset on session boundaries

## Runtime modules

- `index.ts` — extension bootstrap and event registration
- `src/workflow.ts` — root controller loop, hidden follow-up turns, recursion, budgets, and status handling
- `src/args.ts` — `/rlm` argument parsing
- `src/request.ts` — normalized request model and file validation
- `src/protocol.ts` — assistant action protocol and parser
- `src/environment.ts` — persistent document environment
- `src/index.test.ts` — controller and lifecycle regression coverage
- `src/request.test.ts` — request parsing and validation coverage
- `src/protocol.test.ts` — action protocol parsing coverage
- `src/environment.test.ts` — document environment coverage

## Packaging

This extension is bundled into the `duskpi` flake build and loaded by the wrapped `pi` binary via:

- copied resources under `extensions/rlm/`
- an explicit `--extension $out/extensions/rlm/index.ts` wrapper flag in `flake.nix`
