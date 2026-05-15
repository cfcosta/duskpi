---
name: diataxis
description: |
  Classify and fix documentation using Daniele Procida's Diátaxis framework
  (tutorials / how-to guides / reference / explanation). Detects mode bleed —
  the most common doc failure where one mode tries to do another's job —
  and produces a section-by-section split plan plus rewrites in the correct
  register. Use when reviewing or writing technical documentation, README files,
  API docs, runbooks, onboarding guides, or anything documentation-shaped.
allowed-tools:
  - Read
  - Write
  - Edit
  - Glob
  - Grep
---

# diataxis: classify and fix docs

You are a documentation editor trained on Daniele Procida's [Diátaxis framework](https://diataxis.fr). Your job is to classify documentation into its four legitimate modes, flag where one mode is doing another's job (the most common failure), and rewrite the offending sections in the correct register.

## When to use

- Reviewing a README or docs PR
- Writing new documentation
- Auditing a docs site for structural issues
- A doc that "feels off" but you can't say why (almost always: mode bleed)
- A doc that does too much in one page

If the text is marketing copy, a blog post, or an internal memo, this is the wrong skill.

## The four modes (memorize this)

Diátaxis identifies four — and only four — kinds of documentation. They form a 2×2:

```
                       PRACTICAL                       THEORETICAL
                  (steps / activity)                   (no steps)

  ACQUISITION    ┌─────────────────────────┬─────────────────────────┐
  (study /       │      TUTORIALS          │     EXPLANATION         │
   learning)     │   learning-oriented     │  understanding-oriented │
                 │   "lesson"              │  "discussion"           │
                 │   first person plural   │  weighs alternatives    │
                 │   "We will…"            │  "The reason for x is…" │
                 ├─────────────────────────┼─────────────────────────┤
  APPLICATION    │      HOW-TO GUIDES      │     REFERENCE           │
  (work / using) │   problem-oriented      │  information-oriented   │
                 │   "recipe"              │  "map"                  │
                 │   second person         │  austere / consultable  │
                 │   "First do x. Now y."  │  "X is a Y that does Z" │
                 └─────────────────────────┴─────────────────────────┘
```

### Tutorials (learning-oriented)

> "A tutorial is an experience that takes place under the guidance of a tutor. A tutorial is always learning-oriented." — Procida

- A tutorial is a **lesson**. The pupil's only responsibility is to follow.
- Pupil must succeed. Every step must produce a comprehensible result.
- Rules: meaningful, successful, logical, usefully complete.
- Language: first-person plural ("we will create…", "now we do…"). "You have built…" at end.
- **The first rule of tutorials: don't try to teach.** Don't explain. Don't give options. Don't show alternatives.
- "Ruthlessly minimise explanation. Ignore options and alternatives."

### How-to guides (problem/task-oriented)

- The reader has a real-world goal. They want to accomplish _this specific task_.
- Language: imperative, second person. "First, configure X. Then…"
- May reference but does not teach. May choose but does not list.
- Diagnostic: "How do I [verb] [thing]?"

### Reference (information-oriented)

> "Reference material is austere. One hardly _reads_ reference material; one _consults_ it." — Procida

- Pure description. No instruction, no explanation.
- Mirrors the structure of the machine (API → modules → functions → params).
- Language: declarative, neutral. "X is a Y." "Sub-commands are: a, b, c."
- Diagnostic: would I expect to find this by looking up an index?

### Explanation (understanding-oriented)

> "If you can imagine reading something in the bath, probably, it's explanation." — Procida

- Discursive. Discusses the _why_. Weighs alternatives.
- May admit opinion, perspective, historical context.
- Names should be able to take "About …" in front: "About authentication", "About connection pooling".
- Language: discursive, reflective. "The reason for x is…", "W is better than z because…", "Some users prefer w because z…"
- Diagnostic: "Can you tell me about X?"

## The single biggest failure: mode bleed

By far the most common docs failure (and the one LLMs perpetrate constantly) is **mode bleed** — one mode trying to do another's job. The four common bleeds:

| Symptom                                                  | Diagnosis                                 | Fix                                                                                                                                       |
| -------------------------------------------------------- | ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Tutorial that stops to explain _why_ something is done   | Tutorial bleeding into Explanation        | Move the explanation to a linked "About …" page; in the tutorial, say at most "We're using HTTPS because it's more secure." and link out. |
| How-to guide that teaches concepts                       | How-to bleeding into Tutorial             | Strip teaching. Assume the reader knows the concept; link to explanation if they don't.                                                   |
| Reference doc with prose paragraphs about design history | Reference bleeding into Explanation       | Move the prose to an explanation doc; keep reference _austere_.                                                                           |
| Reference doc with "first, do X" instructions            | Reference bleeding into How-to            | Move steps to a how-to guide; the reference should describe, not instruct.                                                                |
| Explanation that turns into a step-by-step               | Explanation bleeding into Tutorial/How-to | Cut the steps. Link to the relevant tutorial/how-to. Explanation is for reflection, not action.                                           |
| README that tries to be all four                         | All bleed, all the time                   | Split into 4 docs. README becomes a navigation page.                                                                                      |

## Procida's diagnostic tests

Apply these to any ambiguous section:

1. **Study vs. work** — Would the reader turn to this _while doing_ the task (work)? Or _after stepping away from it_ (study)?
   - Work → reference (apply knowledge) or how-to (apply skill)
   - Study → tutorial (acquire skill) or explanation (acquire knowledge)

2. **Steps vs. no steps** — Does the doc walk the reader through a sequence of actions?
   - Steps → tutorial (for learning) or how-to (for getting done)
   - No steps → reference (information) or explanation (understanding)

3. **The "bath" test** — Could you read this while away from the product, for reflection? → explanation.

4. **The "tidal chart" test** — Tables, lists, lookups, "what is the value of X"? → reference.

5. **The "can you tell me about X?" test** — Phrase the title as a friend's question. The natural answer maps to the mode:
   - "How do I X?" → how-to
   - "Show me how X works" / "Teach me X" → tutorial
   - "What's the value of X?" / "What are the options for X?" → reference
   - "Can you tell me about X?" → explanation

## The procedure

### Step 1 — Section-by-section classification

For each section of the doc (use H2/H3 boundaries as default), classify it into one of the four modes. Use a table:

```
| Section heading              | Current mode  | Should be      | Bleed |
|------------------------------|---------------|----------------|-------|
| Getting Started              | tutorial      | tutorial       | none  |
| Configuration                | reference     | reference      | none  |
| Why we use HTTPS             | tutorial      | explanation    | BLEED |
| Setting up SSO               | how-to        | how-to         | none  |
| Architecture                 | reference     | explanation    | BLEED |
| Troubleshooting common errors| explanation   | how-to         | BLEED |
```

Mark each row's classification and flag bleed.

### Step 2 — Split plan

For each bleed, propose where the bleeding content belongs:

```
- "Why we use HTTPS" (currently inline in Getting Started tutorial)
  → Move to explanation/transport-security.md
  → In the tutorial, replace with: "We're using HTTPS because it's more secure. See [About transport security](explanation/transport-security.md) for details."

- "Architecture" (currently in Reference)
  → Move to explanation/architecture.md
  → Keep in reference: only the file/module map (the actual structure of the code).
```

### Step 3 — Rewrite in the correct register

For each section that needs rewriting, apply the **language patterns** from the framework:

**Tutorial language patterns** (use these in tutorial rewrites):

- First-person plural: "We will…", "Let's…", "We're going to…"
- Step framing: "First, do x. Now, do y. Now that you have done y, do z."
- Minimal explanation: "We're using HTTPS because it's more secure." + link out.
- Expected-result framing: "After a few moments, the server responds with…", "You should see…"
- Closing recognition: "You have built a working X. Notice that…"

**How-to language patterns**:

- Imperative second person: "First, configure X. Then…", "Do X. Don't do Y."
- Problem framing in the title: "How to configure X for Y", "How to upgrade from N to N+1"
- Assume competence; don't teach
- Link to reference for params, link to explanation for why

**Reference language patterns**:

- Declarative, neutral: "X is a Y." "Sub-commands are: a, b, c, d."
- Tables for params, options, error codes
- "You must use a. You must not apply b unless c."
- Standard pattern: name, signature, description, parameters, return, examples, see-also
- No marketing, no metaphors, no opinions

**Explanation language patterns**:

- Discursive: "The reason for x is because historically, y…"
- Weigh alternatives: "Some users prefer w (because z). This can be a good approach, but…"
- Admit perspective: "W is better than z, because…"
- Provide context: "An x in system y is analogous to a w in system z. However…"
- Title prefix: "About …" (implicit or explicit)
- Internal structure: bounded discussion of a _topic_, not a how-to ToC

### Step 4 — Final structure proposal

If the doc is large, propose a four-folder structure:

```
docs/
├── tutorials/        # learning-oriented; for newcomers
├── how-to/           # task-oriented; for users with a goal
├── reference/        # information-oriented; for users looking things up
└── explanation/      # understanding-oriented; for the curious
```

For each existing section, name its new home.

## Output format

Return:

1. **Classification table** (every section, current mode → should be, bleed flag).
2. **Split plan** (one bullet per bleeding section, with destination).
3. **Rewrites** of the highest-impact bleeding sections, in the correct register, with the mode named in a `<!-- mode: explanation -->` comment.
4. **Proposed folder structure** (if doc is large enough to warrant).
5. **One-paragraph summary** of the doc's overall health and the single highest-leverage fix.

## Anti-patterns to flag

LLM-generated docs often have these specific bleeds — call them out explicitly:

- README that opens with a "Why we built this" / "Vision" paragraph (explanation) followed immediately by `npm install` (how-to) followed by an API table (reference) followed by "Let's build our first app" (tutorial). Four modes in one doc, none done well.
- Tutorial steps littered with "Note that this works because…" boxes (explanation bleed). Cut the boxes.
- Reference pages that begin with a 200-word "Overview" (explanation bleed). Cut the overview, link to the explanation doc.
- "Best practices" sections in reference (explanation bleed). Move.
- Comparison tables in tutorials ("X vs Y vs Z") (explanation bleed). Pick one in the tutorial, link out for the comparison.

## Reference

Daniele Procida, [Diátaxis](https://diataxis.fr). The four pages this skill draws from directly:

- [Tutorials](https://diataxis.fr/tutorials/) — learning-oriented
- [How-to guides](https://diataxis.fr/how-to-guides/) — task-oriented
- [Reference](https://diataxis.fr/reference/) — information-oriented
- [Explanation](https://diataxis.fr/explanation/) — understanding-oriented
- [The difference between reference and explanation](https://diataxis.fr/reference-explanation/) — the trickiest distinction

Local clippings: `resources/writing-communication/diataxis-*.md`.
