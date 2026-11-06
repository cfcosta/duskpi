---
name: jev
description: Best practices for building software on Jev, TypeSafe's System One model, which answers typed questions (Choice, Score, Noul, Box) about a state with calibrated probabilities. Use when writing, reviewing, or debugging code in any language that calls the TypeSafe API (`POST https://api.typesafe.ai/v1/systemone`, directly or through a TypeSafe client SDK), when designing Jev questions, state, or thresholds, when replacing an LLM prompt-and-parse step, regex, or brittle heuristic with a typed judgment, or when looking for places in a codebase where Jev fits.
---

# jev: building with TypeSafe's System One model

Jev evaluates typed **questions** against a **state** and returns typed answers with calibrated probabilities. It does not generate text, write code, explain itself, or call tools. It is a judgment component that your code calls, not an agent and not a chat model. It cannot be the backend of a coding agent; there is no `model: "jev-latest"` setting that turns a coding agent into a Jev agent.

The one rule that the rest of this skill elaborates:

> **Jev makes judgments. Code makes decisions.**

Everything below is guidance distilled from TypeSafe's docs, blog, and cookbooks (as of Jev 1.14, November 2026). The live docs are the source of truth for exact syntax: start at `https://docs.typesafe.ai/llms.txt`; append `.md` to any docs path to get Markdown. When the docs and this skill disagree, trust the docs and say so.

This skill is language-neutral. Requests and responses are shown as the HTTP API's JSON, and routing logic as decision tables or pseudocode. Translate them into whatever language the project uses. If the project uses a TypeSafe client SDK, read its installed types for exact names (`https://docs.typesafe.ai/sdk.md` lists the official ones); the JSON field names carry over. Never invent request or response fields.

Companion files in this skill's directory:

- `references/api.md`: HTTP API reference: request and response schemas, limits, headers, errors, models, images, and the behavior to expect from any client (retries, timeouts, caching).
- `references/cookbooks.md`: every official cookbook and demo, reduced to its decomposition, thresholds, results, and lessons. Read the closest one before designing a new workflow.

---

# 0. When to use Jev (and when not)

Reach for Jev when code needs a fast, cheap, structured judgment over unstructured input (text, JSON records, images):

- Route an input to one of a fixed set of destinations, and know how sure the routing is.
- Detect whether a property is present (spam signal, refund request, PII, injected instruction, unauthorized charge).
- Place something on a described scale (severity, frustration, relevance, quality).
- Verify another system's output (LLM answer vs. its sources, citation vs. quote, extracted field vs. document, tool call vs. policy).
- Pick the right candidate from a list that code produced (regex matches, retrieved passages, search results, catalog items).
- Turn text into numeric features for a classical ML model.
- Find where something is in an image (Box, experimental).

Signs a codebase needs it: an LLM is asked to "return JSON" and the result is parsed, validated, and retried; keyword lists or regexes try to detect meaning; the same input gets different LLM answers; a person reads each item to decide what happens to it; frontier-LLM cost or latency rules out checking every row.

Do **not** use Jev for:

| Task | Use instead |
| - | - |
| Generating text, summaries, replies, code | A generative LLM |
| Arithmetic, counting, comparing numbers or dates, exact lookups, policy rules | Code |
| Multi-step reasoning, chains of indirection, "analyze and decide the best course of action" | Decompose into atomic questions; or a reasoning model |
| Free-form extraction of a value | Code (regex/parser) or an LLM proposes candidates, Jev picks one (Choice) |
| Something code already decides reliably | Code. Tell the user Jev is not needed. |

Performance envelope: most calls finish in about 100–150 ms; price is per input token only ($0.042 per million tokens on Jev 1.13/1.14, output free); every question in a request runs in parallel against one read of the state.

---

# 1. The core idea: decompose decisions into judgments and facts

A decision is rarely one atomic choice. "Peel off the cap" of any business decision and you find a graph: inputs flow through **fact nodes** (lookups and arithmetic your code computes exactly) and **judgment nodes** (questions only an informed reader can answer), and logic in code combines them into an exit.

The anti-pattern is putting the whole decision in one question: a single Choice whose `criteria` encode business rules ("Pick this if they want a refund AND the claim is eligible AND the amount ≤ $25, unless they report fraud..."). It can work on the demo inputs, but it puts intelligence at the wrong layer. Every new edge case means rewording long criteria (**prompt gymnastics**), new inputs break it again, and when it routes a case wrongly you get one probability and no way to tell which judgment or which rule failed.

Decomposed, the same customer-service router looks like this:

```
exit  fraud_team
  ├─ g_fraud    reports an unauthorized charge (p > 0.6)        true   ← decided
  ├─ g_person   asks for a person, or threatens legal action …  –
  ├─ g_instant  wants money back, claim eligible, amount ≤ $25  –
  ├─ g_large    wants money back, claim eligible, amount over…  –
  ├─ g_offer    wants to cancel, subscription active, open to…  –
  └─ else       answer                                          –
  judgments · Jev
       wants_money_back       0.99
       reports_unauthorized   0.94  ←
       requests_human         0.02
       threat_legal           0.01
       wants_to_cancel        0.02
       open_to_offer          0.22
  facts · your code
       refund_eligible       false
       small_refund          false
       subscription_active   false
```

What decomposition buys:

1. **Clarity.** The rule table shows what flows through the system and which combinations still have no defined outcome.
2. **Observability.** A wrong exit points at either one judgment (fix the question or state) or one rule (fix the code). The fix is focused.
3. **Extendability.** A new exit adds its rule plus any new judgments and facts it needs. Jev evaluates every question in isolation, so new questions cannot change the answers to questions you have already validated.

Think of each decision as a **truth table**: Jev supplies boolean-ish and categorical inputs, code holds the mapping to actions. If the user asks Jev "Should this be escalated?" or "What should the agent do next?", the question is at the wrong layer. Break it into the judgments the decision depends on, and write the decision in code.

---

# 2. Workflow

Follow these steps when building or changing a Jev integration.

1. **Start from the action.** Write down what the system will show, select, change, or hand off. Sketch the rule table that decides it and list its inputs.
2. **Sort inputs into facts and judgments.** Arithmetic, dates, thresholds on amounts, membership in a list, status flags, and policy belong in code. Inputs that need an understanding of language or images become questions. Give every combination of answers an outcome, including "unsure" (a Noul between thresholds, a low-probability Choice). If code alone can decide reliably, stop and say so.
3. **Design the state** (section 4): only what the questions need, as named JSON fields.
4. **Write one atomic question per judgment** (sections 3 and 5). Put all questions, option descriptions, levels, and thresholds in one module of constants, so people can review and edit them in one place. Expect to edit question wording with the user; agents are bad at writing questions on the first try.
5. **Bundle every question over the same state into one request**, including speculative ones (section 6).
6. **Write the composition and routing code** (sections 7 and 8): which number gates which action, with risk-scaled thresholds and an explicit uncertain path.
7. **Probe the live API** with representative, hard, and negative cases before integrating (section 10). Ask the user first.
8. **Integrate for production** (section 11): pinned model ID, logged payloads and answers, errors surfaced as errors, client reuse.

If the request is open-ended ("where could we use Jev?"), explore the codebase for the signs in section 0, then propose the two or three best opportunities with the closest cookbook for each (`references/cookbooks.md`), and recommend one.

---

# 3. Choosing a question type

| Type | Use when | Request fields | Answer fields |
| - | - | - | - |
| **Choice** | Exactly one of a known, unordered set of options | `instructions`, `criteria`: map of option name → description (string, object, array, or `null`); up to 255 options | `choice` (top option), `probabilities` (every option, sums to 1), `confidence` |
| **Score** | A position on a spectrum you can describe in steps | `instructions`, `criteria`: ordered list of level descriptions, low to high, 2 to 10 levels | `score` (probability-weighted mean of level indices, 0 to n−1), `legend`, `probabilities` (per level), `confidence` |
| **Noul** | A yes/no proposition, where the probability itself is the signal | `instructions`; optional `criteria` `{true, false}` | `noul`: P(yes), 0 to 1. No `confidence`. |
| **Box** | Where one target is in an image (experimental) | `instructions` only; no `criteria` | `box` `{top, bottom, left, right}` as fractions of image height/width from the top-left; `confidence` |

Rules for picking:

- Prefer the type whose answer maps straight onto code: a Choice onto a `match`/`switch`, a Score onto a threshold or a weight, a Noul onto an `if`.
- **Choice always picks something**, even when nothing fits, sometimes with high probability. When the list may not cover every input, add a **companion Noul** ("Does `message` name any of `products`?") and read the Choice only when the Noul is a clear yes. In TypeSafe's tests this beats an `other`/`none of the above` option, which competes with the real options for probability. (A `none`/`not_stated` option still makes sense when "absent" is itself a legitimate, frequent answer, such as a date part that the document does not state.)
- **Box always returns a box.** Pair it with a Noul asking whether the target is in the image at all.
- **When several options can be true at once** (a message that is both a refund request and a complaint), use one Noul per option instead of a Choice, which would split probability between them. All Nouls low then means "none", with no extra question.
- **Noul is not a degree.** "Is the candidate strong in SQL?" at 0.5 means "the model can't tell", not "medium skill". For degree, use a Score with described levels. For a yes/no decision, define a crisp condition: "Does the resume state that the candidate has used SQL at work?"
- **No in-between, a few discrete categories:** use a Choice or several Nouls, not a Score.

---

# 4. Designing the state

State is the material you would show a panel of experts before asking them to judge. It can be a string, a JSON object, or an array, and it can contain images. Every question in the request sees the same state.

- **Apply the human test.** Could a smart person, shown only this state and this question, answer at a glance? When a question fails, the fix is usually in the state, not the wording.
- **Use an object with descriptive keys** for anything beyond a single passage. Named fields work better than a string of serialized JSON and let questions point at parts by path.
- **Point questions at fields with backticked dot-and-index paths**, backticks included: ``Does `ticket.messages[0].text` request a refund?`` Prefer stable names (`candidates.refund_policy`) over positions when you can.
- **Send only what the questions need.** Unrelated detail is a distractor; accuracy falls as the state fills with irrelevant content (context rot), and a field added for one question can sway another. Filter and retrieve in code first. The model can also read an empty list as a signal, so leave out fields that carry no information.
- **Give what a person would look at:** who sent each message, the full thread rather than a truncated last line, names instead of raw IDs or `@`-mention markup, the one item under discussion rather than the whole catalog.
- **State facts code already knows** instead of making the model re-derive them: "all messages in `replies` were sent after the refund was issued", `"days_overdue": 42`, `"refund_eligible": false`.
- **Supply facts the model may lack:** what an internal codename refers to, your policy text, your product list. Do not rely on knowledge in the weights when your own knowledge base has current information. Jev is not fine-tuned per customer; the request is the only place to put domain knowledge.
- **Truncate carefully.** Only when needed, and check the cut keeps what the questions rely on.
- **Leave out what no person could judge** (an unreadable crop, a distinction experts dispute). The answer there is noise that code will treat as signal.
- Put everything a judgment compares in the same state: query + passage, claim + cited section, task + extracted answer, both records of a candidate match, stream title + game for a chat message. Send the relevant section, not the whole document.
- Run cheap deterministic checks before Jev and keep their results out of the question: exact string matches (a quote missing from the source is fabricated, no model call), schema validation, blank lines and markers, single-option nodes.
- Send identifiers and exact large numbers as strings. `NaN`, `Infinity`, and out-of-range numbers are rejected; nesting is capped at 64 levels.
- Audio and video are not supported. Send video as still frames (an array of `{seconds_ago, frame}` objects works).

---

# 5. Writing questions

## 5.1 Rules for every type

- **One snap judgment per question.** The kind of call a knowledgeable person makes in a second or two. "Does this message convey urgency?" is good. "Analyze this message and determine the best course of action" is not.
- **Ask the concrete, observable thing.** "Is a SQL query built by string concatenation here?" rather than "Are there SQL injection risks?". Instead of "Is this fraud?", ask about each sign of fraud: does it ask to change bank details, does the sender domain match the vendor, does it pressure the reader to act quickly.
- **Beware "and"/"or".** Two conditions in one question make the answer mean less. Split into two questions and combine in code. A list of rules becomes one question per rule.
- **Write the complete question in `instructions`.** Question IDs are for your code and are never sent to the model. Option names and descriptions are sent.
- **Jev is literal.** It answers the question you wrote, not the one you meant. Scoping words, negations, and implied conditions are read at face value. When you catch yourself explaining what a question "really meant", that explanation is the missing half of the instruction, or a sign the question should be two literal questions.
- **Write plainly. A question is not an LLM prompt.** No preambles, no "consider X, Y, and Z" lists, no output-format instructions, no "think step by step". Option descriptions belong in `criteria`, not in `instructions`.
- **Phrase so that high means yes.** "Does the message contain personal data?", not "Is the message free of personal data?". Avoid double negatives and presuppositions ("the next step"). Keep `instructions` and `criteria` consistent: a Noul whose `true` describes a "no" performs worse.
- **Reduce indirection.** A property of a property, or a multi-hop lookup, costs accuracy. Name the subject directly ("Where is the coffee mug in `photo`?", not "Where is `target` in `photo`?" with the target defined elsewhere).
- **Anchor intent to the goal.** "Which of these files does the user want copied?" beats "Which of these names the main input?".
- **Same question over many items: one question per item.** Generate the questions in code with IDs like `item_0`, `item_1`, ..., each pointing at its own item (``Is `items[3]` the name of a fruit?``), rather than giving the model an ID to look up in a shared list.
- **Name the narrowest fact that decides it**, especially when the answer feeds a threshold. Asking "are these two lines part of the same paragraph?" (a topic judgment) merged list items; "does this line pick up mid-sentence, continuing a sentence left unfinished on the previous line?" (a fact about the text) fixed it.
- **Write about the idea, not the words.** Questions phrased around meaning reach inputs that share no keywords with them. Don't name a question after a parameter ("Which resolution?"); say what the value means.
- **Put domain rules in the question:** equivalence rules ("ignore differences in spacing, punctuation, currency symbols and letter case"; "a regional branch of a label is the same label; an imprint and its parent are different"), format conventions ("dates are day/month/year, so the year is the last part"), evidence requirements ("answer yes only when the content gives concrete evidence"), and knowledge-cutoff guards ("don't call an API incorrect just because you don't recognize it").
- **Verifier questions ask whether the thing is broken.** For a battery of rule checks over another system's output, frame each Noul so yes means "this rule is broken", one rule per Noul, so a fired check names what failed.
- **Name the confusing case.** When answers mix up two outcomes, say in the criteria what separates them with the specific case ("a question about the refund policy is not a refund request"). A vague exclusion ("not other kinds of message") helps less and can draw attention to the wrong answer.
- Each question is answered alone. It cannot see the other questions or their answers. Any context it relies on belongs in the state or in that question.

## 5.2 Choice

- Give option names that describe their content (`refund_request`, `shipping_delay`). Positional names (`A`, `left`, `option_1`) give the model nothing and can bias the answer. `null` descriptions are fine when names are self-explanatory (`{"calm": null, "frustrated": null, "angry": null}`).
- Give the full list rather than a shortlist; options cost a few tokens each. The hard limit is 255 options (256 is rejected); the docs call ~240 reliable, and only ~40 fit when each option carries a long passage. For bigger sets, funnel: per-item Nouls on short text for everything, richer Nouls for the top slice, then a Choice over the final handful. For deep taxonomies, walk the tree one level per request (beam search over probabilities, see `references/cookbooks.md`).
- **Choice is relative, Noul is absolute.** Choice probabilities sum to 1, so some option always ranks first and its top probability says how far ahead the leader is; use it to pick among candidates. Per-item Nouls judge each candidate alone (several can be high, all can be low); use them to filter, rank by absolute fit, and detect "none".
- Option keys can be the exact machine values your code consumes (function argument literals, regex-found spans, line IDs like `L052`), so nothing maps labels back. With short ID keys, `null` descriptions are fine when the text is already in the state.
- When comparing candidates against a description, put each candidate's own text in its option or question ("The film is X. Its plot: ...") so Jev compares rather than recalls from a title.
- Keep options distinct and concrete. Wording shared between options, or between an option and the input, pulls probability toward those options. Split an option that covers several meanings; its probability cannot tell code which meaning applied. Ask direction and magnitude as separate questions.
- When two options keep getting confused, switch their descriptions to objects with the same field names on every option, so the model compares like with like:

  ```json
  "criteria": {
    "return_policy": {"what": "Questions about the rules for returns", "not_for": "The status of a return already sent", "examples": ["Can I return sale items?"]},
    "return_status": {"what": "Where a return or its refund is now", "not_for": "General return rules", "examples": ["You got my parcel, where's my refund?"]}
  }
  ```

  The field names (`what`, `not_for`, `examples`, `focus`, ...) are not part of the API; pick short labels.
- **Option order can bias the answer** (Jev leans toward the first option in some cases). Reorder the options during testing and check the answer is stable.
- An option's value can be a subtree of a taxonomy, so the model sees what lives under a branch before committing.

## 5.3 Score

- **Describe situations, not degrees.** "Broken or degraded feature, but workaround exists" gives the model something to match. "Moderately severe" does not. Numbers-only levels (`["0", "1", "2"]`) fail: on a clear cosmetic bug they returned 0.55 at confidence 0.33, while descriptive levels returned 0.0 at confidence 1.0.
- **Each level is judged on its own.** The model does not see a level's index or its neighbors, so "worse than the previous level" means nothing. Numbers in descriptions or instructions do not help.
- **One dimension per Score.** "Punctual and smart and experienced" measures three things; confidence drops and the score means less. Split into several Scores and weight them in code (composite scoring).
- Use as many levels as you can describe distinctly, up to 10. Three is fine. Give a rare extreme that needs different handling its own top level (add "abusive or threatening" above "very angry").
- When the model keeps landing between two neighbors on inputs you think are clear, give each level an object (`{"what": ..., "examples": [...]}`) with the same keys on every level. Examples help only when they resemble your real inputs: a matching example moved one report from 1.43 @ 0.35 to 1.03 @ 0.96; an unrelated example left it at 1.43 @ 0.35.
- The score is a position, not a measurement. Use it to rank, to compare against a threshold, or round it to a level. Do not interpolate an exact magnitude between levels. Different distributions give the same score: 1.0 can be all mass on level 1 or half on 0 and half on 2.

## 5.4 Noul

- One proposition per Noul. A statement ("The customer is requesting a refund") works as well as a question; test both on your data.
- Make the yes/no boundary unambiguous ("any SQL experience" leaves no middle ground). When the boundary is subtle, add `criteria` with `true` and `false` descriptions, written as concrete situations: `false: "The package arrived on time"`, not `"not late"`. List what counts as a no when nos are diverse (newsletters, receipts, notifications). Try with and without `criteria`; keep whichever does better.
- `instructions` can be an object that carries data from code next to a fixed question:

  ```json
  "same_as_record_18": {
    "type": "noul",
    "instructions": {
      "potential_duplicate": {"name": "Jon Smyth", "location": "Leeds", "last_employer": "Acme"},
      "question": "Is the resume for the same person as `potential_duplicate`?"
    }
  }
  ```

  The question text stays fixed; code fills `potential_duplicate` from the database, one question per candidate record, all in one request.

## 5.5 Box (experimental) and images

Images and Box are "dreamer-ready": fine for prototypes, not yet production-grade, and the format and limits can change. Every request with an image or Box question needs the header `TypeSafe-Danger-Zone-Images: true`. Box needs Jev 1.14 or later.

- Name the target and the image: "the coffee mug in `photo`". The target can itself be a picture referenced in `instructions`.
- One target per Box question; ask one Box per thing. When there may be several of the same thing, describe the one you want ("the mug nearest the sink"), or add a Choice `none`/`one`/`several` and split the image into regions on `several`.
- Small target in a large image: find the region first (a Choice over image tiles), then Box on the tile, and convert edges back to full-image fractions. Low Box confidence: retry on a larger image or a crop, or pad the box before cropping. There is no recommended Box threshold yet; tune on your images.
- An image that several questions use goes in the state once and is referenced by path; an image used by one question goes in that question. Every use of a reference adds another copy of the image to the input.
- Images can define options and levels (a Choice whose options are example pictures).
- Prepare images: PNG or baseline JPEG, upright pixels (EXIF orientation is stripped, not applied), each side 280–1568 px, at most 16 MiB per file. Out-of-range images are rejected, never resized, and one bad image fails the whole request.
- Use unguessable asset references (a fresh UUID per image) because references match as plain text anywhere in the request; `cat` would match inside `category`. The SDKs generate references for you, but they do not add the images header.
- **Separate perception from judgment.** First ask what the image shows (is the row present, which year is written, is it legible), then judge from those readings in a text-only request. Asking "is this dose still valid?" straight on the image passed an unreadable date at 0.88, and you can't tell whether reading or judging failed.
- Box by name with an appearance hint ("the male northern cardinal (the bright red bird)"), not by position ("the leftmost bird"); positional boxes landed on the same bird twice. Whole-page boxes on small print are rough: zoom to ~3× around the first box, box again, and map coordinates back.
- Use independent checks to catch different errors (a page-level Noul plus a crop-level Noul caught misreads that neither caught alone).

Asset fields, multipart uploads, and image limits: `references/api.md`.

---

# 6. Composing requests

- **Bundle every question that uses the same state into one request.** Questions run in parallel and independently; the state is read and paid for once; each extra question costs only its own tokens and adds almost no latency. Batching 13 questions over the GDPR article was 12.2× cheaper and 11.8× faster than 13 calls, with identical answers. If two calls would send the same state with different questions, they should be one call. Coding agents in particular fall into one-question-per-request; don't.
- **Ask speculatively.** Include questions whose answers only matter on some paths (bug severity alongside the ticket category) and let code ignore the irrelevant ones. A speculative question needs no "if this is a bug..." clause; code handles the condition.
- **No context rot across questions.** One answer never becomes context for another, so you can add or remove questions without changing the others' answers.
- **Make a second request only for a real dependency:** code needs the first answer to fetch more data for the state, to decide what the state is made of, or to choose the next question's options (hierarchical classification, re-judging a shortlist with fuller evidence, classifying blocks that only exist after a first pass). Other good reasons: a state field needed by one question measurably misleads another; question sets need separate caching or versioning.
- **Screen with a Noul first** only when the later step costs something the first does not: a bigger state that must be fetched, a slower model (an LLM), or a person. Otherwise fan out.
- **Size limits, not count limits.** There is no cap on questions per request. A request must fit 64k tokens for state plus all questions, and 32k tokens for state plus any one question. If questions don't fit, split them across requests with the same state. The `TypeSafe-Danger-Zone-Long-Context: true` header raises both limits to 262k at the same price, but it is slower and less accurate; use it only when needed.
- Fan out independent requests concurrently with a bounded number in flight, reusing one HTTP client/connection pool. Cookbooks keep 4–12 requests in flight per shared key; more triggers 429s.
- **Loops over Choice need a cap.** A Choice returns one option, so an unknown number of items means a shrinking-options loop (remove each found item, re-ask, stop on a `nothing_else` option) with a hard maximum number of rounds.

## 6.1 Combining several answers

Pick the aggregation to match the decision, and write it down next to the thresholds:

- **min** across the parts one result depends on (date components, every argument of a function call): one weak part spoils the whole.
- **max** across independent rule checks (a battery of "is rule X broken?" Nouls): one confident red flag must not be averaged into silence.
- **mean** across rephrasings of the same judgment, or across a run of similar items (is this list numbered?).
- **weighted sum** across dimensions you want to trade off (composite scoring).
- **separate thresholds** for independent reasons to act; averaging them lets one outvote the other.
- **ordered rules, first match wins,** with security and safety checks first (injection before relevance, toxicity before category).
- **branching:** let one answer choose which other answer is the risk (if the LLM declined, the risk is "was it answerable?"; otherwise it is "is the answer unsupported?").

Store raw answers, not only decisions, so policy changes and threshold tuning replay without new requests.

---

# 7. Reading answers and setting thresholds

First decide what your code needs to know, then pick the number:

| Code needs | Read | Notes |
| - | - | - |
| The best option, no gate | Choice `choice`, Score `score` | Don't threshold at all. |
| Whether to act on a yes/no | Noul `noul` | Start with yes > 0.7, no < 0.3, and give 0.3–0.7 its own outcome. |
| Whether to act on a Choice | `probabilities[choice]` | It reads as risk: act above 0.9 = "act when the chance of the wrong option is under 10%". |
| Whether a close runner-up exists | top-to-second ratio, or the other probabilities | Choice confidence ignores how the rest is spread. |
| A decision that turns on one side of a Score boundary | Sum of the probabilities of the levels on that side | e.g. blocked = P(level 3) + P(level 4). The position can hide a two-peaked answer. |
| Whether a Score answer is settled at all | Score `confidence` | Check it before routing on `score`. |
| Comparing uncertainty across questions | `confidence` | Same 0–1 scale whatever the option count. |

Facts about `confidence`:

- It summarizes how peaked the distribution is; it is **not** the probability that the answer is correct. It is computed from `probabilities`, so you can compute any other statistic yourself.
- Choice: `(p_max − 1/n) / (1 − 1/n)`. For a fixed number of options it is a monotonic transform of the top probability, so gating on both adds nothing, and the same confidence means different top probabilities with 2 vs. 10 options. Prefer `probabilities[choice]`. (One cookbook, "classification using confidence", claims confidence separates "0.45 vs. a 0.44 runner-up" from "0.45 over scattered weight"; by this formula it cannot. Use the top-to-second ratio for that.)
- Score: `max(0, 1 − Σ pᵢ|i − m| / MAD_unif)` where m is the most likely level and `MAD_unif = (1/n) Σ |i − (n−1)/2|`. Probability on a neighboring level lowers it less than on a distant level, so a split between two adjacent levels can pass a confidence check and still sit on the wrong side of your boundary.
- Noul has no confidence; if you need one on the same scale, use `|2p − 1|`.

Threshold rules:

- **Three paths:** high → act automatically; middle → confirm, review, clarify, or gather more data; low → don't act (human, clarification, or a reasoning model).
- **Scale thresholds with the cost of being wrong**, per action. A read-only action can run at 0.7; a destructive or money-moving one needs more, and the threshold should only open a confirmation workflow, never move money by itself. Raise a Noul threshold when a false yes is expensive (paging, refunds); lower it when a missed yes is expensive (safety flags).
- Calibration holds across groups of predictions, not for any single answer.
- Start conservative, then tune by plotting probability or confidence against accuracy on your own labeled cases. Don't fit thresholds to a handful of examples.
- Thresholds are tuned against a model version. Pin the versioned model ID (`jev-1.14.0`) once thresholds are tuned; `jev-latest` moves when new releases ship.
- A failed API call is an error, never an answer. Don't let an exception fall through as "no" or as the default branch.

---

# 8. Patterns

All patterns split a decision into small questions and leave the decision to code.

**Speculative fan-out** (cost, speed): ask everything in one request; route on the classifier answer; read the dependent answers only on their path. One request carries `category` (Choice), `bug_severity` (Score, 0–2), `has_reproducible_steps`, `refund_requested` (Nouls), and `frustration` (Score, 0–2):

| `category.choice` | Further condition | Action |
| - | - | - |
| `bug_report` | `bug_severity.score > 1.5` and `has_reproducible_steps.noul > 0.6` | escalate to engineering, high severity |
| `bug_report` | otherwise | add to bug backlog |
| `billing` | `refund_requested.noul > 0.7` | route to billing, flagged as likely refund |
| `billing` | otherwise | route to billing |
| `feature_request` | | log it |
| any | `frustration.score > 1.5` | also flag for priority response |

**Screen with a Noul first** (cost, speed): one Noul over a small state; clear no → cheap handling; clear yes → fetch the big context and run the expensive request or LLM; middle → its own path (a quick human look). Chain several screens, cheapest first ("written in English" → "about our product"). Variant: run a cheap step, Noul-check its output, escalate only failures.

**Companion Noul** (reliability): Choice `product` ("which product?") + Noul `about_our_product` ("is this about one of `products` at all?") in the same request. Check the rows in order:

| `about_our_product.noul` | `product.probabilities[product.choice]` | Action |
| - | - | - |
| < 0.3 | (ignore: the Choice is noise) | general inbox |
| > 0.7 | > 0.7 | that product's team |
| otherwise | | general agent, with `product.choice` passed along as a suggestion |

A desk lamp from another shop got `desk_pro` at 0.96 from the Choice alone; the companion Noul read 0.02.

**Routing by confidence** (Score): `confidence < 0.5` → a person; otherwise route on `score` bands. Add a boundary check with summed level probabilities when the action turns on one level boundary.

**Routing by probability** (Choice): a floor for every action (`p < 0.7` → human), and a higher bar for risky actions (`approve_transfer` needs `p > 0.9` to *open the confirmation screen*; 0.7–0.9 asks the user to clarify). A hesitant "um, the transfer thing... yeah, go ahead I guess" scored 0.99 for `approve_transfer`: probability tells you the intent, not that the user checked the details, so risky actions still need confirmation.

**Composite scoring** (cost, reliability): one Score per dimension, normalize each to 0–1 by dividing by its top level index (number of levels − 1), combine with weights in code. Different weight vectors over the same answers serve different roles (senior IC vs. engineering manager). When rankings disagree with what the team would decide, change a coefficient, not a prompt. Weighted Nouls work the same way:

```
quality = 0.4 × answers_request.noul + 0.4 × citations_are_supported.noul + 0.2 × (1 − contradicts_context.noul)
```

**Learned composition:** feed the probabilities as features to a classical model (gradient boosting, logistic regression). Without labels, generate them with an ensemble of reasoning models.

**Select, don't generate:** code (regex, parser, cheap LLM) proposes candidates; a Choice picks the intended one (with a `none` option or companion Noul); code copies the exact span and normalizes it. Dates: Choice per component (day, month, year, relative offset) with a "not stated" option; code assembles and validates the date.

**Cascade:** a cheap model extracts, Jev checks each field with a battery of Nouls, and only fields that fail go to a reasoning model.

**Rank by probability:** one Noul per (query, candidate) pair, sort by `noul`. Funnel very large candidate sets: cheap Noul on short text for all, richer Noul on long text for the top slice, a Choice over the final handful. Each stage can only rank what the previous stage kept, so the first stage should favor recall.

**Progressive disclosure:** a wide Choice over short descriptions ranks a big catalog; a second request re-judges the top 3 with full descriptions, plus one independent "does this one fit?" Noul per candidate. The Choice settles *which*, the Nouls settle *whether* (all can come back low).

**Locate, then decide:** a Choice over line IDs (or tiles, or sections) says where to look, and an `exists` Noul says whether the document answers at all. Probabilities sum to 1, so some line always ranks first.

---

# 9. Known weak spots

| Weak spot | Do this instead |
| - | - |
| Literal reading | Write the exact condition; put boundary cases in criteria; split interpretation into literal questions |
| Math, counting | Compute in code; to count matches, ask one Noul per item and sum in code |
| Numeric representations (hex colors, RGB, binary, assembly) | Convert in code to a computed number or a named bucket; ask the semantic part |
| Interpolating magnitudes from Score levels | Only compare the score against thresholds |
| Comparing dates, durations, windows | Extract components with Choices; compare in code |
| Indirection, double negatives, multi-hop | Ask directly; name the relevant state by path |
| Large state with irrelevant detail | Filter first; use a relevance Noul when code can't filter |
| Adversarial content (injected instructions, text that argues for its own label) | Explicit criteria, test adversarial cases before rollout; consider a dedicated injection-detection Noul |
| Contradictory instructions and criteria | Align them; criteria extend the instruction |
| Choice option order | Reorder options in testing; check the answer is stable |
| Generation | Use a generative model; turn bounded extraction into a Choice over candidates |

---

# 10. Testing and tuning

**Probe the live API before integrating.** Ask the user first: get a budget (Jev is cheap; a small budget goes far), disclose what data will be sent (flag personal or private data), and confirm their `TYPESAFE_API_KEY` will be used. Make sure the environment has network access to `api.typesafe.ai`. The Playground (`https://console.typesafe.ai/playground`) works for no-code trials.

- Start with a few representative cases, then hard cases, then negatives (answer "no" or "nothing fits").
- **Compare wordings in one request:** send each variant as a separate question over the same state. Independence makes this a fair A/B at near-zero cost.
- Read individual answers, not only aggregates. Keep the exact payload for every case so any result can be rerun.
- Check every change on cases you did not tune on.
- Reorder Choice options and confirm the answer holds.
- **Measure self-consistency without labels.** Build borderline inputs as combinations of the facts that matter (e.g. 6 binary facts → 128 variants; sample 40 with a fixed seed; clear-cut inputs are easy for every model). Send each identical request ~15 times with a random `uid` field in the state to defeat caches (drop it in production). For each option or question, compute the mean absolute probability difference over all pairs of repeats: the chance that a random cutoff flips the decision. Score each input by its least stable output and count inputs above 0.10. Measure probability movement, not argmax flips, and look at the worst case per item, not averages. Jev 1.14 scored 0/40 unstable on both official tests where reasoning LLMs scored 2–40/40, and temperature 0 does not close that gap. Jev is not bit-deterministic, though: expect small run-to-run noise (std up to ~0.015), concentrated on genuinely ambiguous questions near 0.5.
- **With labels:** plot probability/confidence against accuracy, choose thresholds from the curve, and report coverage (fraction auto-handled) alongside accuracy. Sweep thresholds to trace cost vs. quality when escalation costs money.
- **Hold-out discipline.** Keep the cases you read while writing questions separate from the cases that judge a change, and both separate from a final test set scored once. A question tuned on the cases that then grade it will look better than it is. Require a minimum improvement sized to the noise of the judging set before keeping a change.
- When levels define the routing (rounding a Score to its nearest level), write the level descriptions before looking at the scores, so the cut points are not fitted to the data.
- Include cheap baselines: "ask Jev the whole judgment directly" is often strong, and decomposition should beat it on held-out data.
- Higher confidence after a wording change does not prove the wording is better. Check against known answers.
- Cache answers keyed on model ID + state + a canonical serialization of the questions (JSON with sorted keys), so wording changes invalidate the cache and experiments replay for free.

**When an answer looks wrong, check in this order:**

1. The payload as actually sent (log it).
2. The state, against the human test.
3. The options or candidates: is the right answer among them?
4. The scope: can the question be split into smaller judgments?
5. The wording.

If a clear question with complete state still gets a confidently wrong answer, check the jaggedness page (`https://docs.typesafe.ai/model-jaggedness.md`) and design around the weak spot.

**Yellow flags (prompt gymnastics).** A good change makes a definition clearer or improves the state. Wording written to produce a particular value breaks on new inputs and on the next model version. Watch for:

- criteria that name specific test items, or that grow a clause per failing case;
- caveats that explain away a model quirk;
- thresholds fitted to particular cases;
- tests that assert an exact probability (assert on decisions and bands instead; values change between releases);
- code that quietly overrides answers.

The structural fix is usually better state, a separate question, or moving logic into code.

---

# 11. Production checklist

- [ ] Questions, option/level descriptions, and thresholds live in one constants module, named for review.
- [ ] Every combination of answers has an outcome, including the uncertain band.
- [ ] Deterministic checks run in code before (or instead of) calling Jev.
- [ ] One request per state; speculative questions included; independent requests run concurrently.
- [ ] Choice/Box answers that may be "nothing" have a companion Noul.
- [ ] Gates use the right number (section 7); risky actions have higher thresholds and a confirmation step.
- [ ] Model pinned to a versioned ID once thresholds are tuned; the response `model` field is logged with every result.
- [ ] Exact request payload, request ID, and answers are logged so any decision can be traced and replayed (judgments and facts side by side, as in section 1).
- [ ] API errors surface as errors, with a defined fallback path; never read as "no".
- [ ] API key read from the environment on the server, never shipped to a browser or client.
- [ ] One HTTP client/connection pool reused across requests. Retries with exponential backoff on 429/529 (and 408/5xx), honoring `retry-after`; the official SDKs do this by default, a hand-written client must. Timeouts raised for large states (SDK defaults are about 10 s per attempt; cookbooks use 120–300 s for large requests).
- [ ] Any `null` confidence (Box, some edge cases) handled as "needs review", never formatted blind.
- [ ] Jev used as a filter, not a security boundary: injection-detection Nouls help, but downstream LLM prompts still treat retrieved or user content as untrusted. Screen both LLM inputs and LLM outputs.
- [ ] Debug logging off for sensitive state (SDK debug logs redact secret headers but not bodies).
- [ ] Images: the `TypeSafe-Danger-Zone-Images: true` header, prepared images, UUID references, and treated as experimental.
- [ ] Tests assert decisions and probability bands on held-out cases, not exact values.

---

# 12. Minimal request and response

```
POST https://api.typesafe.ai/v1/systemone
Authorization: Bearer $TYPESAFE_API_KEY
Content-Type: application/json
```

```json
{
  "model": "jev-1.14.0",
  "state": {
    "ticket": "Our API integration started returning 500 errors on every request about 20 minutes ago, and we can't process any customer orders until this is fixed."
  },
  "questions": {
    "department": {
      "type": "choice",
      "instructions": "Which team should handle `ticket`?",
      "criteria": {
        "billing": "Payment or subscription issues",
        "technical": "Bugs or integration problems",
        "sales": "Pricing or account questions"
      }
    },
    "frustration": {
      "type": "score",
      "instructions": "How frustrated does the customer appear in `ticket`?",
      "criteria": ["Calm, just stating facts", "Frustrated but civil", "Very angry, strong language"]
    },
    "is_urgent": {
      "type": "noul",
      "instructions": "`ticket` conveys urgency or time-sensitivity"
    },
    "repeat_contact": {
      "type": "noul",
      "instructions": "Has the customer contacted support about this before?",
      "criteria": {
        "true": "Mentions a prior attempt, ticket, or asking before",
        "false": "No sign of any previous contact"
      }
    }
  }
}
```

```json
{
  "model": "jev-1.14.0",
  "answers": {
    "department": {"type": "choice", "choice": "technical", "confidence": 1.0,
                   "probabilities": {"technical": 1.0, "billing": 0.0, "sales": 0.0}},
    "frustration": {"type": "score", "score": 0.67, "confidence": 0.5,
                    "legend": {"0": "Calm, just stating facts", "1": "Frustrated but civil", "2": "Very angry, strong language"},
                    "probabilities": {"0": 0.33, "1": 0.67, "2": 0.0}},
    "is_urgent": {"type": "noul", "noul": 0.99},
    "repeat_contact": {"type": "noul", "noul": 0.05}
  },
  "usage": {"input_tokens": 428, "output_tokens": 73}
}
```

(Illustrative values; they change between releases.) Reading it:

- Answers come back under your question IDs. Dispatch on each answer's `type`.
- For the Choice, act on `probabilities[choice]`, here `probabilities["technical"]`.
- The Score is a position from 0 to 2. Its `probabilities` and `legend` are keyed by level index; on the wire the keys are strings (`"0"`). Some SDKs convert them to integers.
- `model` is the versioned ID that answered. Log it.
- Only `input_tokens` is billed.

Images, long context, every field and limit, errors, and client behavior: `references/api.md`.

---

# 13. Reviewing existing Jev code

Flag, in rough order of impact:

1. A question that asks Jev to make the decision ("should we...", "what should happen next") or encodes business rules in criteria.
2. Arithmetic, date comparison, counting, or lookups delegated to Jev.
3. Compound questions ("and"/"or"), Score levels that mix dimensions, or Nouls used as degree measures.
4. One request per question over the same state; serial calls that could be one fan-out.
5. A Choice or Box that can legitimately have no answer, with no companion Noul (or an `other` option doing that job).
6. Gating a Choice on `confidence`, gating a Score on `score` alone where a split would matter, rounding the Noul middle band to one side.
7. One global threshold for actions with very different risk; risky actions with no confirmation step.
8. Bloated state (whole records, catalogs, or threads when the question needs one field), or state missing what a person would need.
9. Numbers-only or relative Score levels; positional Choice option names; inverted Noul phrasing.
10. Unpinned `jev-latest` with tuned thresholds; no logging of payload, model ID, and answers.
11. API failures swallowed into a default answer.
12. Questions and thresholds scattered across files.
13. Tests asserting exact probabilities.

---

# 14. Sources

- Blog: "Don't Call It a Decision Model", `https://typesafe.ai/blog/dont-call-it-a-decision-model`
- Docs index: `https://docs.typesafe.ai/llms.txt`; OpenAPI: `https://api.typesafe.ai/openapi.json`
- Key pages: `concepts/how-to-build-with-system-one`, `primitives` (+ `choice`, `score`, `noul`, `box`, `advanced`), `confidence`, `patterns/*`, `model-jaggedness`, `models`, `images`, `api/errors`, `cookbooks`
- Official TypeSafe agent skill: `https://github.com/typesafe-ai/skills/blob/main/skills/typesafe-ai/SKILL.md`
- Workflow evals referenced by the docs: `https://evals.typesafe.ai`
