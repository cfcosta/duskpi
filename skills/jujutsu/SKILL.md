---
name: jujutsu
description: Teaches the LLM how to use Jujutsu (jj), a Git-compatible VCS, correctly. Use when a `.jj/` directory exists at the workspace root (jj-managed repo, possibly colocated with `.git/`), when the user mentions "jj"/"jujutsu", or when the user asks for VCS operations and prefers jj. Covers mental model, commands, bookmarks, push workflow, conflicts, recovery via the operation log, revsets/templates/filesets, scripting hygiene, and known gotchas.
---

# 0. When to use this skill

Activate this skill if any of these is true:

1. The current workspace contains a `.jj/` directory (run `[ -d .jj ] && echo jj` to detect; or check `git rev-parse --show-toplevel` and look for `.jj/` next to it).
2. The user typed `jj`, `jujutsu`, `jjvcs`, or referred to bookmarks/operation log/change IDs.
3. The user asked you to do VCS work and configured `vcs = jj` or similar in CLAUDE.md.

If `.jj/` is **not** present, do NOT introduce jj — use git. If both `.git/` and `.jj/` are present, the repo is **colocated** and either tool works; prefer jj for any rewrite (it auto-rebases descendants and keeps an undoable op log).

# 1. The non-negotiable mental model

You MUST internalize these before issuing any rewriting command. Acting on git intuition will corrupt or surprise the user.

## 1.1 `@` is a real commit, not a working tree

- `@` is the **working-copy commit**: a real, persistent commit whose contents == files on disk.
- Almost every `jj` command **auto-snapshots** the working copy first, replacing `@` with an amended version. There is no `git add`, no staging area, no untracked-vs-staged distinction.
- New files are auto-tracked (subject to `.gitignore` and `snapshot.auto-track`); deleted files auto-disappear.
- `@-` = parent of `@`. Suffix chain: `@--`, `@++`, etc.

## 1.2 Change ID vs Commit ID

- **Commit ID** — 40-hex SHA, identical to a git commit hash under the Git backend. Changes whenever the commit's contents/metadata change.
- **Change ID** — 16-byte stable identity displayed as 12 letters in the `k`–`z` range. **Follows the commit across rewrites** (rebase, amend, describe, squash). Prefer change IDs in commands because they survive rewriting.
- A "hidden" commit is reachable by commit ID but not by change ID.
- Disambiguate divergent change IDs with `xyz/0` (most recent), `xyz/1`, etc.

## 1.3 First-class conflicts

- Conflicts are stored **inside** commits as structured data, not just `<<<<<<<` markers.
- `jj rebase` never fails on conflicts — descendants are rebased successfully and inherit conflict state.
- Conflict markers materialize in files only when the conflicted commit is checked out as `@`.
- Default marker style is **NOT** git-style — see §7.

## 1.4 Bookmarks ≠ git branches

- A **bookmark** is a named pointer to a revision. **It does NOT auto-advance** when you commit on top of it.
- There is **no "current bookmark"** / no `HEAD` to follow.
- Bookmarks DO follow the change-id automatically when you rewrite a commit (rebase, squash, etc.).
- Push refuses without an explicit bookmark or `--change` (see §6).

## 1.5 The operation log = whole-repo undo

- Every state-changing command writes an **Operation** containing a snapshot of bookmarks + heads + working-copy commits.
- `jj op log` shows them; `jj undo` reverts the most recent; `jj op restore OPID` jumps the entire repo state to a snapshot. See §8.

## 1.6 Mindset shifts from git

| Git habit                         | jj reality                                                                                                 |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `git add` then `git commit`       | No staging — files auto-snapshot into `@`. Use `jj split` / `jj squash` / `jj squash -i` to redistribute.  |
| Branches advance with new commits | Bookmarks **don't move** unless you move them.                                                             |
| `git stash` to switch branches    | `jj edit OTHER_REV` — your old `@` stays as a sibling commit.                                              |
| Rebases fail on conflict          | Rebases always finish; conflicts ride along until resolved.                                                |
| `git reflog` for recovery         | `jj op log` shows the whole-repo history; `jj undo` is one command.                                        |
| `git checkout COMMIT`             | `jj edit COMMIT` (edit in place) **or** `jj new COMMIT` (new empty child). These are different — see §1.7. |

## 1.7 The `jj new` vs `jj edit` trap

- `jj new REV` creates a **new empty commit** whose parent is REV and points `@` at it. Closest git equivalent: `git checkout -b temp REV`.
- `jj edit REV` makes REV itself the working copy — saving files **rewrites REV**. Closest git equivalent: amending an arbitrary commit in history.
- Default to `jj new REV` when starting fresh work; use `jj edit REV` only when intentionally editing a specific historical commit.

# 2. Detection and setup

## 2.1 Detection commands

```bash
# Is this a jj workspace?
[ -d .jj ] && echo "jj-managed"
# or:
jj root 2>/dev/null && echo "jj-managed"   # exits 0 if managed, 1 otherwise

# Is it colocated with git?
[ -d .jj ] && [ -d .git ] && echo "colocated"

# Get version
jj --version
```

`jj st` exits 1 with `Error: There is no jj repo in "."` when run outside a jj workspace — useful as a guard.

## 2.2 Identity (#1 setup gotcha)

jj refuses to commit without `user.name` + `user.email`, or stamps a placeholder and refuses to push placeholder-authored commits. Set once per machine:

```bash
jj config set --user user.name "Name"
jj config set --user user.email "you@example.com"
```

In CI/automation, prefer env vars: `JJ_USER`, `JJ_EMAIL`.

**Important:** `jj config set` only affects FUTURE commits — the current `@` keeps its old author. To rewrite the author of `@`, run `jj metaedit --update-author` after setting the config.

## 2.3 Initialize / clone

```bash
jj git init                       # in existing dir; default colocates
jj git init --colocate            # explicit; both .jj/ and .git/
jj git init --no-colocate         # pure jj (rare)
jj git clone URL [DEST]           # default colocates; tracks default remote bookmark
jj git clone --colocate URL DEST
```

# 3. The git ⇄ jj command table

Use this when translating user intent from git vocabulary.

| Git intent                           | jj                                                                     |
| ------------------------------------ | ---------------------------------------------------------------------- |
| `git status`                         | `jj st`                                                                |
| `git log --oneline --graph`          | `jj log -r ::@`                                                        |
| `git log --all`                      | `jj log -r ::` (or `-r 'all()'`)                                       |
| `git diff` (working tree vs HEAD)    | `jj diff`                                                              |
| `git diff REV`                       | `jj diff --from REV`                                                   |
| `git diff A B`                       | `jj diff --from A --to B`                                              |
| `git show REV`                       | `jj show REV`                                                          |
| `git blame FILE`                     | `jj file annotate FILE`                                                |
| `git ls-files`                       | `jj file list`                                                         |
| `git add FILE` (new)                 | `touch FILE` (auto-tracked on next snapshot)                           |
| `git rm --cached FILE`               | `jj file untrack FILE`                                                 |
| `git commit -a -m "msg"`             | `jj commit -m "msg"`                                                   |
| `git commit --amend -a`              | `jj squash` (defaults `@` → `@-`)                                      |
| `git commit --amend --only` (reword) | `jj describe @-`                                                       |
| `git restore PATHS`                  | `jj restore PATHS`                                                     |
| `git reset --hard` (drop change)     | `jj abandon`                                                           |
| `git reset --soft HEAD~`             | `jj squash --from @-`                                                  |
| `git checkout -b TOPIC main`         | `jj new main` (then bookmark when pushing)                             |
| `git checkout BRANCH`                | `jj edit BRANCH` (warps `@`)                                           |
| `git checkout -- PATHS`              | `jj restore PATHS`                                                     |
| `git branch`                         | `jj bookmark list` (or `jj b l`)                                       |
| `git branch NAME REV`                | `jj bookmark create NAME -r REV`                                       |
| `git branch -f NAME REV` (forward)   | `jj bookmark move NAME --to REV`                                       |
| `git branch -f NAME REV` (backward)  | `jj bookmark move NAME --to REV --allow-backwards`                     |
| `git branch -d NAME`                 | `jj bookmark delete NAME` (then push to propagate)                     |
| `git tag NAME REV`                   | `jj tag set NAME -r REV`                                               |
| `git tag -d NAME`                    | `jj tag delete NAME`                                                   |
| `git rebase MAIN` (current branch)   | `jj rebase -d MAIN` (default `-b @`)                                   |
| `git rebase --onto B A^ DESC`        | `jj rebase -s A -d B`                                                  |
| `git revert REV`                     | `jj revert -r REV -B @`                                                |
| `git cherry-pick SRC`                | `jj duplicate SRC -d @` (or `-A REV` / `-B REV`)                       |
| `git merge B`                        | `jj new @ B` (multi-parent commit)                                     |
| `git stash`                          | `jj new @-` then `jj edit OLD` later                                   |
| `git fetch [REMOTE]`                 | `jj git fetch [--remote REMOTE]`                                       |
| `git push REMOTE BRANCH`             | `jj git push --bookmark BRANCH [--remote REMOTE]` (auto-tracks if new) |
| `git push --all`                     | `jj git push --all` (pushes all bookmarks, NOT all commits)            |
| `git remote add NAME URL`            | `jj git remote add NAME URL`                                           |
| `git reflog` / undo                  | `jj op log`, `jj undo`, `jj op revert OPID`                            |
| `git rev-parse --show-toplevel`      | `jj workspace root`                                                    |

# 4. Inspection commands (always safe to run)

These are read-only modulo the auto-snapshot. Add `--ignore-working-copy` to suppress even that when scripting.

```bash
jj log                                     # default revset; @ + recent + trunk
jj log -r 'trunk()..@'                     # your stack ahead of trunk
jj log -r ::                               # everything (= -r 'all()')
jj log -r 'mine() & mutable()'             # your unpushed work
jj log -n 10 -r 'mutable()'                # cap output

jj st                                      # working-copy + conflict summary
jj show                                    # @'s commit + diff
jj show REV
jj diff                                    # working-copy diff
jj diff -r REV                             # REV vs its parent
jj diff --from A --to B                    # arbitrary diff
jj diff --stat
jj diff -- 'glob:src/**/*.rs'              # path-restricted

jj evolog -r REV                           # change-id history (rewrites)
jj op log                                  # operation history
jj op show OPID
jj op diff --from FROM --to TO

jj bookmark list                           # all local
jj bookmark list -a                        # include remotes
jj bookmark list -t                        # tracked only

jj git remote list
jj file list
jj file show PATH
jj file annotate PATH
```

For machine-readable output, **always** combine `-T 'TEMPLATE'` with `--no-graph`, `--no-pager`, and `--color=never` (see §10 and §11).

# 5. Making and changing commits

## 5.1 The core five

| Command                                | What                                                                                      |
| -------------------------------------- | ----------------------------------------------------------------------------------------- |
| `jj new [REV]`                         | New empty child of REV (default `@`). Sets `@` to it.                                     |
| `jj describe [-m MSG] [-r REV]`        | Edit description. Default REV = `@`. With no `-m` opens `$EDITOR`.                        |
| `jj commit -m "MSG"`                   | `jj describe -m MSG` then `jj new @` (mints a new empty `@` on top).                      |
| `jj squash [-r SRC] [--into DST] [-i]` | Move changes between commits. Default: `@` → `@-`.                                        |
| `jj abandon [REV]`                     | Hide a commit; descendants rebase onto its parent. Default `@`. Reversible via `jj undo`. |

## 5.2 Useful patterns

```bash
# Amend last commit ("git commit --amend")
# (just edit files; jj snapshots automatically; if you wanted to fold @ into @-:)
jj squash

# Reword the last commit
jj describe @-

# Insert a new commit between A and B (B is child of A)
jj new -A A    # or -B B

# Edit an old commit in place
jj edit OLD_REV
# ...edit files...
# (next jj command auto-snapshots; the edit lives on OLD_REV)

# Edit an old commit without leaving @
jj new OLD_REV
# ...edit files...
jj squash      # folds the new change into OLD_REV

# Split current commit interactively (TUI)
jj split
jj split -r REV

# Move WIP hunks back to whichever ancestor last touched those lines
jj absorb

# Drop a commit, descendants reparent automatically
jj abandon REV
```

## 5.3 Rebasing — the `-r/-s/-b` distinction

`jj rebase -d DEST` always requires a destination. The source flag picks WHAT moves:

- `-r REV` — **only** that revision; descendants stay where they were (they reparent onto REV's parent). Use to surgically extract or reorder a single commit.
- `-s REV` — REV **and all descendants**. Closest to `git rebase --onto DEST REV^ HEAD`.
- `-b REV` — the whole "branch" containing REV (default `-b @`). Roughly: `roots(DEST..REV)::`.

Other flags: `--insert-after REV` / `-A REV`, `--insert-before REV` / `-B REV` (instead of `-d`), `--skip-emptied` (drop commits emptied by the rebase).

**Multi-result revsets** were once gated by an `all:` prefix; that prefix is **deprecated** in current jj (≥0.30) and not needed. Just write the revset:

```bash
jj rebase -s 'roots(trunk()..@)' -d trunk
```

`-d` is an alias for `-o/--onto`; both work.

## 5.4 Restore / revert / cherry-pick

```bash
jj restore PATHS              # restore PATHS in @ from @-
jj restore --from REV PATHS   # restore from arbitrary rev
jj revert -r REV -B @         # apply inverse of REV before @
jj duplicate SRC -d DEST      # cherry-pick (copy not move)
jj duplicate SRC -A REV       # cherry-pick inserted after REV
```

# 6. Bookmarks and the push workflow

## 6.1 Bookmark commands

```bash
jj bookmark create NAME [-r REV]                  # default REV = @
jj bookmark set NAME -r REV [-B/--allow-backwards] # creates OR updates
jj bookmark move NAME --to REV [-B]               # updates only; errors if NAME absent
jj bookmark delete NAME                           # propagates deletion on next push
jj bookmark forget NAME [--include-remotes]       # local-only; does NOT delete remote
jj bookmark rename OLD NEW
jj bookmark track NAME@REMOTE                     # start tracking
jj bookmark untrack NAME@REMOTE
jj bookmark list [-a|-t|-c|--remote PATTERN]
```

Critical:

- `set` creates if missing; `move` errors if missing.
- Both default to **forward-only**; pass `-B` (`--allow-backwards`) for backward/sideways.
- `delete` schedules removal on the remote (next push); `forget` only drops the local pointer.

## 6.2 Push workflow

```bash
# Existing tracked bookmark — just push
jj git push

# First push of a new bookmark — just specify it
jj git push -b NAME
jj git push --bookmark NAME --remote origin

# Auto-bookmark + push (ergonomic for PRs)
jj git push --change @         # creates push-<short_change_id>, tracks, pushes
jj git push -c @-              # same with @-

# Push everything you've bookmarked
jj git push --all              # all bookmarks, NOT all commits
jj git push --tracked          # only tracked bookmarks
jj git push --deleted          # propagate bookmark deletions
jj git push --dry-run

# One-shot named push without pre-creating a bookmark
jj git push --named NAME=REV
```

**`--allow-new` is deprecated in current jj** (≥0.34). Just pass `-b NAME` for a new bookmark — it will be auto-tracked on success. To enable auto-tracking globally for a remote, set `remotes.<name>.auto-track-bookmarks = "*"` in config.

Push performs a `--force-with-lease`-equivalent safety check; if rejected, run `jj git fetch --remote NAME` and re-evaluate. The default push revset is `remote_bookmarks(remote=<remote>)..@` — if no bookmarks fall in that revset, push prints a warning and does nothing.

## 6.3 Recommended PR workflow

```bash
jj new main                                       # branch off
# ...code...
jj commit -m "feat: thing"                        # sets @'s description, mints empty @ above
jj git push -c @-                                 # auto-bookmark + push the named commit
gh pr create --base main --head push-<chid>       # outside jj
```

**`jj commit -m MSG` rewrites @'s description** — it's `describe + new`. If you already ran `jj describe -m "..."` and then run `jj commit -m "different"`, the second message wins. Either describe-then-commit-without-`-m`, or just commit once with the final message.

Updating the PR after review:

- **Add a commit:** `jj new BOOKMARK; ...; jj commit -m "fix"; jj bookmark move BOOKMARK --to @-; jj git push`
- **Rewrite (clean history):** `jj edit COMMIT; ...; jj git push -b BOOKMARK` (force-pushed safely)

## 6.4 Multiple remotes

```toml
[git]
fetch = ["upstream", "origin"]   # array → fetched on every `jj git fetch`
push  = "origin"                 # single string
```

Push to a non-default remote: `jj git push --remote upstream -b NAME`.

# 7. Conflicts (first-class)

## 7.1 Detecting

- `jj log` annotates conflicted revisions in the description line.
- `jj st` lists `Warning: There are unresolved conflicts at these paths:`.
- `jj resolve --list` (or `-l`) — files in conflict in the current rev.
- Revset: `conflicts()`. Template field: `conflict`.

## 7.2 Default marker format (NOT git-style)

```
<<<<<<< conflict 1 of 1
%%%%%%% diff from: <hash> "merge base"
       to: <hash> "commit A"
 apple
-grape
+grapefruit
 orange
+++++++ <hash> "commit B"
APPLE
GRAPE
ORANGE
>>>>>>> conflict 1 of 1 ends
```

Markers may be lengthened (`<<<<<<<<<<<<<<<`) when content collides. Switch style via:

```toml
[ui]
conflict-marker-style = "diff"      # default
# = "snapshot"                      # raw contents of every side
# = "git"                           # git's diff3 style (only for 2-sided)
```

## 7.3 Resolving

```bash
# 3-way merge tool (must configure ui.merge-editor first)
jj resolve
jj resolve PATH
jj resolve --tool TOOL              # built-ins :ours, :theirs

# Manual: edit the file in @, save — auto-snapshots
# To resolve a non-@ commit cleanly:
jj new C       # materialize the conflict in a child
# ...edit files...
jj squash      # fold resolution back into C; descendants auto-rebase clean
```

# 8. Operation log — your safety net

## 8.1 Vocabulary

- Every state-changing command writes one Operation.
- `@` (in op-log context) refers to the current operation; `@-`/`@+` parent/child ops.

## 8.2 Read

```bash
jj op log                          # graph of operations
jj op log -p                       # patches per op
jj op log --at-op=@ --ignore-working-copy   # truly read-only
jj op show OPID
jj op diff --from FROM --to TO
```

## 8.3 Recover

```bash
jj undo                            # undo the LAST operation; repeatable
jj redo                            # reapply most-recently undone

jj op revert OPID                  # incremental inverse of one specific op
jj op restore OPID                 # JUMP repo state back to OPID's snapshot
```

Difference: `undo`/`op revert` apply incremental inverses; `op restore` jumps the entire repo state to a snapshot in one new op (intervening ops still exist in the log, just no longer reachable from `@`).

**There is no `jj op undo` subcommand.** Use `jj undo` for the last op, `jj op revert OPID` for an arbitrary one.

## 8.4 Recovery recipes

| Situation                              | Command                                                        |
| -------------------------------------- | -------------------------------------------------------------- |
| Just ran `jj abandon` on the wrong rev | `jj undo`                                                      |
| Bad rebase                             | `jj op log` → identify op-before-rebase → `jj op restore OPID` |
| Working copy looks weird               | `jj op log` → `jj op restore <last-good>`                      |
| `.jj/working_copy/` stale (ctrl-C'd)   | `jj workspace update-stale`                                    |
| Read-only inspection at past op        | `jj --at-op=OPID log` (implies `--ignore-working-copy`)        |
| Permanently delete op history          | `jj op abandon RANGE` then `jj util gc` (DESTRUCTIVE)          |

## 8.5 Auto-snapshot timing

- jj auto-snapshots `@` at the start of nearly every command (including `jj log`, `jj st`, `jj op log`).
- Suppress with global `--ignore-working-copy`.
- Concurrent edits never overwrite each other — both writes survive as **divergent** changes.
- A stale working copy (ctrl-C, multi-workspace race) recovers via `jj workspace update-stale`; nothing is silently lost.

# 9. Revsets — the revision selection language

## 9.1 Symbols and operators

| Symbol        | Meaning                                                                           |
| ------------- | --------------------------------------------------------------------------------- |
| `@`           | working-copy commit                                                               |
| `@-`, `@--`   | parent, grandparent                                                               |
| `@+`, `@++`   | child, grandchild                                                                 |
| `root()`      | virtual root (common ancestor of all commits)                                     |
| `trunk()`     | built-in alias → default-bookmark head on origin/upstream; falls back to `root()` |
| `name@remote` | remote-tracking ref                                                               |

| Operator     | Meaning                                                                   |
| ------------ | ------------------------------------------------------------------------- |
| `x..y`       | ancestors-of-y not ancestors-of-x (excludes x, includes y) — git's `x..y` |
| `x::y`       | ancestry path from x to y (includes both)                                 |
| `::x`, `x::` | ancestors of x (incl x); descendants of x (incl x)                        |
| `..x`, `x..` | (= `~::x`) the complement                                                 |
| `~x`         | negation                                                                  |
| `x \| y`     | union                                                                     |
| `x & y`      | intersection                                                              |
| `x ~ y`      | difference                                                                |

Distribution gotcha: `(A|B).. = A.. & B..`, NOT `A.. | B..`.

## 9.2 Functions agents need

- **Refs:** `bookmarks([pattern])`, `remote_bookmarks([name], [remote=])`, `tags([pattern])`, `git_refs()`, `git_head()`
- **Existence:** `present(x)` — returns `none()` instead of erroring on missing refs (REQUIRED in scripts)
- **Resolution:** `commit_id(prefix)`, `change_id(prefix)`, `coalesce(...)`
- **Text/people:** `description(pat)`, `author(pat)`, `author_email(pat)`, `committer(pat)`, `mine()`
- **Files/diff:** `files(fileset)`, `diff_lines(text, [files])`, `diff_lines_added(...)`, `diff_lines_removed(...)`. Note: there is **no** `diff_contains` function.
- **Topology:** `ancestors(x, [depth])`, `descendants(x, [depth])`, `parents(x, [depth])`, `children(x, [depth])`, `heads(x)`, `roots(x)`, `connected(x)`, `latest(x, [count])`
- **State:** `empty()`, `merges()`, `conflicts()`, `divergent()`
- **Visibility:** `mutable()`, `immutable()`, `visible_heads()`, `working_copies()`, `all()`, `none()`
- **Time travel:** `at_operation(op, x)`

## 9.3 String patterns (default `glob:`)

`exact:`, `glob:`, `regex:`, `substring:`. Append `-i` for case-insensitive: `glob-i:"*Frob*"`.

Date patterns: `after:"2024-02-01"`, `before:"yesterday"`, `after:"2 weeks ago"`.

## 9.4 Recipes

```bash
# Stack ahead of trunk
jj log -r 'trunk()..@'

# Unpushed mutable work
jj log -r 'mine() & mutable() & ~::trunk()'

# Commits touching a path
jj log -r 'files("src/foo.rs")'

# Commits referencing JIRA-123
jj log -r 'description(glob:"*JIRA-123*")'

# Empty mutable WIP I should clean up
jj log -r 'mine() & empty() & mutable()'

# Latest 5 commits on origin/main
jj log -r 'latest(::remote_bookmarks(exact:"main", remote=exact:"origin"), 5)'

# Safely reference a maybe-missing bookmark
jj log -r 'present(feature-x)..@'

# Conflicted commits in current stack
jj log -r '(trunk()..@) & conflicts()'
```

# 10. Templates — formatting output

`jj log` and friends accept `-T '<template>'`. Pair with `--no-graph` for parseable lines.

## 10.1 Syntax

- `expr.method()`, `f(x)`, `x ++ y` (concat), `if(cond, then, else)`, `concat(...)`, `separate(sep, ...)`, `coalesce(...)`, `join(sep, ...)`
- Logic: `==`, `!=`, `&&`, `||`, `!`
- Strings in `'...'` or `"..."`

## 10.2 Most-used keywords on a Commit

`commit_id`, `change_id`, `description`, `author`, `committer`, `parents`, `bookmarks`, `local_bookmarks`, `remote_bookmarks`, `tags`, `empty`, `conflict`, `divergent`, `hidden`, `immutable`, `mine`, `root`, `current_working_copy`.

Methods worth knowing: `commit_id.short([n])`, `change_id.short([n])`, `description.first_line()`, `author.name()`, `author.email()`, `author.timestamp().format("%Y-%m-%d")`, `bookmarks.join(",")`.

## 10.3 Useful agent-grade templates

```bash
# Just commit hashes
jj log --no-graph -r 'mutable()' -T 'commit_id ++ "\n"'

# Compact: change_id + summary
jj log --no-graph -r 'trunk()..@' \
  -T 'change_id.short() ++ " " ++ description.first_line() ++ "\n"'

# TSV for parsing
jj log --no-graph -r 'trunk()..@' \
  -T 'change_id.short() ++ "\t" ++ author.email() ++ "\t" ++ description.first_line() ++ "\n"'

# Bookmarks with their tip
jj bookmark list -T 'name ++ "\t" ++ normal_target.change_id().short() ++ "\n"'

# JSON
jj log --no-graph -T 'json(self) ++ "\n"'
```

# 11. Filesets — file selection

Used positionally in `jj diff -- FILES`, `jj log -- FILES`, `jj split FILES`, `jj restore FILES`, etc.

| Pattern                                              | Meaning                         |
| ---------------------------------------------------- | ------------------------------- |
| `cwd:"path"` (default) / `file:` / `cwd-file:`       | cwd-relative literal            |
| `root:"path"` / `root-file:`                         | workspace-root-relative         |
| `glob:"*.c"`, `cwd-glob:`, `root-glob:"src/**/*.rs"` | non-recursive glob              |
| `prefix-glob:` / `root-prefix-glob:`                 | glob that also matches subtrees |
| append `-i` (`glob-i:`)                              | case-insensitive                |

Operators: `~x`, `x & y`, `x ~ y`, `x | y`. Quote when you have operators.

```bash
# Diff excluding lockfiles
jj diff -r @ -- '~glob:"**/*.lock"'

# Restore one file from main
jj restore --from main path/to/file
```

# 12. Config keys an agent will encounter

| Key                                                           | What                                                                                  |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------- | ------ | ------------------------------ |
| `user.name`, `user.email`                                     | identity (REQUIRED)                                                                   |
| `ui.editor`, `ui.diff-editor`, `ui.merge-editor`              | editors. Resolve order for editor: `$JJ_EDITOR` > `ui.editor` > `$VISUAL` > `$EDITOR` |
| `ui.pager`, `ui.paginate`                                     | pager. Default `less -FRX`, `auto`. Set `paginate = "never"` for scripts.             |
| `ui.color`                                                    | `auto`/`always`/`never`/`debug`. Overrides `NO_COLOR`.                                |
| `ui.conflict-marker-style`                                    | `diff`/`snapshot`/`git`                                                               |
| `revset-aliases.'immutable_heads()'`                          | Gates rewrites. Default = `trunk()                                                    | tags() | untracked_remote_bookmarks()`. |
| `revsets.log`                                                 | Default revset for `jj log`                                                           |
| `git.colocate`                                                | Whether `jj git init/clone` colocate. Default `true`.                                 |
| `git.fetch`, `git.push`                                       | Default remote(s).                                                                    |
| `git.private-commits`                                         | Revset jj refuses to push (silent push failures hide here).                           |
| `git.sign-on-push`                                            | Sign mutable unsigned commits at push time.                                           |
| `templates.git_push_bookmark`                                 | Bookmark name for `--change` push. Default: `'"push-" ++ change_id.short()'`.         |
| `signing.behavior`, `signing.backend`, `signing.key`          | GPG/SSH signing.                                                                      |
| `snapshot.max-new-file-size`                                  | Default 1 MiB; large new files refuse to snapshot.                                    |
| `snapshot.auto-track`                                         | Fileset of paths auto-tracked.                                                        |
| `aliases.X`                                                   | Single command alias (list of args).                                                  |
| `revset-aliases.X`, `template-aliases.X`, `fileset-aliases.X` | Custom names.                                                                         |

Read/write:

```bash
jj config list                    # everything
jj config list --user --include-defaults
jj config get KEY
jj config set --user|--repo|--workspace KEY VALUE
jj config edit --user
jj config path --user             # print file path

# One-shot override
jj --config KEY=VALUE COMMAND
jj --config-file PATH COMMAND
```

Config files (later wins): built-in → user (`$XDG_CONFIG_HOME/jj/config.toml` or `~/.jjconfig.toml`) → repo (`jj config path --repo`) → workspace → CLI.

## 12.1 Handling immutable_heads

If a rewrite is rejected with "Commit is immutable":

1. **Don't** edit `immutable_heads()` to none — that defeats the safety net.
2. Use the global `--ignore-immutable` flag for that ONE command (cannot rewrite the literal root commit either way).
3. If you genuinely want to extend the immutable set: `revset-aliases."immutable_heads()" = "builtin_immutable_heads() | release@origin"`.

# 13. Scripting hygiene

For any output an agent will parse:

```bash
jj --no-pager --color=never log \
   --ignore-working-copy \
   --no-graph \
   -r 'REVSET' \
   -T 'TEMPLATE'
```

- `--no-pager` — disables pager (or `ui.paginate=never`).
- `--color=never` — disables ANSI (or `ui.color=never`; do NOT rely on `NO_COLOR` since `ui.color` overrides it).
- `--ignore-working-copy` — skip auto-snapshot for read-only operations.
- `--no-graph` + `-T` — deterministic, line-oriented output.
- Avoid relying on default revsets in machine output — pass `-r` explicitly.

## 13.1 Editor prompts that block scripts

Several jj commands open `$EDITOR` even when the diff is determined non-interactively:

- `jj describe` (no `-m`)
- `jj split` (even with positional fileset — opens editor for the new commit's description)
- `jj squash` when both source and destination have descriptions (opens editor to merge them)
- `jj commit` (no `-m`)
- `jj resolve` (opens the merge tool)

In automation, set a no-op editor: `JJ_EDITOR=true jj split feat-x.txt`. `true` exits 0 without modifying the file, accepting whatever default jj wrote.

## 13.2 Useful env vars

| Variable              | Effect                                                                                  |
| --------------------- | --------------------------------------------------------------------------------------- |
| `JJ_USER`, `JJ_EMAIL` | Override identity                                                                       |
| `JJ_EDITOR`           | Highest-priority editor (set to `true` to auto-accept)                                  |
| `JJ_CONFIG`           | Override config file/dir lookup (`:` Unix, `;` Windows). Set empty to skip user config. |

# 14. Practitioner patterns

## 14.1 Megamerge (multi-parent WIP)

A merge commit on top of N feature branches you're integrating locally. You work on top of the merge, never push the merge itself.

```bash
jj new x y z                            # multi-parent new = merge
jj commit -m "megamerge"                # mints empty @ above

# Send WIP back to one parent branch
jj squash --from @ --into x             # whole WIP commit
jj squash --from @ --into x -i          # interactive

# Auto-route hunks back to whichever ancestor last touched same lines
jj absorb
```

## 14.2 Stacked PRs

One bookmark per stack member; each PR's `--base` is the previous bookmark.

```bash
jj new main
# ...PR 1 work...
jj commit -m "PR1: foo"
jj bookmark create pr1 -r @-

# ...PR 2 stacked on PR 1...
jj commit -m "PR2: bar"
jj bookmark create pr2 -r @-

jj git push --all                        # push all bookmarks
gh pr create --base main --head pr1 ...
gh pr create --base pr1  --head pr2 ...
```

## 14.3 Quality-of-life aliases

Add to `~/.config/jj/config.toml` (NOT mandatory; mention them when the user wants them).

```toml
[revset-aliases]
'closest_bookmark(to)' = 'heads(::to & bookmarks())'
'closest_pushable(to)' = 'heads(::to & mutable() & ~description(exact:"") & (~empty() | merges()))'

[aliases]
# Move closest bookmark forward to closest pushable commit
tug = ["bookmark", "move", "--from", "closest_bookmark(@)", "--to", "closest_pushable(@)"]
```

# 15. Anti-patterns (do NOT do these)

1. **Don't run `git rebase` / `git commit --amend` / `git checkout` in a colocated repo without thinking.** Those bypass jj's auto-rebase and op log; you can lose the safety net. Prefer the `jj` equivalent.
2. **Don't set `revset-aliases."immutable_heads()" = "none()"`** — use `--ignore-immutable` for one-shot rewrites.
3. **Don't `jj abandon` ancestors of a bookmark you care about** without considering descendants — they reparent automatically (usually fine, sometimes surprising).
4. **Don't push without an explicit bookmark or `--change`** — `jj git push --all` only pushes existing bookmarks; commits without bookmarks aren't published.
5. **Don't expect bookmarks to advance** — they don't. Use `jj bookmark move` after each commit, or `jj git push -c @-` for the auto-bookmark shortcut.
6. **Don't use `jj op undo`** — it doesn't exist. Use `jj undo` (last op) or `jj op revert OPID` (specific op).
7. **Don't rely on `jj edit` for "checkout"** — `jj edit` rewrites that commit when you save. Use `jj new REV` for fresh work atop REV.
8. **Don't parse default `jj log` output** — graph + colors + truncation are unstable. Use `--no-graph -T '...' --color=never`.
9. **Don't reference unstable bookmarks without `present()`** in scripts — `jj log -r 'feature-x..@'` errors if `feature-x` doesn't exist; `present(feature-x)..@` returns `none()`.
10. **Don't push commits without descriptions or with a placeholder identity** — push will refuse. Set identity first; `jj describe` before pushing.
11. **Don't use the `all:` prefix on revsets** — it's deprecated since jj 0.30. Modern jj accepts multi-result revsets directly: `jj rebase -s 'roots(trunk()..@)' -d trunk`.
12. **Don't try to use `jj` if there is no `.jj/` directory.** Fall back to git.

# 16. Engineering checklist before reporting "done"

- [ ] Identity is configured (commits not authored as placeholder).
- [ ] All commits intended for the PR have descriptions.
- [ ] Bookmark exists and points at the right commit (`jj bookmark list`).
- [ ] `jj log -r 'mine() & conflicts()'` is empty.
- [ ] `jj st` shows the working copy in the expected state.
- [ ] If pushing, `jj git push --dry-run` shows the expected change set.
- [ ] If anything went sideways, `jj op log` was used to trace it.

# 17. Versioning notes

- This skill was verified against **jj 0.40.0**. jj is **pre-1.0** and changes fast.
- Recently removed/deprecated:
  - `--allow-new` flag on `jj git push` (deprecated; just pass `-b NAME` and it auto-tracks)
  - `all:` revset prefix (deprecated since 0.30; multi-result revsets work without it)
  - `git.push-bookmark-prefix` config key (replaced by `templates.git_push_bookmark`)
- `-d/--destination` is an alias for `-o/--onto` on `jj rebase` and friends; `--after`/`--before` are aliases for `-A`/`-B`. Use whichever reads better.
- `jj --version` to check the installed version.
- Authoritative docs: `https://docs.jj-vcs.dev/latest/`. Use `/prerelease/` for unreleased features.
- Default colocate (`git.colocate = true`) is the post-2025 norm; older docs may show `--colocate` as opt-in.

# 18. Quick cheat sheet (memorize)

```
@ = working copy        @- = parent       @+ = child
.. = exclusive range    :: = inclusive ancestry path

jj st                       # status
jj log -r 'trunk()..@'      # my stack
jj diff                     # working diff
jj show REV                 # full commit

jj new [REV]                # new empty child of REV (default @)
jj describe [-m MSG]        # edit message
jj commit -m MSG            # describe + new
jj squash [--into REV]      # fold @ into REV (default @-)
jj split                    # split @ in two
jj abandon [REV]            # drop, descendants reparent

jj rebase -d DEST           # default -b @     (-d aliases -o/--onto)
jj rebase -s REV -d DEST    # REV + descendants
jj rebase -r REV -d DEST    # REV only

jj edit REV                 # warp @ to REV (rewrites on save!)
jj restore [PATHS]          # discard working changes

jj bookmark create NAME [-r REV]
jj bookmark move   NAME --to REV [-B]
jj bookmark delete NAME
jj git push -c @-           # auto-bookmark + push for PR

jj op log                   # what happened
jj undo                     # undo last op (NOT `jj op undo` — doesn't exist)
jj op revert OPID           # incremental inverse of one op
jj op restore OPID          # jump to past op state
jj workspace update-stale   # fix stale working copy
```

That's the working surface. Reach for the relevant section above when you need details.
