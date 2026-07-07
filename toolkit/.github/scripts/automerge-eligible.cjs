#!/usr/bin/env node
'use strict';
/**
 * automerge-eligible.cjs — the auto-merge eligibility gate.
 *
 * WHAT ELIGIBILITY MEANS. A pull request is eligible to auto-merge once its
 * REVIEW VERDICT is clean: CI green + no CRITICAL, HIGH, or MEDIUM review finding
 * + conversations resolved, code included. There is no path allowlist — the
 * review verdict IS the gate. So this file does not classify file paths; it
 * classifies the reviewer's verdict.
 *
 * TWO CALLERS, ONE VERDICT. This classifier is the single source of truth for
 * "is this review clean?", read by BOTH gates:
 *   1. the `review` required status check (.github/workflows/claude-pr-review.yml)
 *      — a BLOCK exit fails the check and holds the merge; and
 *   2. the ARMING workflow (.github/workflows/auto-merge.yml) — which arms GitHub's
 *      native auto-merge ONLY when this classifier returns PASS for the review run.
 * The hosted reviewer is told to end its review with exactly one machine-readable
 * line:
 *     AUTOMERGE_VERDICT: PASS    (no CRITICAL, HIGH, or MEDIUM findings)
 *     AUTOMERGE_VERDICT: BLOCK   (at least one CRITICAL, HIGH, or MEDIUM finding)
 * A caller pipes that review text into this script; a BLOCK exit fails the `review`
 * check (caller 1) and refuses to arm (caller 2), and the branch protection ruleset
 * (empty bypass list) then holds the merge. That is what makes a CRITICAL/HIGH/MEDIUM
 * finding block the merge MECHANICALLY, not merely as a posted comment. The
 * severity-to-verdict mapping itself lives in the reviewer's prompt
 * (claude-pr-review.yml); this classifier reads only the verdict line.
 *
 * SKIP IS NOT PASS. When claude-code-action self-skips (on a PR that edits the
 * review workflow) it posts NO review, so the text handed here is empty — which is
 * BLOCK, not PASS. This is load-bearing: a skipped review can never be "eligible",
 * so auto-merge.yml never arms on a skip. The `review` check still goes green on
 * skip by a SEPARATE branch in claude-pr-review.yml (so a human can merge) — that
 * greenness is not routed through this classifier, and must not be mistaken for one.
 *
 * FAIL-CLOSED, like its sibling .claude/hooks/review-gate.cjs:
 *   - no verdict line rendered   -> BLOCK (a review that did not render a verdict
 *                                   cannot clear a merge)
 *   - reviewer skipped / empty   -> BLOCK (a skip is not a clean review)
 *   - any BLOCK line present     -> BLOCK (block wins over any PASS)
 *   - empty / non-string input   -> BLOCK
 * Only an unambiguous PASS (>= 1 PASS line, no BLOCK line) is eligible.
 *
 * A verdict is read only from a LINE whose content is the marker (after stripping
 * surrounding markdown decoration). That keeps a marker QUOTED inside prose — an
 * instruction the reviewer might echo, or a sentence about the format — from being
 * mistaken for the verdict itself.
 *
 * Pure core: verdictOf(text) -> 'PASS'|'BLOCK', isEligible(text) -> boolean,
 * markersIn(text) -> ('PASS'|'BLOCK')[]. Node builtins only.
 * CLI (require.main === module): reads the review text from STDIN, prints a
 * one-line reason to stderr, exits 0 (eligible / PASS) or 1 (block).
 */

const TAG = '[automerge-eligible]';

// A verdict LINE begins (after decoration is stripped) with the marker followed
// by PASS or BLOCK. No trailing anchor: a line may carry a short tail comment
// ("AUTOMERGE_VERDICT: PASS — no CRITICAL findings") and still count.
const VERDICT_LINE = /^AUTOMERGE_VERDICT:\s*(PASS|BLOCK)\b/i;

/**
 * markersIn(text) -> array of 'PASS'|'BLOCK' in document order.
 * Each source line is stripped of leading list/heading/quote/emphasis chars and
 * trailing emphasis/whitespace before matching, so `**AUTOMERGE_VERDICT: PASS**`,
 * `> AUTOMERGE_VERDICT: BLOCK`, and `- AUTOMERGE_VERDICT: pass` all resolve, while
 * a prose line that merely mentions the marker mid-sentence does not.
 */
function markersIn(text) {
  if (typeof text !== 'string') return [];
  const out = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/^[\s>*_`#-]+/, '').replace(/[\s*_`.]+$/, '');
    const m = VERDICT_LINE.exec(line);
    if (m) out.push(m[1].toUpperCase());
  }
  return out;
}

/**
 * verdictOf(text) -> 'PASS' | 'BLOCK'
 * BLOCK unless the review rendered a clean verdict: at least one PASS line and no
 * BLOCK line. No verdict line at all -> BLOCK. BLOCK always wins (fail closed).
 */
function verdictOf(text) {
  const markers = markersIn(text);
  if (markers.length === 0) return 'BLOCK';
  if (markers.includes('BLOCK')) return 'BLOCK';
  return 'PASS';
}

/**
 * isEligible(text) — may this PR auto-merge, judged by its review verdict?
 * True only for an unambiguous PASS.
 */
function isEligible(text) {
  return verdictOf(text) === 'PASS';
}

module.exports = { verdictOf, isEligible, markersIn };

// ---------- CLI ----------
if (require.main === module) {
  let input = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', chunk => { input += chunk; });
  process.stdin.on('end', () => {
    if (isEligible(input)) {
      process.stderr.write(
        `${TAG} ELIGIBLE: review verdict PASS — no CRITICAL/HIGH/MEDIUM findings; ` +
        `auto-merge may proceed once CI and conversation-resolution are green.\n`
      );
      process.exit(0);
    }

    const markers = markersIn(input);
    const reason =
      typeof input !== 'string' || input.trim() === ''
        ? 'the review text was empty'
        : markers.length === 0
          ? 'the review rendered no AUTOMERGE_VERDICT line'
          : 'the review verdict is BLOCK (a CRITICAL, HIGH, or MEDIUM finding)';
    process.stderr.write(
      `${TAG} INELIGIBLE: ${reason} — the review check fails, so branch protection ` +
      `holds this PR for a fix or a manual merge.\n`
    );
    process.exit(1);
  });
}
