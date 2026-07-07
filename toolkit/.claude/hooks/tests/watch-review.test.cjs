#!/usr/bin/env node
'use strict';
/**
 * watch-review.test.cjs — plain node:assert tests for the review-watch classifier
 * (the loop that lets a build agent learn its PR's review outcome instead of
 * walking away blind). No framework — mirrors the repo's node-only test style.
 * Throws on the first failed assertion, so any failure exits non-zero; prints one
 * PASS line if all green.
 *
 * The classifier is PURE — it takes a normalised PR snapshot and returns the
 * outcome + the agent's next action. That decision is what gates whether a PR
 * silently stalls, so it is what is tested here; the gh plumbing around it is a
 * thin, separately smoke-tested shell.
 *
 * Run:  node .claude/hooks/tests/watch-review.test.cjs
 */

const assert = require('node:assert');
const { classify, reviewVerdict, exitCodeFor } =
  require('../lib/watch-review.cjs');

let count = 0;

// ---- shape contract ----
assert.strictEqual(typeof classify, 'function', 'classify must be exported as a function');
assert.strictEqual(typeof reviewVerdict, 'function', 'reviewVerdict must be exported as a function');
assert.strictEqual(typeof exitCodeFor, 'function', 'exitCodeFor must be exported as a function');
count += 3;

// classify case runner. Asserts outcome, and (when given) action + terminal.
function cls(name, snap, expOutcome, expAction, expTerminal) {
  count++;
  const r = classify(snap);
  assert.strictEqual(r.outcome, expOutcome, `${name}: outcome should be ${expOutcome}, got ${r.outcome}`);
  if (expAction !== undefined) {
    assert.strictEqual(r.action, expAction, `${name}: action should be ${expAction}, got ${r.action}`);
  }
  if (expTerminal !== undefined) {
    assert.strictEqual(r.terminal, expTerminal, `${name}: terminal should be ${expTerminal}, got ${r.terminal}`);
  }
  assert.ok(typeof r.summary === 'string' && r.summary.length > 0, `${name}: summary must be a non-empty string`);
}

function rv(name, body, expected) {
  count++;
  assert.strictEqual(reviewVerdict(body), expected, `${name}: reviewVerdict(...) should be ${expected}`);
}

function ec(name, outcome, expected) {
  count++;
  assert.strictEqual(exitCodeFor(outcome), expected, `${name}: exitCodeFor(${outcome}) should be ${expected}`);
}

// Convenience: a green check row and a failed one.
const pass = (name) => ({ name, bucket: 'pass' });
const fail = (name) => ({ name, bucket: 'fail' });
const pend = (name) => ({ name, bucket: 'pending' });

// ---------- reviewVerdict: SKIP vs PASS vs BLOCK ----------
// null body = no claude[bot] verdict comment exists AFTER the run completed = the
// reviewer self-skipped (a PR that edits the review machinery). Never PASS.
rv('null comment -> SKIP (self-skip)', null, 'SKIP');
rv('undefined comment -> SKIP', undefined, 'SKIP');
// A present comment is judged by the SAME verdict reader the merge gate uses.
rv('comment with PASS line -> PASS', 'looks good\n\nAUTOMERGE_VERDICT: PASS', 'PASS');
rv('comment with BLOCK line -> BLOCK', 'a MEDIUM issue\n\nAUTOMERGE_VERDICT: BLOCK', 'BLOCK');
rv('empty-string comment -> BLOCK (fail safe)', '', 'BLOCK');
rv('comment with no verdict line -> BLOCK (fail safe)', 'findings but no verdict line', 'BLOCK');

// ---------- terminal outcomes: the PR has settled, the agent acts ----------
cls('merged wins over everything',
  { state: 'MERGED', isDraft: false, checks: [pend('CI')], reviewVerdict: 'PASS' },
  'merged', 'advance', true);
cls('closed unmerged -> stop',
  { state: 'CLOSED', isDraft: false, checks: [], reviewVerdict: 'PASS' },
  'closed', 'stop', true);
cls('draft -> mark ready',
  { state: 'OPEN', isDraft: true, checks: [pass('CI')], reviewVerdict: 'PASS' },
  'draft', 'ready', true);
cls('review verdict BLOCK -> fix findings',
  { state: 'OPEN', isDraft: false, checks: [pass('CI'), fail('review')], reviewVerdict: 'BLOCK' },
  'blocked', 'fix-findings', true);
cls('review CHECK failed even if verdict unreadable -> blocked',
  { state: 'OPEN', isDraft: false, checks: [pass('CI'), fail('review')], reviewVerdict: 'PASS' },
  'blocked', 'fix-findings', true);
cls('non-review check failed, review clean -> fix build',
  { state: 'OPEN', isDraft: false, checks: [fail('CI'), pass('review')], reviewVerdict: 'PASS' },
  'ci-failed', 'fix-build', true);
// A check merely containing "review" in its name (e.g. a future "code-review"
// lint step) is not the gating review check — only an exact name match is.
cls('a check merely named like "review" does not count as the review check',
  { state: 'OPEN', isDraft: false, checks: [fail('code-review')], reviewVerdict: 'PASS' },
  'ci-failed', 'fix-build', true);
cls('green + review SKIP -> needs a human (auto-merge will not arm)',
  { state: 'OPEN', isDraft: false, checks: [pass('CI')], reviewVerdict: 'SKIP' },
  'needs-human', 'ask-human', true);

// ---------- non-terminal outcomes: keep watching ----------
cls('checks still pending -> keep watching',
  { state: 'OPEN', isDraft: false, checks: [pend('CI'), pass('review')], reviewVerdict: 'PASS' },
  'pending', 'keep-watching', false);
cls('green + PASS but not merged yet -> keep watching (auto-merge finalising)',
  { state: 'OPEN', isDraft: false, checks: [pass('CI'), pass('review')], reviewVerdict: 'PASS' },
  'clean-pending', 'keep-watching', false);

// ---------- priority ordering ----------
// A BLOCK verdict is more actionable than a coincident CI failure: surface the
// findings first (the CI red will re-surface next round if it outlives the fix).
cls('BLOCK beats a coincident CI failure',
  { state: 'OPEN', isDraft: false, checks: [fail('CI'), fail('review')], reviewVerdict: 'BLOCK' },
  'blocked', 'fix-findings', true);
// Merged always wins, even mid-review-block snapshot race.
cls('merged beats a stale BLOCK',
  { state: 'MERGED', isDraft: false, checks: [fail('review')], reviewVerdict: 'BLOCK' },
  'merged', 'advance', true);

// ---------- defensive: missing/odd fields never throw ----------
cls('missing checks array -> treated as none, green+PASS keeps watching',
  { state: 'OPEN', isDraft: false, reviewVerdict: 'PASS' },
  'clean-pending', 'keep-watching', false);

// ---------- exit-code contract: 0 only when merged ----------
ec('merged -> exit 0', 'merged', 0);
ec('blocked -> exit 1', 'blocked', 1);
ec('ci-failed -> exit 1', 'ci-failed', 1);
ec('needs-human -> exit 1', 'needs-human', 1);
ec('clean-pending -> exit 1', 'clean-pending', 1);
ec('closed -> exit 1', 'closed', 1);
ec('draft -> exit 1', 'draft', 1);

console.log(`PASS: all ${count} watch-review classifier cases green`);
