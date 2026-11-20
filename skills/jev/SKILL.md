---
name: jev
description: Build software with Jev, the TypeSafe System One model. Jev answers typed questions (Choice, Score, Noul, Box) about a state and gives calibrated probabilities. Use this skill when code in any language calls the TypeSafe API (`api.typesafe.ai/v1/systemone`, directly or through a TypeSafe SDK). Also use it to write Jev questions, state, or thresholds, to replace an LLM prompt-and-parse step or a fragile heuristic, or to find where Jev can help in a codebase.
---

# jev

Jev is the TypeSafe System One model. You send a state and typed questions. Jev sends typed answers with calibrated probabilities. Jev does not write text or code, explain, or call tools. It is not a chat model and cannot operate a coding agent.

**Jev gives judgments. Code makes decisions.**

This skill shows requests as HTTP JSON and logic as decision tables. Write them in the language of the project. If the project uses a TypeSafe SDK, read its installed types for the exact names. Do not make up fields.

The live docs are the source of truth: `https://docs.typesafe.ai/llms.txt`. Add `.md` to a docs path to get Markdown. If the docs and this skill do not agree, use the docs and tell the user.

- `references/api.md`: schema, limits, headers, errors, models, images, and client behavior.
- `references/cookbooks.md`: the official recipes. Read the nearest recipe before you design a workflow.

## 1. When to use Jev

Use Jev when code needs a fast, structured judgment about text, JSON records, or images:

- Send an input to one of a fixed set of destinations.
- Find if a property is present (spam signal, refund request, PII, injected instruction).
- Put an input on a described scale (severity, frustration, relevance).
- Examine the output of a different system (an LLM answer against its sources, an extracted field against its document).
- Select the correct candidate from a list that code made.
- Make numeric features for a classical ML model.
- Find an object in an image (Box, experimental).

Signs that a codebase can use Jev: code asks an LLM for JSON, then parses and retries. Regexes or keyword lists try to find meaning. The same input gets different LLM answers. A person reads each item to decide what to do.

| Do not use Jev for | Use |
| - | - |
| Text generation | An LLM |
| Arithmetic, counts, dates, number comparison, lookups, policy rules | Code |
| Multi-step reasoning ("analyze and decide") | Atomic questions, or a reasoning model |
| Free-form extraction | Code or an LLM gives candidates. A Choice selects one. |
| A decision that code can make reliably | Code. Tell the user that Jev is not necessary. |

A request takes approximately 100–150 ms. The price is $0.042 for each million input tokens. Output tokens are free. All questions in a request run in parallel against one read of the state.

## 2. Divide each decision into judgments and facts

A decision is a graph. Code computes the facts (lookups, arithmetic, status flags). Jev gives the judgments (questions that only a person with knowledge can answer). Rules in code combine the two into an action.

Do not put the full decision in one question. A Choice with business rules in its criteria ("refund if eligible and $25 or less, unless fraud") is at the incorrect layer. Each new edge case adds more words to the criteria. This is "prompt gymnastics". When the answer is incorrect, you cannot find which judgment or rule caused the error.

Write each decision as a truth table. Jev supplies the inputs. Code holds the map from inputs to actions. This gives three benefits:

- Clarity: the table shows the input combinations that have no outcome.
- Observability: log each judgment and each fact. An incorrect action then points to one question or one rule.
- Extension: a new action adds one rule and its new questions. Jev answers each question in isolation, so the tested answers do not change.

If a question is "Should we escalate?" or "What is the next step?", divide it into the judgments that the decision uses.

## 3. Workflow

1. Write the action that the system does. Write the rule table and its inputs.
2. Put arithmetic, dates, amounts, list membership, and policy in code.
3. Make a question only for an input that needs language or image understanding.
4. Give each combination of answers an outcome. Include "not sure".
5. Design the state (section 5).
6. Write one atomic question for each judgment (sections 4 and 6).
7. Keep all questions, criteria, and thresholds in one module. Expect to edit the wording with the user.
8. Put all questions about one state in one request (section 7).
9. Write the routing (section 8).
10. Test with the live API (section 11). Ask the user first.
11. Do the production checklist (section 12).

For an open request ("where can we use Jev?"), look for the signs in section 1. Propose two or three uses with the nearest recipe for each. Recommend one.

To review Jev code, use sections 2, 4–8, and 12 as the checklist.

## 4. Question types

| Type | Use for | Request | Answer |
| - | - | - | - |
| Choice | One option from an unordered set | `instructions`, `criteria`: option name → description or `null` | `choice`, `probabilities` (sum is 1), `confidence` |
| Score | A position on a described scale | `instructions`, `criteria`: 2–10 levels, low to high | `score` (0 to n−1), `probabilities`, `legend`, `confidence` |
| Noul | A yes/no proposition | `instructions`, optional `criteria` `{true, false}` | `noul` = P(yes) |
| Box | The location of one object in an image | `instructions` only | `box` `{top, bottom, left, right}` as fractions, `confidence` |

- Select the type that maps directly to code: a Choice to a switch, a Score to a threshold or a weight, a Noul to an `if`.
- A Choice always selects an option, also when no option is correct. If the list can miss an input, add a companion Noul ("Does `message` name one of `products`?"). Use the Choice only when the Noul is a clear yes. This works better than an `other` option, which takes probability from the real options. Use a `none` option only when "not stated" is a frequent, real answer.
- A Box always gives a box. Add a Noul that asks if the object is in the image.
- If more than one option can be correct, use one Noul for each option.
- A Noul is not a degree. A Noul of 0.5 means "not sure", not "medium". For a degree, use a Score.
- A Choice is relative: its probabilities add to 1, so one option is always first. Nouls are absolute: all can be high, or all can be low.

## 5. State

The state is the data that an expert reads before a judgment. It is a string, a JSON object, or an array, and it can include images. All questions in a request see the same state.

- Do the human test: can a smart person answer quickly from only this state and this question? If not, change the state before you change the question.
- Use an object with descriptive keys. Point to a field with a backticked dot-and-index path: ``Does `ticket.messages[0].text` ask for a refund?``
- Send only the data that the questions use. Unrelated data makes answers less correct. Filter in code first. Remove empty fields, because the model can read an empty list as a signal.
- Give the data that a person uses: the sender of each message, the full thread, names instead of IDs, one item instead of the full catalog.
- Write the facts that code knows: `"refund_eligible": false`, `"days_overdue": 42`.
- Supply domain facts: codenames, policy text, product lists. Jev has no customer-specific training. The request is the only place for this data.
- Put the two sides of a comparison in one state: query and passage, claim and cited section, task and extracted answer.
- Do deterministic checks before Jev: exact string matches, schema validation.
- Do not send data that no person can judge, for example an unreadable crop.
- Send IDs and large exact numbers as strings.

## 6. Questions

### 6.1 All types

- Ask for one quick judgment. "Does this message show urgency?" is good. "Analyze this message and decide the next action" is bad.
- Ask about a concrete thing that you can see. Ask "Is a SQL query made by string concatenation?", not "Is there SQL injection risk?". Instead of "Is this fraud?", ask about each sign of fraud.
- Write one condition in each question. Divide "and" or "or" into two questions. Write one question for each rule.
- Write the full question in `instructions`. Jev does not see question IDs. Jev sees option names and descriptions.
- Jev reads literally. It answers the words, not the intent. If you must explain what a question means, add the explanation to the question. Or divide it into literal questions.
- Write plainly. A question is not an LLM prompt. Do not write preambles, output formats, or "think step by step". Put option descriptions in `criteria`.
- Write the question so that a high value means yes. Do not use double negatives. Make `instructions` and `criteria` agree.
- Ask directly. Each indirect step (a property of a property, a lookup in a list) decreases accuracy.
- Ask about the narrowest fact that decides the answer. "Does this line continue a sentence from the previous line?" worked. "Are these two lines in the same paragraph?" failed.
- Write about the meaning, not about the words that a user can use.
- Put domain rules in the question: equivalence rules ("ignore case and punctuation"), format rules ("dates are day/month/year"), and evidence rules ("answer yes only if the text gives concrete evidence").
- To examine the output of a different system, use one Noul for each rule. Write each Noul so that yes means "this rule is broken".
- When two outcomes are frequently confused, write the confusing case in the criteria: "A question about the refund policy is not a refund request."
- For the same question about many items, write one question for each item (`item_0`, `item_1`, ...). Do not give the model an ID to find in a shared list.
- Jev answers each question alone. A question does not see the other questions or their answers.

### 6.2 Choice

- Use option names that describe the content (`refund_request`). Names like `A` or `option_1` give no data and can bias the answer. Use a `null` description when the name is clear.
- Give the full list. The maximum is 255 options. Approximately 240 options are reliable. Only approximately 40 options fit when each option has a long text. For larger sets, use a funnel (section 10).
- Option names can be the exact values that code uses: function argument values, regex spans, line IDs.
- To compare candidates with a description, put the text of each candidate in its option. Then Jev compares texts and does not use its memory of a title.
- Keep options different and concrete. Shared words pull probability toward an option. Divide an option that has two meanings.
- If two options are frequently confused, use an object with the same keys for each option. The keys are free labels, not API fields:
  `{"return_policy": {"what": "Rules for returns", "not_for": "Status of a sent return", "examples": ["Can I return sale items?"]}}`
- The option sequence can bias the answer toward the first option. In tests, change the sequence. Make sure that the answer stays the same.

### 6.3 Score

- Describe situations, not degrees. "Feature is broken, but a workaround exists" is good. "Moderately severe" is bad. Levels that are only numbers fail.
- Jev examines each level alone. It does not see the index or the adjacent levels. Thus "worse than the previous level" has no meaning.
- Measure one dimension in each Score. Divide "fast and smart and experienced" into three Scores.
- Use only levels that you can describe as different. Three levels are sufficient. Give a rare extreme its own level.
- If answers stay between two levels that you think are clear, use objects with `what` and `examples` for each level. Examples help only if they are similar to real inputs.
- The score is a position: the sum of each level index × its probability. Use it to sort, to compare with a threshold, or to round to a level. Do not calculate a magnitude between levels. Different distributions can give the same score.

### 6.4 Noul

- Ask one proposition. A statement ("The customer asks for a refund") also works.
- Make the yes/no boundary clear. If the boundary is difficult, add `criteria.true` and `criteria.false` as concrete situations: "The package arrived on time", not "Not late". Test with and without criteria.
- `instructions` can be an object that holds data from code next to a fixed question: `{"potential_duplicate": {...}, "question": "Is the resume for the same person as `potential_duplicate`?"}`

### 6.5 Box and images (experimental)

- Send the header `TypeSafe-Danger-Zone-Images: true` with each request that has an image or a Box. Box needs `jev-1.14.0` or later.
- Name the object and the image: "the coffee mug in `photo`". Use a name and an appearance hint, not a position ("the leftmost bird").
- Ask for one object in each Box. If there can be more objects of the same type, add a Choice with `none`, `one`, and `several`.
- For a small object in a large image, find the region first (a Choice over image tiles). Then ask the Box on a zoomed crop of that region.
- Put an image that many questions use in the state one time. Each reference adds one more copy of the image.
- Use a new UUID as each image reference. References match as plain text everywhere in the request.
- Separate perception from judgment. First ask what the image shows. Then judge from those answers in a text-only request.
- Use two independent checks (on the full page and on a crop) to find more errors.
- For limits and image preparation, refer to `references/api.md`.

## 7. Requests

- Put all questions about one state in one request. The questions run in parallel and alone. You pay for the state one time. Each added question adds almost no time. Thirteen questions in one request cost 12× less than 13 requests and gave the same answers.
- Coding agents frequently send one question in each request. Do not do this.
- Ask speculative questions. Include questions that only some code paths use. Code ignores the other answers.
- Send a second request only for a real dependency: code needs the first answer to get more data, to make the state, or to select the next options.
- There is no limit on the number of questions. The limits are 64k tokens for the state and all questions, and 32k tokens for the state and one question.
- The header `TypeSafe-Danger-Zone-Long-Context: true` increases the two limits to 262k tokens. These requests are slower and less accurate.
- Send independent requests at the same time, with 4–12 requests in progress for each API key. Use one HTTP client.
- A loop over a Choice must have a maximum number of iterations.

Combine answers with a method that agrees with the decision:

| Method | Use for |
| - | - |
| min | The parts of one result (date parts, function arguments) |
| max | Independent rule checks. One strong flag must not disappear in an average. |
| mean | Different wordings of one judgment, or a series of similar items |
| Weighted sum | Dimensions to trade against each other |
| Separate thresholds | Independent reasons to act |
| Ordered rules, first match | Safety checks first (injection before relevance) |
| Branch | One answer selects which answer is the risk |

Keep the raw answers. Then you can change thresholds without new requests.

Minimal request (`POST https://api.typesafe.ai/v1/systemone`, `Authorization: Bearer $TYPESAFE_API_KEY`):

```json
{"model": "jev-1.14.0",
 "state": {"ticket": "Our API returns 500 errors and we cannot take orders."},
 "questions": {
   "team": {"type": "choice", "instructions": "Which team must handle `ticket`?",
            "criteria": {"billing": "Payment issues", "technical": "Bugs or integration problems"}},
   "frustration": {"type": "score", "instructions": "How frustrated is the customer in `ticket`?",
                   "criteria": ["Calm, only facts", "Frustrated but civil", "Very angry"]},
   "urgent": {"type": "noul", "instructions": "`ticket` shows urgency"}}}
```

Response: `{"model": "jev-1.14.0", "answers": {"team": {"type": "choice", "choice": "technical", "confidence": 1.0, "probabilities": {...}}, "frustration": {"type": "score", "score": 0.67, "confidence": 0.5, "legend": {"0": ...}, "probabilities": {"0": 0.33, "1": 0.67, "2": 0.0}}, "urgent": {"type": "noul", "noul": 0.99}}, "usage": {"input_tokens": 428, "output_tokens": 73}}`. Score keys are strings on the wire.

## 8. Answers and thresholds

| Code needs to know | Read |
| - | - |
| The best option, with no gate | `choice`, or the Score `score` |
| If it can act on a yes/no | `noul`. Start with yes > 0.7 and no < 0.3. Give 0.3–0.7 its own outcome. |
| If it can act on a Choice | `probabilities[choice]`. A gate at 0.9 means "less than 10% risk of an incorrect option". |
| If a second option is close | The ratio of the top probability to the second probability |
| The side of a Score boundary | The sum of the level probabilities on that side |
| If a Score answer is settled | The Score `confidence` |

`confidence` shows how concentrated the distribution is. It is not the probability that the answer is correct.

- Choice: `(p_max − 1/n) / (1 − 1/n)`. For a fixed n, it follows from `p_max` only. A gate on the two values gives no new data. One recipe says that confidence can find a close second option. The formula shows that it cannot.
- Score: probability on an adjacent level decreases confidence less than probability on a far level. A split between two adjacent levels can pass a confidence gate and stay on the incorrect side of your boundary.
- Noul has no confidence. If necessary, use `|2p − 1|`.

Rules for thresholds:

- Use three paths: high → act, middle → confirm or review, low → do not act.
- Set each threshold from the cost of an error. A read-only action can use 0.7. An action that moves money needs a higher value, and it must only open a confirmation step.
- Calibration applies to groups of answers, not to one answer.
- Start with conservative values. Tune them on labeled data. Do not fit them to a small number of examples.
- After you tune thresholds, use a versioned model ID (`jev-1.14.0`). The alias `jev-latest` changes with each release.
- An API error is not an answer. Do not read it as "no" or as the default path.

## 9. Weak areas

Sections 5 and 6 cover literal reading, indirection, large state, and option sequence. These weak areas are different:

- Counts: Jev cannot count. Ask one Noul for each item and add the results in code.
- Numeric data (hex colors, RGB, binary): convert it in code to a number or a named group. Ask only the semantic part.
- Adversarial content: text in the state can change the answer. Write explicit criteria. Test adversarial cases before release.

## 10. Patterns

- **Speculative fan-out:** send the classifier and the questions for each path in one request. Code reads only the answers for the selected path.
- **Noul screen:** use it only if the next step costs more (a larger state, an LLM, or a person). Ask one Noul on a small state. A clear no gets the low-cost path. A clear yes gets the next step. The middle band gets its own path.
- **Companion Noul:** ask the Choice `product` and the Noul `about_our_product` together. If the Noul is less than 0.3, ignore the Choice. If the Noul and `probabilities[choice]` are more than 0.7, use the Choice. Send all other cases to a person, with the Choice as a hint.
- **Confidence routing (Score):** if `confidence` is less than 0.5, send the case to a person. Then route on bands of `score`.
- **Probability routing (Choice):** set a minimum for all actions (p < 0.7 → a person). Set a higher threshold for risky actions. A hesitant "um, the transfer thing, go ahead I guess" got 0.99 for `approve_transfer`. The probability shows the intent, not that the user examined the details. Thus a risky action still needs a confirmation step.
- **Composite scoring:** divide each Score by its top level index. Then add them with weights in code. To change the ranking, change a weight, not a question.
- **Learned composition:** use the probabilities as features for a classical model.
- **Select, do not generate:** code finds candidates. A Choice selects one. Code copies the exact text. For dates, ask one Choice for each part, with a "not stated" option. Code makes the date and validates it.
- **Cascade:** a low-cost LLM extracts data. One Noul for each rule examines the result. Only failed results go to a reasoning model.
- **Funnel:** ask Nouls on short text for all candidates. Ask Nouls on long text for the best candidates. Ask a Choice for the final small set. Each stage can only rank the candidates that the previous stage kept.
- **Progressive disclosure:** ask a wide Choice with short descriptions. Then ask the top 3 again, with the full text and one "does it fit?" Noul for each. The Choice tells which. The Nouls tell if.
- **Locate and confirm:** a Choice over line IDs tells where the answer is. An `exists` Noul tells if the document has an answer.

## 11. Tests

- Ask the user before you send live requests. Get a budget. Tell the user which data you will send. Identify personal data.
- Make sure that the environment can connect to `api.typesafe.ai`.
- Use typical cases, difficult cases, and negative cases.
- To compare two wordings, send each wording as a different question in one request.
- Read individual answers, not only totals. Keep each payload, so that you can send it again.
- Change the option sequence. Make sure that the answer stays the same.
- Without labels, measure self-consistency (method in `references/cookbooks.md`). Small noise (standard deviation 0.015) is usual.
- With labels, plot probability against accuracy. Select thresholds from the plot. Show coverage and accuracy together.
- Keep three data sets: one to write questions, one to judge changes, and one final test set.
- Write the Score levels before you look at the scores.
- Higher confidence after a change does not prove that the question is better.
- Cache answers on the model ID, the state, and the sorted-key JSON of the questions.

If an answer is incorrect, examine these items in this sequence:

1. The payload that you sent.
2. The state (the human test).
3. The options. Is the correct answer in the list?
4. The scope. Can you divide the question?
5. The words.

These are signs of prompt gymnastics:

- Criteria that name test items, or that get one more clause for each failure.
- Thresholds that fit specific cases.
- Tests that assert an exact probability. Assert decisions and bands instead.
- Code that silently overrides answers.

Fix the structure instead: a better state, a different question, or a rule in code.

## 12. Production checklist

This list adds to the rules in sections 2–8.

- The logs contain `model`, the request ID, the payload, the facts, and the answers.
- An API error has a fallback path.
- The API key stays on the server.
- The client retries 408, 429, and 5xx with backoff and obeys `retry-after`. Large states have long timeouts.
- A `null` confidence goes to review.
- Jev is a filter, not a security boundary. Downstream prompts still treat the content as untrusted. Examine LLM inputs and LLM outputs.
- Debug logs do not contain sensitive request bodies.
