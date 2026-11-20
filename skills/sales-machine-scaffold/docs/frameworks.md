# Frameworks it uses

[← back to the README](../README.md) · [docs index](README.md)

The skill does not invent a sales method. It puts together a few well-known frameworks and turns
each into a rule or a field that the workflows check.

## Product-led growth (PLG)

From Wes Bush, _Product-Led Growth_ (2019), and common PLG practice.

- **The product carries people to value.** Stages 03 and 04 are a guided path inside the product,
  with a sandbox or sample account, so people try it without real risk before they talk to anyone.
- **Hybrid motion: two lanes.** Self-serve users go on their own; assisted users get the team.
  The split is internal: pages never show "lanes".
- **Buying signal (product-qualified lead).** The team steps in when usage reaches a signal
  defined in the config, not when a form is filled in.
- **Understand, communicate, deliver value.** Every article states the reader's outcome as
  functional, emotional or social, and asks for one next step.

Used in: `machine`, `article-ideas`, `landing`.

## B2B Elements of Value

From Bain & Company, "The B2B Elements of Value" (Harvard Business Review, 2018): 40 reasons
businesses buy, in 5 levels (table stakes, functional, ease of doing business, individual,
inspirational).

- Selling copy names and shows 2 to 4 elements, with at least one from level 3 or 4. Deals are
  won on ease of doing business and on what changes for the person who decides, not on price.
- Each stage of the machine has the elements it must deliver.
- Coverage of elements per persona and stage drives which articles come next.
- "Acceptable price" and "Regulatory compliance" are never used as selling points.

Used in: `explore`, `position`, `article-ideas`, `landing`, `value-audit`. Full list in
[`reference/elements-of-value.md`](../reference/elements-of-value.md).

## Growth loops

From Reforge, "Growth Loops are the New Funnels". A funnel ends at the customer; a loop uses the
output of one group of customers to bring the next, so growth compounds.

- Three loops: **integrations** (customers name their providers, each integration page brings that
  provider's other customers), **invites** (active accounts bring colleagues and partners) and
  **content** (real uses become templates and articles).
- Each loop has 4 steps that close, an owner and one metric: new access requests per monthly
  activated cohort.
- Every article and page gives the reader a reason to feed a loop.

Used in: `machine` (stage 06), `loops`, `article-ideas`.

## Jobs to be done

Copy talks about the job the reader is trying to get done and the outcome they want. The product
appears as the way to do it, never as a list of feature names.

Used in: `position` (persona matrix), `article-ideas`, `landing`, `manual`.

## Fact ledger

Every product claim traces to a local source with a status: live, rolling out or internal.
Anything unconfirmed is written `[to confirm]`. This is what keeps the output honest across
articles, pages and the manual.

Used in: every workflow, checked by `value-audit`.
