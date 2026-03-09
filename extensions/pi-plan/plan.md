# pi-plan Feature Plan

## Goal

Extend `pi-plan` from basic read-only planning into a lightweight execution companion by adding:

1. Plan-progress visibility with `/todos`

## Added Capabilities

- `/todos` reports current plan step completion (`[DONE:n]` markers).
- Plan-mode next action menu includes:
  - `Continue from proposed plan` (iterative refinement)
  - `Regenerate plan` (fresh plan output)

## Out of Scope (moved outside `pi-plan` package)

The following are not implemented in `pi-plan` package code:

- `/handoff <goal>` command (user-local runtime asset under `~/.pi/agent/extensions`)
- `/tmux` status/widget command (provided by `pi-exec-plane` root extension)
- `tmux-helper` skill documentation (user-local skill under `~/.agents/skills`)

## Critique orchestration strategy

For the critique-pass regression, the supported non-visible follow-up path in Pi is:

- `pi.sendMessage(...)` with a custom message
- `display: false` so the orchestration message stays hidden from the TUI
- `triggerTurn: true` with `deliverAs: "steer"` or `"followUp"` when the extension needs the agent to respond

This is the documented alternative to `pi.sendUserMessage(...)`, which always injects an actual user-visible message and therefore cannot be used for hidden critique/revision orchestration.

Chosen fix strategy for the next implementation step:

1. keep the critique pass feature
2. stop using `pi.sendUserMessage(...)` for critique and revision control prompts
3. rework the critique loop to use hidden custom messages via `pi.sendMessage(...)`
4. preserve the visible planning UX while keeping critique output internal to the extension flow

## Follow-ups

- Add package-level tests for `/todos` command paths.
- Consider plan-state persistence across session resume.
