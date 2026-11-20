# Jev recipes

These are the official TypeSafe cookbooks and demos (Jev 1.14, November 2026). The full text is at `https://docs.typesafe.ai/cookbooks/<slug>.md` and `https://docs.typesafe.ai/demos/<slug>.md`. The thresholds are starting values for the data of each recipe. Tune them on your data.

## Agents and verification

**Function calling** (`function_calling`): plain-language command → typed function call.
- One request has a Choice over the function descriptions and the argument questions for all functions. Code reads only the arguments of the selected function.
- Map types to questions: an enum gives a Choice with the enum values as keys. A list of enums gives one Noul for each value. A boolean gives a Noul. Free text, numbers, and dates get no question.
- A `stated` Noul for each optional argument asks if the command gives it. If not, use the default.
- The call confidence is the minimum of all decisions, not the product.
- Write questions about the meaning of an argument, not its parameter name.

**Skill suggestion** (`skill_suggestion`): select zero or one skill from 194 for an agent turn.
- Request 1 has a Choice over all skills with short descriptions. Its probabilities are the ranking.
- Request 1 also has three "is an action necessary?" Nouls (use the mean) and a "does it name a tool or format?" Noul with its own threshold.
- Request 2 has the top 3 with full text, a Choice, and one `fits` Noul for each candidate. Suggest the winner only if the best `fits` is 0.30 or more.
- The Choice still ranks a skill first when no skill is correct. Only the `fits` Nouls find this case.
- Short descriptions confused two similar skills. Full text separated them.
- Result: incorrect loads decreased from 15.7% to 7.9%.

**LLM guardrails** (`llm_guardrails`): examine each message into and out of an LLM.
- One request has five hazard Nouls (jailbreak, drop safeguards, harmful request, medical advice, self-harm) and a severity Score. Each Noul has `true` and `false` criteria.
- Each hazard has its own action. The sequence of precedence is support, block, review, pass.
- A policy is a set of thresholds. Strict: review at 0.35, act at 0.70. Permissive: 0.70 and 0.85.
- Examine the inputs and the outputs.

**Citation check** (`citation_check`): find incorrect or invented citations.
- First, code does a string match of the quote against the source. If the quote is not in the source, it is invented. No request is necessary.
- Then one Choice with `supports`, `contradicts`, and `says_nothing` examines the claim against the cited section only.
- Accept automatically if confidence is 0.8 or more.

**Verify LLM answers** (`verify_llm_outputs`): examine an LLM answer against its source paragraphs.
- One request has three Nouls: `answerable`, `declines`, `supported`.
- If `declines` is 0.5 or more, the risk is `answerable`. If not, the risk is 1 − `supported`. Send risk 0.2 or more to review.
- Correct answers have a risk near zero. Incorrect answers spread over the full range. Thus the threshold must be low.
- Do not use the data that you used to select the questions as test data.

**RAG passages** (`classifying_rag_passages`): filter retrieved passages before generation.
- One request for each query and passage pair has four Nouls: relevant, contains evidence, contradicts the premise, contains prompt injection.
- Ordered rules: injection > 0.70 → exclude. Contradiction > 0.70 → put in a separate conflict block. Relevance < 0.45 → exclude. Evidence > 0.55 → include.
- The injection Noul is a filter, not a security boundary.
- Vector similarity ranked the injected passage first. Jev gave it 0.98 for injection.

**Memory** (`basic_memory`): keep facts across requests.
- Request 1 routes the ticket, with the saved memories in the state.
- Request 2 is a `remember` Noul: does the thread state a lasting fact about the customer? Save the fact if the value is 0.5 or more.
- Tell the `remember` question to ignore the answer of request 1. Else it saves inferences from old memories as new facts.
- Add limits and expiry for production use.

## Classification and extraction

**Hierarchical classification** (`hierarchical_classification`): deep taxonomies.
- Ask one Choice for each tree node over its children. The state does not change.
- Use beam search with a width of 3. The score of a path is the geometric mean of its edge probabilities.
- Greedy search cannot recover from an early error. Beam search can.

**Classification with confidence** (`classification_using_confidence`): a flat taxonomy with a fallback.
- One Choice with 75 options. Each description lists the members of the group.
- If confidence is 0.9 or more, give the group. If not, code gives the parent division.

**Twitch chat filter** (`twitch_chat_filter`): live moderation.
- One request for each message has a 5-option category Choice, a toxic Noul, and a spoiler Noul. The state includes the stream title and the game.
- Ordered rules: toxic ≥ 0.7 → hide. Then the category rule. Then spoiler ≥ 0.7 → blur.
- Option descriptions include exclusions ("not gameplay instructions in the form of a question"). Keep a fallback category.

**SDE cascade** (`sde_cascade`): low-cost extraction with escalation.
- A low-cost LLM extracts JSON. One request has six rule Nouls. Each Noul gives yes if the rule is broken.
- Escalate to a reasoning model if the JSON does not parse or if the maximum check is more than 0.7.
- Do not force structured output on the low-cost model. Forced JSON hides incorrect answers.
- Result: 96.5% correct at 26% of the cost of the reasoning model.

**Date extraction** (`date_extraction_cookbook`): dates in documents.
- One request has seven Choices: mode, month, day, year, anchor, weekday, and week offset. Each Choice has a `none` option.
- The date confidence is the minimum of the parts that code uses. Review below 0.60.
- Code does all calendar calculations. Code sends `none`, impossible dates, and out-of-range years to review.

**Value extraction** (`pre_parsed_value_extraction_cookbook`): emails, phone numbers, amounts.
- A regex finds candidates. A Choice uses the candidate spans as option keys, plus `none`. Code copies the selected span and normalizes it.
- Jev cannot invent a value or change a digit with this method.
- For more than 255 candidates, select a section first.

**Structure recovery** (`autoformat`): plain text → Markdown.
- Request 1 has one Noul for each pair of lines: "Does line B continue a sentence from line A?" Request 2 classifies the blocks that request 1 made.
- The merge threshold depends on a fact that code reads: 0.2 after an open line, 0.5 after a period.
- "Same paragraph?" merged list items. "Mid-sentence?" did not.

**Shopping cart** (`cart_from_primitives`): an order → a cart.
- A loop asks a Choice over the remaining menu items and `nothing_else`. Code removes each found item. The loop stops after 6 iterations maximum.
- Then one request for each item asks a Choice for each field, with an `unspecified` option.

**Entity alignment** (`entity_alignment`): match records from two sources.
- One request for each pair has a 3-level Score (different, related, same) and three field Nouls for curators. Code compares the years.
- Round the score to the nearest level. Write the levels before you look at the scores.
- Write equivalence rules in the instructions (for example, a regional branch of a label is the same label).

## Images (experimental)

**Scanned record** (`reading_scanned_documents`): a vaccination record.
- Request 1 has a presence Noul and a row Box for each expected item. It also asks if an item that is not on the list is present.
- Request 2 has a year Choice with `other` and `unreadable`, and a legibility Noul.
- Request 3 is text only. It judges each dose from the readings.
- A direct judgment on the image passed an unreadable date at 0.88.

**OCR check** (`ocr_confidence_bounding_boxes`): examine values from an OCR tool.
- Box each value on the full page, zoom approximately 3×, and box again.
- Ask a Noul on the page and a Noul on the crop. Review if one of them is less than 0.25. Each check found errors that the other check did not find.

**Feeder camera** (`feeder_watch`): video frames → a visit log.
- One request for each frame has a presence Noul, a count Choice, a Box, and species Choices.
- Box by species name with an appearance hint. Position-based boxes selected the same bird two times.
- Code makes the visit log from the saved answers.

## Search and ranking

**Re-ranking** (`rerank_typesafe`): sort search results.
- BM25 gives 30 candidates. Ask one Noul for each query and candidate pair. Sort by `noul`.
- Top-1 accuracy increased from 5% to 30%. Re-ranking cannot add a candidate that the first search did not find.

**Large candidate sets** (`infinite_cardinality_choice`): one film from 5,000.
- Ask a Noul on a short plot for all films. Ask a Noul on a long plot for the top 80. Ask a Choice over the top 20.
- Show one film if the Choice confidence is 0.8 or more. If not, show the top 3.
- Put the text of each candidate in its question, so that Jev compares texts.
- Nouls rank but cannot show certainty. A Choice can.
- Use retries and long timeouts for large requests.

**Line search** (`semantic_find`): find the line that answers a query.
- Prefix each line with an ID (`L052|`). Ask a Choice over the line IDs with `null` descriptions, and an `exists` Noul.
- `exists` ≥ 0.7 means answered. 0.35 or less means not in the document.

**Live checklist** (`intelliprompter`): mark notes as the speaker covers them.
- Ask one 5-level Score for each note that is not covered, against the transcript. Code keeps the checklist state.

**Demos** (`demos/*`): Airbnb search uses groups of 100 listings with a Choice, then a Score for each listing on the shortlist. The smart home demo asks all Choices in one request. The content audit asks 45 questions for each page. The time was 144 ms for 1 question and 151 ms for 45.

## Evaluation and cost

**Parallel questions** (`parallel_questions`): 13 questions in one request cost 12.2× less and run 11.8× faster than 13 requests. The answers stay the same.

**Self-consistency** (`consistency_choice_cookbook`, `consistency_noul_cookbook`): measure stability without labels.
- Make borderline inputs from combinations of 6 facts. Send each request 15 times with a random `uid`.
- Calculate the mean absolute probability difference between pairs of runs. Use the worst option for each input. Count the inputs above 0.10.
- Jev had 0 of 40 unstable inputs. Reasoning LLMs had 2 to 40 of 40. Temperature 0 did not correct the LLMs.

**Feature discovery** (`autoresearch_feature_discovery`): text → features for a model.
- An LLM proposes questions. Jev answers them for each row. CatBoost trains on the answers.
- Keep a change only if the error on check rows decreases by 0.003 or more. The proposer must not see the check rows.
- A Score gives two features: the mean level and the spread. A Noul gives one feature.
- A direct Score of the full judgment is a strong baseline.
