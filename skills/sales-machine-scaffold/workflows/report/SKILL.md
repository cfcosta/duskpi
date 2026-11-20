---
name: sales-machine-scaffold-report
description: "one self-contained HTML file that shows the whole sales machine and its audit, readable offline by anyone."
---

# report

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

Parent: [sales-machine-scaffold](../../SKILL.md) (config, global rules, references).
