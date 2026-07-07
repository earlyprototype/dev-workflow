---
description: Watch a build PR through its review and report the outcome — merged, findings to fix, a red check, or a stall — so the result is acted on rather than missed
argument-hint: [PR number | blank to use the current branch's PR]
---

# /watch-review

Closes the loop between opening a PR and knowing what its review decided.
Opening a PR ends your turn, but the review lands minutes later on GitHub with
nothing wired back — so without this a PR can merge unnoticed, or stall on a
finding no one addresses. This parks a bounded, read-only watch on the PR and,
when it settles, tells you in plain English what happened and what to do next.

**Input**: $ARGUMENTS — a PR number, or blank to use the current branch's PR.

## When to run it

Right after you open the PR. One writer per branch: watch the PR you just
opened, from the worktree you opened it in. A PostToolUse hook
(`watch-review-reminder.cjs`) fires after `gh pr create` succeeds and reminds
you to run this. The hook cannot perform the watch itself — a hook-spawned
process has no tracked task for the harness to re-invoke — so it triggers the
agent's own tracked watch instead.

## How to run it

Launch it in the **background** so it frees your turn — the harness re-invokes
you when it exits, and the review landing is the wake-up:

```
node .claude/hooks/lib/watch-review.cjs $ARGUMENTS
```

Use the Bash tool with `run_in_background: true`. It polls every 20s, up to
25 min, and is **read-only** against GitHub — it never merges, comments, or
pushes.

## React to the outcome

When you are re-invoked, read the `WATCH_REVIEW_OUTCOME:` line and act:

| Outcome | What it means | Do |
|---|---|---|
| `merged` | Clean review; GitHub squash-merged it | Advance the card (`propose_done`), take the next slice |
| `blocked` | Review returned BLOCK — the findings are printed inline | Fix every finding, commit, push; the new commit re-runs the review — watch again |
| `ci-failed` | A required check other than the review went red | Fix the build, push, watch again |
| `needs-human` | Green, but the review self-skipped (the PR edits review machinery) — auto-merge will not arm | Ask the owner to merge by hand |
| `clean-pending` (or a timeout) | Green and PASS but not merged inside the window — usually an unresolved conversation | Resolve conversations, or re-run to keep watching |
| `closed` | The PR was closed unmerged | Stop; check why with the owner |
| `draft` | It is a draft, so no review runs | Fix any findings, mark it ready, watch again |

After a fix-and-push, run `/watch-review` again — each new commit gets a fresh
review, so the loop repeats until `merged`.

## Notes / ceiling

- **Read-only.** It reports; it never merges or pushes. The owner still owns the
  merge button — auto-merge arms only on a genuine clean verdict.
- **Bounded, not infinite.** It stops after 25 min so a stuck check cannot
  recreate the silent stall it exists to prevent; re-run to keep watching.
  Override with `WATCH_REVIEW_MAX_WAIT_MS` / `WATCH_REVIEW_INTERVAL_MS` if needed.
- **"Clean" is defined once.** It reads the review verdict with the same reader
  the merge gate uses (`.github/scripts/automerge-eligible.cjs`), so what it
  calls clean is exactly what auto-merge calls clean.
- **Session death is the one gap.** If your session closes before the review
  lands, this warm loop is gone — the PR is not lost (it still merges or waits on
  GitHub), you just won't be re-invoked. A recurring sweep over open PRs is the
  planned backstop (deferred).
