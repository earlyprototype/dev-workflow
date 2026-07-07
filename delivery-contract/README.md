# The delivery contract

How a change physically moves from idea to merged code. This is the mechanical
half of the workflow — issue → branch → PR → gated review → verdict-gated merge
→ the agent watching its own PR. The runnable wiring is in
[`../toolkit/`](../toolkit/); this explains what each piece is for and why it's
shaped the way it is.

The governing idea: **enforce it with wiring, not willpower.** Anything that
depends on remembering to do it will eventually be skipped under pressure. So
each stage that can be a gate is a gate, and each gate **fails closed** — an
error, an unreadable state, or a missing proof resolves to "blocked", never to
"allowed".

## The stages

### 1. Issue first
A change starts as a tracked issue that records the agreed approach *before*
work begins, and is closed with a comment stating what actually happened. The
issue is the anchor: branches, commits, and the PR all reference its number, so
the trail from intent to merged code stays legible later.

### 2. Decisions recorded as they're made
An ADR log (`docs/DECISIONS.md`) captures each decision as it's taken — the
context, the decision, the consequences, and what would make you revisit it. Not
just what shipped, but why, and what you considered instead. Use
[`adr-template.md`](adr-template.md). The value shows up months later, when the
top-level docs have drifted and the log is the only place the reasoning survives.

### 3. Branch, never main directly
One branch per issue; one writer per branch. `main` is protected — a ruleset
requires the status checks and conversation resolution and keeps its bypass list
empty, so nobody merges around the gates, including the owner.

### 4. Gated review before merge
Every PR is reviewed against a stated severity scale (CRITICAL / HIGH / MEDIUM /
LOW), in two layers:

- **A fresh-context review** before the work is even proposed done. `/review`
  hands a clean-context reviewer the coding standards and has it report findings
  with file:line and a concrete fix each. "Fresh-context" is the point: the
  builder can't wave its own work through, because the reviewer doesn't share
  the builder's context or its blind spots. The `review-gate.cjs` PreToolUse
  hook then blocks the kanban done-move until that review is logged against the
  current commit — a new commit re-blocks until re-reviewed.
- **An automated PR review** on GitHub (`claude-pr-review.yml`) that posts
  findings and ends with a single machine-readable verdict line.

A CRITICAL / HIGH / MEDIUM finding blocks the merge; only LOW rides through.

### 5. Merge gated on verdict, not habit
The automated reviewer ends with `AUTOMERGE_VERDICT: PASS` or `BLOCK`. One
classifier (`automerge-eligible.cjs`) reads that line and is the single source
of truth for "is this review clean?":

- it runs inside the required `review` check, so a BLOCK fails the check and
  branch protection holds the merge; and
- it runs inside the arming workflow (`auto-merge.yml`), which turns on GitHub's
  native auto-merge *only* on a genuine PASS.

So a finding blocks the merge **mechanically**, not merely as a posted comment.
Both workflows fetch the classifier from the base branch, never the PR's own
copy, so a PR can't edit the code that judges it. And a *skipped* review (the
reviewer declines to review a change to its own machinery) counts as "not clean"
for arming while staying green for the check — so such a change stays manually
mergeable but never auto-merges unseen. Merge itself stays human unless
auto-merge arms on a clean verdict.

### 6. The agent watches its own PR
Opening a PR ends the agent's turn, but the review lands minutes later on GitHub
with nothing wired back to the machine — so a PR can merge unnoticed, or stall on
a finding no one sees. `/watch-review` closes that: the agent backgrounds a
bounded, read-only poll on its own PR (the harness re-invokes it when the poll
exits, so the review landing is the wake-up), and it reports, in plain English,
one of: merged (advance the board), blocked (fix the findings, printed inline),
ci-failed (fix the build), or needs-a-human (a self-skipped review — ask the
owner). It reads the verdict with the *same* classifier as the merge gate, so
"clean" means one thing everywhere. A PostToolUse hook
(`watch-review-reminder.cjs`) fires after `gh pr create` and reminds the agent
to run it — a hook can't do the watching itself (a hook-spawned process has no
tracked task for the harness to wake), so its only job is that the step is never
forgotten.

## What this deliberately doesn't cover

- **A team.** It assumes a single merge authority and no CODEOWNERS. With more
  than one maintainer, add required reviewers and code ownership on top.
- **The session-death gap.** If the agent's session closes before the review
  lands, the warm watch loop is gone — the PR still merges or waits on GitHub,
  but the agent won't be re-invoked. A recurring sweep over open PRs is the
  planned backstop; it needs a scheduled runner, so it's noted, not shipped.

## Scale it down
Not every change earns all six stages at full weight. A typo fix is still an
issue and a PR, but its review is a glance and its ADR entry is nothing. The
gates stay on — they're cheap when there's nothing to find — while the *effort*
inside them scales to the risk.
