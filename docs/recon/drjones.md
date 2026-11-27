# DrJones Recon Brief: `earlyprototype/dev-workflow`
*Scout: Ranger Elytra (Paused-Repo Survey Detachment) | State: `near_complete` | Recorded: 2026-11-26T22:01:27Z*

## Summary
Near complete as a copy-in workflow. The repository ships requirements templates, a delivery contract, a bootstrap checklist, a diagrammed overview, and runnable hooks for review and merge. `git log -n 15 --oneline` returned seven commits. The toolkit landed in `0c9943e`. The latest commit, `43c35c3` on July 27, 2026, merged a README link correction. The README records use on one production project. The survey found no TODO or FIXME markers.

- **CI / Test Command:** `From `toolkit/`, run these four commands in order:
```
node .claude/hooks/tests/review-gate.test.cjs
node .github/scripts/automerge-eligible.test.cjs
node .claude/hooks/tests/watch-review.test.cjs
node .claude/hooks/tests/watch-review-reminder.test.cjs
```
On Node 24.15.0, the verdict suite passed 47 cases, the watcher passed 29, and the reminder passed 12. I inspected the 17 review-gate cases and skipped execution because they create temporary Git repositories. The three GitHub workflows live under `toolkit/` and become active when copied to a target repository’s root.`
- **Risks / Blockers:** Hosted review and merge behavior remain unverified in this checkout. The watcher result was reproduced locally. The auto-merge finding comes from workflow inspection. One onboarding link is still stale: `toolkit/README.md` uses the `early-prototype` owner corrected to `earlyprototype` in the root README by `41c9337`. The checkout remained clean.

## Recommended Actions
### [tier1_deterministic_fix] Bind auto-merge to the commit that received the review
- **Rationale:** The workflow reads the verdict for a specific run, then changes auto-merge by PR number. It uses the reviewed SHA to locate the PR but never checks whether that SHA is still the PR head. A late review can therefore change auto-merge for a newer commit. [Auto-merge workflow](C:/gant-ops/readonly_refs/earlyprototype__dev-workflow/toolkit/.github/workflows/auto-merge.yml:97)
- **Acceptance Criteria:** With two successive commits on one PR, a late result for the first leaves the second commit’s auto-merge setting untouched. A PASS for the current commit can arm auto-merge, and a BLOCK for it can disarm it.

### [tier1_deterministic_fix] Keep watching while the review check is absent
- **Rationale:** I passed the watcher an open PR with zero checks and no verdict. It returned terminal `needs-human` and reported that checks were green. A newly opened PR can therefore send the author to merge by hand before the review appears. [Watch classifier](C:/gant-ops/readonly_refs/earlyprototype__dev-workflow/toolkit/.claude/hooks/lib/watch-review.cjs:127)
- **Acceptance Criteria:** An empty first poll keeps watching. A later poll with a running review also keeps watching. A confirmed self-skip requests human review, and an unavailable check reaches the documented timeout with an accurate explanation.

### [tier1_deterministic_fix] Make the copied CI work before the target has an npm app
- **Rationale:** The bootstrap guide directs adopters to copy the toolkit as-is. Its CI enables npm caching and runs install, lint, typecheck, and coverage before any toolkit test. A fresh target has neither the required lockfile nor those scripts. [CI template](C:/gant-ops/readonly_refs/earlyprototype__dev-workflow/toolkit/.github/workflows/ci.yml:23)
- **Acceptance Criteria:** A target containing only the copied toolkit runs all four guard suites. An npm target that enables application checks still fails CI when lint, typecheck, coverage, or build fails.

### [tier2_discretionary_finish] Show one requirement traced to an executable test
- **Rationale:** The requirements contract calls forward traceability machine-checked. The module template supplies a table with a placeholder test name, and the toolkit ships no check for that table. An adopter has to infer how an uncovered criterion becomes visible. [Requirements contract](C:/gant-ops/readonly_refs/earlyprototype__dev-workflow/requirements-contract/README.md:40)
- **Acceptance Criteria:** One worked example connects a source requirement, an acceptance criterion, and a named test. It includes a check command that succeeds with the mapping present and reports the criterion when its test reference is removed.

### [human_decision_required] Choose the second project that can validate the method
- **Rationale:** The author explicitly keeps each element provisional until a second, different project exercises it. Choosing that project determines which portability claims the next trial can support. [README status](C:/gant-ops/readonly_refs/earlyprototype__dev-workflow/README.md:86)
- **Acceptance Criteria:** The author names the pilot, states how it differs from the first project, and identifies which requirements and delivery steps it will exercise.

> **Field Dispatch:** Ranger Elytra to Gant HQ. While the General defends democracy in Project Zomboid, the PR lookout has declared the road clear before the first sentry reported in.
