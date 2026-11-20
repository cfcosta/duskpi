---
name: sales-machine-scaffold-system-spec
description: "describe the finished sales machine as an intelligent system that an agent operates day to day, in one HCL spec."
---

# system-spec

`id: sales-machine-scaffold.workflow.system-spec`

- **Goal:** describe the finished sales machine as an intelligent system that an agent operates day to day, in one HCL spec.
- **Scope:** the machine as it RUNS (who does what, when, with which inputs, outputs and gates).
  Not the plan to build it, not infrastructure, not code. Writes `system/sales-machine.hcl`,
  `system/README.md` and `system/operator.md`.
- **Triggers:** "system spec", "HCL of the machine", "how the agent runs the machine", any change to
  stages, loops, routines or rules.
- **Inputs:** `config.json`, `positioning.md`, `machine.md`, `loops.md`, `articles/index.json`, `audit/findings.json`.
- **Invariants:**
  - Spec only: plain HCL native syntax (blocks, attributes, lists, objects, references written as
    `type.name`). No `provider`, `resource`, `module`, `data`, `terraform` blocks; no functions or
    `${}` interpolation; no secrets, credentials or real hosts (placeholders like `"<channel>"`).
  - Only these block types: `spec`, `agent`, `role`, `source`, `routine`, `workflow` (with nested
    `step`), `gate`, `stage`, `event`, `lane`, `signal`, `loop`, `metric`, `rule`, `handoff`.
  - Every value comes from the workspace files; unknowns stay `"[to confirm]"`.
  - Every reference resolves to a declared block; every routine names an agent and a workflow;
    every workflow has a `review_gate`; every stage has `entry`, `exit` and `metric`; every loop
    closes (its last step feeds its first) and has an `owner` and a `metric`.
- **Procedure:**
  1. `spec` header: product, version, date, `operator = agent.<id>`, and
     `note = "Specification only. Not infrastructure. Nothing here is executed."`
  2. `agent` blocks: the operator agent (what it reads, what it writes, what it must never do,
     who it escalates to), plus any specialist agent the machine needs (e.g. writer, auditor).
  3. `role` blocks for the people (content, sales, success, product) with what they own and approve.
  4. `source` blocks: each input the agent reads (product sources, access requests, usage signals),
     with `kind`, `path_or_channel` placeholder and `refresh`.
  5. `stage` blocks 01-06 with `order`, `entry`/`exit` events, `value` elements, `metric`, `owner`;
     `event` blocks with what each event captures; `lane` + `signal` blocks with the buying-signal rule
     and what fires when it is met.
  6. `loop` blocks (integrations, invites, content) with `steps`, `owner`, `metric`, `feeds`.
  7. `workflow` blocks for every recurring job of the running machine (article batch, release
     sweep, lead hand-off, coverage review, rule-change sweep, report refresh), each with `inputs`,
     ordered `step` blocks (`does`, `uses`), `outputs`, `review_gate`.
  8. `routine` blocks: when each workflow runs (`schedule` as text such as `"daily 19:00 <tz>"`,
     `"weekly mon 09:00 <tz>"` or `on = event.<name>`), `agent`, `runs`, `delivers_to`.
  9. `gate`, `metric`, `rule` (from the hard rules and config: CTA, never-say, regulated topics,
     no customer names) and `handoff` blocks (agent -> role, artifact, when).
  10. `README.md`: one line "This file is a specification, not infrastructure: nothing is applied
      or executed", the block guide, how to read references, how to validate (any HCL parser can
      parse it; no tool is required to use it).
  11. `operator.md`: the standing instructions an agent workspace loads to run the machine: load
      the spec, run each routine's workflow on its schedule or event, obey every `rule`, stop at
      every `gate`, deliver through `handoff`, never act outside the spec.
  12. **Self-check without tools:** balanced braces and quotes; only allowed block types; every
      `type.name` reference declared; no forbidden blocks, `${`, URLs or secrets. Record the result
      in `audit/findings.json` as file `system/sales-machine.hcl`.
- **Example shape (placeholders; an excerpt, so some referenced blocks are not shown here: the
  full spec declares every block it references):**

```hcl
spec "sales_machine" {
  product  = "<ProductName>"
  version  = "1.0.0"
  operator = agent.operator
  note     = "Specification only. Not infrastructure. Nothing here is executed."
}

agent "operator" {
  purpose      = "Runs the routines, drafts, audits and hands off to people"
  reads        = [source.product, source.access_requests, source.usage]
  writes       = ["sales-machine/"]
  never        = [rule.no_publish_without_review, rule.never_say]
  escalates_to = role.sales
}

role "sales" {
  owns     = ["assisted invites", "leads", "closing"]
  approves = [handoff.lead]
}

source "access_requests" {
  kind            = "form"
  path_or_channel = "<channel>"
  refresh         = "on event"
}

event "access_requested" {
  captures = ["goal", "company", "providers", "referrer"]
}

stage "attract" {
  order  = 2
  entry  = event.access_requested
  exit   = event.invite_sent
  value  = ["Vision", "Time savings", "Reduced anxiety"]
  metric = metric.request_to_invite
  owner  = role.sales
}

lane "self_serve" {
  path   = ["first use", "own setup", "schedule", "connect an agent"]
  signal = signal.self_serve_usage
}

signal "self_serve_usage" {
  when = "[to confirm: N uses in 30 days]"
  then = workflow.lead_handoff
}

loop "integrations" {
  steps  = ["customer names its providers", "we integrate", "integration page attracts their customers", "they name theirs"]
  owner  = role.product
  metric = metric.requests_per_cohort
  feeds  = stage.feed
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

routine "daily_articles" {
  schedule    = "daily 19:00 <tz>"
  agent       = agent.operator
  runs        = workflow.article_batch
  delivers_to = handoff.articles
}

gate "content" {
  checks  = ["only ledger facts", "2-4 value elements", "loop hook", "FAQ", "no forbidden CTA"]
  on_fail = "fix, or record FAIL and hand off"
}

metric "request_to_invite" {
  formula = "invites_sent / access_requests"
  per     = "100 access requests"
}

rule "cta" {
  text = "Every call to action is the configured primary CTA"
}

handoff "articles" {
  from     = agent.operator
  to       = role.content
  artifact = "articles/<date>/*.md"
  when     = "after gate.content passes"
}
```

- **Outputs:** `system/sales-machine.hcl`, `system/README.md`, `system/operator.md`.
- **Review gate:** self-check clean; every stage, loop, routine and workflow of `machine.md` and
  `loops.md` is in the spec and nothing else is; README says spec, not infrastructure.
- **References:** Workflow: machine, Workflow: loops, Workflow: report.

---

Parent: [sales-machine-scaffold](../../SKILL.md) (config, global rules, references).
