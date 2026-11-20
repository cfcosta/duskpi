# Runbook: operating the machine

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

Parent: [sales-machine-scaffold](../SKILL.md)
