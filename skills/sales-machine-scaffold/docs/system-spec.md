# The HCL system spec

[← back to the README](../README.md) · [docs index](README.md)

The scaffold's main output is `system/sales-machine.hcl`. It describes the sales machine as it runs
day to day: what an agent does, when it does it, what it reads, what it writes, where it must stop
for a review, and what it hands to people. It does not describe how the scaffold itself works.

## Why HCL

HCL is easy to read, it can hold nested blocks and references between them, and many existing
parsers can check it. Here it is used **only as a specification language**:

- Nothing is applied or executed. The file is not infrastructure.
- No `provider`, `resource`, `module`, `data` or `terraform` blocks.
- No functions and no `${}` interpolation. Values are plain strings, numbers, lists and references.
- No secrets, credentials or real hosts. Placeholders look like `"<channel>"`, and unknown values
  stay `"[to confirm]"`.

## Block types

| Block      | Describes                                                                                                            |
| ---------- | -------------------------------------------------------------------------------------------------------------------- |
| `spec`     | the header: product, version, operator agent, the "spec only" note                                                   |
| `agent`    | an agent: purpose, what it reads and writes, what it must never do, who it escalates to                              |
| `role`     | a group of people: what they own and what they approve                                                               |
| `source`   | an input the agent reads: kind, path or channel, how often it refreshes                                              |
| `routine`  | when a workflow runs (`schedule = "daily 19:00 <tz>"` or `on = event.x`), which agent runs it, where the result goes |
| `workflow` | a recurring job: `inputs`, ordered `step` blocks, `outputs`, `review_gate`                                           |
| `gate`     | the checks that must pass before a result moves on, and what happens on a failure                                    |
| `stage`    | one of the 6 stages: order, entry and exit events, value elements, metric, owner                                     |
| `event`    | something that happens and what it captures                                                                          |
| `lane`     | a path through stage 04 and its buying signal                                                                        |
| `signal`   | the rule that turns usage into a lead, and what fires when it is met                                                 |
| `loop`     | a growth loop: its steps, owner, metric, the stage it feeds                                                          |
| `metric`   | a formula and its unit                                                                                               |
| `rule`     | a standing rule every output obeys (CTA, never-say, regulated topics, no customer names)                             |
| `handoff`  | what goes from an agent to a role, which artifact, and when                                                          |

A reference is written `type.name`, for example `runs = workflow.article_batch`. Every reference
must point to a block declared in the same file.

## Example

```hcl
routine "daily_articles" {
  schedule    = "daily 19:00 <tz>"
  agent       = agent.operator
  runs        = workflow.article_batch
  delivers_to = handoff.articles
}

workflow "article_batch" {
  inputs = [source.product, "articles/index.json"]

  step "pick_gaps" {
    does = "Coverage persona x stage x loop x value; pick the gaps"
  }

  step "draft" {
    does = "Write ready articles with value, loop, CTA and FAQ"
    uses = [rule.cta, rule.never_say]
  }

  outputs     = ["articles/<date>/*.md"]
  review_gate = gate.content
}
```

A complete example, where every reference resolves, is in
[`reference/system-spec.example.hcl`](../reference/system-spec.example.hcl).

## How an agent runs it

1. Load `system/operator.md` as the agent workspace's standing instructions.
2. Load `system/sales-machine.hcl` as the machine.
3. For each `routine`, run its `workflow` on its schedule or event, with the `agent` it names.
4. Obey every `rule`, stop at every `gate`, and deliver results only through a `handoff`.
5. Never act outside the spec. To change the machine, change the spec first
   (`/sales-machine-scaffold system-spec`).

## How to check it

The skill checks the spec itself, with no tool: balanced braces, only the block types above,
every reference declared, and no forbidden blocks, `${}`, URLs or secrets. If you have an HCL
parser at hand you can also parse the file with it, but none is required.
