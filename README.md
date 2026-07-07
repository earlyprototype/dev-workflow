# dev-workflow

A working record of the delivery process and tooling used to build software
with an AI collaborator — kept here so it can be pulled into a new project
rather than reconstructed from memory each time.

This is not a finished methodology. It is updated as pieces prove
themselves on real projects; entries below name the project they were
proven on.

## The pipeline

Every change moves through the same stages, enforced mechanically where
possible rather than relied on as convention:

1. **Issue first.** A change starts as a tracked issue — the agreed
   approach recorded before work starts, closed with a comment stating the
   outcome.
2. **Decisions recorded as they're made.** An ADR log captures what was
   decided, why, what else was considered, and what would change the
   decision — not just what shipped.
3. **Branch, never main directly.** One branch per issue; commits and PRs
   reference the issue number.
4. **Gated review before merge.** Every PR is reviewed — automated and/or
   human — against a stated severity scale. A CRITICAL/HIGH/MEDIUM finding
   blocks the merge; only LOW rides through.
5. **Merge gated on verdict, not on habit.** CI green, review clean, every
   conversation resolved — checked mechanically, not just expected.
6. **The agent that opened the PR learns what happened to it.** Opening a
   PR does not end the work: the agent watches for its own review outcome
   and reacts — fixes findings, advances the task, or asks a human —
   instead of the PR going quiet.

## Tools that implement it

| Tool | Stage | What it does |
|---|---|---|
| ADR log (`docs/DECISIONS.md` convention) | 2 | One entry per decision: context, decision, consequences, revisit trigger. |
| Review-gate hook (PreToolUse) | 4 | Blocks a task board's done-move until a review is logged against the current commit; a new commit re-blocks it. |
| Verdict-gated auto-merge (GitHub Action) | 5 | Reads the review's verdict and arms auto-merge only on a clean result; a CRITICAL/HIGH/MEDIUM finding fails the required check instead. |
| Review-watch loop (`/watch-review`) | 6 | The agent backgrounds a bounded, read-only poll on its own PR; when the review lands, it reports merged / blocked-with-findings / build-broken / needs-a-human, instead of the agent walking away blind. |
| Review-watch reminder (PostToolUse hook) | 6 | Fires right after a PR is opened and reminds the agent to run the watch — a hook can't do the watching itself (no tracked task to wake), so its only job is making sure the step isn't forgotten. |

*Proven on:* LCCL (a charity-shop till and community app), July 2026.

## Bootstrapping a new project with this

1. Set up issue-first branching: every change gets an issue before a branch.
2. Start the ADR log on day one, not once decisions have piled up.
3. Wire the review gate and verdict-gated auto-merge before the first real
   PR, not after the first incident.
4. Add the review-watch loop once PRs are routinely gated on an automated
   review — it has nothing to watch before that exists.
5. Add the reminder hook once the watch loop is proven; it is a small
   guardrail on top, not a starting point.

## Status

One project deep. Treat anything above as a candidate pattern, not a
settled standard, until it has survived a second, different project.
