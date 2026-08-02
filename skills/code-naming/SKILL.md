---
name: code-naming
description: Names and renames variables, functions, methods, types, modules, events, errors, and tests by matching grammar to responsibility. Uses Steve Yegge's "Kingdom of Nouns" critique to detect noun-heavy action wrappers, vague verbs such as execute/process/handle, and empty titles such as Manager/Helper. Use when choosing names, reviewing naming, refactoring an API, or answering "what should I call this?"
---

# code-naming: put verbs back in the code

Names are compressed design. A good name tells the truth at the call site; a bad
name makes the reader reconstruct intent from types, control flow, and comments.

The governing rule is simple:

- Name things with nouns.
- Name actions with verbs.
- Name predicates as questions.
- Do not invent a thing merely to give an action somewhere to live.

This is not an argument that nouns or objects are bad. `Invoice`, `Clock`, and
`RetryPolicy` can be real concepts. The smell is an action disguised as a class,
especially when the resulting call reads like
`SomethingManager(...).execute()`.

## When to use

Use this skill when:

- choosing a name for a variable, function, type, module, endpoint, event, error,
  or test;
- reviewing a diff for misleading or vague names;
- renaming an existing API;
- a class or interface ends in `Manager`, `Processor`, `Handler`, `Service`,
  `Helper`, `Util`, `Factory`, `Strategy`, `Context`, `Info`, `Data`, or `Object`;
- behavior is hidden behind `execute`, `run`, `process`, `handle`, `perform`,
  `operate`, or `doIt`;
- no concise name fits, which may mean the code has more than one job.

Do not run a rename campaign merely to enforce personal taste. Leave clear,
idiomatic names alone.

## The procedure

### 1. Learn the local dialect

Before proposing names, inspect:

- the language's naming conventions;
- nearby code and public APIs;
- the repository's domain vocabulary;
- function bodies, call sites, tests, and docs;
- compatibility surfaces such as serialized fields, CLI flags, database columns,
  environment variables, and external interfaces.

Never infer behavior from the current name alone. Existing domain terms and
project conventions beat a generic style guide unless they are actively
misleading.

### 2. State the responsibility as a sentence

Complete this without using the current identifier:

> This code **[verb] [object] [qualifier]**, producing/changing **[result]**.

Examples:

- "parses a configuration file into validated settings";
- "looks up a user by email and may find nothing";
- "decides whether a failed request may be retried";
- "owns the open database connection and its transaction state".

If the sentence needs "and", first check whether the code has multiple
responsibilities. A naming problem is often a design problem in disguise. Do not
paper over it with a longer identifier.

### 3. Choose the right grammatical shape

| Code element         | Preferred shape                    | Diagnostic                                                 | Examples                                               |
| -------------------- | ---------------------------------- | ---------------------------------------------------------- | ------------------------------------------------------ |
| Function or method   | specific verb phrase               | What does it do or return?                                 | `parseHeader`, `reserveSeat`, `loadConfig`             |
| Boolean or predicate | question/predicate                 | What yes/no question does it answer?                       | `isEmpty`, `hasAccess`, `canRetry`, `shouldFlush`      |
| Value or field       | concrete noun                      | What value is this?                                        | `retryDelay`, `invoice`, `usersById`                   |
| Collection           | plural or relationship             | What does it contain or map?                               | `users`, `ordersById`, `childrenByParent`              |
| Type or class        | stable concept or role             | What identity, state, invariant, or lifecycle does it own? | `Invoice`, `Clock`, `RetryPolicy`, `ConnectionPool`    |
| Callable type        | capability or event                | What behavior can be supplied?                             | `Comparator`, `Predicate`, `OnFailure`                 |
| Command              | imperative action                  | What is being requested?                                   | `PlaceOrder`, `CancelBooking`                          |
| Event                | completed fact, usually past tense | What happened?                                             | `OrderPlaced`, `BookingCancelled`                      |
| Error                | failed condition or operation      | What specifically went wrong?                              | `InvalidHeader`, `UserNotFound`, `PaymentDeclined`     |
| Module or package    | cohesive domain/capability         | What concept does it collect?                              | `billing`, `routing`, `retry`                          |
| Test                 | behavior sentence                  | Under what condition, what should happen?                  | `rejects_expired_token`, `returns_none_for_unknown_id` |

Adapt casing and word order to the language. Do not impose `camelCase`,
`snake_case`, `IThing`, or a `get`/`find` distinction when the local ecosystem
uses something else.

Add units or representation when confusion would be dangerous:
`timeoutMs`, `sizeBytes`, `createdAtUtc`. Do not encode the static type in every
name.

### 4. Run the Kingdom-of-Nouns scan

Flag these smells, then inspect the implementation before deciding they are
problems:

1. **Action in a noun costume** — a class exists only to expose one stateless
   `execute`, `run`, `process`, or `handle` method.
2. **Architecture instead of intent** — the name says `Manager`, `Factory`,
   `Strategy`, or `Helper`, but not what domain behavior occurs.
3. **Masked executioner** — the method merely repeats the owner:
   `RegistrationManager.register()` or `FieldTiller.till()`.
4. **Generic verb, specific body** — `process(data)` actually parses a CSV,
   charges a card, or publishes an invoice.
5. **Noun pile** — names such as `PaymentOperationExecutionStrategy` stack
   abstractions without sharpening meaning.
6. **Accessor pilgrimage** — the caller traverses a long object graph before it
   can express the action.
7. **Pattern leakage** — a design-pattern name exposes an implementation choice
   that callers do not need to know.
8. **Meaningless container** — `data`, `info`, `item`, `object`, `misc`, or
   `utils` replaces the actual concept.

A suspicious suffix is evidence, not a conviction. `Parser` is honest if it
parses, `Factory` may be honest if choosing among construction policies is the
real abstraction, and `Handler` may be the framework's established term for a
protocol hook. Keep the suffix only if one sentence can explain the distinction
it communicates.

### 5. Pick the shallowest truthful abstraction

Use this ladder in order:

1. A direct function with a specific verb.
2. A verb method on the object that genuinely owns the relevant state.
3. A function/callback value when behavior must be passed around.
4. A named object when behavior has meaningful state, identity, invariants, or
   lifecycle.

Do not create a class just to pass one action when the language supports
functions, lambdas, closures, traits, or callable values directly. Conversely,
do not flatten a stateful domain concept into unrelated free functions merely
because verbs are good.

### 6. Generate candidates from behavior, not synonyms

Derive names from the responsibility sentence. Prefer the domain verb that users
and maintainers already say. Do not cycle through synonyms to avoid repetition;
consistent repetition is easier to understand.

Assuming the described behavior is accurate:

| Weak name                                 | Better direction                     | Why                                           |
| ----------------------------------------- | ------------------------------------ | --------------------------------------------- |
| `FileProcessor.process(file)`             | `parseConfig(file)`                  | names the actual action and result            |
| `PaymentExecutionStrategy.execute(order)` | `paymentGateway.charge(order.total)` | exposes the domain operation, not the pattern |
| `DataManager.getUserData(id)`             | `users.findById(id)`                 | removes empty words and states the lookup key |
| `ReportGenerator.run(input)`              | `renderReport(input)`                | frees the verb from a wrapper noun            |
| `enabled`                                 | `isCacheEnabled`                     | names the subject and reads as a predicate    |
| `timeout`                                 | `timeoutMs`                          | makes the unit explicit                       |
| `OperationExecutionException`             | `PaymentDeclined`                    | names the failure the caller can act on       |

These are conditional examples, not mechanical substitutions. If `process`
performs several stages, first split or name the pipeline's actual contract. If
`run` is a conventional scheduler or event-loop operation, it may already be the
most truthful verb.

### 7. Judge the call site

Preview every serious candidate in real code. Read it aloud as a sentence.
Prefer the name that makes the call site reveal intent without duplicating its
context.

Check:

- **Truth** — does the name promise exactly what the code does?
- **Specificity** — could this identifier name dozens of unrelated operations?
- **Contrast** — does it distinguish this concept from its peers?
- **Context** — does the surrounding type/module already supply part of the
  meaning? `users.find(id)` may be clearer than `users.findUserById(id)`.
- **Effects** — can a reader tell whether it mutates, performs I/O, may be slow,
  or may return nothing when that distinction matters locally?
- **Consistency** — does the same verb mean the same thing across the codebase?
- **Searchability** — can people pronounce, grep, and discuss it?
- **Durability** — is it named for stable behavior rather than current
  implementation?
- **Scope** — local names may be short; exported APIs need more context.

Comments should explain why, constraints, or surprises. A comment that merely
translates a vague name is a request to rename.

### 8. Rename safely

Before editing:

1. Find all definitions and references with language tooling or search.
2. Identify reflection, string-based lookup, serialization, schemas, generated
   code, configuration, docs, and downstream callers that a symbol rename may
   miss.
3. Preserve public compatibility with an alias or deprecation path when needed.
4. Keep a pure rename behavior-preserving. Separate unrelated logic changes.
5. Update tests and examples, then run the repository's normal checks.

Do not rename third-party or generated identifiers at their source. Adapt them at
an owned boundary only when the translation adds clarity.

## Output contract

When reviewing names, return findings in priority order:

```text
path/to/file.ext:42 — action disguised as noun
Current: FileProcessor.process(file)
Proposed: parseConfig(file)
Reason: the body parses one config format and returns Settings; it does not
perform a generic processing pipeline.
Confidence: high
```

For each finding include:

1. `path:line` when code is available;
2. the smell category;
3. current name and proposed name;
4. one behavioral reason grounded in body/call sites/tests;
5. confidence and any compatibility risk.

If the user asks for a name, provide 3-5 ranked candidates with call-site
previews. Explain why the top choice wins and reject at least one tempting vague
name. If one candidate clearly dominates, say so rather than manufacturing a
tie.

When writing code, apply these rules directly and only call out non-obvious
trade-offs. If existing names are already clear, say "no naming changes
recommended". Do not create churn to satisfy the skill.

## Hard constraints

- Do not guess semantics that the implementation and call sites do not support.
- Do not replace a domain term with generic computer-science vocabulary.
- Do not prefer brevity over truth, or length over useful context.
- Do not ban all objects, patterns, suffixes, or generic framework verbs.
- Do not hide two responsibilities behind one polished name.
- Do not change behavior under cover of a rename.
- Do not invent abbreviations unless the codebase and domain already use them.

## Reference

Steve Yegge, ["Execution in the Kingdom of
Nouns"](https://steve-yegge.blogspot.com/2006/03/execution-in-kingdom-of-nouns.html)
(2006). The essay's enduring diagnostic is that actions should remain visible as
verbs instead of being forced into wrapper objects. Its language-specific claims
reflect pre-lambda Java; apply the design lesson, not the historical limitation.
