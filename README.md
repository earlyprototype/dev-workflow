# dev-workflow

A record of a working method for building software with an AI collaborator: the
requirements discipline it runs on, the delivery pipeline that carries a change
to merged code, and the runnable tooling that enforces both. It is structured to
be copied into a new repository rather than reconstructed each time.

Every element here has been used on one production project. Each is treated as a
candidate until a second, different project has exercised it.

## Two contracts

A change is governed by two independent contracts. They are separated because
they answer different questions and scale differently: a small change needs
little of the first and a light pass of the second, while a change to money,
personal data, or anything irreversible needs the full weight of both.

- **[The requirements contract](requirements-contract/)** governs *what must be
  true*. It defines a single source of truth, a scoped and traceable extract per
  unit of work, a completeness checklist, acceptance criteria that become tests,
  and a build loop that validates the plan before code is written.

- **[The delivery contract](delivery-contract/)** governs *how a change reaches
  `main`*: issue, branch, pull request, gated review, verdict-gated merge, and a
  final step in which the agent that opened the PR receives its review outcome.
  Each stage that can be enforced by tooling is, so the process is enforced
  rather than merely conventional.

## The delivery pipeline

The six stages every change passes through, and what each contributes:

1. **Issue first.** The change is recorded as a tracked issue before work
   starts, stating the intended approach, and closed with the outcome. The issue
   number threads through the branch, commits, and PR, providing one reference
   from intent to merged code.
2. **Decisions recorded as taken.** An ADR log (`docs/DECISIONS.md`) captures
   each decision — its context, the decision, its consequences, and the
   condition that would reopen it. It retains the reasoning that higher-level
   docs lose as they drift.
3. **Work on a branch.** One branch per issue, one writer per branch. `main` is
   protected by a ruleset requiring the status checks and conversation
   resolution, with an empty bypass list, so no path merges around the gates.
4. **Gated review.** Every PR is reviewed against a severity scale (CRITICAL /
   HIGH / MEDIUM / LOW): a fresh-context review before the work is marked done,
   and an automated review on the PR. A CRITICAL, HIGH, or MEDIUM finding blocks
   the merge; LOW does not.
5. **Verdict-gated merge.** The automated review ends in a machine-readable
   verdict. One classifier reads it, fails the required `review` check on a
   blocking verdict, and arms GitHub's auto-merge only on a clean one — so a
   finding blocks the merge mechanically, not as a comment a human must notice.
6. **Reviewed-outcome feedback.** A PR's review lands minutes after the agent's
   turn ends. The agent runs a bounded, read-only watch on its own PR; the
   review's completion re-invokes the agent with the outcome — merged, blocked
   with findings, a failed check, or a review needing a human — so the result is
   handled in the context that produced the change.

## The enforcing tools

The runnable tooling is in [`toolkit/`](toolkit/), at the paths it occupies in a
target repository (`.claude/…`, `.github/…`), so it transfers unchanged. Each
guard carries its own tests, run in CI.

| Tool | Stage | Function |
|---|---|---|
| ADR log (`docs/DECISIONS.md`) | 2 | One record per decision: context, decision, consequences, revisit condition. |
| `review-gate.cjs` (PreToolUse hook) | 4 | Blocks the kanban done-move until a fresh-context review is logged against the current commit; a new commit invalidates the log and re-blocks. |
| `automerge-eligible.cjs` + `claude-pr-review.yml` + `auto-merge.yml` | 5 | The reviewer ends with `AUTOMERGE_VERDICT: PASS`/`BLOCK`; one classifier reads it, fails the required `review` check on BLOCK, and arms auto-merge only on a genuine PASS. |
| `watch-review.cjs` + `/watch-review` | 6 | Polls the PR, read-only and time-bounded, and returns the review outcome to the agent as one classified result. |
| `watch-review-reminder.cjs` (PostToolUse hook) | 6 | Fires after `gh pr create` and prompts the agent to start the watch on its own tracked call. The watch cannot run from the hook itself: a hook-spawned process has no tracked task for the harness to re-invoke, so the outcome would have no path back to the agent. |

The stack assumes GitHub, [kanbanger](https://github.com/early-prototype/kanbanger-partymix)
as the board, and the Claude GitHub app for the hosted review. It assumes one
merge authority and no CODEOWNERS; a team adds required reviewers on top.

## Applying it

[`bootstrap-checklist.md`](bootstrap-checklist.md) installs the method into a new
repository in dependency order: source of truth and ADR log first; the review
gate and verdict-merge before the first real PR; the watch loop and its reminder
once an automated review exists for them to act on.

## Status

Used on one production project (July 2026). Each element remains a candidate
until a second, different project has exercised it.
