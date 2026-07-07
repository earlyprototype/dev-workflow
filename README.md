# dev-workflow

A working record of how to build software with an AI collaborator — the
discipline and the wiring — kept here so it can be pulled into a new project
rather than reconstructed from memory each time.

It is not a finished methodology. It is updated as pieces prove themselves on
real work, and everything here stays a candidate pattern until a second,
different project has used it.

## Two contracts, not one

Every change is bound by two separate contracts. Conflating them is why process
tends to either get skipped wholesale or bolted onto everything regardless of
size. Scale each independently: a one-line fix needs almost none of the first
and a light pass of the second; a change touching money, personal data, or
anything hard to reverse needs the full weight of both.

- **[The requirements contract](requirements-contract/)** — *what must be true,
  traced to tests.* A single source of truth, a scoped extract per unit of work,
  a completeness checklist, acceptance criteria that seed the tests, and a build
  loop that reviews the plan before any code is written.

- **[The delivery contract](delivery-contract/)** — *how a change physically
  moves from idea to merged code.* Issue → branch → PR → gated review →
  verdict-gated merge → the agent watching its own PR. Enforced mechanically
  where possible, so it can't be skipped under pressure.

## The delivery pipeline, in one pass

Every change moves through the same stages, enforced by wiring rather than
relied on as convention:

1. **Issue first.** A change starts as a tracked issue — the agreed approach
   recorded before work starts, closed with a comment stating the outcome.
2. **Decisions recorded as they're made.** An ADR log captures what was decided,
   why, what else was considered, and what would change the decision.
3. **Branch, never main directly.** One branch per issue; commits and PRs
   reference the issue number.
4. **Gated review before merge.** Every PR is reviewed against a stated severity
   scale. A CRITICAL / HIGH / MEDIUM finding blocks the merge; only LOW rides
   through.
5. **Merge gated on verdict, not habit.** CI green, review clean, every
   conversation resolved — checked mechanically, not just expected.
6. **The agent that opened the PR learns what happened to it.** Opening a PR
   does not end the work: the agent watches for its own review outcome and
   reacts — fixes findings, advances the task, or asks a human — instead of the
   PR going quiet.

## The wiring that enforces it

The runnable tools live in [`toolkit/`](toolkit/), laid out exactly as they sit
in a target repo (`.claude/…`, `.github/…`) so they copy across unchanged. Each
ships with its own tests, run in CI.

| Tool | Stage | What it does |
|---|---|---|
| ADR log (`docs/DECISIONS.md` convention) | 2 | One entry per decision: context, decision, consequences, revisit trigger. |
| `review-gate.cjs` (PreToolUse hook) | 4 | Blocks a kanban done-move until a fresh-context review is logged against the current commit; a new commit re-blocks it. |
| `automerge-eligible.cjs` + `claude-pr-review.yml` + `auto-merge.yml` | 5 | The hosted reviewer ends with `AUTOMERGE_VERDICT: PASS`/`BLOCK`; a shared classifier reads it, fails the required `review` check on BLOCK, and arms GitHub auto-merge only on a genuine PASS. |
| `watch-review.cjs` + `/watch-review` | 6 | The agent backgrounds a bounded, read-only poll on its own PR; when the review lands it reports merged / blocked-with-findings / ci-failed / needs-a-human. |
| `watch-review-reminder.cjs` (PostToolUse hook) | 6 | Fires after `gh pr create` and reminds the agent to run the watch — a hook can't watch it itself (no tracked task to wake), so its only job is that the step isn't forgotten. |

The stack assumes GitHub, [kanbanger](https://github.com/early-prototype/kanbanger-partymix)
for the board, and the Claude GitHub app for the hosted review. It assumes a
single merge authority (no CODEOWNERS); add required reviewers if you have a
team.

## Using this

[`bootstrap-checklist.md`](bootstrap-checklist.md) stands the whole thing up in
a new repo, in dependency order. In short: source of truth and ADR log on day
one; the review gate and verdict-merge before the first real PR; the watch loop
and its reminder once an automated review exists to watch.

## Status

First proven end-to-end on one production project, July 2026. Treat everything
here as a candidate pattern, not a settled standard, until a second, different
project has used it.
