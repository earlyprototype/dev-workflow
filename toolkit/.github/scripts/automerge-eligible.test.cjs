#!/usr/bin/env node
'use strict';
/**
 * automerge-eligible.test.cjs — plain node:assert tests for the review-verdict
 * eligibility gate (a MEDIUM finding blocks too; only LOW passes).
 * No framework (mirrors the repo's node-only style, e.g. the hooks). Throws on
 * the first failed assertion, so any failure exits non-zero; prints one PASS
 * line if all green.
 *
 * Run:  node .github/scripts/automerge-eligible.test.cjs
 */

const assert = require('node:assert');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const { isEligible, verdictOf, markersIn } = require('./automerge-eligible.cjs');

const SCRIPT = path.join(__dirname, 'automerge-eligible.cjs');

let count = 0;

// The exports exist and have the shapes the contract and the workflow rely on.
assert.strictEqual(typeof isEligible, 'function', 'isEligible must be exported as a function');
assert.strictEqual(typeof verdictOf, 'function', 'verdictOf must be exported as a function');
assert.strictEqual(typeof markersIn, 'function', 'markersIn must be exported as a function');
count += 3;

// verdictOf case runner.
function verdict(name, text, expected) {
  count++;
  assert.strictEqual(
    verdictOf(text),
    expected,
    `${name}: verdictOf(...) should be ${expected}`
  );
}

// isEligible case runner (isEligible === verdict PASS).
function eligible(name, text, expected) {
  count++;
  assert.strictEqual(
    isEligible(text),
    expected,
    `${name}: isEligible(...) should be ${expected}`
  );
}

// CLI exit-code runner — the review check branches on the process exit code, so
// the 0/1 mapping is itself part of the safety contract and must be tested.
function cli(name, input, expectedCode) {
  count++;
  const res = spawnSync(process.execPath, [SCRIPT], { input, encoding: 'utf8' });
  assert.strictEqual(
    res.status,
    expectedCode,
    `${name}: exit code should be ${expectedCode}, got ${res.status} (stderr: ${res.stderr})`
  );
}

// A realistic clean review body, shaped like the hosted reviewer's real output.
// A clean review carries no CRITICAL, HIGH, or MEDIUM finding — only LOW nits and
// informational notes may ride a PASS.
const CLEAN_REVIEW = [
  "**Claude finished the review in 2m 12s** — [View job](https://github.com/OWNER/REPO/actions/runs/123)",
  '',
  '### Review — PR #999: a routine change',
  '',
  'No CRITICAL, HIGH, or MEDIUM findings. One LOW nit.',
  '',
  '- LOW: trailing whitespace on line 3.',
  '',
  'AUTOMERGE_VERDICT: PASS',
].join('\n');

// A realistic MEDIUM-carrying review. The reviewer is instructed
// (claude-pr-review.yml) to set BLOCK on any CRITICAL, HIGH, or MEDIUM finding,
// so a review containing a MEDIUM classifies as BLOCK.
const MEDIUM_REVIEW = [
  "**Claude finished the review** — [View job](https://github.com/OWNER/REPO/actions/runs/789)",
  '',
  '### Review — PR #1001',
  '',
  '- MEDIUM: `parseValue` could silently coerce a bad input — validate it.',
  '- LOW: trailing whitespace on line 3.',
  '',
  'AUTOMERGE_VERDICT: BLOCK',
].join('\n');

// A realistic blocking review body ending in BLOCK.
const BLOCKING_REVIEW = [
  "**Claude finished the review** — [View job](https://github.com/OWNER/REPO/actions/runs/456)",
  '',
  '### Review — PR #1000',
  '',
  '**CRITICAL:** the code writes a value before validating it — a data-integrity risk.',
  '',
  'AUTOMERGE_VERDICT: BLOCK',
].join('\n');

// ---------- Clean PASS verdicts are eligible ----------
verdict('bare PASS line -> PASS', 'AUTOMERGE_VERDICT: PASS', 'PASS');
verdict('realistic clean review -> PASS', CLEAN_REVIEW, 'PASS');
eligible('realistic clean review is eligible', CLEAN_REVIEW, true);
verdict('lowercase pass -> PASS', 'automerge_verdict: pass', 'PASS');
verdict('PASS with a trailing tail comment -> PASS',
  'AUTOMERGE_VERDICT: PASS — no CRITICAL, HIGH, or MEDIUM findings', 'PASS');
verdict('bold markdown PASS -> PASS', '**AUTOMERGE_VERDICT: PASS**', 'PASS');
verdict('backtick PASS -> PASS', '`AUTOMERGE_VERDICT: PASS`', 'PASS');
verdict('list-item PASS -> PASS', '- AUTOMERGE_VERDICT: PASS', 'PASS');
verdict('blockquote PASS -> PASS', '> AUTOMERGE_VERDICT: PASS', 'PASS');

// ---------- BLOCK verdicts block ----------
verdict('bare BLOCK line -> BLOCK', 'AUTOMERGE_VERDICT: BLOCK', 'BLOCK');
verdict('realistic blocking review -> BLOCK', BLOCKING_REVIEW, 'BLOCK');
eligible('realistic blocking review is NOT eligible', BLOCKING_REVIEW, false);
verdict('bold BLOCK -> BLOCK', '**AUTOMERGE_VERDICT: BLOCK**', 'BLOCK');

// ---------- a review carrying a MEDIUM finding blocks (only LOW passes) ----------
verdict('MEDIUM-carrying review -> BLOCK', MEDIUM_REVIEW, 'BLOCK');
eligible('MEDIUM-carrying review is NOT eligible', MEDIUM_REVIEW, false);
cli('CLI MEDIUM-carrying review -> exit 1 (holds the merge)', MEDIUM_REVIEW, 1);

// ---------- Fail-closed: no verdict rendered ----------
verdict('empty string -> BLOCK', '', 'BLOCK');
verdict('whitespace only -> BLOCK', '   \n  \t ', 'BLOCK');
verdict('review with findings but NO verdict line -> BLOCK',
  'Some findings here, but the reviewer forgot the verdict line.', 'BLOCK');
verdict('non-string (null) -> BLOCK', null, 'BLOCK');
verdict('non-string (number) -> BLOCK', 123, 'BLOCK');
verdict('non-string (object) -> BLOCK', {}, 'BLOCK');
eligible('missing verdict is NOT eligible', 'no marker at all', false);

// ---------- SKIP CASE: a skipped review is NOT eligible (skip != pass) ----------
// When claude-code-action self-skips (a PR that edits the review workflow) it posts
// NO review, so the ARMING workflow (auto-merge.yml) reads an EMPTY body and hands it
// here. That skip must classify as BLOCK — never PASS — so arming never treats a skip
// as a clean review. (The `review` CHECK still goes green on skip via a separate
// branch in claude-pr-review.yml, so a human can still merge by hand; that greenness
// does not run through this classifier.)
eligible('skipped review (empty body) is NOT eligible for arming', '', false);
eligible('skipped review (whitespace-only body) is NOT eligible for arming', '  \n\t ', false);
eligible('skip masquerading as prose (no verdict line) is NOT eligible', 'Reviewer skipped; no verdict here.', false);
verdict('skipped review (empty body) -> BLOCK, not PASS', '', 'BLOCK');
cli('CLI skipped review (empty stdin) -> exit 1 (arming refuses)', '', 1);
cli('CLI skip-as-prose (no verdict) -> exit 1 (arming refuses)', 'reviewer skipped, nothing to read\n', 1);

// ---------- BLOCK wins over PASS (fail closed on contradiction) ----------
verdict('BLOCK then PASS on separate lines -> BLOCK',
  'AUTOMERGE_VERDICT: BLOCK\nAUTOMERGE_VERDICT: PASS', 'BLOCK');
verdict('PASS then BLOCK on separate lines -> BLOCK',
  'AUTOMERGE_VERDICT: PASS\nAUTOMERGE_VERDICT: BLOCK', 'BLOCK');

// ---------- A marker QUOTED mid-prose is NOT a verdict line ----------
// The reviewer might describe the format; that mention must not count as a
// verdict, and with no real verdict line the review fails closed to BLOCK.
verdict('mid-sentence mention is not a verdict -> BLOCK',
  'End your review with AUTOMERGE_VERDICT: PASS or AUTOMERGE_VERDICT: BLOCK.', 'BLOCK');
// The same mention, but a real PASS line follows -> the real line decides.
verdict('mid-sentence mention + real PASS line -> PASS',
  ['The rule: emit AUTOMERGE_VERDICT: PASS or AUTOMERGE_VERDICT: BLOCK.',
    '',
    'AUTOMERGE_VERDICT: PASS'].join('\n'), 'PASS');

// ---------- CRLF line endings (GitHub comment bodies are CRLF) ----------
verdict('CRLF clean review -> PASS',
  'No CRITICAL, HIGH, or MEDIUM findings.\r\n\r\nAUTOMERGE_VERDICT: PASS\r\n', 'PASS');
verdict('CRLF blocking review -> BLOCK',
  '**CRITICAL** issue.\r\n\r\nAUTOMERGE_VERDICT: BLOCK\r\n', 'BLOCK');

// ---------- markersIn returns the raw markers in order ----------
count++;
assert.deepStrictEqual(
  markersIn('AUTOMERGE_VERDICT: PASS\nAUTOMERGE_VERDICT: BLOCK'),
  ['PASS', 'BLOCK'],
  'markersIn should return both markers in document order'
);
count++;
assert.deepStrictEqual(markersIn('no markers here'), [], 'markersIn should return [] when none present');

// ---------- CLI exit-code contract ----------
cli('CLI clean review -> exit 0', CLEAN_REVIEW, 0);
cli('CLI bare PASS -> exit 0', 'AUTOMERGE_VERDICT: PASS\n', 0);
cli('CLI blocking review -> exit 1', BLOCKING_REVIEW, 1);
cli('CLI bare BLOCK -> exit 1', 'AUTOMERGE_VERDICT: BLOCK\n', 1);
cli('CLI empty stdin -> exit 1 (fail safe)', '', 1);
cli('CLI no verdict line -> exit 1 (fail safe)', 'findings but no verdict\n', 1);
cli('CLI PASS+BLOCK -> exit 1 (block wins)', 'AUTOMERGE_VERDICT: PASS\nAUTOMERGE_VERDICT: BLOCK\n', 1);

console.log(`PASS: all ${count} automerge-eligible (review-verdict) cases green`);
