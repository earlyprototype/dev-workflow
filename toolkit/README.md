# toolkit — the delivery-contract wiring

These are the runnable pieces of the [delivery contract](../delivery-contract/),
laid out exactly as they sit in a target repository. Copy the trees across as-is;
the paths inside the files already assume this layout, so nothing needs editing
to run.

```
toolkit/
├── .mcp.json                              → your repo root
├── .claude/
│   ├── settings.json                      registers the two hooks
│   ├── commands/{review,watch-review}.md  the two slash commands
│   └── hooks/
│       ├── review-gate.cjs                PreToolUse: gate the kanban done-move
│       ├── watch-review-reminder.cjs      PostToolUse: nudge /watch-review after a PR opens
│       ├── lib/write-review-log.cjs       stamps the review-proof log
│       ├── lib/watch-review.cjs           the bounded PR-review poll
│       └── tests/                         node:assert tests, run in CI
└── .github/
    ├── scripts/automerge-eligible.cjs     the shared verdict classifier (+ its test)
    └── workflows/{ci,claude-pr-review,auto-merge}.yml
```

## What connects to what

- **The review gate** (`review-gate.cjs`) is registered in `settings.json` as a
  PreToolUse hook on `mcp__kanbanger__propose_done` / `approve_done`. It blocks
  the board's done-move unless a review log exists for the exact `HEAD` commit
  and the tracked tree is clean. `/review` runs the review and calls
  `write-review-log.cjs` to stamp that log. The log is keyed by commit sha, so a
  new commit re-blocks until re-reviewed. A doc-only move logs a one-line waiver
  instead — the hook does not distinguish a review from a waiver, so that distinction is the author's to make.

- **The verdict gate** is three files sharing one classifier. `claude-pr-review.yml`
  runs the hosted reviewer, which ends with `AUTOMERGE_VERDICT: PASS` or `BLOCK`.
  `automerge-eligible.cjs` reads that line; on BLOCK it fails the required
  `review` check (holding the merge), on a genuine PASS it lets `auto-merge.yml`
  arm GitHub's native auto-merge. Both workflows fetch the classifier from the
  base branch, never the PR's copy, so a PR can't edit the code that judges it.
  A skipped review (empty output) is treated as BLOCK for arming but green for
  the check, so a review-machinery change stays manually mergeable without ever
  auto-merging unseen.

- **The watch loop** (`watch-review.cjs`, run via `/watch-review`) reads the same
  verdict with the same classifier, so "clean" means one thing everywhere. The
  reminder hook (`watch-review-reminder.cjs`) only makes sure the agent runs it.

Everything fails closed: an unreadable HEAD, an unreadable verdict, a crashed
gate, or a skipped review all resolve to "blocked / not eligible", never to a
false pass.

## Prerequisites

- **GitHub**, with branch protection on `main`: require the `checks` and
  `review` status checks and conversation resolution, and leave the bypass list
  empty (so even the owner merges through the gate, or via armed auto-merge).
- **[kanbanger](https://github.com/early-prototype/kanbanger-partymix)** for the
  board the review gate defends (or adapt the hook's matcher to your board tool).
- **The Claude GitHub app** connected, with a `CLAUDE_CODE_OAUTH_TOKEN` secret,
  for the hosted review.
- **Node** on the dev machine and in CI (the hooks are Node with no dependencies).

## Verifying

From `toolkit/`, the tests run with no app and no network:

```bash
node .claude/hooks/tests/review-gate.test.cjs
node .github/scripts/automerge-eligible.test.cjs
node .claude/hooks/tests/watch-review.test.cjs
node .claude/hooks/tests/watch-review-reminder.test.cjs
```

The workflow files under `.github/workflows/` here are inert: GitHub only runs
workflows from a repository's *root* `.github/workflows/`, never a nested one, so
this archive can carry them without them firing on itself.
