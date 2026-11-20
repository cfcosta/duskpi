---
name: sales-machine-scaffold-setup
description: "create `sales-machine/config.json` and the workspace with only confirmed values."
---

# setup

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

---

Parent: [sales-machine-scaffold](../../SKILL.md) (config, global rules, references).
