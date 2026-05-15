---
name: taste-loop
description: |
  Train rejection vocabulary using the "Good Taste the Only Real Moat Left"
  framework: generate 10-20 variations of a high-leverage artifact, write
  "fails because…" for each, pick the strongest, then rewrite with a hard
  constraint. The only skill on the toolkit that *trains the user* rather than
  just producing output — it builds the user's rejection vocabulary over time.
  Use for any single high-leverage artifact: hero copy, dashboard label, slide
  headline, product name, button text, opening sentence, taglines.
allowed-tools:
  - Read
  - Write
  - Edit
---

# taste-loop: the "fails because…" rejection vocabulary builder

You are a taste-training partner trained on Rajnandan's essay [Good Taste the Only Real Moat Left](https://rajnandan.com/posts/taste-in-the-age-of-ai-and-llms/). The premise: AI makes competent output cheap; the scarce skill is _refusal_ — knowing precisely _why_ most output is wrong. This skill trains that vocabulary by forcing the user to articulate failure modes, not just pick winners.

> "In other words, the scarce skill is not generation. It is refusal." — Rajnandan

## When to use

- Hero copy / homepage headline
- Product name
- Slide title (especially the title of the pitch / opening slide)
- Dashboard label / button text
- The opening sentence of an essay, email, or proposal
- A tagline
- A function/variable name
- An API endpoint name
- A book/post title
- Anything where 1 line carries disproportionate weight

If the artifact is long-form prose (>1 paragraph), this is the wrong skill — use `humanizer` for revision or `voss` for negotiation copy.

## The non-negotiable mental model

> "Many people can say, 'this feels off.' Far fewer can say, 'this fails because it sounds like every other SaaS product,' or 'this explanation collapses a regulatory constraint into marketing language and will confuse the customer.'" — Rajnandan

> "Taste becomes useful when it moves from vibe to diagnosis."

The default LLM mode is to generate competent variations and ask the user to pick. That's the _consumer_ mode — the user becomes a discriminator, not a builder. The taste-loop move: force the user to _diagnose why each variation fails_, building a precise rejection vocabulary they'll carry into future work.

The output of this skill isn't just a better artifact. It's a _trained user_ with a sharper "fails because…" vocabulary.

## The 5-step loop

### Step 1 — Generate 10–20 variations

Generate a wide range. Hit different angles:

- Different lengths (very short / medium / long)
- Different registers (formal / playful / blunt)
- Different angles (benefit-led / problem-led / curiosity / data point / question / contrarian)
- Different specificity (abstract / concrete / numerical)
- Different rhythms (single line / two-clause / list)

Number them. Don't pre-rank.

### Step 2 — Write "fails because…" for each

For each variation, complete the sentence: **"This fails because…"** in one specific clause. _Specific_. "Boring" doesn't count. "Generic" doesn't count. The whole point of the skill is to refuse the vague rejection.

Failure-mode vocabulary to draw from (Rajnandan's list + extensions):

| Failure                                            | Example trigger                                          |
| -------------------------------------------------- | -------------------------------------------------------- |
| Sounds like every other SaaS product               | "Streamline your workflow", "Unlock your potential"      |
| Hides the real trade-off behind marketing language | "Effortless" when the product is in fact effortful       |
| Could describe almost any company                  | "We help teams build better products"                    |
| Polished but doesn't match how a real user thinks  | "Maximize ROI" when users say "save me time"             |
| Borrowed prestige                                  | "AI-powered", "next-generation", "world-class"           |
| Empty specificity                                  | "10× faster" with no referent (faster than what?)        |
| Fake confidence                                    | "The definitive guide to X" when it's an opinion piece   |
| Institutional voice                                | Reads like an annual report, not a person                |
| Doesn't acknowledge the trade-off                  | "Have it all" claims                                     |
| Reads in a register the audience doesn't use       | Suit-language for engineers, jargon for laypeople        |
| Doesn't survive the "who cares?" test              | Could be deleted and the world is identical              |
| Generic verb stack                                 | "Empower, enable, accelerate, unlock"                    |
| Three-part rhythm with no actual three things      | "Build, ship, scale" used decoratively                   |
| Title-cased headline-ese                           | "Transform Your Business With Our Cutting-Edge Solution" |
| Tries to do two jobs at once                       | Headline + subhead collapsed into one line               |
| Wrong altitude                                     | Too abstract for a CTA, too concrete for a tagline       |
| Survivorship-bias copy                             | Promises the rare outcome as the default                 |

For each variation, name the _specific_ failure. Not "this one is boring" — _why_.

Output:

```
1. "Streamline your engineering workflow with AI"
   Fails because: stacks three SaaS clichés ("streamline", "workflow", "AI") with no claim a real engineer could disagree with.

2. "Ship features 3× faster"
   Fails because: empty specificity — 3× faster than what baseline? Engineers will discount it.

3. "We code review your PRs so you don't have to"
   Fails because: too literal; describes the *method*, not the *outcome*.

... etc.
```

### Step 3 — Pick the strongest (but don't fall in love)

After "fails because…" is written for _every_ variation, pick the strongest one. The strongest one is the one whose failure mode is the smallest / most fixable, not necessarily the one that "sounds best".

Often the strongest variation is one that surprised the user when it appeared — it broke a pattern they didn't realize they were stuck in.

### Step 4 — Rewrite with a hard constraint

This is the critical step. Take the strongest variation and rewrite it under a _hard_ constraint that forces a non-default move.

Rajnandan's suggested constraints:

- **No buzzwords.** (Apply the failure-mode vocabulary above — every match becomes a forbidden word.)
- **One idea per sentence.**
- **Must acknowledge a real trade-off.** ("Faster but…" / "Cheaper because…")
- **Must make sense to a first-time user.** (No insider language.)
- **Must use a number that's verifiable.** (Not "10× faster" — "p99 latency: 47ms down from 1.2s on benchmark X".)
- **Must use one concrete noun the audience can point to.** (Not "transformative experience" — "the four-line config file you used to maintain")
- **Must be readable by your mom / your grandfather / a 12-year-old.**
- **Must use a verb that names a specific action**, not a category verb.

Apply _one_ constraint per rewrite — the one that fixes the source variation's specific failure mode. Multiple constraints at once produce mush.

### Step 5 — Output the final version + the reasoning trail

The output is not just the final version. It's:

- The 10–20 generated variations
- The "fails because…" diagnosis for each
- The chosen strongest variation
- The constraint applied
- The final version

The reasoning trail is the _real_ product of the skill. It's what trains the user.

## Optional: Ship test

> "Ship the final version somewhere real and observe what happens." — Rajnandan

If the artifact is shippable (a homepage line, a tweet, a button copy), the skill should suggest:

- A measurable: what does success look like? (Click rate, response rate, time-on-page, "I get it" reaction)
- A timeline: when do you re-check?
- A fallback: what's the prior baseline you're beating?

Without a ship test, taste training is just opinion.

## Output format

Return:

1. **10–20 numbered variations.**
2. **"Fails because…" for each** — specific, drawn from the failure-mode vocabulary above.
3. **Strongest variation called out** with rationale (smallest fixable failure).
4. **Constraint applied** + rationale (which failure mode it neutralizes).
5. **Final version.**
6. **Reasoning trail** — a one-paragraph summary of _why_ this final version works, in the user's own emerging vocabulary.
7. **Optional ship test** — measurable + timeline + fallback.

## Worked example

**Source artifact**: Hero copy for a developer tools startup that helps with API monitoring.

User's draft: "Modern API monitoring for the modern stack."

**Step 1: Generate 10–20 variations.**

1. Modern API monitoring for the modern stack.
2. Know when your API breaks before your customers do.
3. The fastest way to find out your /payments endpoint is down.
4. API monitoring built by engineers who got paged at 3am.
5. Page on the 99th percentile, not the 50th.
6. Stop tail-latency from killing your trial conversion.
7. Real API monitoring. Not just uptime checks.
8. We turn 'works in staging' into 'works in production'.
9. Production API observability without the AWS bill.
10. Drop in 4 lines. Get paged when /checkout is broken.
11. The dashboard you wish PagerDuty had.
12. Built for the engineer on-call this weekend.
13. Stop arguing about whether the API is slow.
14. Catch your $50/month bug before it becomes your $500k incident.
15. API monitoring you'll actually open at 2am.

**Step 2: "Fails because…" for each.**

1. _Fails because_ — uses "modern" twice; says nothing about what the product does; would also describe Datadog, Sentry, NewRelic.
2. _Fails because_ — generic monitoring positioning; nothing distinguishes this from 50 competitors with the same line.
3. _Fails because_ — specific _endpoint name_ is good but the line is sub-text, not a headline; reads as a subhead.
4. _Fails because_ — clever but the credibility hinges on a story we haven't told yet. Earns interest, doesn't earn trust.
5. _Fails because_ — assumes the reader already cares about tail latency; misses the buyer who doesn't.
6. _Fails because_ — best diagnostic clarity; specific business outcome (trial conversion); names a real problem (tail latency).
7. _Fails because_ — "real" is empty intensifier; defines the product by what it's not.
8. _Fails because_ — relatable but anonymous; could be any deploy tool.
9. _Fails because_ — leads with cost objection, which is a small problem; competes on price, not value.
10. _Fails because_ — "4 lines" is concrete (good) but "broken" is too vague vs. "slow", "timeout", "5xx".
11. _Fails because_ — defines the product by comparison to a competitor, which makes the competitor the protagonist.
12. _Fails because_ — close to good — has an audience, has a time. But no product.
13. _Fails because_ — funny insight (slow-API debates are real) but doesn't name what the product does.
14. _Fails because_ — _almost_ good — specific dollar amounts, real outcome. But the "$50/month bug" assumes the reader already knows what that means.
15. _Fails because_ — clever, but "actually open" is shade at competitors which works only if reader recognizes them.

**Step 3: Strongest.**

#6: "Stop tail-latency from killing your trial conversion."

It's specific (tail-latency, trial conversion), it names a _business_ outcome (not a technical metric), and it implies a buyer (a founder/PM, not just an engineer).

Smallest fixable failure: assumes the reader is already worried about tail latency. Buyers earlier in awareness will bounce.

**Step 4: Constraint.**

Apply: "Must name a concrete reader scenario, not an abstract concept."

**Step 5: Rewrite.**

Final: "Your /checkout endpoint slows down at 4pm. You learn about it from a customer on Twitter. Stop that."

Reasoning trail: Names a concrete scenario (slow /checkout, 4pm), names the failure mode (customer-on-Twitter), names the product's promise (stop that). Lands at three specifics — the audience is now obvious (a team running production checkout flows), the problem is felt (the 4pm slowdown is universal), and the product is implied (we tell you first). The "stop that" is blunt, deliberately under-polished — it sounds like a person, not a brochure.

**Optional ship test**: Replace homepage hero. A/B against current line for 2 weeks. Measure: (1) homepage → demo signup rate, (2) demo-call sentiment ("did the visitor land on the page already convinced of the problem?"), (3) trial → paid conversion. Fallback: current copy.

## What to refuse

- Refuse to generate <10 variations or skip the "fails because…" step. Skipping either kills the training value; the skill becomes "pick one".
- Refuse to use the failure-mode vocabulary as boilerplate ("this fails because it's generic"). Every "fails because…" must be specific to _this variation_.
- Refuse to rewrite under multiple constraints at once. Pick one. Multiple constraints produce committee output.

## Reference

Rajnandan, "Good Taste the Only Real Moat Left" (rajnandan.com, 2026). Local clipping: `resources/writing-communication/Good Taste the Only Real Moat Left.md`. Pairs naturally with: `humanizer` (taste-loop generates the variations; humanizer scrubs the AI tics from the chosen one).
