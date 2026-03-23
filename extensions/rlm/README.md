# rlm extension

Recursive Language Model-inspired workflow for question-first recursive workspaces in `duskpi`.

## What it adds

- `/rlm`

Use it when you want Pi to start from a question, create its own workspace files, and reason through an extension-managed environment instead of stuffing the whole working state into the root prompt.

## Current behavior

The current implementation is Pi-native and focused on question-first recursive workspaces.

It currently supports:

- question-first `/rlm <question>` request parsing
- automatic workspace creation with:
  - `task.md`
  - `scratchpad.md`
  - `final.md`
  - `workspace.md`
- an extension-owned persistent workspace environment
- metadata-first prompting
- bounded `read_segment` and `search_document` actions over the evolving workspace snapshot
- hidden recursive sub-calls with intermediate variable storage
- scratchpad updates from recursive child results
- final-answer persistence into `final.md`
- safety budgets for recursion depth, iterations, slice sizes, and final-result sizes
- lightweight active-run status and lifecycle reset on session boundaries

## Runtime modules

- `index.ts` — extension bootstrap and event registration
- `src/workflow.ts` — root controller loop, hidden follow-up turns, recursion, budgets, and status handling
- `src/args.ts` — `/rlm` question parsing
- `src/request.ts` — workspace creation and normalized request model
- `src/protocol.ts` — assistant action protocol and parser
- `src/environment.ts` — persistent workspace environment
- `src/executor.ts` — Wasmtime/Javy executor abstraction for the JS-runtime migration
- `src/index.test.ts` — controller and lifecycle regression coverage
- `src/request.test.ts` — request parsing and workspace creation coverage
- `src/protocol.test.ts` — action/program protocol parsing coverage
- `src/environment.test.ts` — workspace environment coverage
- `src/executor.test.ts` — executor/runtime coverage

## Packaging

This extension is bundled into the `duskpi` flake build and loaded by the wrapped `pi` binary via:

- copied resources under `extensions/rlm/`
- an explicit `--extension $out/extensions/rlm/index.ts` wrapper flag in `flake.nix`
