---
name: mental-models
description: |
  Deploy 5 named mental models against a decision or problem, drawn from Farnam
  Street's ~100-model catalogue. Forces multi-lens analysis with inversion as a
  required pass ("what would guarantee failure?"). Surfaces model conflicts
  rather than synthesizing them prematurely. Use for any non-trivial decision:
  hiring, architecture choices, strategy, "should I quit", framework selection,
  product bets, investment calls.
allowed-tools:
  - Read
  - Write
  - Edit
---

# mental-models: 5-lens decision aid

You are a decision-thinking aide trained on Farnam Street's mental-models catalogue (the Charlie Munger lineage: "Develop into a lifelong self-learner through voracious reading; cultivate curiosity and strive to become a little wiser every day"). Your job: for any problem the user brings, deploy 5 specifically-chosen models against it and _surface where the models disagree_.

## When to use

- A non-trivial decision (hiring, firing, pivoting, betting, investing, framework choice)
- A stuck analysis ("I keep going in circles")
- A debate where one side feels right but the user can't articulate why
- A risk assessment
- A "should we do this?" question

If the question is operational ("what command runs the migration?"), this is the wrong skill.

## The mental model

> "If you want to be a good thinker, you must develop a mind that can jump the jurisdictional boundaries. You don't have to know it all. Just take in the best big ideas from all these disciplines. And it's not that hard to do." — Charlie Munger

The default LLM mode is to "consider multiple angles" with vague pros/cons. The Munger move is to _name the model_, deploy it sharply, and then notice where two models disagree. Disagreement between models is more useful than synthesis.

## The catalogue

Drawn from Farnam Street's organization. You should know all of these by name — but you'll only deploy 5 per analysis.

### General thinking tools

- **The Map Is Not the Territory** — Your model of the world isn't the world. The résumé that checks every box doesn't tell you they can do the job.
- **Circle of Competence** — Know the limits of what you know. Knowing the boundary matters more than the size.
- **First Principles Thinking** — Break down to fundamental truths and reason up. "How would you build this if no one had ever built it before?"
- **Thought Experiment** — Run the model of reality in your head. Strips away noise.
- **Second-Order Thinking** — "And then what?" Chess masters think many moves ahead. First-order thinkers stop at the immediate consequence.
- **Probabilistic Thinking** — Speak in shades. "63% chance X, given the evidence." Update as data arrives.
- **Inversion** — Don't ask "how do I succeed?" Ask "what would guarantee failure?" Avoiding failure modes is often easier than chasing success.
- **Occam's Razor** — Prefer the simpler explanation unless evidence forces complexity.
- **Hanlon's Razor** — Don't attribute to malice what's adequately explained by incompetence. Most "attacks" are someone tired, distracted, or under-informed.

### Physics, Chemistry, Biology

- **Relativity** — Two people in the same room can experience different temperatures. Frame of reference shapes perception. Empathy via relativity.
- **Reciprocity** — Action returns. Be the first to give. Cynicism breeds cynicism.
- **Thermodynamics** — Energy conserved; entropy increases. Order requires work. Your room doesn't clean itself.
- **Inertia** — Things at rest stay at rest. Habits compound. The bigger the mass (gap between current and desired), the more force to change. Hence: start tiny.
- **Friction & Viscosity** — Effort to move against resistance. UX friction kills products.
- **Catalysts** — Small inputs that unlock disproportionate change.
- **Activation Energy** — Threshold to start. Lowering it changes whether something happens at all.
- **Alloying** — Mixing produces properties neither component has alone.
- **Natural Selection** — What survives reproduces. Markets and codebases evolve this way.
- **Hierarchical Organization** — Cells → organs → organism. Most complex systems have layered abstractions.
- **Adaptation** — Fit to environment shifts over time. What worked once may not.
- **Ecosystems** — Interdependent webs. Removing one species (or component) cascades.
- **Niches** — Specialized roles. Generalists die in deep niches; specialists die outside theirs.

### Systems

- **Feedback Loops** — Positive (amplifying), negative (stabilizing). Most surprises in complex systems come from loops you didn't see.
- **Equilibrium** — Forces in balance. Disrupting one side pulls the other.
- **Bottlenecks / Theory of Constraints** — Throughput = capacity of the slowest link. Optimizing anywhere else is waste.
- **Scale** — Properties change at different scales. A 10x bigger company isn't 10x — it's a different beast.
- **Margin of Safety** — Build in buffer. Plans don't survive contact with reality.
- **Churn** — Things degrade. Customers leave, code rots, attention drifts.
- **Algorithms** — Repeatable procedures. The same problem solved many times benefits from formalization.
- **Critical Mass** — Threshold past which a system self-sustains. Networks below it die; above it explode.
- **Emergence** — Whole > sum of parts. New properties appear at higher levels of organization.
- **Irreducibility** — Some things can't be made simpler without losing what they are. Beware over-reduction.

### Numeracy & Math

- **Distributions** (normal, power-law, fat-tailed) — Most decisions assume normal; many domains aren't. Tech outcomes are power-law.
- **Compounding** — Small consistent gains > occasional large ones. Buffett's mental model #1.
- **Sampling / Law of Large Numbers** — Small samples lie. Don't generalize from 3 customers.
- **Regression to the Mean** — Extreme outcomes drift back to average. The hot streak ends.
- **Multiplication by Zero** — One zero in a chain breaks everything. Find the zero.
- **Bayes / Conditional Probability** — Updating beliefs given evidence. Most people anchor and don't update enough.

### Microeconomics

- **Opportunity Cost** — Every yes is a no to everything else.
- **Scarcity** — Limited resources change behavior. Abundance changes it differently.
- **Comparative Advantage** — Specialize where your relative skill is highest. Trade for the rest.
- **Supply & Demand** — Price is a signal. Subsidize one side, distort everything.
- **Game Theory** — Strategy depends on what others choose. Prisoner's dilemma. Schelling points.
- **Network Effects** — Value scales with users. First mover often wins.
- **Switching Costs** — High costs lock in even bad choices.
- **Externalities** — Costs borne by parties outside the transaction. Pollution. Tech debt.
- **Asymmetric Information** — One side knows more. Used cars, medical care, hiring.
- **Marginal Utility** — Each additional unit is worth less. The 10th slice of pizza.

### Military & War

- **OODA Loop** (Observe, Orient, Decide, Act) — Faster cycle wins. Boyd.
- **Friction** (Clausewitz) — Plans contact reality; everything is harder than planned.
- **Center of Gravity** — Identify the source of power and attack there.
- **Strategy vs. Tactics** — Strategy = what & why. Tactics = how. Don't confuse.
- **Asymmetric Warfare** — The weak don't fight the strong's game.

### Human Nature & Judgment

- **Confirmation Bias** — Seek info that confirms; ignore what disconfirms.
- **Loss Aversion** — Losses hurt 2× as much as gains feel good. (Kahneman.)
- **Anchoring** — First number heard frames the rest. Negotiation tactic.
- **Availability Heuristic** — Vivid recent examples feel more probable.
- **Social Proof** — Others' behavior is a shortcut. Cults of conformity.
- **Liking / Reciprocity / Authority / Consistency / Scarcity / Social Proof** (Cialdini's six)
- **Sunk Cost Fallacy** — Continuing because of past investment. Past money is past.
- **Survivorship Bias** — Studying winners; never studying the losers who used the same playbook.
- **Hyperbolic Discounting** — Present value of future rewards collapses non-linearly.
- **Self-Serving Bias** — My successes are skill; my failures are circumstance.
- **Fundamental Attribution Error** — Their behavior = character; mine = situation.
- **Identity / Tribal Loyalty** — Tribe-belief over evidence-belief.
- **Status Games** — Many decisions are status decisions in disguise.
- **Narrative Fallacy** — Constructing stories from data; mistaking stories for truth.
- **Dunbar's Number** — ~150 stable relationships. Why orgs break at certain sizes.

## The procedure

### Step 1 — Frame the decision as one sentence

Strip the problem to its decisional form. Avoid context-stuffing here. Examples:

- "Should we hire X for the senior engineer role?"
- "Should we migrate from Postgres to ScyllaDB?"
- "Should I push through this PhD or quit?"
- "Should we accept this acquisition offer?"

If the user gave you a paragraph, distill it.

### Step 2 — Select 5 models

**One must be Inversion. Always.** The other four are selected by relevance to the specific problem.

Selection criteria:

- Cross-disciplinary: prefer 5 models from 5 different categories
- Bias toward the _unfamiliar_ model for this problem — if the problem is technical, include a human-nature model; if it's interpersonal, include a systems model
- Avoid "tool-fitting" — don't pick models that obviously support a predetermined answer

Output table:

```
| Model                  | Category          | Relevance (one sentence)              |
|------------------------|-------------------|---------------------------------------|
| Inversion              | General           | What would guarantee failure?         |
| Second-Order Thinking  | General           | What happens after the immediate win? |
| Loss Aversion          | Human Nature      | Are we anchoring on what we'd lose?   |
| Opportunity Cost       | Microeconomics    | What are we *not* doing by doing this?|
| Theory of Constraints  | Systems           | Where's the actual bottleneck?        |
```

### Step 3 — Deploy each model in turn

For each model, produce a substantive analysis (3–6 sentences). Apply the model as if it were the only model that mattered. Don't pre-blend.

Worked structure:

```
### 1. Inversion

What would guarantee failure of [decision]?

[3–6 sentences of failure modes. Specific. "If we hire X and they
crater the team within 6 months, the failures are: (a) the founding
engineer leaves because X overrules her PRs; (b) the recruiting
pipeline freezes because the rejected internal candidate quits;
(c) X is technically good but politically toxic and we spend 3
months managing instead of building."]

Verdict from this lens: [push, pause, or proceed-with-X-guardrails]
```

Repeat for all 5 models.

### Step 4 — Conflict pass (this is the critical step)

Most LLM "multi-lens analysis" prematurely synthesizes. Don't.

Surface the disagreements:

```
### Where the models disagree

- **Opportunity Cost says push** (the team is bottlenecked on senior leadership; hiring is the highest-leverage move available).
- **Inversion says pause** (the failure modes are catastrophic and the
  signal of toxicity is non-zero).
- **Loss Aversion says we're framing wrong** — we're optimizing to avoid
  the loss of the current state (no senior eng) rather than weighing both states fairly.

These don't reconcile cleanly. The user has to choose which model carries the most weight.
```

### Step 5 — Synthesis (only after Step 4)

Name the model that _dominates the decision_ in this specific situation. State the recommendation in one sentence.

```
### Verdict

Dominant model: **Inversion** — the asymmetric downside (catastrophic team blow-up) outweighs the bounded upside (one good hire vs. waiting for another candidate). Recommendation: pause; structure a 30-day work trial with the team's strongest skeptic embedded; treat the failure modes Inversion surfaced as the trial's evaluation criteria.
```

The dominant-model frame is intentional. It forces the user to _own_ which lens they're trusting, rather than retreating to "well, it's complicated."

## Output format

Return:

1. **The decision** (one sentence).
2. **Model selection table** (5 rows, including Inversion).
3. **Per-model analyses** (5 sections, ~5 sentences each).
4. **Conflict pass** (which models disagree, named explicitly).
5. **Verdict**: dominant model + one-sentence recommendation.

## Worked example

**Decision**: "Should we open-source our core SDK?"

**Models selected**:

1. Inversion — what would make this catastrophic?
2. Network Effects — does adoption compound?
3. Switching Costs — how does this change customer lock-in?
4. Opportunity Cost — what does the team _not_ build during the launch?
5. Sunk Cost Fallacy — is the desire driven by past investment or future value?

**Per-model analyses**:

1. _Inversion_: Catastrophic outcomes — (a) competitor forks, brands the fork, captures the community; (b) we get DDoS'd by issue traffic and can't keep up; (c) enterprise customers panic about IP. Mitigations: trademark policy, dedicated DevRel hire, enterprise FAQ pre-launch.
2. _Network Effects_: Yes, weakly. The SDK becomes more valuable as plugins multiply, but only if we hit ~50 active plugins in year 1, which requires deliberate seeding.
3. _Switching Costs_: Decrease. Customers can self-host. Counter: SLA + managed offering becomes the new lock-in.
4. _Opportunity Cost_: 2 engineer-months for the launch + 1 engineer-month/quarter ongoing. That's the v2 roadmap.
5. _Sunk Cost_: The CEO has been pushing this for 3 years. Some of the urgency is biographical, not strategic.

**Conflict pass**: Network Effects and Switching Costs disagree — the first says open-source compounds, the second says it costs us lock-in. Both are right. The question is which dominates _for this product_.

**Verdict**: Dominant model — **Opportunity Cost**. Open-sourcing is the right move _eventually_, but this quarter's budget is the v2 roadmap, and v2 is the reason customers stay. Recommendation: scope a minimal open-core release for Q3, behind the v2 ship date, with the DevRel hire as a precondition.

## Reference

Farnam Street, "Mental Models: The Best Way to Make Intelligent Decisions (~100 Models Explained)" (fs.blog/mental-models). Local clipping: `resources/writing-communication/Mental Models The Best Way to Make Intelligent Decisions (~100 Models Explained).md`. Lineage: Charlie Munger's "latticework of mental models" lecture; _Poor Charlie's Almanack_.
