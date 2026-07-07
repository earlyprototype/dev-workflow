# Bootstrapping a new project with this workflow

Stand the two contracts up in a new repository, in dependency order. Each step
assumes the ones before it. Nothing here is heavy; the point is to wire the gates
*before* the first real change, not after the first thing slips through.

## Day one — before the first change

1. **Name the source of truth.** Even a lean requirements document, as long as
   it's the one thing that outranks everything else. Put it where it won't be
   mistaken for notes (e.g. `docs/PRD.md`).
2. **Start the ADR log.** Create `docs/DECISIONS.md` and record the first
   decision — often "we're using this workflow" — with the
   [ADR template](delivery-contract/adr-template.md). Starting it on day one is
   the point; nobody backfills a decision log.
3. **Protect `main`.** Branch protection: require status checks and conversation
   resolution, squash-only, and an empty bypass list. This is what makes every
   later gate real rather than advisory.

## Wire the delivery gates — before the first real PR

4. **Copy the toolkit in.** From [`toolkit/`](toolkit/): `.claude/` and
   `.github/` into your repo at the same paths, and `.mcp.json` to the root. The
   [toolkit README](toolkit/README.md) maps what goes where.
5. **Install the prerequisites.** kanbanger (or adapt the review-gate matcher to
   your board tool); connect the Claude GitHub app and set the
   `CLAUDE_CODE_OAUTH_TOKEN` secret; confirm Node runs in CI.
6. **Make `checks` and `review` required.** Add both to the branch ruleset so a
   red CI or a BLOCK verdict actually holds the merge.
7. **Prove it once.** Open a throwaway PR and watch the gates fire: CI runs the
   hook tests, the reviewer posts a verdict, and a clean one arms auto-merge.
   Bootstrap note: the PR that first introduces the review workflow self-skips
   (the reviewer won't review changes to its own machinery), so that first one is
   merged by hand — every PR after it is gated.

## Turn on the loop — once an automated review exists to watch

8. **Use `/watch-review`** after opening a PR, so the agent learns its own
   outcome instead of walking away. The reminder hook is already wired by step 4;
   it fires after `gh pr create`.

## Adopt the requirements discipline — per unit of work

9. For each unit of work, before code: a scoped
   [module PRD](requirements-contract/module-prd-template.md) with its
   completeness checklist, a
   [contextualisation manifest](requirements-contract/contextualisation-manifest-template.md),
   and the observe → propose → adversarial review → align → build loop. Ship the
   checklist as its own PR before the build PR.

## Scale to the change
The gates stay on for everything; the effort inside them scales to the risk. A
typo fix is an issue, a branch, a PR, and a glance. A change touching money,
personal data, or anything hard to reverse earns the full weight of both
contracts.
