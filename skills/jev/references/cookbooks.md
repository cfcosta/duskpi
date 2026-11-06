# Jev cookbooks and demos, distilled

Every official TypeSafe cookbook and demo (docs as of Jev 1.14, November 2026), reduced to the parts worth copying: the decomposition, the request shape, the thresholds, the results, and the lessons. Full pages: `https://docs.typesafe.ai/cookbooks/<name>.md` and `https://docs.typesafe.ai/demos/<name>.md`.

The cookbooks pin `jev-1.14.0`, cache every call (keyed on the state plus a sorted-key JSON serialization of the questions, so editing a question invalidates the cache), and replay saved answers so they run without a key. Their code is written against one official SDK, but every recipe is just requests and rules; the field names below are the HTTP API's. Every threshold below is the cookbook's starting point for its data, not a default for yours.

## Choosing a starting point

| Your problem | Start from |
| - | - |
| Natural-language command → call a typed function | Function calling |
| Pick an agent skill/tool from a big catalog | Skill suggestion |
| Screen LLM inputs and outputs | Guardrails for LLMs |
| Check citations, or an LLM answer against its sources | Double-checking citations; Verifying LLM answers |
| Filter retrieved passages before generation | Classifying RAG passages |
| Remember facts across requests | Simple memory system |
| Deep taxonomy | Hierarchical classification |
| Flat taxonomy, fall back to coarser label when unsure | Classification using confidence |
| Real-time chat moderation | Twitch chat filter |
| Cheap LLM extraction with escalation | SDE cascade |
| Dates in documents | Date extraction |
| Emails, phones, amounts, any regex-findable value | Pre-parsed value extraction |
| Rebuild structure from plain text | Structure recovery |
| Order → structured cart (unknown item count) | Shopping cart |
| Match records across sources | Knowledge graph entity alignment |
| Scanned forms, photos | Reading a scanned vaccination record; OCR confidence and bounding boxes |
| Video / camera frames | Feeder-cam visit log |
| Re-rank search results | Re-ranking |
| Find one item among thousands | Infinite cardinality choice |
| Find the line in a long document | Line-by-line search |
| Live checklist over a transcript | Intelliprompter |
| Evaluate consistency without labels | Self-consistency: choices / nouls |
| Batching economics | Parallel questions |
| Text → features for an ML model | Autoresearch feature discovery |
| Search inside a spreadsheet, catalog audit | Airbnb listing search; Content audit |

---

## Agents and verification

### Function calling

- **Decomposition:** one request per command with every question for every function (54 here): a `__tool__` Choice over the 10 function descriptions, plus speculative argument questions for all functions; code reads only the chosen function's arguments. Argument questions are derived from type hints: `Literal` → Choice keyed by the literal values; `list[Literal]` → one Noul per member; `bool` → Noul; `int`, free text, dates → no question (default stands). An optional `stated` Noul per argument asks whether the command mentions it at all; if not, the argument is omitted.
- **Combining:** each binary decision's probability is the Noul value when it reads yes (≥ 0.5) and 1 minus it when it reads no; an argument's probability is the product of its decisions; the call's confidence is the **min** over all decisions ("one wrong argument is enough to spoil it"), not the product, which falls as functions take more arguments.
- **Lessons:** option keys are the exact strings the function takes, so nothing maps back. Write questions about the idea, not the words a user might use ("is amd tracking nvidia lately" reaches `rolling_correlation` with no keyword overlap). Don't name a question after its parameter ("Which resolution?" gives the model nothing to match). When two arguments share a domain, spell out their roles ("the one being measured, named first" vs. "the yardstick"). An LLM can write the question spec from function signatures.
- **Result:** 14/14 commands correct; call confidence 0.53–1.00.

### Skill suggestion

- **Decomposition:** two requests, progressive disclosure. Request 1, state `{"request", "recent_context"}`: a Choice over all 194 skill names (60-char descriptions), whose probabilities are the ranking; three differently worded "is an action wanted?" Nouls, averaged (one inverted); a `named` Noul ("does the request name a specific tool, format, template, or method?") with its own threshold. Request 2, top 3 only: a Choice with full descriptions plus the first 700 chars of each skill body, and one independent `fits::<name>` Noul per candidate. Suggest the winner only if the highest `fits` Noul is ≥ 0.30.
- **Thresholds:** action mean ≥ 0.30, named ≥ 0.50, fits ≥ 0.30.
- **Lessons:** ask whether an action is wanted, not about subject matter. Give independent reasons separate thresholds instead of averaging them in. "Choice settles *which*, the Nouls settle *whether*": for "Post to Mastodon" (no skill covers it) the Choice still ranked the nearest skill first and only the `fits` gate caught it. Short descriptions confused two lookalike skills; full text separated them. One Choice handles 194 options comfortably; at several times that, chunk, rank each chunk, rerank the winners. In the agent prompt, phrase the suggestion as ignorable and keep it after the cached prefix.
- **Result:** on 452 requests with a small agent model, wrong loads 15.7% → 7.9%, needless loads 14.0% → 5.2%; Jev latency 0.07–0.25 s.

### Guardrails for LLMs

- **Decomposition:** one request per message, five hazard Nouls (`jailbreak`, `drop_safeguards`, `harmful_request`, `medical_advice`, `self_harm`) plus one Score for severity, each Noul with explicit `true`/`false` criteria. A second battery screens outputs (jailbreak questions replaced by `broke_policy`, and the rest ask whether the reply *gave* the thing).
- **Routing:** each hazard maps to its own action (medical → review, self-harm → support path, others → block); action precedence `support > block > review > pass`; severity ≥ 2.0 upgrades review to block. Policies are named threshold sets: strict `review 0.35 / action 0.70`, permissive `0.70 / 0.85`.
- **Lessons:** "out of bounds" is not one question; one hazard can fire alone (a tone jailbreak scored jailbreak 0.17 but drop_safeguards 0.81). Screen both inputs and outputs. Pick thresholds from labeled examples of your own traffic.

### Double-checking citations

- **Decomposition:** deterministic first: normalize whitespace and quotes, substring-match the quote in the source; missing → `fabricated` with no model call. Otherwise one Choice with state `{"claim", "section"}` (the matched section, not the whole 58k-char document): `supports` / `contradicts` / `says_nothing`.
- **Threshold:** auto-accept when confidence ≥ 0.8 ("start high for more human review as you build trust").
- **Lessons:** a real third option (`says_nothing`) keeps the Choice from being forced into a binary. A verbatim quote can still fail to support the claim, which is why the model step follows the string match. Production needs fuzzy matching.
- **Result:** 8/8 handled; accurate citations verified at ≥ 0.98; one unsupported claim sent to review at 0.56.

### Verifying LLM answers against their source

- **Decomposition:** one request, three Nouls with both criteria sides: `answerable` (do the paragraphs state every needed fact?), `declines` (does the answer refuse?), `supported` (following the paragraphs step by step, do you arrive at the answer?). State `{"request", "response_requirement", "paragraphs", "candidate_response"}`.
- **Combining:** branch on one Noul to pick the risk: if `declines` ≥ 0.5, risk = `answerable`; otherwise risk = 1 − `supported`. Review when risk ≥ 0.2.
- **Result:** on 1,000 multi-hop questions (88.5% answered right by the LLM), threshold 0.2 auto-passes 73% of answers at 95.7% accuracy and holds back 84 of 115 wrong ones. Right answers cluster near zero risk while wrong ones spread, so the threshold must be low. Most remaining misses answered a related question instead of the one asked.
- **Lessons:** they chose the three questions using the first 100 items, so those 100 are not a fair test: select questions and thresholds on one split, report on another. Labels came from a second Jev Noul comparing the answer with a reference, with disagreements sent to a reasoning model.

### Classifying RAG passages

- **Decomposition:** one request per (query, passage) pair, the same four instruction-only Nouls every time: `is_relevant`, `contains_answer_evidence`, `contradicts_query_premise`, `contains_prompt_injection`. None asks "include this?"; that is code.
- **Routing:** ordered rules, first match wins: injection > 0.70 → exclude; contradicts > 0.70 → `conflicting_evidence` block; relevant < 0.45 → exclude; evidence > 0.55 → include; else exclude. Injection first ("a security decision, not an evidence one"); contradiction before evidence because premise-denying passages also contain usable facts.
- **Lessons:** the injection Noul is a filter, not a security boundary; the generator prompt must still treat passages as untrusted. Keep conflicting passages in their own prompt block. Re-routing stored answers costs no API calls. Cosine similarity was a poor proxy: the planted injection ranked first by similarity and was caught at 0.98.

### Simple memory system

- **Decomposition:** request 1 routes a ticket (Choice over 7 teams including `none_suitable`) with saved memories added to the state under `earlier_tickets_from_this_customer`. Request 2 asks a `remember` Noul over the pre-memory state plus Jev's routing answer: does the thread state a lasting fact that should change future, unrelated tickets? Save when ≥ 0.5.
- **Lessons:** tell the remember question not to count anything in `jev_answered`, or inferences drawn from old memories get re-saved as new facts. Store the pre-memory state so memories don't nest. `none_suitable` absorbs low-context tickets. If the remember question doesn't need the routing answer, fold it into request 1. Memory only grows here: add limits, relevance checks, or expiry in production.
- **Result:** 3/6 tickets routed correctly without memory, 6/6 with it; remember scored 0.96–0.98 for lasting facts, 0.02–0.03 for transient ones.

---

## Classification and extraction

### Hierarchical classification

- **Decomposition:** one Choice per tree node over its direct children; the state (the document) never changes, only the question. Opaque option keys (`c0..cN`) with the full label as the description. Single-child nodes skip the API (probability 1.0).
- **Search:** beam width 3; path score = geometric mean of edge probabilities (computed as the exponential of the mean log probability for deep trees, to avoid floating-point underflow) so deep leaves aren't penalized; the K frontier questions per level run in parallel, so beam needs as many rounds as greedy.
- **Lessons:** greedy can't recover from an early mistake; beam can. One question per node makes errors observable per node and hierarchy edits testable. Expand DAGs into one path per tree position.

### Classification using confidence

- **Decomposition:** one Choice with 75 options (SEC major groups) over only the "Business" section of each 10-K. Option descriptions built from the group's member industries (`"{umbrella} — includes: {up to 8 members}"`) because many groups have no good title.
- **Routing:** confidence ≥ 0.9 → report the group; below → map the group to its parent division in code (a lookup, not a second call).
- **Result:** 28/60 confident, 26 of those right (93%); the rest right 50% at group level and 78% at division level; 51/60 useful answers vs. 42/60 forcing a group.
- **Caveat:** the page says it reads `confidence` instead of the winner's probability because it separates "0.45 vs. 0.44 runner-up" from "0.45 over scattered weight". By the Confidence page's formula, Choice confidence depends only on the top probability for a fixed number of options, so it cannot separate those. Use the top-to-second ratio for that distinction. "A Choice works reliably up to roughly 240 options" (hard limit 255).

### Twitch chat filter

- **Decomposition:** one request per message: a 5-way category Choice (`question`, `hype`, `conversation`, `backseat`, `spam`), a `toxic` Noul with criteria, a `spoiler` Noul. State `{"stream": {"title", "game"}, "message": {"user", "text"}}`, because spoiler and backseating depend on the game.
- **Routing:** `decide()` is separate from `classify()`: toxic ≥ 0.7 → hide; category rule (hide/show/highlight); spoiler ≥ 0.7 → blur. Order matters. Swapping rule sets changed 14 of 29 outcomes with zero new requests.
- **Lessons:** option descriptions carry explicit exclusions ("not gameplay instructions phrased as a question") and there is a fallback category. Noul `criteria` shape the reading ("light banter with no target" kept a teasing message at toxic 0.28). The sample's scores were cleanly separated (≥ 0.95 or ≤ 0.38); real traffic will land in the gap, so calibrate on your own channel. Median ~0.1 s per request; run 8 workers; keep message IDs to update the right message asynchronously.

### SDE cascade (structured data extraction)

- **Decomposition:** a cheap LLM extracts JSON; Jev runs six rule-check Nouls in one call, each framed so `true` means the rule is broken (`"criteria": {"true": "the answer breaks this rule", "false": "the answer follows this rule"}`), over state `{"task", "answer"}`; escalate to a reasoning model if the JSON fails to parse or any rule fires.
- **Threshold:** the task flag is the **max** of the checks ("so one confident red flag is not averaged into silence"); fire at 0.7. A 201-point sweep traced the cost/quality frontier.
- **Lessons:** never ask one "is this answer right?" question; a fired flag should name the broken rule. The verifier must cost far less than the strong model. Do not force structured outputs on the cheap model: forced-valid JSON hides broken answers; let parse failures escalate.
- **Result:** cheap model alone 92.6% at $0.156/1k tasks; strong model alone 98.1% at $1.890; cascade 96.5% at $0.490 (13% escalated) or 98.1% at $1.307. Jev's checks cost $0.04 per 1k tasks.

### Date extraction

- **Decomposition:** seven Choices in one call, with the date's role ("the deadline to return the form") in every instruction: `mode` (absolute/relative/none), `month`, `day` (1–31), `year` (1900–2050 plus `out_of_range` and `none`), `day_anchor`, `weekday`, `week_offset`. Every part has a `none` escape. Code reads only the parts `mode` calls for and does all calendar math from a pinned `TODAY`.
- **Routing:** confidence = **min** over the parts actually used; review below 0.60; `mode == none`, impossible dates (Feb 30, rejected by the date library), and `out_of_range` always go to review. Missing year inferred in code.
- **Lessons:** "The model reads what the text says and never does the calendar math." Conventions like what "next Thursday" means live in code. A long year list can be shortened by offering only the year-like numbers code finds in the text.

### Pre-parsed value extraction

- **Decomposition:** a recall-tuned regex finds candidate spans; a Choice whose **option keys are the spans themselves** (plus `none`) picks the one for the requested role; small Choices read attributes (currency, country) and a Noul reads credit vs. charge; code copies the picked span verbatim and normalizes it (phone numbers to E.164, amounts to exact decimals).
- **Lessons:** Jev "cannot invent a value or transpose a digit" this way. Ask different role questions over the same candidates ("where should the receipt go?" vs. "who sent it?"). Ask a Noul for locale facts ("does this document use a comma as the decimal point?"). More than 255 candidates: narrow to a section first, then the span. Candidate generation is the hard part; names need a roster, NER, or an LLM proposer.

### Structure recovery (plain text → Markdown)

- **Decomposition:** two requests, because pass 2 classifies blocks that only exist after pass 1. Lines are tagged `L014| `; blank lines and explicit markers are handled in code. Pass 1: one Noul per adjacent line pair, quoting both lines: "Does line L015 pick up mid-sentence, continuing a sentence left unfinished at the end of line L014?" Pass 2: a 6-way type Choice per block plus speculative companions (heading level only for blocks ≤ 90 chars, step-order Noul, callout kind): 62 questions in one request.
- **Thresholds:** the merge cutoff depends on a fact code reads (0.2 after a dangling line, 0.5 after terminal punctuation); numbered vs. bulleted list from the **mean** step probability over the run (0.5); review blocks with type confidence < 0.7.
- **Lesson:** "same paragraph?" (topic) collapsed lists; "mid-sentence?" (the text itself) fixed them, 13 vs. 17 blocks. When a judgment feeds a threshold, name the narrowest fact that decides it.

### Shopping cart

- **Decomposition:** a shrinking-options loop: each request is one Choice over the menu items not yet found plus `nothing_else`, with the instruction listing items already accounted for and "if more than one remains, choose the one mentioned first"; stop on `nothing_else`, an empty menu, or a hard cap of 6 rounds. Then one request per found item with a Choice per field, each with an `unspecified` option.
- **Lessons:** a Choice returns one option, so an unknown number of items needs a loop, and loops need a cap. Item descriptions carry customer synonyms ("flat white or a milky coffee"). Because found items leave the list, quantities need their own field. Handle a `null` confidence explicitly.

### Knowledge graph entity alignment

- **Decomposition:** one request per candidate pair, state `{"entity_a", "entity_b"}` with raw catalog text: a 3-level Score decides (different / closely related, maybe the same / same), and three Nouls (same title, artist, label) are diagnostics for curators only. Year comparison is in code.
- **Routing:** round the score to the nearest level (cut points 0.5 and 1.5). The level descriptions were written before looking at scores; the middle level's wording decides who reaches a curator.
- **Lessons:** Score fits an ordered outcome with a described uncertain middle better than a thresholded Noul or an unordered Choice. Write domain equality rules into the instructions (romanization, regional label names = same; imprint vs. parent company = different). Clear non-matches cluster at 0.1–0.4 because the middle level takes some mass; only the cut side matters. Ground truth was noisy; agreement is not accuracy.
- **Result:** of 450 pairs, 57 auto-merged (48 known matches), 79 to curators, 314 left unlinked (3 known matches).

---

## Images (experimental; header `TypeSafe-Danger-Zone-Images: true`)

### Reading a scanned vaccination record

- **Decomposition:** request 1 (image): per vaccine in the expected list, a presence Noul (exact name) and a Box ("the whole X row"), plus one Noul "is any vaccine recorded that is not in this list?" (33 questions). Request 2 (image): per found row, a year Choice (`y2016..y2026`, `other`, `unreadable`) and a legibility Noul. Request 3 (text only): an in-date Noul per row over state built from the readings. Code sorts rows by `box.top` and does the date math.
- **Thresholds:** present ≥ 0.5; read accepted when `min(present, year_confidence) ≥ 0.90`; legibility ≥ 0.50 (its own cutoff, since that Noul scores clear dates at only 0.86–0.96); crop padding 0.02, widened to 0.05 when Box confidence < 0.6.
- **Lessons:** Jev doesn't extract a list; ask about each thing you expect, include lookalikes to test exact matching, and add a catch-all Noul for unlisted items. A Box always returns a box; use it only when the Noul says the item is there. Separate perception from judgment: asking "is this dose in date?" straight on the image passed an unreadable date at 0.88, and you can't tell whether reading or judging failed. Put format rules in the question ("dates are day/month/year, so the year is the last part").

### OCR confidence and bounding boxes

- **Decomposition:** checks an OCR extractor's values. Request 1 (whole photo): per field, a Box (with the extracted value as a hint) and a page-check Noul ("Is "value" the invoice number on `page`?" plus an equivalence rule: ignore spacing, punctuation, currency symbols, case). Request 2: crop ~3× around each box (min 30% × 15% of the page), upscale, Box again. Request 3: crop to the padded tight box, crop-check Noul ("Does this cropped image clearly show ... Answer no if it is cut off, unreadable or different").
- **Threshold:** review if either check < 0.25.
- **Lessons:** neither check alone caught all three misreads; together they did. Whole-page boxes on small print are rough: zoom and box again. Upscale small crops; pad crops still under 280 px onto a white canvas and keep the offset to map boxes back.

### Feeder-cam visit log

- **Decomposition:** one request per frame: `bird_present` Noul, `how_many` Choice (none/one/several), a Box on the most prominent bird, left/right species Choices (10 species + `other`). A second request only when needed: one Box per named species with an appearance hint ("the male northern cardinal (the bright red bird)"). Visits are built in code (dedupe by IoU 0.6, gap and minimum-frame rules) from saved answers, so tuning reruns no requests.
- **Lessons:** positional Boxes ("leftmost") both landed on the same bird; boxing by species name with an appearance hint fixed it. On empty frames the Box still returns a box (confidence 0.14) and species Choices still name an option. Describe what this camera shows, not field-guide text. Same-species flocks need a detector to find birds and Jev to name each crop.
- **Result:** presence 101/101 frames, species 132/133 sightings; ~0.3 s per request.

---

## Search, ranking, and large candidate sets

### Re-ranking

- **Decomposition:** BM25 shortlists 30 passages per query; one Noul per (query, candidate) pair, state `{"query_excerpt", "candidate_passage"}`; sort by `noul`. Criteria separate "states the specific proposition" from "merely on a similar topic".
- **Result:** top-1 5% → 30%, top-10 38% → 65%.
- **Lessons:** the continuous probability ranks where a yes/no can't. Re-ranking can't recover what the first stage missed. In production, ask several questions about each pair in the same call.

### Infinite cardinality choice

- **Decomposition:** a funnel over 5,000 films. Round 1: one Noul per film with a ~100-word plot, 300 per call, all calls concurrent. Round 2: the top 80 with ~600-word plots, 40 per call. Round 3: one Choice over the top 20 with long plots as descriptions.
- **Routing:** Choice confidence ≥ 0.8 → show one film (right 48/48); below → show the top 3.
- **Lessons:** put the candidate's text in the question so Jev compares instead of recalling from the title. Short-text filters miss late details; re-read survivors with longer text. Nouls judge each item alone (two can both score high; the top five can sum past 1), so they rank but can't say "sure vs. unsure"; a Choice weighs options against each other, so its top probability can. A Choice fits ~40 options when each is a long plot (64k context). Retries are "not optional" at large request sizes; use ~5 retries with backoff up to 30 s and timeouts of several minutes.
- **Result:** right film first 78% vs. 33% with an embedding shortlist.

### Line-by-line search

- **Decomposition:** tag each line `L052| ...`; the tagged document is the state. One request: a Choice whose options are the line IDs with `null` descriptions and the query in `instructions`, plus an `exists` Noul ("Does any line of the document address or answer: ...?").
- **Routing:** `exists` ≥ 0.7 answered, ≤ 0.35 not in the document, between = partially addressed.
- **Lessons:** Choice probabilities sum to 1, so some line always ranks first; "the ranking tells you where to look; the `exists` score tells you whether the result answers the question." Over 255 lines, pick a window first, then lines inside it.

### Intelliprompter

- **Decomposition:** state `{"transcript": <cumulative transcript>}`; one 5-level Score per *unchecked* talking point, every 0.5 s when the transcript changed and no request is in flight. Ticked points leave later requests (a one-way ratchet in code).
- **Threshold:** covered at 2.5 on a 1–5 display scale (SDK returns 0–4; the demo adds 1).
- **Lessons:** "Jev returns scores; it does not keep checklist state." Keep each point's short display text separate from the fuller description sent to Jev.

### Airbnb listing search (Google Sheets demo)

- **Decomposition:** 1,000 listings, under the 30 s Sheets limit: 10 parallel requests, each with 100 listings as tagged state lines and one Choice over the IDs (`null` descriptions); top 5 per group → one request with the 50 survivors and one Score per listing; score normalized to a mark out of 10. 11 requests in about 1 s, cached 6 h.

### Smart home assistant (demo)

- Speculative fan-out: every Choice (category, room, device, action) in one call; code ignores the irrelevant answers. A Noul detects compound requests; an LLM splits them into atomic commands; chat and general questions go to an LLM.

### Content audit (demo)

- One request per page (279 Django docs pages), 45 questions each (quality Scores, importance, classification Choices, 21 problem Nouls, quick-win Nouls), 12 requests in parallel. Median latency 144 ms with 1 question vs. 151 ms with 45; whole audit under 5 s for $0.10, with question text about 40% of the cost. Nouls end with "Answer yes only when the page content gives concrete evidence"; the state's `site` context warns against flagging APIs as wrong just because they are unrecognized (a knowledge-cutoff guard). Priority = `(1 − quality) × importance`.

---

## Evaluation and economics

### Parallel questions

- 13 questions (8 Noul, 2 Choice, 3 Score) over the 53,777-char GDPR article: one batched request $0.000497 in 0.24 s vs. 13 single requests $0.006090 in 2.81 s, so 12.2× cheaper and 11.8× faster. Means agree within 0.004.
- Each question is scored on its own, so batching costs no accuracy. The state dominates cost; N single calls pay for it N times. Concurrency shrinks the latency gap but not the cost gap.
- Jev is not bit-deterministic: 6 of 13 answers showed run-to-run noise (std up to 0.015).

### Self-consistency: choices / nouls

- **Method (no labels needed):** build borderline inputs as factorial combinations of the facts that matter (6 binary facts → 128 variants, sample 40 with a fixed seed); send each identical request 15 times with a random `uid` in the state to defeat caches; for each option or question, compute the mean absolute probability difference over all pairs of repeats (the chance a uniformly random cutoff gives a different decision); score each item by its **least stable** output; count items above 1 in 10.
- **Results:** Jev 1.14 had 0/40 unstable posts and 0/40 unstable claims; the best reasoning LLMs had 2/40, the worst 36–40/40. Temperature 0 narrowed but did not close the gap (20–21/40). Averages hid the gap on Nouls; worst-case-per-item exposed it. Jev's residual wobble sits on genuinely ambiguous questions near 0.5. ~100 ms and ~$0.00005–0.00007 per 8–14-question call.
- **Lessons:** measure probability movement, not argmax flips. Count parse failures; don't patch them. Leave the cache-busting `uid` out of production.

### Autoresearch feature discovery

- **Loop:** an LLM proposes up to 18 add/revise/drop question changes; Jev answers every new question for every row (one request per row per try, all new questions in it); CatBoost trains on the answers; keep a change only if out-of-fold error on check rows drops by at least 0.003 ("a smaller gain is within the noise of 400 rows").
- **Encoding:** Score → probability-weighted mean level plus spread (sd); Noul → P(true). Drop flat columns (std < 0.05). A shared 5-level intensity rubric for Scores and fixed presence criteria for Nouls.
- **Splits:** 800 rows the proposer reads; 400 check rows it never sees; 800 test rows scored once.
- **Result:** RMSE 0.456 with 20 discovered questions vs. 0.492 asking Jev for the rating directly (one 10-band Score plus a fitted line) vs. 0.703 for CatBoost on raw text. The direct ask is a strong, cheap baseline; fit a mapping from Score levels to your target scale.
- **Lessons:** the judge must be data the proposer never read. Check adds too (a narrow question can add more noise than signal). Don't pre-screen questions on a small sample. Cost scales with rows, not questions. Feed rejected changes back to the proposer. Run about 4 concurrent requests per shared key; 8 hit rate limits.

---

## Cross-cutting lessons

1. **Judgments from Jev, decisions in code.** No cookbook asks Jev "should I include/block/pay this?". Thresholds live in one named constant or policy dict, so a policy change edits a number and replays stored answers for free.
2. **One request per state, many questions in it.** Speculative questions are nearly free; a second request needs a real dependency (shortlist → rerank, pass-1 blocks → pass-2 types, routing answer → remember).
3. **Every Choice and Box needs a way out:** a companion Noul, an `exists` Noul, independent per-candidate `fits` Nouls, or a meaningful escape option (`none`, `unspecified`, `unreadable`, `says_nothing`, `nothing_else`).
4. **Choice is relative, Noul is absolute.** Choice picks and ranks among candidates and its top probability says how far ahead the leader is; Nouls filter, check existence, and rank by absolute fit.
5. **Funnels for big candidate sets:** cheap and broad, then rich and narrow, then a Choice. The last stage can only rank what earlier stages kept.
6. **Select, don't generate:** code or an LLM proposes candidates; Jev picks; code copies and normalizes.
7. **Aggregate on purpose:** min across the parts of one answer (dates, function arguments), max across rule checks (cascade), mean across rephrasings or a run of items, separate thresholds for independent reasons.
8. **Separate perception from judgment** (read the image, then judge from the reading), and **use independent signals** to catch different errors (page check + crop check; Choice + legibility Noul).
9. **Short IDs as option keys, text in the state,** or the candidate's own text in its question so Jev compares rather than recalls.
10. **Wording decides outcomes:** the narrowest observable fact, explicit inclusions and exclusions, domain equality rules, both Noul criteria sides, and checks framed so `true` means "broken".
11. **Operations:** pin `jev-1.14.0`; cache on state plus serialized questions; keep worker pools small (4–12) under shared-key rate limits; retries and 120–300 s timeouts for large requests; cap loops; treat a `null` confidence as needing review; tune thresholds on held-out labeled data.
