# Review proof after a new commit

## Requirement

R1. A review log clears the done move only for the commit that was reviewed.
The delivery contract defines this rule in section 4, Gated review.
[Source requirement](../../delivery-contract/README.md#4-gated-review)

## Completeness checklist

- [x] AC1. Given a review log for the current commit, when another commit is made, the gate blocks the done move.

## Acceptance criteria and tests

| Criterion | Proves | Test |
|---|---|---|
| AC1 | R1 | BLOCKS when the log is stale (a new commit moved HEAD) |

## Check the mapping

Run this command from the repository root with Node and Git installed.

```sh
node requirements-contract/example/check.cjs
```

The checker runs the [review-gate suite](../../toolkit/.claude/hooks/tests/review-gate.test.cjs)
and matches each checklist criterion to a passing test by its reported name.
Clear the Test cell and run the command again. It exits with status 1 and
prints `AC1: missing test reference`. Restoring the name restores the mapping.
