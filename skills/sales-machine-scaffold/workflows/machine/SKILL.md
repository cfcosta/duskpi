---
name: sales-machine-scaffold-machine
description: "a 6-stage sales machine where the product carries people to value and the team enters on a buying signal."
---

# machine

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

---

Parent: [sales-machine-scaffold](../../SKILL.md) (config, global rules, references).
