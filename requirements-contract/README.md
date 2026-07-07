# The requirements contract

What must be true, traced to tests. This is the judgment half of the workflow —
the part no hook can enforce for you, because it's about deciding what to build
and proving you built all of it. Where the [delivery contract](../delivery-contract/)
is wiring, this is discipline.

The failure it exists to prevent is the quiet one: a requirement that was in
scope, silently not built, with nothing to catch it — because tests only test
the code that exists, not the code that should have existed. Everything below is
built to make a dropped requirement *visible*.

## The pieces

### 1. A single source of truth
One authoritative requirements document outranks everything else — every module
extract, every plan, every "I think we agreed". If it's contested, you change
*that* document, deliberately, not the interpretation. A change to a requirement
is a numbered open question resolved before any code, never a quiet
reinterpretation mid-build.

### 2. A scoped extract per unit of work
Each unit of work gets its own extract from the source of truth — a per-module
PRD ([`module-prd-template.md`](module-prd-template.md)):

- **Traceable line by line** back to the source, so anyone can check it neither
  invented scope nor dropped it.
- **Verified by someone other than its author** — the person who scoped it is
  the person least able to see what they left out.
- **Kept lean.** An extract that sprawls past a page or two stops being read,
  which makes it worse than none. It's a checklist, not a prose re-description of
  the whole system.

### 3. A completeness checklist
The extract carries a checklist: every deliverable element tied to a requirement,
as a box. A built element ticks its box; a dropped one shows as an unticked box,
not a silent gap. This is the whole trick — it turns "did we forget anything?"
from a judgment call into something you can *see*.

### 4. Acceptance criteria that seed the tests
Each checklist item carries an acceptance criterion, and each criterion seeds a
test. This makes traceability directional, and the direction matters:

- **Forward (requirement → test) is mandatory and machine-checked.** Every
  acceptance criterion must have a test that proves it. A green suite then means
  something specific: nothing in scope was silently dropped.
- **Backward (code → requirement) is *not* required.** Mechanism — error
  handling, structure, naming, the plumbing a reasonable person never asked for
  by name — is free and doesn't need to trace to a requirement. Only *behaviour a
  reasonable person has a stake in* needs to trace. Demanding a requirement
  behind every line just manufactures fake requirements to satisfy the check.

## The build loop

Before any code, and then through it: **observe → propose → adversarial review →
align → build.**

1. **Observe.** Read the contextualisation manifest
   ([`contextualisation-manifest-template.md`](contextualisation-manifest-template.md))
   — a reading list scoped to this unit of work, each item marked *read in full*
   / *held as a constraint* / *consulted only if touched*. Any existing working
   implementation — a prior prototype, a legacy system, a competitor — is
   **required** reading, not optional: an untested predecessor is exactly where a
   silent regression hides. Produce a short summary of what was read and what
   constraints follow — a checkable artifact, not a tick-box claim.
2. **Propose.** A coverage map (each acceptance criterion → the test that will
   prove it), a deviations list (what's added beyond the contract, what's cut and
   why, what's ambiguous), and the one visible behaviour this unit will
   demonstrate end-to-end.
3. **Adversarial review.** A second, independent reviewer checks two things only:
   is anything in the contract left uncovered, and is anything in the code a
   decision dressed up as craft? Its job is to find the gap the author can't see.
4. **Align.** A human resolves whatever got flagged — a real gap changes the
   plan; a real ambiguity goes back to the source of truth.
5. **Build.** Test-first, against the now-complete contract.

## Two gated PRs, not one
The requirements sign-off ships as its **own PR**, separate from and before the
implementation PR. The build cannot start until the checklist PR merges. This
keeps the gate structural rather than optional: no build effort is spent before a
requirement is approved, and a wrong requirement is caught while it's still cheap
— a paragraph to fix, not a feature to rewrite.

## The unit of delivery
Deliver **one visible behaviour, built end-to-end and shown working** — not a
screen with no data behind it, and not a data layer with no screen on top. A
behaviour a person can watch happen is the thing that's either done or not; "the
UI" and "the backend", built separately, are each half-done in a way that hides
the seam where things silently break.
