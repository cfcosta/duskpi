---
name: sales-machine-scaffold-explore
description: "a product map of what the product really does, what is live, and which value each feature delivers."
---

# explore

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

---

Parent: [sales-machine-scaffold](../../SKILL.md) (config, global rules, references).
