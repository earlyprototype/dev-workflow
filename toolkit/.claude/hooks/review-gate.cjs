#!/usr/bin/env node
'use strict';
/**
 * review-gate.cjs — PreToolUse hook: no kanban "done" move without a logged review.
 *
 * Matched (in .claude/settings.json) on:
 *   mcp__kanbanger__propose_done   (DOING -> REVIEW, the recovery path)
 *   mcp__kanbanger__approve_done   (REVIEW -> DONE, the approve path a clock-out uses)
 *
 * BLOCKS the move (exit 2 + stderr reason) unless BOTH hold:
 *   1. the tracked working tree is clean, and
 *   2. a non-empty review-log exists for the current HEAD whose `sha:` matches.
 * Otherwise ALLOWS (exit 0, silent).
 *
 * The log lives at <cwd>/.claude/review-log/<HEAD-sha>.md (untracked). HEAD is
 * the freshness key: a new commit moves HEAD, so a stale review stops matching
 * and the gate re-blocks until re-reviewed (or a one-line waiver is logged).
 * A `kind: waiver` entry counts too — the hook stays dumb on review-vs-waiver;
 * the build-vs-doc judgment is the human's.
 *
 * Ceiling: this proves a review was LOGGED against this commit — not that it
 * was good. It also cannot block a Stop hook that edits the board file directly
 * (no MCP call fires there); it gates the MCP done-moves that do. That residual
 * trust is the reviewer's to honour.
 *
 * Mirrors the stdin/timeout convention of the repo's other hooks.
 */

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const TAG = '[review-gate]';
const MAX_STDIN = 1024 * 1024;
const STDIN_TIMEOUT_MS = 2000;
const GATED = new Set([
  'mcp__kanbanger__propose_done',
  'mcp__kanbanger__approve_done'
]);

// ---------- stdin ----------
let stdinData = '';
let ran = false;
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => {
  if (stdinData.length < MAX_STDIN) stdinData += chunk.substring(0, MAX_STDIN - stdinData.length);
});
process.stdin.on('end', () => runMain());
process.stdin.on('error', () => runMain());
const stdinTimer = setTimeout(() => {
  try { process.stdin.destroy(); } catch (_) { /* ignore */ }
  runMain();
}, STDIN_TIMEOUT_MS);
stdinTimer.unref();

function runMain() {
  if (ran) return;
  ran = true;
  clearTimeout(stdinTimer);
  try { main(); } catch (err) {
    // A crash in a security gate must fail closed, not open.
    block(`internal error (${err && err.message ? err.message : err}); gate fails closed.`);
  }
}

// ---------- gate ----------
function block(reason) {
  process.stderr.write(`${TAG} BLOCKED: ${reason}\n`);
  process.exit(2);
}
function allow() { process.exit(0); }

function git(cwd, args) {
  return spawnSync('git', args, { cwd, encoding: 'utf8', timeout: 5000 });
}

function main() {
  let env = {};
  try { env = JSON.parse(stdinData || '{}'); } catch (_) { env = {}; }

  // The matcher should only route the two gated tools here; if anything else
  // arrives, do not interfere.
  if (env.tool_name && !GATED.has(env.tool_name)) allow();

  const cwd = (typeof env.cwd === 'string' && env.cwd) ? env.cwd : process.cwd();

  // HEAD — fail closed if unreadable. The gate only installs in this repo, so an
  // unreadable HEAD is anomalous; a security gate must not fail open.
  const headRes = git(cwd, ['rev-parse', 'HEAD']);
  if (!headRes || headRes.status !== 0) {
    block(`cannot read git HEAD in ${cwd} (gate fails closed). ` +
          `Run the move from the worktree whose commit was reviewed.`);
  }
  const head = String(headRes.stdout).trim();
  const shortHead = head.slice(0, 8);

  // Tracked tree must be clean — a review is bound to a commit, so uncommitted
  // tracked edits made after the review would otherwise pass unreviewed.
  // --untracked-files=no keeps the (gitignored) review-log and board file out of it.
  const st = git(cwd, ['status', '--porcelain', '--untracked-files=no']);
  if (!st || st.status !== 0) {
    // Fail closed: if we cannot read the tree state, we cannot prove it is clean.
    // (spawnSync returns {status:null} on timeout/signal — not an exception.)
    block(`cannot check working tree (git status exit ${st ? st.status : 'null'}); gate fails closed.`);
  }
  if (String(st.stdout).trim() !== '') {
    const changed = String(st.stdout).trim().split('\n').slice(0, 5).join('; ');
    block(`tracked files changed since any review — commit or revert, then re-review. Changed: ${changed}`);
  }

  // The logged-review proof for this exact commit.
  const logFile = path.join(cwd, '.claude', 'review-log', `${head}.md`);
  if (!fs.existsSync(logFile)) {
    block(`no logged review for commit ${shortHead}. ` +
          `Run /review (or log a one-line waiver), then retry the move. ` +
          `The log is worktree-local — if you reviewed in another worktree, re-run /review here.`);
  }
  let content = '';
  try { content = fs.readFileSync(logFile, 'utf8'); } catch (_) { content = ''; }
  if (content.trim() === '') block(`review log for ${shortHead} is empty. Re-run /review.`);

  const m = content.match(/^sha:\s*(\S+)/m);
  if (!m || m[1] !== head) {
    block(`review log for ${shortHead} is malformed (sha line missing or != HEAD). Re-run /review.`);
  }

  allow();
}
