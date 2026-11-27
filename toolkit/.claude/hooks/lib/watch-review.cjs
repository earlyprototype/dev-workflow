#!/usr/bin/env node
'use strict';
/**
 * watch-review.cjs — close the loop between a build agent and its PR's review.
 *
 * THE GAP THIS CLOSES. Opening a PR ends the build agent's turn, but the review
 * lands seconds-to-minutes later on GitHub's side (the `review` check in
 * .github/workflows/claude-pr-review.yml, verdict in a claude[bot] comment) with
 * nothing wired back to the machine. So the agent never learns whether the PR
 * merged clean or stalled on a finding — the PR just goes quiet, and either the
 * board never advances or a MEDIUM+ finding sits unaddressed. This script is the
 * wire back: an agent runs it (backgrounded, so the harness re-invokes the agent
 * when it exits — the review landing IS the wake-up), and it reports, in plain
 * English, exactly what happened and what to do next.
 *
 * HOW IT DECIDES. It polls the PR until it settles (bounded — a stuck check must
 * never re-create the silent stall it exists to prevent), snapshots three things
 * with `gh` — the PR state, its checks, and the reviewer's verdict comment — and
 * hands them to the PURE classifier below. The verdict is read with the SAME
 * reader the merge gate uses (verdictOf from automerge-eligible.cjs), so "clean"
 * here means exactly what "clean" means to auto-merge: one source of truth.
 *
 * FAIL-SAFE, like its siblings (automerge-eligible.cjs, review-gate.cjs): an
 * unreadable verdict, a failed review check, or a self-skip all resolve to "not
 * done, here's why" — never to a false "merged". Only a genuine MERGED exits 0.
 *
 * Pure core (unit-tested in .claude/hooks/tests/watch-review.test.cjs):
 *   classify(snapshot)      -> { outcome, action, terminal, summary }
 *   reviewVerdict(body|null) -> 'UNKNOWN' | 'PASS' | 'BLOCK'
 *   exitCodeFor(outcome)    -> 0 (merged) | 1 (anything else)
 * CLI (require.main === module): resolves the PR, polls, classifies, prints a
 *   plain-English result plus a machine line `WATCH_REVIEW_OUTCOME: <outcome>`,
 *   and (when blocked) the review findings inline. Read-only against GitHub.
 */

const path = require('node:path');
const { spawnSync } = require('node:child_process');

// The verdict reader is shared with the merge gate so "clean" is defined once.
// Path is resolved from THIS file (not cwd), so it holds from any worktree/dir.
const { verdictOf } = require(
  path.join(__dirname, '..', '..', '..', '.github', 'scripts', 'automerge-eligible.cjs')
);

const TAG = '[watch-review]';
const POLL_INTERVAL_MS = Number(process.env.WATCH_REVIEW_INTERVAL_MS) || 20000;   // 20s
const MAX_WAIT_MS = Number(process.env.WATCH_REVIEW_MAX_WAIT_MS) || 25 * 60 * 1000; // 25 min

// ─────────────────────────── pure core ───────────────────────────

/**
 * A missing comment gives no verdict. The review job reports a self-skip
 * separately. The merge gate's reader classifies each available comment.
 */
function reviewVerdict(commentBody) {
  if (commentBody == null) return 'UNKNOWN';
  return verdictOf(commentBody); // 'PASS' | 'BLOCK'
}

function mk(outcome, action, terminal, summary) {
  return { outcome, action, terminal, summary };
}

/**
 * classify(snapshot) -> { outcome, action, terminal, summary }
 * snapshot = {
 *   state: 'OPEN' | 'MERGED' | 'CLOSED',
 *   isDraft: boolean,
 *   checks: [{ name: string, bucket: 'pass'|'fail'|'pending'|'skipping'|'cancel' }],
 *   reviewVerdict: 'UNKNOWN' | 'SKIP' | 'PASS' | 'BLOCK',
 * }
 * `terminal` = the PR has settled and the agent should act now; false = keep
 * polling. Ordering is deliberate — see the inline notes.
 */
function classify(s) {
  const checks = Array.isArray(s.checks) ? s.checks : [];
  const review = checks.find(c => c && c.name === 'review');
  const failed = checks.filter(c => c && c.bucket === 'fail');
  const pending = checks.filter(c => c && c.bucket === 'pending');
  const failedNames = failed.map(c => c.name).join(', ');
  // A review problem is EITHER a BLOCK verdict OR the review check itself red
  // (e.g. the verdict was unreadable and the gate failed closed) — both mean
  // "the review did not clear this PR", which routes to the findings, not build.
  const reviewFailed = s.reviewVerdict === 'BLOCK'
    || review?.bucket === 'fail';

  // Merged / closed are the true end states — they win over any check snapshot,
  // including a stale one caught mid-merge.
  if (s.state === 'MERGED') {
    return mk('merged', 'advance', true,
      'Merged. Advance the card (propose_done) and take the next slice.');
  }
  if (s.state === 'CLOSED') {
    return mk('closed', 'stop', true,
      'The PR was closed without merging — stop and check why with the owner.');
  }

  // A draft never runs the review and never arms auto-merge; that fact blocks
  // everything else, so surface it first (fix any findings, then mark it ready).
  if (s.isDraft) {
    return mk('draft', 'ready', true,
      'The PR is a draft, so no review runs and auto-merge never arms. Fix any ' +
      'findings, then mark it ready for review and watch again.');
  }

  // A BLOCK is the headline case — and more actionable than a coincident CI red,
  // so it is surfaced first (a CI red that outlives the fix re-surfaces next round).
  if (reviewFailed) {
    return mk('blocked', 'fix-findings', true,
      'The review returned BLOCK — a CRITICAL, HIGH, or MEDIUM finding. Read the ' +
      'review comment, fix every finding, then commit and push; the new commit ' +
      're-runs the review.' + (failed.length ? ` Also red: ${failedNames}.` : ''));
  }
  if (failed.length) {
    return mk('ci-failed', 'fix-build', true,
      `A required check failed (not the review): ${failedNames}. Fix it, then ` +
      'commit and push.');
  }
  if (!review) {
    return mk('pending', 'keep-watching', false, 'Waiting for the review check to appear or become readable.');
  }
  if (pending.length) {
    return mk('pending', 'keep-watching', false, 'Checks are still running.');
  }

  if (review.bucket !== 'pass') {
    return mk('pending', 'keep-watching', false, 'Waiting for a successful or failed review check.');
  }
  if (s.reviewVerdict === 'SKIP') {
    return mk('needs-human', 'ask-human', true,
      'The review self-skipped. Ask the owner to review the PR and merge it by hand.');
  }
  if (s.reviewVerdict !== 'PASS') {
    return mk('pending', 'keep-watching', false, 'The review check finished. Waiting for its verdict or a confirmed self-skip.');
  }
  // Green + a genuine PASS, not merged yet: auto-merge should complete shortly —
  // keep watching for the merge. If it never comes, an unresolved conversation is
  // the usual cause (the timeout note in the CLI points there).
  return mk('clean-pending', 'keep-watching', false,
    'Review PASSED and every check is green; auto-merge should complete shortly. ' +
    'Still watching for the merge — if it stalls, an unresolved conversation is ' +
    'the usual cause.');
}

/** Only a genuine merge is success; everything else is "not done, look here". */
function exitCodeFor(outcome) {
  return outcome === 'merged' ? 0 : 1;
}

module.exports = { classify, reviewVerdict, exitCodeFor };

// ─────────────────────────── CLI ───────────────────────────
if (require.main === module) {
  main().then(code => process.exit(code)).catch(err => {
    process.stderr.write(`${TAG} unexpected error: ${err && err.stack || err}\n`);
    process.exit(2);
  });
}

/** Run `gh` without throwing on a non-zero exit — several `gh` reads (notably
 *  `pr checks` when a check has failed) exit non-zero yet still print usable
 *  JSON on stdout, so callers inspect stdout regardless of status. */
function gh(args) {
  const res = spawnSync('gh', args, { encoding: 'utf8' });
  return { status: res.status, stdout: res.stdout || '', stderr: res.stderr || '' };
}

function parseJson(text, fallback) {
  try { return JSON.parse(text); } catch (_) { return fallback; }
}

// Function declaration (not `const`), so it's hoisted — main() is invoked
// from the CLI block above, before this line would otherwise run.
function sleep(ms) { return new Promise(res => setTimeout(res, ms)); }

/** Resolve the PR number: an explicit arg, else the current branch's PR. */
function resolvePr(arg) {
  if (arg && /^\d+$/.test(arg)) return arg;
  const r = gh(['pr', 'view', '--json', 'number']);
  const n = parseJson(r.stdout, {}).number;
  return n ? String(n) : null;
}

/** One read of the PR's decision-relevant state. Every field fails safe. */
function snapshot(pr) {
  const view = parseJson(
    gh(['pr', 'view', pr, '--json', 'state,isDraft,url,title,number']).stdout, null);
  if (!view) return null; // PR not found / gh error — caller stops.

  const checks = parseJson(
    gh(['pr', 'checks', pr, '--json', 'name,bucket,state,link']).stdout, []);

  // Read the completed check's own run. A running review can still edit its comment.
  const reviewCheck = (Array.isArray(checks) ? checks : []).find(c => c && c.name === 'review');
  const reviewRunMatch = reviewCheck && typeof reviewCheck.link === 'string'
    && reviewCheck.link.match(/\/actions\/runs\/(\d+)/);
  const reviewRunId = reviewRunMatch ? reviewRunMatch[1] : null;

  let comment = null;
  let verdict = 'UNKNOWN';
  if (reviewRunId && ['pass', 'fail'].includes(reviewCheck.bucket)) {
    const runLink = new RegExp(`/actions/runs/${reviewRunId}(?![0-9])`);
    const bodies = parseJson(
      gh(['api', `repos/{owner}/{repo}/issues/${pr}/comments?per_page=100`,
        '--jq', '[.[] | select(.user.login=="claude[bot]") | .body]']).stdout, []);
    if (Array.isArray(bodies)) {
      comment = bodies.findLast(body => typeof body === 'string' &&
        body.includes('AUTOMERGE_VERDICT') && runLink.test(body)) ?? null;
    }
    verdict = reviewVerdict(comment);
    if (verdict === 'UNKNOWN' && reviewCheck.bucket === 'pass') {
      const run = parseJson(gh(['run', 'view', reviewRunId, '--json', 'jobs']).stdout, null);
      const review = run?.jobs?.find(job => job.name === 'review');
      if (review?.steps?.some(step => step.name === 'Report review self-skip' && step.conclusion === 'success')) {
        verdict = 'SKIP';
      }
    }
  }

  return {
    number: view.number,
    url: view.url,
    title: view.title,
    state: view.state,
    isDraft: view.isDraft,
    checks: Array.isArray(checks) ? checks : [],
    reviewVerdict: verdict,
    reviewComment: comment,
  };
}

function printResult(snap, result, timedOut) {
  const p = s => process.stdout.write(s + '\n');
  p('');
  p(`${TAG} PR #${snap.number} — ${snap.title}`);
  p(`${TAG} ${snap.url}`);
  if (timedOut) {
    p(`${TAG} did not settle within ${Math.round(MAX_WAIT_MS / 60000)} min — reporting the last state; re-run to keep watching, or check the PR by hand.`);
  }
  p(`${TAG} ${result.summary}`);
  // The findings, inline, so the agent can act without a second round-trip.
  if (result.outcome === 'blocked' && snap.reviewComment) {
    p('');
    p('───── review comment ─────');
    p(snap.reviewComment.trim());
    p('──────────────────────────');
  }
  // Machine-readable line, in the house style of AUTOMERGE_VERDICT — a caller
  // (or a future sweep) can grep exactly this.
  p('');
  p(`WATCH_REVIEW_OUTCOME: ${result.outcome}`);
}

async function main() {
  const args = process.argv.slice(2);
  const once = args.includes('--once');
  const prArg = args.find(a => /^\d+$/.test(a));

  const pr = resolvePr(prArg);
  if (!pr) {
    process.stderr.write(
      `${TAG} no PR number given and none found for the current branch. ` +
      'Pass a PR number: node .claude/hooks/lib/watch-review.cjs <PR>\n');
    return 2;
  }

  process.stdout.write(
    `${TAG} watching PR #${pr} — polling every ${Math.round(POLL_INTERVAL_MS / 1000)}s, ` +
    `up to ${Math.round(MAX_WAIT_MS / 60000)} min. Backgrounded, this frees the agent's ` +
    `turn until the review lands.\n`);

  const start = Date.now();
  let snap = null;
  let result = null;

  // Bounded poll — a stuck check must not recreate the silent stall.
  // Date.now() drives only the wall-clock timeout, never any cached result.
  // eslint-disable-next-line no-constant-condition
  while (true) {
    snap = snapshot(pr);
    if (!snap) {
      process.stderr.write(`${TAG} could not read PR #${pr} (gh error or PR not found).\n`);
      return 2;
    }
    result = classify(snap);
    process.stdout.write(`${TAG} PR #${pr}: ${result.outcome} — ${result.summary}\n`);

    if (result.terminal || once) { printResult(snap, result, false); return exitCodeFor(result.outcome); }
    if (Date.now() - start >= MAX_WAIT_MS) { printResult(snap, result, true); return exitCodeFor(result.outcome); }
    await sleep(POLL_INTERVAL_MS);
  }
}
