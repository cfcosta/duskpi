---
name: sales-machine-scaffold-manual
description: "a non-technical brand + sales manual and a training ebook the team learns and sells from."
---

# manual

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

---

Parent: [sales-machine-scaffold](../../SKILL.md) (config, global rules, references).
