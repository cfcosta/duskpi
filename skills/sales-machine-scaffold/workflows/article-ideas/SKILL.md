---
name: sales-machine-scaffold-article-ideas
description: "a batch of READY articles, each moving one persona one stage down the machine and feeding one loop."
---

# article-ideas

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

---

Parent: [sales-machine-scaffold](../../SKILL.md) (config, global rules, references).
