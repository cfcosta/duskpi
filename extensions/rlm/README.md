# rlm extension

Recursive Language Model scaffold for long prompts in `duskpi`.

## What it adds

- `/rlm`

Use it when you want Pi to treat the input prompt as an external object, reason over it through code, and recurse on programmatically constructed sub-prompts instead of stuffing the whole task state into the root prompt.

## Current behavior

The current implementation is now closer to the paper's core loop:

- the `/rlm` command takes the full command body as the input prompt
- the root model sees only bounded prompt metadata, not the full prompt contents
- the full prompt is stored externally as `Prompt` inside the execution environment
- the assistant must return JavaScript programs, not tool-style JSON actions
- each turn executes code in a persistent frame environment with symbolic variables
- recursive sub-calls are requested from code via `subcall(prompt, storeAs)`
- child results are stored symbolically in parent variables
- final answers are produced by setting the `Final` variable
- follow-up turns receive only compact execution metadata, not full observations
- the root run still creates workspace files:
  - `task.md`
  - `scratchpad.md`
  - `final.md`
  - `workspace.md`
  - `sources.md`
- safety budgets remain in place for recursion depth, iterations, malformed outputs, and imported source sizes

## Runtime modules

- `index.ts` — extension bootstrap and event registration
- `src/workflow.ts` — root controller loop, hidden follow-up turns, recursion, code execution, and status handling
- `src/args.ts` — `/rlm` prompt parsing
- `src/request.ts` — workspace creation and normalized request model
- `src/protocol.ts` — assistant program parsing
- `src/environment.ts` — persistent frame environment and workspace syncing
- `src/executor.ts` — Wasmtime/Javy-backed JavaScript executor
- `src/index.test.ts` — controller and lifecycle regression coverage
- `src/request.test.ts` — request parsing and workspace creation coverage
- `src/protocol.test.ts` — program parser coverage
- `src/environment.test.ts` — environment coverage
- `src/executor.test.ts` — executor/runtime coverage

## Packaging

This extension is bundled into the `duskpi` flake build and loaded by the wrapped `pi` binary via:

- copied resources under `extensions/rlm/`
- an explicit `--extension $out/extensions/rlm/index.ts` wrapper flag in `flake.nix`
