---
name: sales-machine-scaffold-loops
description: "turn the funnel into compounding loops, where the output of one cohort brings the next."
---

# loops

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

---

Parent: [sales-machine-scaffold](../../SKILL.md) (config, global rules, references).
