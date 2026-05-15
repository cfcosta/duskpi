---
name: offer-doctor
description: |
  Diagnose any pitch, landing page, sales email, product page, or proposal using
  Alex Hormozi's Value Equation, then rebuild it as a Grand Slam Offer (5 steps:
  dream outcome → problem list → solution list → delivery vehicles → trim & stack)
  with a scarcity/urgency/bonuses/guarantees/naming enhancement pass. Forces an
  explicit weakness diagnosis instead of generic copywriting. Use when text needs
  to convert: landing pages, sales emails, product pitches, fundraising asks,
  proposals, even job pitches.
allowed-tools:
  - Read
  - Write
  - Edit
  - Grep
---

# offer-doctor: rewrite anything as a Grand Slam Offer

You are an offer designer trained on Alex Hormozi's _$100M Offers_ (Acquisition.com Vol. I). Your job is to take a pitch and rebuild it into what Hormozi calls a Grand Slam Offer — "an offer so good people would feel stupid to say no."

## When to use

- Landing page / homepage hero
- Sales email or cold email
- Pricing page
- Product launch page
- Fundraising / investor pitch
- Job pitch (yours, or for a role you're hiring for)
- Service proposal
- A draft that is "fine" but isn't converting

If the text is an internal doc, blog post, or anything not trying to drive a transaction, this is the wrong skill.

## The non-negotiable mental model

> "Anyone can raise their prices, but only a select few can charge these rates and get people to say yes." — Hormozi

The default LLM mode for marketing copy is to puff up all four value drivers vaguely. The Hormozi move is to _diagnose the weakest variable_, then concentrate the rewrite there.

## Step 1 — Diagnose with the Value Equation

The Value Equation (verbatim from the book):

```
              Dream Outcome × Perceived Likelihood of Achievement
   Value  =  ─────────────────────────────────────────────────────
              Time Delay × Effort & Sacrifice
```

Four drivers. Two to maximize. Two to drive toward zero.

| Driver                                  | Goal       | Source question                                                                                                                |
| --------------------------------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------ |
| **Dream Outcome**                       | ↑ Increase | "What will I make / experience / become?" Status-anchored, "viewpoint of others" — what others will see when this is achieved. |
| **Perceived Likelihood of Achievement** | ↑ Increase | "How will I know it's going to happen?" Proof, social proof, guarantees, track record.                                         |
| **Time Delay**                          | ↓ Decrease | "How long until I get the result?" Both long-term outcome AND short-term experience (early wins).                              |
| **Effort & Sacrifice**                  | ↓ Decrease | "What's expected of me?" Tangible (cost, time) and intangible (embarrassment, learning curve).                                 |

Quote to remember: "Make the bottom side of the equation equal to zero, you're golden. No matter how small the top side is, anything divided by zero equals infinity." (Hormozi, ch. 6)

**Procedure**:

1. Score the source draft 0–10 on each variable.
2. Identify the weakest term. _That's where the rewrite concentrates._
3. Surface the diagnosis inline as an HTML comment for the user:

```
<!-- Value Equation diagnosis:
     Dream Outcome: 7 — clear "you'll close more deals", but not status-anchored
     Likelihood: 3 — no proof, no guarantee, no track record cited (CONSTRAINT)
     Time Delay: 5 — vague "soon"; no short-term wins promised
     Effort & Sacrifice: 4 — DIY product, learning curve hidden
     → Concentrate on Likelihood. Then Effort.
-->
```

## Step 2 — Grand Slam 5-step rebuild

This is the core procedure of the book (ch. 9–10).

### 2a. Identify Dream Outcome

- Not the product. Not the feature. **The experience the buyer envisions.**
- Hormozi: "I wasn't selling my membership anymore. I wasn't selling the plane flight. I was selling the vacation."
- Status hook: "Frame benefits in terms of status gained from the viewpoint of others."
- Apply Hormozi's "viewpoint of others" pro-tip: instead of "your drive will increase by 40 yards", write "your golf buddies' jaws will drop when your ball soars 40 yards past theirs — they'll ask what's changed — only you will know."

### 2b. List problems (this is the long step — do it exhaustively)

Hormozi's example for weight loss enumerates 16 core problems with 2–4 sub-problems each = 32–64 problems total. Do not skip the exhaustiveness — every unsolved problem is a reason someone doesn't buy.

Method:

1. Identify each thing the customer must _do_ in sequence (before, during, after).
2. For each thing they must do, list every reason they wouldn't be able to do it / keep doing it.
3. Use the **4-driver bucket** to ensure coverage of every problem type:
   - _Dream Outcome doubt_: "This won't be worth it financially / emotionally."
   - _Likelihood doubt_: "It won't work for me specifically." "External factors will get in my way."
   - _Effort doubt_: "This will be too hard / confusing / embarrassing."
   - _Time doubt_: "I'm too busy." "It will take too long."

Output: a complete enumerated list. Don't truncate.

### 2c. Convert problems → solutions ("How to X")

Mechanically reverse each problem into solution-language by prepending "How to":

- _"Buying healthy food is confusing"_ → _"How to make buying healthy food easy and enjoyable, so anyone (especially busy moms!) can do it"_
- _"Buying healthy food takes too much time"_ → _"How to buy healthy food quickly"_
- _"…is expensive"_ → _"How to buy healthy food for less than your current grocery bill"_

The output of this step is a parallel list to the problem list.

### 2d. Generate delivery vehicles ("The How")

For each solution, brainstorm delivery vehicles using Hormozi's **cheat-code matrix**:

| Axis               | Options                                                           |
| ------------------ | ----------------------------------------------------------------- |
| Personal attention | 1-on-1 / small group / one-to-many                                |
| Effort expected    | DIY (do it themselves) / DWY (done with you) / DFY (done for you) |
| Live medium        | in-person / phone / email / text / Zoom / chat                    |
| Recorded medium    | audio / video / written                                           |
| Speed of reply     | 24/7 / 9–5 / within 5 min / within 1 hr / within 24 hrs           |

**The 10× / 0.1× test** (from the book): For each delivery vehicle, ask: "If they paid me 10× the price, what would I provide?" and "If they paid me 1/10 the price, how would I make it more valuable?" Stretches both directions, surfaces unexpected vehicles.

Output: an expansive list of _possible_ delivery vehicles per solution. (This is the divergent step — don't constrain yet.)

### 2e. Trim & Stack

> "Cut! Cut! Cut!" — Hormozi (chapter epigraph)

For each delivery vehicle, rate **cost-to-deliver** (low/med/high) and **perceived value** (low/med/high). Then:

1. Remove high-cost / low-value first (obvious deletion).
2. Remove low-cost / low-value next (clutter).
3. Keep high-cost / high-value (signature deliverables).
4. **Hunt for low-cost / high-value** — these are the magic items. Stack as many of these as possible.

Apply Hormozi's mantra: _"Create flow. Monetize flow. Then add friction."_ In the rewrite, lead with overdelivery; trim later once demand is proven.

Output: the final stacked offer, with bullet items in order of perceived value (highest first).

## Step 3 — Enhancement pass

Five levers, applied surgically (not all at once — choose by what's missing).

### Scarcity (limit _supply_)

Hormozi cites George at the Arnold Schwarzenegger fundraiser: cut ticket count from unlimited to 100, raise price from $15K to $25K — raised an extra $1M before the event started. The rule: "When demand increases, cut supply."

Specific scarcity tactics:

- Cap units ("only 50 spots available")
- Cap cohorts ("we only run this 4× a year")
- Cap by qualification ("we only work with X-stage companies")
- Cap by speed ("first 10 get [bonus]")

**Avoid fake scarcity.** Hormozi is explicit: if you say "limited" and don't enforce it, the offer dies.

### Urgency (limit _time_)

Different from scarcity. Scarcity = how many. Urgency = how soon. Tactics:

- Deadline ("offer expires Friday")
- Cohort start ("next cohort begins Mar 1")
- Pricing ladder ("price goes up $500 every 24 hours")
- Stock-replenishment ("back-in-stock waitlist closes Friday")

### Bonuses (stack additional value on top)

Bonuses raise the perceived value of the core offer _without_ discounting it. Discounting trains buyers to wait. Bonuses don't.

The Hormozi stack template:

```
Core offer:        [main product/service]      Value: $X
+ Bonus 1:         [solves objection A]          $Y
+ Bonus 2:         [solves objection B]          $Z
+ Bonus 3:         [accelerates the win]         $W
+ Bonus 4:         [done-for-you template]       $V
+ Bonus 5:         [community / access]          $U
─────────────────────────────────────
Total value:                                    $T
Today:                                          $P  (much less than $T)
```

Each bonus should solve a specific objection from the problem list. Bonuses without a problem to attach to are filler.

### Guarantees (reverse the risk)

Guarantees address the _Likelihood_ term. Types Hormozi catalogues (ch. 17):

- **Unconditional money-back** — strongest, scariest
- **Conditional money-back** — refund tied to specific effort ("if you complete the worksheets and don't see X, refund")
- **Anti-guarantee** — "no refunds" + explanation of why (creates commitment)
- **Implied guarantee** — performance-based pricing ("we only get paid when you do")
- **Service guarantee** — "we'll keep working until you get the result"

Pick _one_ that fits the offer's risk profile. Multiple guarantees look desperate.

### Naming (re-stimulate awareness)

The name of the offer matters. Hormozi's **MAGIC** formula (ch. 18):

- **M**ake a Magnetic reason why
- **A**nnounce your avatar
- **G**ive them a goal
- **I**ndicate a time interval
- **C**omplete with a container word

Example: "The 6-Week Photographer's Booked-Out Calendar Bootcamp" hits all five.

## Step 4 — Apply the psychological-not-logical reframe

Hormozi cites Rory Sutherland: "Any fool can sell a product by offering it for a discount; it takes great marketing to sell the same product for a premium."

Before finalizing, audit the rewrite for opportunities to swap a logical move for a psychological one:

| Logical (default)     | Psychological (Hormozi's preferred)                               |
| --------------------- | ----------------------------------------------------------------- |
| Make it cheaper       | Make fewer of them and raise the price                            |
| Make the wait shorter | Add a dotted-map-style "you'll see X happen by day 3, Y by day 7" |
| Faster shipping       | "Live launch event you're invited to"                             |
| Add features          | Add a status-bearing badge                                        |

## Output format

Return:

1. **Value Equation diagnosis** (the HTML-commented score block).
2. **Dream Outcome rewrite** (1–2 sentences, status-anchored).
3. **Problems list** (exhaustive, bucketed by 4 drivers).
4. **Solutions list** (problems mechanically reversed).
5. **Delivery vehicle inventory** (using cheat-code matrix).
6. **Trimmed & stacked offer** (final form, perceived-value sort).
7. **Enhancement layer** (only the levers that fit the offer's gap).
8. **Final rewritten copy** (ready to ship).
9. **One-paragraph rationale** explaining which Value Equation term the rewrite targeted and why.

## Worked example (mini)

Source draft (job pitch landing page):

> "Join Acme as a Senior Engineer. Work on cool ML problems with talented people. Competitive salary, remote-friendly, great benefits."

Value Equation diagnosis:

- Dream Outcome: 2 — generic "cool problems"; no status anchor.
- Likelihood: 1 — no proof of culture, no employee quotes, no team detail.
- Time Delay: N/A for hiring (interview process is the time cost).
- Effort & Sacrifice: 5 — hidden; what's the interview process? Relocation? On-call?

Constraint: **Dream Outcome and Likelihood are both broken.**

Rewrite (Dream Outcome rebuilt with status hook):

> "Six months from now, you'll have shipped an ML system in production touching 10M+ users, with your name on the internal launch post and your old PyTorch group's Slack asking how you got the job. You'll work in a 4-person team where the senior engineers review every PR and the founder shows up to design reviews. You'll move from 'I built this in a notebook' to 'I run this in production.'"

(Then continue through problems → solutions → delivery → enhancement.)

## Reference

Alex Hormozi, _$100M Offers: How to Make Offers So Good People Feel Stupid Saying No_ (Acquisition.com, Vol. I, 2021). Sections II (Pricing), III (Value), IV (Enhancing Your Offer). Also draws on companion _$100M Leads_ (Vol. II, 2023) for the Core Four channel framework where the offer is paired with a distribution strategy.
