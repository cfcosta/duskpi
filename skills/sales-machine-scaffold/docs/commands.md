# Commands and what each one produces

[← back to the README](../README.md) · [docs index](README.md)

## Output files

- **`system/sales-machine.hcl`**: the finished machine as an intelligent system that an agent runs.
  It lists the agents, roles, sources, routines and schedules, workflows (inputs, steps, outputs,
  review gates), stages, lanes, buying signals, growth loops, metrics, rules and hand-offs.
  The file is a specification, not infrastructure. Nothing in it is executed, and it has no
  providers, resources or modules. See [system-spec.md](system-spec.md).
- **`system/operator.md`**: the standing instructions an agent workspace loads to run that system.
- **`report/sales-machine-report.html`**: one self-contained HTML audit report that opens offline,
  with inline CSS and SVG and no external resources.
- Working files: product map and fact ledger, positioning, machine, loops, articles, landing page
  specs, sales manual and training ebook, audit findings.

## Commands

Invoke as `/sales-machine-scaffold <cmd>`. The default order is the order of this table.

| cmd             | What it does                                                                                                                           | Produces                                                                                          |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `setup`         | collects the product-specific values                                                                                                   | `config.json`, workspace folders                                                                  |
| `explore`       | maps every feature from the code and docs: name as the UI shows it, job, persona, live / rolling out / internal, value delivered       | `product-map.md` with the fact ledger (`F-001 \| claim \| source \| status`) and the content gaps |
| `position`      | defines the flagship customer, the promise, the persona matrix, headline facts and the say / never-say table                           | `positioning.md`                                                                                  |
| `machine`       | designs the 6 stages (Feed, Attract, Activate, Qualify, Convert, Feed back), the two lanes, buying signals, the engine and the metrics | `machine.md`                                                                                      |
| `loops`         | designs the integrations, invites and content loops, each with steps, owner, metric and missing instrumentation                        | `loops.md`                                                                                        |
| `article-ideas` | drafts ready articles from the coverage gaps, each with persona, stage, loop, value elements, CTA, media plan and FAQ                  | `articles/<date>/*.md`, `articles/index.json`                                                     |
| `landing`       | writes page specs where every line is backed by a ledger fact                                                                          | `landing/home.md`, `landing/persona-*.md`, `landing/integration-*.md`                             |
| `manual`        | writes the brand + sales manual and the training ebook, with no technical detail                                                       | `manual/manual.md`, `manual/ebook.md`                                                             |
| `value-audit`   | checks any text against the rules and the value elements, quoting each problem and giving the fix                                      | `audit/findings.json`                                                                             |
| `system-spec`   | describes the finished machine as an agent-operated system                                                                             | `system/sales-machine.hcl`, `system/README.md`, `system/operator.md`                              |
| `report`        | puts everything together for review, with diagrams, coverage and the audit                                                             | `report/sales-machine-report.html`                                                                |

## Repository layout

```
SKILL.md                 entry skill, self-contained (orchestrator, config, rules, every workflow)
template.json            command manifest (router-only)
config.example.json      config shape with placeholders
reference/               routing matrix, role contracts, Elements of Value, example HCL spec
workflows/<cmd>/SKILL.md one contract per command (same text as in SKILL.md)
runbooks/                operating sequence
examples/                full runs on real products (sources + every output)
```

`SKILL.md` is the source of truth. The files under `workflows/`, `reference/` and `runbooks/` are
split from it for agents that load one contract at a time.
