import test from "node:test";
import assert from "node:assert/strict";
import { parseCritiqueVerdict } from "./utils";

test("parseCritiqueVerdict accepts markdown-formatted PASS verdicts", () => {
  assert.equal(parseCritiqueVerdict(`1) **Verdict:** PASS\n2) Issues:\n- none`), "PASS");
});

test("parseCritiqueVerdict accepts markdown-formatted REFINE verdicts", () => {
  assert.equal(
    parseCritiqueVerdict(`1) **Verdict:** REFINE\n2) Issues:\n- split step two`),
    "REFINE",
  );
});

test("parseCritiqueVerdict ignores unrelated PASS mentions", () => {
  assert.equal(parseCritiqueVerdict(`Summary: This looks passable.`), undefined);
});
