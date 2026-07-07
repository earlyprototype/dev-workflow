---
description: Fresh-context code review for a build PR — handed the coding standards, logs the proof the review-gate hook checks
argument-hint: [blank for a review | "waiver: <one-line reason>" for a no-code/doc change]
---

# /review

Runs the mandatory fresh-context code review that gates the kanban done-moves
(`propose_done` / `approve_done`), then writes the proof log the `review-gate`
hook reads. Without that log, the gate blocks the move.

**Input**: $ARGUMENTS

## Mode

- Blank / normal → **Review mode**.
- Starts with `waiver:` → **Waiver mode** (a genuinely no-code or doc-only change:
  record a one-line justification instead of a review).

---

## Review mode

### 1. Hand the reviewer the standards

The review judges against your stated standard — load these as the explicit checklist
before reviewing (do not rely on what the reviewer happens to know):

- your coding-standards reference (a skill, a `docs/coding-standards.md`, or equivalent)
- for any UI change, your design rulebook

### 2. Run the fresh review

Delegate to a clean-context reviewer so the judgment is independent of the build
session (this is what makes it *fresh-context*: the reviewer shares none of the
builder's context and so does not inherit the builder's blind spots):

```
Task(subagent_type: "code-reviewer",
     prompt: "Review the changes on this branch against the coding standards you are
              handed. Report CRITICAL/HIGH/MEDIUM/LOW with file:line and a concrete
              fix for each. Compare explicitly against those standards.")
```

Scope = the build PR's diff (`git diff main...HEAD --name-only`). For anything touching
login, roles, personal data, or credentials, also run a security review.

### 3. Triage

Fix every **CRITICAL** and **HIGH** before logging. Triage MEDIUM/LOW (fix, or note why
not). A finding that exposes a gap in the signed checklist is a **flagged follow-up**,
never a silent edit to make the build pass.

### 4. Log the proof

Once CRITICAL/HIGH are cleared and your work is committed (the gate also blocks a dirty
tracked tree), stamp the log:

```bash
node .claude/hooks/lib/write-review-log.cjs --summary "<counts + what was triaged, e.g. 0 CRITICAL/HIGH; 2 MEDIUM fixed>"
```

This writes `.claude/review-log/<HEAD>.md`. The review-gate hook will then allow
`propose_done` / `approve_done` for this commit. A new commit moves HEAD, so it requires
a fresh review.

---

## Waiver mode

For a genuinely no-code or doc-only move where a code review does not apply:

```bash
node .claude/hooks/lib/write-review-log.cjs --kind waiver --summary "doc-only, no code — <reason>"
```

The waiver is the logged trail. The build-vs-doc judgment is yours, not the hook's —
the hook only checks that *some* entry exists for this commit.

---

## Notes / ceiling

- The log binds to the current commit (HEAD). Commit first; an uncommitted tracked change
  re-blocks the gate.
- The log is **worktree-local** (untracked, gitignored) — it lives only where you ran
  `/review`. Run the review and the kanban done-move from the **same** worktree, or
  the gate won't find the log and will block.
- The hook proves a review was **logged** against this commit; it does not establish that
  the review was thorough. That remains a matter of reviewer diligence.
- The hook gates the MCP done-moves; it cannot block a Stop hook that edits the board
  file directly. Running `/review` before clocking out is what closes that.
