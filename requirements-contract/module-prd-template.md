# Module PRD — <module name>

> A scoped extract from the source of truth for one unit of work. Traceable,
> lean, and verified by someone other than its author. If this grows past a page
> or two, it's too big — split the unit of work.

**Source of truth:** <doc + the sections/lines this extract is drawn from>
**Author:** <who scoped it>   **Verified by:** <someone other than the author>
**Status:** Draft | Verified | Signed off (checklist PR merged)

## The one behaviour this delivers
<A single sentence: the visible, end-to-end behaviour a person can watch happen.
If you need "and" to describe it, it's probably two units of work.>

## Requirements in scope
Every requirement this unit must satisfy, each traced back to the source.

| # | Requirement (verbatim or a tight paraphrase) | Source ref |
|---|---|---|
| R1 | … | §… |
| R2 | … | §… |

## Completeness checklist
Every deliverable element, as a box. A built element ticks; a dropped one shows.

- [ ] <element> — satisfies R<n>
- [ ] <element> — satisfies R<n>
- [ ] …

## Acceptance criteria → tests
Each criterion is the observable condition that proves a requirement, and seeds a
test. Forward traceability (requirement → test) is mandatory: no criterion
without a test.

| Criterion | Proves | Test |
|---|---|---|
| Given …, when …, then … | R1 | <test name / file> |
| … | R2 | … |

## Explicitly out of scope
What a reader might expect here but that belongs elsewhere — named, so its
absence is a decision, not an oversight.

- <thing> — deferred to <where>, because <why>

## Deviations
Filled during the build loop's *propose* step. What's added beyond the contract,
what's cut and why, what's ambiguous and needs a ruling before build.

- …
