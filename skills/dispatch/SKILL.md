---
name: dispatch
description: Break a coding task into smaller tasks and dispatch them to Codex through MCP or the CLI in parallel waves, one Jujutsu workspace per task, choosing the Codex model and reasoning effort by task difficulty, applying the code-naming skill, and landing each verified task as its own commit in the original workspace. Use when the user wants to delegate implementation to Codex in small, verified increments.
---

# Dispatch

Break down the user's current problem, send the tasks to Codex in parallel
waves, and finish each task with a naming refactor, verification, and its own
Jujutsu commit. Each task runs in its own Jujutsu workspace; when it is done,
its commit moves into the original workspace and the task workspace is deleted.
Carry out the workflow; do not stop at a task list or ask the user to run the
commands.

## 1. Break down the work

Inspect the repository and turn the requested outcome into small tasks that can
each be implemented, checked, and committed independently. Give each task:

- A concrete outcome and acceptance criteria.
- The relevant files, constraints, and context.
- Dependencies on other tasks and the checks that demonstrate completion.
- A difficulty rating (see §3), which picks its model and reasoning effort.
- A short slug for its workspace name, such as `parse-config`.

Avoid splitting tightly coupled changes into incomplete commits.

### Group tasks into waves

Order the tasks by dependency, then group them into waves:

- A wave holds tasks that do not depend on each other and can run at the same
  time. Wave N+1 holds the tasks that depend on something in wave N or earlier.
- Tasks in the same wave should touch disjoint files. If two independent tasks
  must edit the same file, put them in different waves so the later one starts
  from the earlier one's commit instead of conflicting with it.
- Keep waves small enough to review; four to six tasks is a good ceiling.

Keep the task list, with each task's wave, difficulty, workspace, status, and
commit, visible and update it as work progresses.

### Check prerequisites

Read [jujutsu](../jujutsu/SKILL.md) and
[code-naming](../code-naming/SKILL.md) before dispatching. Resolve their paths for
the worker rather than assuming it inherits your skills or conversation. The
repository must be a Jujutsu repository (`jj root` succeeds). If a required
skill, Jujutsu, or the Codex interface is unavailable, report the missing
prerequisite instead of silently substituting another workflow.

Record the original workspace before creating anything:

```bash
ROOT=$(jj workspace root)            # the original workspace; all commits land here
jj st                                # note unrelated work already in @
jj workspace list                    # note existing workspaces; never touch them
```

Unrelated changes already in the original `@` stay there. Task workspaces start
from `@-` of the original workspace, so that work never leaks into a task, and
landed commits are inserted between `@-` and `@`, so it stays on top.

## 2. Run each wave in Jujutsu workspaces

Repeat for every wave, in order. Do not start a wave until every task of the
previous wave has landed (§5), because the next wave builds on those commits.

### 2.1 Create one workspace per task

Put workspaces outside the repository root so the original workspace never
snapshots them, for example in the session scratch directory or under
`${TMPDIR:-/tmp}`. The parent directory must exist before `jj workspace add`.

```bash
WS_DIR=${TMPDIR:-/tmp}/dispatch/$(basename "$ROOT")
mkdir -p "$WS_DIR"

# From $ROOT, once per task in the wave:
jj -R "$ROOT" workspace add --name dispatch-<slug> -r "$ROOT_BASE" "$WS_DIR/<slug>"
```

Compute `ROOT_BASE` at the start of each wave as the original workspace's
parent, so the wave builds on everything already landed:

```bash
ROOT_BASE=$(jj -R "$ROOT" log --no-graph -r @- -T 'commit_id')
```

Each workspace gets its own working-copy commit (`dispatch-<slug>@`) on top of
that base, with a full checkout of the files. All workspaces share one
repository, so commits made in any of them are visible from all of them.

Prefix every workspace name with `dispatch-` so leftovers are easy to find with
`jj workspace list`. Pick a new slug if the name or directory already exists.

### 2.2 Link `node_modules` in Node projects

For Node projects (a `package.json` with an installed `node_modules` in
`$ROOT`), link the original `node_modules` into each workspace instead of
reinstalling. Do this right after `jj workspace add`, before any other `jj`
command runs in that workspace.

A `node_modules/` ignore pattern (with a trailing slash) matches only
directories, not symlinks, so Jujutsu would snapshot and commit the link. Add a
pattern that matches the link to the repository's shared Git excludes first. Do
this once per repository and keep it; it only affects ignored paths:

```bash
EXCLUDE="$(jj -R "$ROOT" git root)/info/exclude"
mkdir -p "$(dirname "$EXCLUDE")"
grep -qxF 'node_modules' "$EXCLUDE" 2>/dev/null || echo 'node_modules' >> "$EXCLUDE"

ln -s "$ROOT/node_modules" "$WS_DIR/<slug>/node_modules"
```

In a monorepo, link every installed `node_modules` directory at its matching
relative path (for example `packages/app/node_modules`). The pattern
`node_modules` without slashes matches at every depth.

Confirm the links are ignored before dispatching:

```bash
jj -R "$WS_DIR/<slug>" st            # node_modules must not appear
```

If a task changes dependencies (edits `package.json` or the lockfile), do not
link: give that task its own install in its workspace so it cannot corrupt the
shared `node_modules`, and put it in its own wave.

### 2.3 Dispatch the wave in parallel

Start one Codex worker per task in the wave, all at the same time, each with
its workspace directory as the working directory. Wait for all of them to
finish before landing the wave; process each task through §4 as soon as its
worker finishes.

## 3. Choose the model by difficulty

Rate each task and pass the matching model and reasoning effort explicitly.
Never rely on the Codex config defaults.

| Difficulty | Examples                                                   | Model         | Reasoning |
| ---------- | ---------------------------------------------------------- | ------------- | --------- |
| Trivial    | One-line change, rename a constant, fix a typo or import   | Dispatcher    | —         |
| Simple     | Small, local change in one or two files with obvious shape | `gpt-6-luna`  | `xhigh`   |
| Medium     | Feature or fix across a few files, needs some design       | `gpt-6-sol`   | `medium`  |
| Hard       | Cross-cutting change, subtle logic, unfamiliar code        | `gpt-6-sol`   | `xhigh`   |
| Harder     | Algorithmic, concurrency, or architecture-level work       | `gpt-6-astra` | `medium`  |
| Hardest    | Very complex work where a mistake is costly or subtle      | `gpt-6-astra` | `high`    |

Make trivial changes yourself instead of dispatching them. They still get their
own workspace, naming pass, checks, and commit, and land like any other task.

When unsure between two ratings, pick the higher one. If a worker fails a task
twice on the same problem, escalate the follow-up one row.

## 4. Brief the worker and verify each task

### 4.1 Send the brief

Use an available Codex MCP tool or the `codex exec` CLI. Inspect the MCP tool's
schema or `codex exec --help` before choosing arguments. Use the user's selected
interface when specified; otherwise use whichever is available. Apart from
trivial tasks (§3), implementation must go through Codex, including follow-up
fixes.

Send a bounded brief containing the task's outcome, acceptance criteria,
workspace path, relevant context, constraints, checks, and resolved skill
paths. Tell Codex to:

- Implement only that task, only inside its workspace directory.
- Apply the code-naming skill to its changes.
- Report the diff and check results.
- Not invoke dispatch recursively, and not run `jj` or `git` commands that
  change history: no commit, describe, squash, rebase, bookmark, or push.
- Not add, remove, or reinstall dependencies inside a linked `node_modules`.

Keep committing with the dispatcher so the result is reviewed before it enters
history.

For the CLI, write the brief to a file outside the tracked work and pass it
through stdin, with the model and reasoning effort from §3:

```bash
codex exec --cd "$WS_DIR/<slug>" --sandbox workspace-write \
  -m gpt-6-sol -c model_reasoning_effort=medium \
  - < /path/to/<slug>-brief.txt > /path/to/<slug>-output.txt 2>&1
```

Run the wave's commands concurrently, for example as background shell
commands, and keep each worker's output file for review. For MCP, start the
workers concurrently and pass equivalent instructions, the workspace path as
the working directory, the model, and the reasoning effort through the tool's
supported arguments. Retain each session identifier when available for
follow-up work on the same task.

Choose permissions consistent with the authorized task and environment. If a
worker fails or leaves work incomplete, inspect the partial result and send a
focused correction to Codex in the same workspace. Do not mark a task complete
based only on a worker's success message.

### 4.2 Refactor, verify, and commit in the workspace

For every task, inside its workspace:

1. Review the actual diff against the acceptance criteria:
   `jj -R "$WS_DIR/<slug>" diff`.
2. Use the **code-naming** skill on the changed code and its call sites. Have
   Codex apply justified naming and responsibility refactors, updating affected
   references while preserving behavior and public compatibility. If the names
   are already clear, record that no naming changes are needed.
3. Run the relevant checks in the workspace after the refactor, including the
   repository's required formatting and validation. Send failures back to Codex
   and review the corrected result.
4. Use the **jujutsu** skill to commit the task in its workspace with a
   descriptive message. Select only that task's paths, and confirm no
   `node_modules` link or stray artifact is in the commit:

   ```bash
   cd "$WS_DIR/<slug>"
   jj st
   jj commit -m "<message>" [PATHS...]
   TASK_CHANGE=$(jj log --no-graph -r @- -T 'change_id')
   ```

Do not accumulate tasks into one final commit or leave the naming pass until
the end.

## 5. Land each task and delete its workspace

When a task is committed, move its commit into the original workspace, then
remove the task workspace completely. Land the wave's tasks one at a time, in
the order of the task list, so history stays linear.

1. Insert the commit between the original workspace's `@-` and `@`:

   ```bash
   jj -R "$ROOT" rebase -r "$TASK_CHANGE" --insert-before @
   ```

   With `-R "$ROOT"`, `@` is the original workspace's working copy, whichever
   directory the command runs from. Any unrelated work in the original `@` is
   rebased on top and stays uncommitted. `rebase -r` moves only the task
   commit: the task workspace's own `@` stays on the old base and becomes
   stale.

2. Check the landed commit and everything above it for conflicts:

   ```bash
   jj -R "$ROOT" log -r "conflicts() & ${TASK_CHANGE}::"
   ```

   Jujutsu rebases never fail; conflicts are stored in the commit. If this
   lists anything, resolve it before landing the next task, in the task
   workspace:

   ```bash
   jj -R "$WS_DIR/<slug>" workspace update-stale
   jj -R "$WS_DIR/<slug>" new "$TASK_CHANGE"   # materializes conflict markers
   ```

   Have Codex resolve the markers in that workspace and rerun the checks
   there, then fold the resolution into the task commit and refresh the
   original workspace, which the rewrite made stale:

   ```bash
   jj -R "$WS_DIR/<slug>" squash
   jj -R "$ROOT" workspace update-stale
   ```

   Check `conflicts()` again until it is empty.

3. Forget the workspace and delete its directory, including linked
   `node_modules` (`rm -rf` removes the symlink, not the target):

   ```bash
   jj -R "$ROOT" workspace forget dispatch-<slug>
   rm -rf "$WS_DIR/<slug>"
   ```

   Forgetting abandons the workspace's empty working-copy commit. It does not
   touch the task commit, which is now part of the original workspace's
   history.

4. Record the task's final change ID and commit ID in the task list.

After the last wave, remove `$WS_DIR` if it is empty, and confirm with
`jj workspace list` that no `dispatch-` workspace remains. If you abandon a
task, still forget its workspace and delete its directory; abandon its commit
with `jj abandon` if it holds nothing worth keeping.

## 6. Finish

Continue until the requested outcome is complete. Run the repository's checks
once more in the original workspace on the landed history. Report the completed
tasks, their waves, models, and commits, the validation results, and any
remaining blockers. Follow the user's bookmark and push instructions when
supplied.
