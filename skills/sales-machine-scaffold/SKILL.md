---
name: sales-machine-scaffold
description: "Build a product-led sales machine for any product with zero dependencies (local files only): explore the product, position it, design the 6-stage machine and growth loops, draft articles, landing specs and the sales manual, and close with an HCL spec of the finished machine as an agent-operated system plus one self-contained HTML audit report."
---

# Sales Machine Scaffold

Generic, project-agnostic playbook to build a sales machine for a B2B (or B2B2C) product.
It turns a product's real features into positioning, a sales machine, content, landing page specs
and a team manual, and it keeps them honest: every claim comes from something the product already does.

**Zero dependencies.** The skill reads only the files the user points to (code folder, docs, notes)
and writes only plain files under `sales-machine/`: Markdown, JSON, the system spec in HCL and ONE
self-contained HTML report.

**Two final outputs, two purposes.**

- `system/sales-machine.hcl` describes the FINISHED machine as an intelligent system run by an
  agent (for example an agent project/workspace): its agents, roles, routines and schedules,
  workflows with inputs, steps, outputs and review gates, stages, lanes, signals, loops, metrics,
  rules and hand-offs. It is the machine itself, not the plan to build it. HCL is used only as a
  readable, parseable spec language: nothing in it is executed, there are no providers, resources
  or modules, and it is not infrastructure.
- `report/sales-machine-report.html` is the audit of what was built, for people to review.
  No network, no connectors, no forum, CMS, docs tool, design canvas, scheduler, repository host,
  package, build step, CDN, web font or external image. If a step would need any of those, the skill
  writes the content to a file and lists it as a hand-off item in the report instead.

Everything product-specific lives in one config file (`sales-machine/config.json`, see **Config**).
This skill never assumes a product, brand, customer, partner, URL or tool. If a value is missing,
the workflow asks once or writes `[to confirm]`; it never invents it.

## Orchestrator

1. **Classify** the request with the routing table below. One request = one workflow.
   If it spans several, run them in the order of the **Default sequence** and say which ones.
2. **Load config.** Read `sales-machine/config.json`. If it does not exist, run `setup` first.
3. **Load only the selected workflow section** (and the references it links). Do not load the rest.
4. **Execute** the workflow's Procedure step by step, writing its Outputs into `sales-machine/`.
5. **Close** with the workflow's Review gate plus the **Global review gate**, then regenerate the
   report (`report`) so it always reflects the latest files. A failed gate is fixed before
   delivery, or recorded in the report as a FAIL with what failed.

### Command routing (router-only)

Invoke as `/sales-machine-scaffold <cmd>`. If commands are not parsed, read `<cmd>` from the message.

| cmd             | Use when the user wants to...                                                | Section                 |
| --------------- | ---------------------------------------------------------------------------- | ----------------------- |
| `setup`         | start a sales machine for a product, fill or change the config               | Workflow: setup         |
| `explore`       | map what the product does and what is live, from code and docs               | Workflow: explore       |
| `position`      | define who we talk to, the promise, the personas and the say/never-say rules | Workflow: position      |
| `machine`       | design or review the 6 stages, lanes, buying signals, engine and metrics     | Workflow: machine       |
| `loops`         | design or measure growth loops (integrations, invites, content)              | Workflow: loops         |
| `article-ideas` | draft a batch of ready articles                                              | Workflow: article-ideas |
| `landing`       | write landing page specs: home, persona and integration sub-pages            | Workflow: landing       |
| `manual`        | write the brand + sales manual or the sales training ebook                   | Workflow: manual        |
| `value-audit`   | check copy, an article or a page against the Elements of Value and the rules | Workflow: value-audit   |
| `system-spec`   | write the HCL spec of the finished machine as an agent-operated system       | Workflow: system-spec   |
| `report`        | build the final self-contained HTML audit report                             | Workflow: report        |

### Default sequence

`setup` -> `explore` -> `position` -> `machine` -> `loops` -> (`landing`, `article-ideas`, `manual`) -> `value-audit` -> `system-spec` -> `report`.
`value-audit` also runs inside the review gate of every writing workflow; `system-spec` is
refreshed whenever a stage, loop, routine or rule changes; `report` closes every run.

## Config

`sales-machine/config.json` is the single source of product-specific values. Workflows read it and
never hardcode these values. Schema (all strings are examples of shape, not defaults):

```json
{
  "product": {
    "name": "<ProductName>",
    "tagline": "<one-line promise>",
    "category": "<what it is in 3 words>"
  },
  "language": { "content": "en", "team": "en", "secondaryContent": [] },
  "sources": {
    "code": ["<local folder>"],
    "docs": ["<local folder or file>"],
    "releaseNotes": ["<local file>"],
    "featureFlags": ["<local file listing flags and rollout state>"],
    "notes": ["<any other local file>"]
  },
  "access": {
    "mode": "invite-only | open | waitlist",
    "primaryCta": "Request access",
    "secondaryCta": "Talk to our team",
    "forbiddenCtas": ["Create your account", "Sign up free"]
  },
  "flagship": {
    "who": "<the customer the home page talks to first>",
    "pain": "<what they lose today>"
  },
  "lanes": [
    { "id": "self-serve", "label": "On their own", "buyingSignal": "<e.g. N uses in 30 days>" },
    { "id": "assisted", "label": "With the team", "buyingSignal": "<e.g. any purchase milestone>" }
  ],
  "personas": [
    {
      "id": "<slug>",
      "name": "<Persona>",
      "wants": "<job to be done>",
      "lane": "self-serve | assisted"
    }
  ],
  "integrations": [
    { "slug": "<provider-slug>", "name": "<Provider>", "kind": "<category>", "live": true }
  ],
  "loops": ["integrations", "invites", "content"],
  "neverSay": [
    "<prices, plans, limits, free, trial>",
    "<customer names>",
    "<unreleased features as live>"
  ],
  "sayInstead": { "<word to avoid>": "<word to use>" },
  "internalOnly": ["<revenue levers>", "<internal metrics>"],
  "regulatedTopics": [
    { "topic": "<e.g. identity checks>", "rule": "<the only true statement we make about it>" }
  ],
  "batch": { "articlesPerRun": 3, "minSalesLane": 2 }
}
```

## Global hard rules

1. **Zero dependencies.** Read only local files listed in `config.sources` (or given in the
   message). Write only under `sales-machine/`. No network calls, no external services or tools,
   no installs. The report is one HTML file that opens offline with everything inline.
2. **Facts only.** Every product claim traces to a local source (`explore` ledger). Unconfirmed
   values are written `[to confirm]`, never guessed.
3. **Rollout honesty.** A feature behind an off flag, merged but not released, or not documented
   as released is "rolling out" or left out. Never presented as live.
4. **No customer names**, nor their clients. Integration content names the PROVIDER, never the
   customer who uses it.
5. **Never state** anything in `config.neverSay` (by default: prices, plans, tiers, limits, "free",
   "trial") nor anything in `config.internalOnly` (revenue levers, internal numbers).
6. **CTA discipline.** Every call to action uses `config.access.primaryCta`; never one from
   `forbiddenCtas`. In invite-only mode, never promise open sign-up and never call it an "early
   access program": write as a product that is already running.
7. **Regulated topics** are stated only as the rule in `config.regulatedTopics`, as a fact inside
   the flow that needs it; never sold as an absence ("no X needed") and never as a requirement
   for the whole product.
8. **Job over feature.** Copy talks about the reader's job and outcome; the product appears as the
   way to do it. Simple, short sentences, no jargon, no hype.
9. **Value elements.** Selling copy names and shows 2-4 B2B Elements of Value (reference below),
   at least one from level 3 or 4. Never sell Acceptable price; never sell Regulatory compliance.
10. **Real UI only.** Any description or sketch of the product copies names, labels and values
    from its code or docs; never invented UI.
11. **Review before change.** Nothing is published or applied by this skill. The owner reviews the
    report and decides; existing files are never overwritten without keeping the previous version
    in `sales-machine/history/<file>-<date>`.

## Workspace produced

```
sales-machine/
  config.json
  product-map.md            explore: features, value, live/rolling-out, fact ledger
  positioning.md            position: flagship, personas, principles, say/never-say
  machine.md                machine: 6 stages, lanes, signals, engine, metrics
  loops.md                  loops: loop definitions, metric, instrumentation gaps
  articles/index.json       dedupe index: id, title, lane, persona, stage, loop, value[]
  articles/<date>/*.md      ready articles
  landing/*.md              page specs (home, products, personas, integrations)
  manual/manual.md          brand + sales manual
  manual/ebook.md           training ebook
  audit/findings.json       value-audit results per file
  system/sales-machine.hcl  system-spec: the finished machine as an agent-operated system
  system/README.md          system-spec: "this is a spec, not infrastructure", block guide
  system/operator.md        system-spec: standing instructions for the agent that runs it
  history/                  previous versions of overwritten files
  report/sales-machine-report.html   the final self-contained report
```

## Reference: B2B Elements of Value

Source: Bain & Company, "The B2B Elements of Value" (Harvard Business Review, 2018). 40 elements in
5 levels. Use the exact names. Price and function are the floor; deals are won on ease of doing
business (level 3) and on what changes for the person who decides (level 4).

- **1. Table stakes:** Meeting specifications, Acceptable price, Regulatory compliance, Ethical standards.
- **2. Functional:** Improved top line, Cost reduction (economic); Product quality, Scalability, Innovation (performance).
- **3. Ease of doing business:** Time savings, Reduced effort, Decreased hassles, Information, Transparency (productivity); Organization, Simplification, Connection, Integration (operational); Availability, Variety, Configurability (access); Responsiveness, Expertise, Commitment, Stability, Cultural fit (relationship); Risk reduction, Reach, Flexibility, Component quality (strategic).
- **4. Individual:** Network expansion, Marketability, Reputational assurance (career); Design & aesthetics, Growth & development, Reduced anxiety, Fun & perks (personal).
- **5. Inspirational:** Vision, Hope, Social responsibility.

Default elements per stage (tune in `positioning.md` with product facts):

| Stage                  | Hit first                                                          |
| ---------------------- | ------------------------------------------------------------------ |
| 01 Feed, 02 Attract    | Vision, Time savings, Reduced anxiety, Reputational assurance      |
| 03 Activate            | Reduced effort, Simplification, Decreased hassles, Reduced anxiety |
| 04 Qualify, self-serve | Time savings, Configurability, Integration, Scalability            |
| 04 Qualify, assisted   | Reach, Integration, Expertise, Responsiveness                      |
| 05 Convert             | Risk reduction, Reputational assurance, Transparency, Commitment   |
| Expand / retain        | Scalability, Organization, Information, Connection                 |
| 06 Feed back (loops)   | Network expansion, Connection, Integration, Reach                  |

Do not use elements you cannot prove from the sources (often Stability, Social responsibility).

## Reference: role contracts

| Role               | Owns                                                 | Stages     | Hands off                                    |
| ------------------ | ---------------------------------------------------- | ---------- | -------------------------------------------- |
| Content and brand  | articles, pages, tone                                | 01, 02, 06 | lead-ready pages to Sales                    |
| Sales / BizDev     | invites of the assisted lane, leads, closing         | 02, 04, 05 | integration requests to Product              |
| Customer success   | unblocking accounts, asking which providers they use | 03, 04, 06 | provider list to Product, stories to Content |
| Product            | in-app path, onboarding, integrations                | 03, 04, 06 | release notes to Content                     |
| Agent (this skill) | drafts, analyses, audit, report                      | all        | the report to the owner                      |

The agent drafts and audits; people publish. The report's hand-off list says what each role takes.

---

## Workflow: setup

`id: sales-machine-scaffold.workflow.setup`

- **Goal:** create `sales-machine/config.json` and the workspace with only confirmed values.
- **Scope:** applies to a new product or a config change. Does not write content.
- **Triggers:** "start a sales machine", "set up the sales scaffold", missing `config.json`.
- **Inputs:** product name, local folders/files with code, docs, release notes and flags; access mode, CTA wording.
- **Invariants:** global rules; empty fields stay `"[to confirm]"`; no secrets in any file.
- **Procedure:**
  1. Read the local sources (README, docs index, existing marketing copy) to prefill the config.
  2. Ask the owner, in ONE message, only for what could not be read: access mode + CTA, flagship
     customer, personas, forbidden words, regulated topics, internal-only items.
  3. Write `config.json` and create the workspace folders.
- **Outputs:** `sales-machine/config.json`, empty workspace tree.
- **Review gate:** JSON valid; every `neverSay`/`forbiddenCtas` entry came from the owner or a
  written source; no value invented; every source path exists locally.
- **References:** Config, Global hard rules.

## Workflow: explore

`id: sales-machine-scaffold.workflow.explore`

- **Goal:** a product map of what the product really does, what is live, and which value each feature delivers.
- **Scope:** applies before positioning, before any content batch after a release, and before
  writing a page about a feature. Read-only on the sources.
- **Triggers:** "explore the product", "what can we sell", "map the features", new release.
- **Inputs:** `config.sources` (local code, docs, release notes, flag files).
- **Invariants:** a feature is **live** only if a release note or doc says it shipped AND its flag
  (if any) is on for customers; otherwise **rolling out** or **internal**. Names and labels are copied
  from UI code or locale files.
- **Procedure:**
  1. Inventory surfaces: navigation, pages, editors/builders, API, integrations, notifications.
     Read routes, menu definitions and locale files, not marketing copy.
  2. For each feature: user-facing name (from the UI), job it does, persona, status
     (live / rolling out / internal) with evidence (file path + line or release note).
  3. List integrations/providers with status and what a user can do with each (as the UI names it).
  4. Map features to Elements of Value: "Element -> what in the product delivers it".
  5. Capture the first-run experience exactly (onboarding steps, sample data, first value moment).
  6. Build the **fact ledger**: `F-001 | claim | source path | status`. Content may only use ledger facts.
  7. List gaps: features without docs (content candidates), claims in existing copy the ledger does not support.
- **Outputs:** `product-map.md` (features, integrations, value map, first run, ledger, gaps).
- **Review gate:** every row has a local source; no feature marked live without evidence; UI names
  match the code; the value map uses exact element names.
- **References:** Reference: B2B Elements of Value.

## Workflow: position

`id: sales-machine-scaffold.workflow.position`

- **Goal:** one positioning everyone writes from: who we talk to first, the promise, personas, principles and say/never-say.
- **Scope:** applies to brand positioning and its updates. Does not design the funnel.
- **Triggers:** "position the product", "who do we talk to", "rewrite the promise", persona matrix work.
- **Inputs:** `product-map.md`, `config.flagship`, `config.personas`, `config.lanes`.
- **Invariants:** the tagline says what the product does (category + outcome), not a vague result;
  each headline benefit maps to one value element; personas come from real use, not wishes.
- **Procedure:**
  1. **Flagship customer:** the one the home page talks to first (who, what they lose today, what
     changes). Everyone else comes after.
  2. **Promise:** one sentence "we do X so you stop Y", plus 3-5 tagline options; recommend one and say why.
  3. **Persona matrix:** persona | job to be done | lane | first value moment | elements of value |
     proof (ledger fact). Flag overlaps (two personas with the same job) and propose a merge.
  4. **Headline facts:** 3-5 short benefit labels (about 20 characters) each with "what it means for who decides".
  5. **Principles:** sell ease and peace of mind to the decider, show before it runs, job over
     feature, tone rules, the access model (CTA).
  6. **Say / never-say table** from `neverSay`, `sayInstead`, `regulatedTopics`, `access`.
  7. Keep the lane split internal: pages do not show "lanes", the team uses them to serve.
- **Outputs:** `positioning.md`.
- **Review gate:** every benefit has a ledger fact; at least one level 3 or 4 element per persona;
  no forbidden word; flagship appears before any other persona.
- **References:** Workflow: explore, Reference: B2B Elements of Value.

## Workflow: machine

`id: sales-machine-scaffold.workflow.machine`

- **Goal:** a 6-stage sales machine where the product carries people to value and the team enters on a buying signal.
- **Scope:** applies to designing or reviewing stages, lanes, signals, engine and metrics. Specifies events, not code.
- **Triggers:** "design the sales machine", "PLG funnel", "buying signal", "where do leads go".
- **Inputs:** `positioning.md`, `product-map.md` (first run), `config.lanes`.
- **Invariants:** stages are measurable events, not intentions; each stage names the value elements
  it must deliver; the machine closes back on itself (stage 06).
- **Procedure:**
  1. **01 Feed:** release notes, tutorials, persona articles (`article-ideas`); each persona finds its case.
  2. **02 Attract:** the access request. Capture goal, company, the providers they already use (feeds
     the integrations loop) and the referrer. Confirmation, then invite: immediate for self-serve,
     after a short review for assisted.
  3. **03 Activate:** sign-up prefilled with the goal; a sample/sandbox where everything works without
     real risk; the goal picks the path.
  4. **04 Qualify:** one guided checklist per lane up to the first real value, ending in the lane's
     buying signal (`config.lanes[].buyingSignal`). Regulated steps appear only in the lane that needs them.
  5. **05 Convert:** the signal turns the account into a lead with goal, path and providers; the team
     talks to someone already using it; customer = first real purchase.
  6. **06 Feed back:** growth loops (run `loops`).
  7. **Engine (spec only):** a periodic check per account that records each milestone with its real
     time, sends the right message per stage, and measures conversion and time between stages.
  8. **Metrics:** conversion between stages (per 100 access requests), time between stages,
     loop strength, value coverage per persona and stage.
  9. **Diagram:** describe it as nodes + edges in `machine.md` (6 stages, split at 04 into two lanes,
     arrow from 06 back to 01); `report` draws it as inline SVG.
- **Outputs:** `machine.md`.
- **Review gate:** every stage has an entry event, an exit event and a metric; signals are numbers
  or named milestones; no internal-only item on anything meant to be public.
- **References:** Workflow: loops, Workflow: report.

## Workflow: loops

`id: sales-machine-scaffold.workflow.loops`

- **Goal:** turn the funnel into compounding loops, where the output of one cohort brings the next.
- **Scope:** applies to stage 06 design, loop tagging and loop metrics. Idea from Reforge,
  "Growth Loops are the New Funnels". Prefer one or two strong loops over many weak ones.
- **Triggers:** "growth loops", "feed back", "referrals", "integration-led growth".
- **Inputs:** `machine.md`, `config.integrations`.
- **Invariants:** each loop has 4 steps that end where it starts, one owner, one metric; integration
  content names providers, never customers.
- **Procedure:**
  1. **Integrations loop:** customer tells which providers they use -> we integrate -> the integration
     page attracts that provider's other customers -> they tell theirs. Prioritize providers by how many
     customers and leads use them.
  2. **Invites loop:** an active account gets invites -> brings colleagues and partners -> they skip the
     queue -> activate and get their own invites.
  3. **Content loop:** real uses (anonymized) -> templates and articles -> new access requests -> new
     accounts create new uses.
  4. **Metric:** new access requests per monthly activated cohort, per loop. List the instrumentation
     each loop needs (referrer stored, providers asked, invite source recorded) and what is missing.
  5. **Rule for all content:** every piece gives the reader a reason to feed a loop (name a provider,
     invite someone, start from a template), not only to sign up.
- **Outputs:** `loops.md` (the report draws the three loops as inline SVG).
- **Review gate:** each loop closes; metric defined; instrumentation gaps listed with owner role.
- **References:** Workflow: machine, Reference: role contracts.

## Workflow: article-ideas

`id: sales-machine-scaffold.workflow.article-ideas`

- **Goal:** a batch of READY articles, each moving one persona one stage down the machine and feeding one loop.
- **Scope:** drafts only, as local Markdown. Publishing is a hand-off item in the report.
- **Triggers:** "article ideas", "blog post ideas", "content batch".
- **Inputs:** `articles/index.json`, `product-map.md`, `positioning.md`, `machine.md`, `loops.md`, release notes.
- **Invariants:** global rules; no repeats (index); content language `config.language.content`,
  secondary languages as a collapsed `<details>` block at the end.
- **Procedure:**
  1. Read the index; compute coverage persona x stage x loop x value element; pick gaps first
     (weakest persona, missing elements, loop balance; integrations first when a provider is worth covering).
  2. Two lanes per batch unless asked otherwise:
     - **Lane A, release-driven:** one article per shipped feature or use case; rolling-out marked.
     - **Lane B, sales machine:** at least `batch.minSalesLane` articles.
  3. Front matter of each article: `type`, `for`, `built_from` (source paths), `lane`, `persona`,
     `stage`, `loop` (integrations | invites | content), `value` (2-4 exact elements with level,
     > = 1 from level 3/4), `outcome` (functional/emotional/social), `next_step` (one action),
     > `signal` (the buying signal it leads to).
  4. Body: 600-900 words about the reader's job; each value element shown with a ledger fact; a
     **Media plan** list (M1.., what to capture from the real product) with `<!-- MEDIA Mx -->` markers.
  5. Close with the CTA from config (self-serve adds what the invite opens; assisted adds the
     secondary CTA), then a loop hook (name your provider / invite a colleague / start from this template).
  6. End with `## FAQ`: 4-6 `### Question` + short answer about this article only (who approves,
     safety, how to test, how to start); never answer price/plan questions.
  7. Save to `articles/<date>/<nn>-<slug>.md` and append the index.
- **Outputs:** articles, updated index.
- **Review gate:** `value-audit` on each article; FAQ, value and loop present; no repeat; no
  forbidden word or CTA; integration articles name providers only.
- **References:** Workflow: value-audit, Workflow: loops.

## Workflow: landing

`id: sales-machine-scaffold.workflow.landing`

- **Goal:** landing page specs that speak to the flagship customer first, then each persona and each integration.
- **Scope:** specs as local Markdown (sections, copy, which ledger fact backs each line). Building
  or changing a real site is a hand-off item; the skill never touches it.
- **Triggers:** "landing", "home page", "persona page", "integration page", "hero copy".
- **Inputs:** `positioning.md`, `product-map.md`, `config.integrations`, existing landing copy if given as a local file.
- **Invariants:** reuse what the current pages and the product already show before inventing a
  layout; any product depiction is described from the real UI.
- **Procedure:**
  1. If current pages are given, list what each says and which persona/element it serves.
  2. **Home:** short hero with what we do; 3-5 headline facts; one real product visual (described);
     persona grid; products; articles; a single primary CTA. No pricing, no lane labels.
  3. **Persona pages:** who it is for, what it does, the job, sections reused from product pages.
  4. **Integration sub-pages:** one per live provider: what a user can do with it, the steps it adds
     (named as the product names them), the products it goes well with. No fees or minimums. Skip
     sections that carry no value for the reader (e.g. a generic "how it works in 3 steps").
  5. Where there is a real choice, give A/B/C with a recommendation.
  6. Each spec: section | copy | backing fact id | value element.
- **Outputs:** `landing/home.md`, `landing/persona-<id>.md`, `landing/integration-<slug>.md`.
- **Review gate:** `value-audit` on every spec; CTA from config only; every line backed by a fact.
- **References:** Workflow: position, Workflow: value-audit.

## Workflow: manual

`id: sales-machine-scaffold.workflow.manual`

- **Goal:** a non-technical brand + sales manual and a training ebook the team learns and sells from.
- **Scope:** local Markdown, team language `config.language.team`. No technical detail
  (configuration, infrastructure, code).
- **Triggers:** "sales manual", "training ebook", "onboard the sales team", "brand guide".
- **Inputs:** `positioning.md`, `machine.md`, `loops.md`, `product-map.md`.
- **Invariants:** Markdown is the source; the report embeds it rendered.
- **Procedure:**
  1. **Manual, Part 1 positioning:** who we are, flagship first, personas in two ways (with the team /
     on their own), principles, headline facts table, say / never-say table.
  2. **Manual, Part 2 machine:** stage by stage in plain words, loops, who does what, what we measure.
  3. **Ebook outline** (propose, wait for ok): Part 1 before selling (what it is, personas, speech rules),
     Part 2 product tour (one chapter per area of `product-map.md`, with screenshot slots to fill),
     Part 3 selling (use cases per persona, 20-minute demo script, objections and answers, glossary).
  4. Write the chapters.
- **Outputs:** `manual/manual.md`, `manual/ebook.md`.
- **Review gate:** no technical detail; no internal-only item; every product fact from the ledger;
  `value-audit` on the selling chapters.
- **References:** Workflow: position, Workflow: machine.

## Workflow: value-audit

`id: sales-machine-scaffold.workflow.value-audit`

- **Goal:** pass/fail check of a piece of copy against the rules and the Elements of Value, with exact fixes.
- **Scope:** any article, page spec, deck text, email or manual chapter. Read-only unless asked to apply fixes.
- **Triggers:** "check this copy", "audit the page", inside every writing workflow's review gate.
- **Inputs:** the text or file, `config.json`, `product-map.md` ledger, `positioning.md`.
- **Invariants:** quote the exact text behind each finding; never "fix" by adding unproven claims.
- **Procedure:**
  1. Facts: every product claim maps to a ledger fact; mark unmatched ones.
  2. Rules: `neverSay`, `forbiddenCtas`, `internalOnly`, regulated wording, customer names, rolling-out shown as live.
  3. Value: list elements actually shown (with the sentence); check 2-4 and >= 1 from level 3/4; flag
     Acceptable price or Regulatory compliance used as selling points.
  4. Machine fit: persona, stage, loop hook, single next step, CTA.
  5. Append to `audit/findings.json`: `{file, verdict, findings:[{rule, quote, fix}]}`. Verdict PASS
     only with zero rule findings.
- **Outputs:** findings in `audit/findings.json` (and the fixed text when asked).
- **Review gate:** every finding has a quote and a fix.
- **References:** Global hard rules, Reference: B2B Elements of Value.

## Workflow: system-spec

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

## Workflow: report

`id: sales-machine-scaffold.workflow.report`

- **Goal:** one self-contained HTML file that shows the whole sales machine and its audit, readable offline by anyone.
- **Scope:** reads every file under `sales-machine/` and writes `report/sales-machine-report.html`.
  The report is the only deliverable the owner needs to open.
- **Triggers:** "final report", "audit report", end of every workflow run.
- **Inputs:** all workspace files, `audit/findings.json`.
- **Invariants (zero dependencies):**
  - One `.html` file. All CSS in one `<style>`; any script inline and optional (the page works with
    scripts off). No `<link>`, no `<script src>`, no `@import`, no `url(` to a file or host, no web
    fonts (system font stack), no external images: diagrams are inline `<svg>`, screenshots are
    slots, not files.
  - Links to sources are plain text paths, never loaded resources.
  - Light and dark via `prefers-color-scheme`; readable at phone width; `@media print` so the
    browser's print gives a clean PDF.
  - Content escaped as HTML; nothing from a source runs as markup or script.
- **Procedure:**
  1. **Summary:** product, date, overall verdict (PASS / FAIL counts from the audit), top 5 actions.
  2. **Product map:** features table with status chips (live / rolling out / internal) and the fact ledger.
  3. **Positioning:** promise, flagship, persona matrix, headline facts, say / never-say.
  4. **Machine:** inline SVG of the 6 stages (lanes split at 04, arrow back from 06 to 01), then
     each stage with entry/exit events, value elements and metric.
  5. **Loops:** inline SVG of the three loops, metric, instrumentation gaps.
  6. **Coverage:** matrix persona x stage, and value element x persona, counting articles and specs;
     empty cells highlighted as gaps.
  7. **Content:** list of articles and landing specs with lane, persona, stage, loop, value, verdict;
     each expandable (`<details>`) with the rendered text.
  8. **Manual:** rendered manual and ebook outline.
  9. **System:** how the running machine works, drawn from `system/sales-machine.hcl`: agents and
     roles, a routine calendar (what runs when, which workflow, who receives it), workflow steps with
     their gates, and the HCL itself in an escaped `<pre>` block.
  10. **Audit:** every finding (file, rule, quote, fix), FAILs first, including the spec self-check.
  11. **Hand-off:** what each role takes (publish article X, build page Y, add instrumentation Z),
      and every `[to confirm]` left in the workspace.
  12. **Self-check** after writing: search the file for `<link`, `src="http`, `src="//`, `@import`,
      `url(`; any hit is a FAIL to fix before delivery.
- **Outputs:** `report/sales-machine-report.html`.
- **Review gate:** self-check clean; opens offline; every section present (or marked "not run yet");
  counts match `audit/findings.json`.
- **References:** Workflow: value-audit, Global review gate.

---

## Runbook: operating the machine

- **First run:** `setup` -> `explore` -> `position` (owner reviews) -> `machine` + `loops` ->
  `manual` -> `system-spec` -> `report`.
- **Handing over to an agent:** give the agent workspace `system/operator.md` as its standing
  instructions and `system/sales-machine.hcl` as the machine; from then on it runs the routines.
- **Then:** `landing` specs and a first `article-ideas` batch (owner reviews the format in the report).
- **Every release:** `explore` delta -> Lane A articles -> integration spec if a provider shipped -> `report`.
- **Periodically:** another `article-ideas` batch picked from the coverage gaps in the last report.
- **When a rule changes:** update `config.json` first, run `value-audit` on every existing file,
  fix with history kept, then `report`.

## Global review gate

- [ ] Only local sources read; only `sales-machine/` written; no network, no external tool.
- [ ] Only ledger facts; unknowns written `[to confirm]`.
- [ ] No customer names, no `neverSay`, no `internalOnly`, no forbidden CTA.
- [ ] Rolling-out features marked or omitted.
- [ ] Value elements named and shown (2-4, >= 1 from level 3/4).
- [ ] System spec in HCL is current, spec-only (no providers/resources/modules, no `${}`), references resolve.
- [ ] Report regenerated, self-contained, self-check clean.
