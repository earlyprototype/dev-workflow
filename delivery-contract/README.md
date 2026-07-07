# The delivery contract

How a change moves from idea to merged code: issue → branch → PR → gated review
→ verdict-gated merge → the agent receiving its own PR's review outcome. The
runnable wiring is in [`../toolkit/`](../toolkit/); this describes what each
piece does and why it is shaped as it is.

Two properties hold across the pipeline. Each stage that can be enforced by
tooling is, rather than left to convention, so the guarantees do not depend on
any step being performed from memory. And each gate fails closed: an error, an
unreadable state, or a missing proof resolves to "blocked", never "allowed", so
a malfunction narrows what merges rather than widening it.

## The stages

### 1. Issue first
The change is recorded as a tracked issue before work begins, stating the
intended approach, and closed with a comment stating the outcome. The branch,
commits, and PR all reference the issue number, producing one legible trail from
intent to merged code.

### 2. Decisions recorded as taken
An ADR log (`docs/DECISIONS.md`) records each decision as it is made: its
context, the decision, its consequences, and the condition that would reopen it.
It retains the reasoning and the rejected alternatives, which higher-level
documents lose as they drift. Use [`adr-template.md`](adr-template.md).

### 3. Work on a branch
One branch per issue, one writer per branch. `main` is protected by a ruleset
that requires the status checks and conversation resolution and holds an empty
bypass list, so no account — including the owner's — merges around the gates.

### 4. Gated review
Every PR is reviewed against a severity scale (CRITICAL / HIGH / MEDIUM / LOW),
in two layers:

- **A fresh-context review** before the work is marked done. `/review` runs a
  clean-context reviewer against the stated coding standards, reporting findings
  with file:line and a concrete fix each. The reviewer holds none of the
  builder's context and so does not inherit the builder's blind spots. The
  `review-gate.cjs` PreToolUse hook blocks the kanban done-move until that review
  is logged against the current commit; a new commit invalidates the log, so the
  gate re-blocks until re-reviewed.
- **An automated PR review** on GitHub (`claude-pr-review.yml`) that posts
  findings and ends with a single machine-readable verdict line.

A CRITICAL, HIGH, or MEDIUM finding blocks the merge; LOW does not.

### 5. Verdict-gated merge
The automated review ends with `AUTOMERGE_VERDICT: PASS` or `BLOCK`. One
classifier (`automerge-eligible.cjs`) reads that line and is the single
definition of a clean review, used in two places:

- inside the required `review` check, where a BLOCK fails the check and branch
  protection holds the merge; and
- inside the arming workflow (`auto-merge.yml`), which enables GitHub's native
  auto-merge only on a genuine PASS.

A finding therefore blocks the merge as a failed status check, not as a comment
requiring human attention. Both workflows fetch the classifier from the base
branch rather than the PR's checkout, so a PR cannot alter the code that judges
it. A skipped review — produced when the reviewer declines to review a change to
its own machinery — classifies as not-clean for arming while remaining green for
the check, keeping such a change manually mergeable without ever auto-merging
unreviewed. Merge itself remains a human action unless auto-merge arms on a clean
verdict.

### 6. Reviewed-outcome feedback
A PR's review lands minutes after the agent's turn ends, on GitHub, with no
connection back to the machine. `/watch-review` supplies that connection: the
agent starts a bounded, read-only poll of its own PR, and because the harness
re-invokes a session when its background process exits, the review's completion
re-invokes the agent. The result is one classified outcome — merged (advance the
board), blocked (the findings are printed inline), ci-failed (a non-review check
is red), or needs-a-human (a self-skipped review) — read with the same
classifier as the merge gate, so "clean" means the same thing in both. A
PostToolUse hook (`watch-review-reminder.cjs`) triggers the watch after
`gh pr create`; the watch cannot run from the hook itself, because a
hook-spawned process has no tracked task for the harness to re-invoke.

## Boundaries
- **Team size.** The design assumes one merge authority and no CODEOWNERS. More
  than one maintainer requires added required reviewers and code ownership.
- **Session lifetime.** If the agent's session closes before the review lands,
  the poll is gone and the agent is not re-invoked; the PR itself still merges or
  waits on GitHub. A recurring sweep over open PRs is the intended backstop and
  requires a scheduled runner, so it is documented here rather than included.

## Scaling
The gates apply to every change; the effort inside them scales to the risk the
change carries. A typo fix passes through issue, branch, PR, and a brief review;
a change to money, personal data, or anything irreversible carries the full
weight of both contracts.
