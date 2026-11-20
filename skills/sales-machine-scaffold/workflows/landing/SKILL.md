---
name: sales-machine-scaffold-landing
description: "landing page specs that speak to the flagship customer first, then each persona and each integration."
---

# landing

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

---

Parent: [sales-machine-scaffold](../../SKILL.md) (config, global rules, references).
