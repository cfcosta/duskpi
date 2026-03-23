# rlm extension

Scaffold for a Recursive Language Model-inspired workflow in `duskpi`.

## Current scope

This initial step only adds:

- the `/rlm` command registration
- a minimal `RlmWorkflow` controller stub
- extension-level event wiring for the future recursive runtime
- registration smoke coverage

## Planned direction

The follow-up implementation will build a Pi-native recursive controller for long documents/notes using:

- an extension-owned document environment
- structured assistant actions
- hidden follow-up turns for recursive sub-calls
- bounded lifecycle and safety controls

## Files

- `index.ts` — extension bootstrap and event registration
- `src/workflow.ts` — minimal controller stub
- `src/index.test.ts` — registration and forwarding tests
