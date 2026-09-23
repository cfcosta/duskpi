---
name: dispatch
description: Break a coding task into smaller tasks and dispatch each to Codex through MCP or the CLI, applying the code-naming skill and committing with the jujutsu skill after each task. Use when the user wants to delegate implementation to Codex in small, verified increments.
---

# Dispatch

Break down the user's current problem, send each task to Codex, and finish each
task with a naming refactor, verification, and its own Jujutsu commit. Carry out
the workflow; do not stop at a task list or ask the user to run the commands.

## 1. Break down the work

Inspect the repository and turn the requested outcome into small tasks that can
each be implemented, checked, and committed independently. Give each task:

- A concrete outcome and acceptance criteria.
- The relevant files, constraints, and context.
- Dependencies on earlier tasks and the checks that demonstrate completion.

Order the tasks by dependency. Keep the list visible and update it as work
progresses. Avoid splitting tightly coupled changes into incomplete commits.

Read [jujutsu](../jujutsu/SKILL.md) and
[code-naming](../code-naming/SKILL.md) before dispatching. Resolve their paths for
the worker rather than assuming it inherits your skills or conversation. Check
the initial `jj status` so unrelated work stays out of task commits. If a
required skill, Jujutsu workspace, or Codex interface is unavailable, report the
missing prerequisite instead of silently substituting another workflow.

## 2. Dispatch one task to Codex

Use an available Codex MCP tool or the `codex exec` CLI. Inspect the MCP tool's
schema or `codex exec --help` before choosing arguments. Use the user's selected
interface when specified; otherwise use whichever is available. Implementation
must go through Codex, including follow-up fixes.

Send a bounded brief containing the task's outcome, acceptance criteria,
repository path, relevant context, constraints, checks, and resolved skill
paths. Tell Codex to implement only that task, apply the code-naming skill to its
changes, and report the diff and check results. Keep committing with the
dispatcher so the result is reviewed before it enters history. Tell the worker
not to invoke dispatch recursively or commit, move bookmarks, or push.

For the CLI, write the brief to a file and pass it through stdin:

```bash
codex exec --cd /path/to/repo --sandbox workspace-write - < /path/to/task-brief.txt
```

Choose permissions consistent with the authorized task and environment. Keep
the brief outside the tracked work. For MCP, pass equivalent instructions and
the repository path through the tool's supported arguments. Retain the session
identifier when available for follow-up work on the same task.

Wait for the worker to finish before reviewing its changes or starting another
task in the same working copy. If it fails or leaves work incomplete, inspect
the partial result and send a focused correction to Codex. Do not mark the task
complete based only on a worker's success message.

## 3. Refactor, verify, and commit each task

After every task's implementation:

1. Review the actual diff against the acceptance criteria.
2. Use the **code-naming** skill on the changed code and its call sites. Have
   Codex apply justified naming and responsibility refactors, updating affected
   references while preserving behavior and public compatibility. If the names
   are already clear, record that no naming changes are needed.
3. Run the relevant checks after the refactor, including the repository's
   required formatting and validation. Send failures back to Codex and review
   the corrected result.
4. Use the **jujutsu** skill to commit the completed task, including its naming
   refactor. Select only that task's paths and use a descriptive commit message.
   Record the resulting commit identifier with the task's status.
5. Only then move to the next task. Do not accumulate all tasks into one final
   commit or leave the naming pass until the end.

Continue until the requested outcome is complete. Report the completed tasks,
their commits, validation results, and any remaining blockers. Follow the user's
bookmark and push instructions when supplied.
