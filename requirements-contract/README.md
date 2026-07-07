# The requirements contract

What must be true, traced to tests. This half of the workflow is not enforced by
tooling: it concerns deciding what to build and establishing that all of it was
built. It exists to prevent a specific failure — a requirement that was in scope
but never built — which automated tests do not catch, because tests exercise the
code that exists, not the code that should exist. Each element below makes a
dropped requirement observable.

## The pieces

### 1. A single source of truth
One authoritative requirements document outranks every module extract, plan, and
recollection. A contested requirement is resolved by changing that document
deliberately — as a numbered open question settled before code — rather than by
reinterpreting it during a build.

### 2. A scoped extract per unit of work
Each unit of work has its own extract from the source of truth, a per-module PRD
([`module-prd-template.md`](module-prd-template.md)):

- **Traceable line by line** to the source, so a reader can confirm it neither
  added scope nor dropped it.
- **Verified by someone other than its author.** An author is unlikely to notice
  scope they themselves omitted; an independent reader is the check on that.
- **Short** — one to two pages. The extract functions as a checklist consulted
  during the build, not a prose restatement of the system.

### 3. A completeness checklist
The extract carries a checklist tying every deliverable element to a requirement,
as a box. A built element ticks its box; a dropped element remains an unticked
box. An omission therefore appears as a visible unfilled item rather than as an
absence, and an unfilled item is detectable on inspection where an absence is
not.

### 4. Acceptance criteria that seed tests
Each checklist item carries an acceptance criterion, and each criterion seeds a
test. Traceability is directional:

- **Forward (requirement → test) is mandatory and machine-checked.** Every
  acceptance criterion has a test that proves it, so a passing suite establishes
  that nothing in scope was dropped.
- **Backward (code → requirement) is not required.** Mechanism — error handling,
  structure, naming — need not trace to a requirement; only behaviour a
  reasonable person has a stake in does. Requiring a source requirement behind
  every line produces requirements written to satisfy the check rather than to
  describe a need.

## The build loop

Before code, and through it: **observe → propose → adversarial review → align →
build.**

1. **Observe.** Read the contextualisation manifest
   ([`contextualisation-manifest-template.md`](contextualisation-manifest-template.md)):
   a reading list scoped to the unit of work, each item marked *read in full* /
   *held as a constraint* / *consulted only if touched*. Any existing working
   implementation — a prior prototype, a legacy system, a competitor — is
   required reading; an untested predecessor is a common source of silent
   regressions. The step produces a short written summary of what was read and
   the constraints that follow, which is the checkable evidence that it occurred.
2. **Propose.** A coverage map (each acceptance criterion to the test that will
   prove it), a deviations list (additions beyond the contract, omissions and
   their reasons, ambiguities), and the single visible behaviour the unit will
   demonstrate end-to-end.
3. **Adversarial review.** A second, independent reviewer checks two things: that
   nothing in the contract is left uncovered, and that no decision is presented
   as mere craft. Its purpose is to surface the gap the author did not see.
4. **Align.** A human resolves what was flagged: a real gap changes the plan; a
   real ambiguity returns to the source of truth.
5. **Build.** Test-first, against the completed contract.

## Two gated PRs
The requirements sign-off is its own PR, separate from and preceding the
implementation PR, and the build does not start until it merges. Separating them
means no build effort is spent before a requirement is approved, and a wrong
requirement is corrected while it is still a paragraph rather than a feature.

## The unit of delivery
The unit delivered is one visible behaviour, built end-to-end and shown working —
not a screen without data behind it, nor a data layer without a screen. A
behaviour that can be observed is unambiguously done or not done; a UI and a
backend built separately are each partially complete at the boundary between
them, where integration failures are least visible.
