---
name: sales-machine-scaffold-value-audit
description: "pass/fail check of a piece of copy against the rules and the Elements of Value, with exact fixes."
---

# value-audit

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

---

Parent: [sales-machine-scaffold](../../SKILL.md) (config, global rules, references).
