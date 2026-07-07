#!/usr/bin/env node
/**
 * Integration tests for review-gate.cjs and lib/write-review-log.cjs.
 *
 * The gate is a PreToolUse hook matched on mcp__kanbanger__propose_done and
 * mcp__kanbanger__approve_done. It BLOCKS the move (exit 2 + stderr reason)
 * unless a fresh fresh-context-review log exists for the current commit, and
 * the tracked working tree is clean. It ALLOWS (exit 0, silent) otherwise.
 *
 * Freshness key is the git HEAD sha: any new commit changes HEAD, so a stale
 * review (logged against an older commit) no longer matches and the gate
 * re-blocks until re-reviewed. A "waiver" entry (kind: waiver) counts as a
 * logged entry too — the hook stays dumb; the build-vs-doc judgment is the
 * human's.
 *
 * Spawns each script as a child process (matching how Claude Code runs hooks),
 * feeds a JSON envelope on stdin, and builds an isolated `git init` repo per
 * case. ASCII only.
 *
 * Run:  node .claude/hooks/tests/review-gate.test.cjs
 */

'use strict';

const assert = require('assert');
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const GATE_SCRIPT = path.resolve(__dirname, '..', 'review-gate.cjs');
const WRITER_SCRIPT = path.resolve(__dirname, '..', 'lib', 'write-review-log.cjs');

const PROPOSE = 'mcp__kanbanger__propose_done';
const APPROVE = 'mcp__kanbanger__approve_done';

// ---------- git fixtures ----------
function git(dir, args, opts = {}) {
  const r = spawnSync('git', args, { cwd: dir, encoding: 'utf8', timeout: 5000 });
  if (!opts.allowFail && r.status !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${r.stderr || r.stdout || r.error}`);
  }
  return r;
}

function makeGitRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'review-gate-test-'));
  git(dir, ['init', '-q']);
  git(dir, ['config', 'user.email', 'test@example.com']);
  git(dir, ['config', 'user.name', 'Test']);
  fs.writeFileSync(path.join(dir, 'README.md'), 'hello\n', 'utf8');
  git(dir, ['add', 'README.md']);
  git(dir, ['commit', '-q', '-m', 'init']);
  return { dir, head: headOf(dir) };
}

function makePlainDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'review-gate-nogit-'));
}

function headOf(dir) {
  return git(dir, ['rev-parse', 'HEAD']).stdout.trim();
}

function rimraf(p) {
  try { fs.rmSync(p, { recursive: true, force: true }); } catch (_) { /* ignore */ }
}

function logPath(dir, sha) {
  return path.join(dir, '.claude', 'review-log', `${sha}.md`);
}

function writeLog(dir, sha, opts = {}) {
  const p = logPath(dir, sha);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  if (opts.empty) { fs.writeFileSync(p, '   \n', 'utf8'); return p; }
  const body = [
    `sha: ${opts.shaLine !== undefined ? opts.shaLine : sha}`,
    `reviewed_at: 2026-06-30T12:00:00Z`,
    `kind: ${opts.kind || 'review'}`,
    `standards: coding-standards`,
    `summary: ${opts.summary || '0 CRITICAL/HIGH; 1 MEDIUM triaged'}`,
    ''
  ].join('\n');
  fs.writeFileSync(p, body, 'utf8');
  return p;
}

// ---------- runners ----------
function runGate(envelope) {
  const env = { ...process.env };
  delete env.CLAUDE_SESSION_ID;
  delete env.CLAUDE_TRANSCRIPT_PATH;
  const r = spawnSync(process.execPath, [GATE_SCRIPT], {
    input: JSON.stringify(envelope), encoding: 'utf8', timeout: 8000, env
  });
  return { status: r.status, stderr: r.stderr || '', stdout: r.stdout || '' };
}

function runWriter(dir, args) {
  const r = spawnSync(process.execPath, [WRITER_SCRIPT, ...args], {
    cwd: dir, encoding: 'utf8', timeout: 8000
  });
  return { status: r.status, stderr: r.stderr || '', stdout: r.stdout || '' };
}

function envelope(dir, tool) {
  return { cwd: dir, tool_name: tool, tool_input: { title: 'Some task' } };
}

// ---------- test runner ----------
const tests = [];
function test(name, fn) { tests.push({ name, fn }); }

async function run() {
  let passed = 0, failed = 0;
  for (const t of tests) {
    try { await t.fn(); console.log(`  PASS  ${t.name}`); passed++; }
    catch (err) {
      console.error(`  FAIL  ${t.name}`);
      console.error(`        ${err.message}`);
      if (err.stack) console.error(err.stack.split('\n').slice(1, 4).join('\n'));
      failed++;
    }
  }
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

// ---------- gate tests ----------

test('BLOCKS when no review log exists for HEAD', () => {
  const { dir } = makeGitRepo();
  try {
    const res = runGate(envelope(dir, PROPOSE));
    assert.strictEqual(res.status, 2, `expected block (exit 2), got ${res.status}: ${res.stderr}`);
    assert.ok(res.stderr.includes('/review'), `stderr should point to /review: ${res.stderr}`);
  } finally { rimraf(dir); }
});

test('ALLOWS when a fresh review log matches HEAD', () => {
  const { dir, head } = makeGitRepo();
  writeLog(dir, head, { kind: 'review' });
  try {
    const res = runGate(envelope(dir, PROPOSE));
    assert.strictEqual(res.status, 0, `expected allow (exit 0), got ${res.status}: ${res.stderr}`);
  } finally { rimraf(dir); }
});

test('ALLOWS a waiver entry for HEAD (hook stays dumb on review-vs-waiver)', () => {
  const { dir, head } = makeGitRepo();
  writeLog(dir, head, { kind: 'waiver', summary: 'doc-only, no code, waived' });
  try {
    const res = runGate(envelope(dir, APPROVE));
    assert.strictEqual(res.status, 0, `expected allow, got ${res.status}: ${res.stderr}`);
  } finally { rimraf(dir); }
});

test('BLOCKS when the log is stale (a new commit moved HEAD)', () => {
  const { dir, head } = makeGitRepo();
  writeLog(dir, head, { kind: 'review' });          // log for the OLD head
  fs.writeFileSync(path.join(dir, 'README.md'), 'hello again\n', 'utf8');
  git(dir, ['commit', '-qam', 'second']);            // HEAD moves; no log for it
  try {
    const res = runGate(envelope(dir, PROPOSE));
    assert.strictEqual(res.status, 2, `expected block on stale log, got ${res.status}: ${res.stderr}`);
  } finally { rimraf(dir); }
});

test('BLOCKS when the log file is empty', () => {
  const { dir, head } = makeGitRepo();
  writeLog(dir, head, { empty: true });
  try {
    const res = runGate(envelope(dir, PROPOSE));
    assert.strictEqual(res.status, 2, `expected block on empty log, got ${res.status}: ${res.stderr}`);
  } finally { rimraf(dir); }
});

test('BLOCKS when the log sha line does not match HEAD (malformed)', () => {
  const { dir, head } = makeGitRepo();
  writeLog(dir, head, { shaLine: '0000000000000000000000000000000000000000' });
  try {
    const res = runGate(envelope(dir, PROPOSE));
    assert.strictEqual(res.status, 2, `expected block on sha mismatch, got ${res.status}: ${res.stderr}`);
  } finally { rimraf(dir); }
});

test('BLOCKS when a tracked file is dirty even with a valid log', () => {
  const { dir, head } = makeGitRepo();
  writeLog(dir, head, { kind: 'review' });
  fs.writeFileSync(path.join(dir, 'README.md'), 'uncommitted edit\n', 'utf8'); // tracked, modified
  try {
    const res = runGate(envelope(dir, PROPOSE));
    assert.strictEqual(res.status, 2, `expected block on dirty tree, got ${res.status}: ${res.stderr}`);
    assert.ok(/chang|commit|revert/i.test(res.stderr), `stderr should explain dirty tree: ${res.stderr}`);
  } finally { rimraf(dir); }
});

test('an untracked-only working tree does NOT count as dirty (allows)', () => {
  const { dir, head } = makeGitRepo();
  writeLog(dir, head, { kind: 'review' });           // the log itself is untracked
  fs.writeFileSync(path.join(dir, 'scratch.tmp'), 'x\n', 'utf8'); // untracked
  try {
    const res = runGate(envelope(dir, APPROVE));
    assert.strictEqual(res.status, 0, `untracked files should not block, got ${res.status}: ${res.stderr}`);
  } finally { rimraf(dir); }
});

test('BLOCKS (fail-closed) when cwd is not a git repo', () => {
  const dir = makePlainDir();
  try {
    const res = runGate(envelope(dir, PROPOSE));
    assert.strictEqual(res.status, 2, `expected fail-closed block, got ${res.status}: ${res.stderr}`);
    assert.ok(/git/i.test(res.stderr), `stderr should mention git: ${res.stderr}`);
  } finally { rimraf(dir); }
});

test('gates BOTH propose_done and approve_done', () => {
  const { dir } = makeGitRepo();
  try {
    assert.strictEqual(runGate(envelope(dir, PROPOSE)).status, 2, 'propose_done should block');
    assert.strictEqual(runGate(envelope(dir, APPROVE)).status, 2, 'approve_done should block');
  } finally { rimraf(dir); }
});

test('ALLOWS (exit 0) a non-gated tool name (defensive)', () => {
  const { dir } = makeGitRepo();
  try {
    const res = runGate(envelope(dir, 'mcp__kanbanger__list_tasks'));
    assert.strictEqual(res.status, 0, `non-gated tool should pass, got ${res.status}: ${res.stderr}`);
  } finally { rimraf(dir); }
});

test('BLOCKS (fail-closed) when git status fails though HEAD is readable', () => {
  // Corrupt .git/index: `git status` reads it (fails), but `git rev-parse HEAD`
  // reads refs (still succeeds) — isolating the status-failure branch from the
  // HEAD-failure branch. A valid log is present so only a status failure can block.
  // (Relies on git rejecting a corrupt index with a non-zero exit; a more tolerant
  // future git would make this assert fail loudly, never false-pass.)
  const { dir, head } = makeGitRepo();
  writeLog(dir, head, { kind: 'review' });
  fs.writeFileSync(path.join(dir, '.git', 'index'), 'not-a-real-index', 'utf8');
  try {
    const res = runGate(envelope(dir, PROPOSE));
    assert.strictEqual(res.status, 2, `expected fail-closed block, got ${res.status}: ${res.stderr}`);
    assert.ok(/working tree/i.test(res.stderr), `stderr should name the status failure: ${res.stderr}`);
  } finally { rimraf(dir); }
});

// ---------- writer tests ----------

test('writer stamps a log named by the real HEAD, with matching sha', () => {
  const { dir, head } = makeGitRepo();
  try {
    const res = runWriter(dir, ['--summary', '0 CRITICAL, 2 MEDIUM fixed']);
    assert.strictEqual(res.status, 0, `writer should succeed, got ${res.status}: ${res.stderr}`);
    const p = logPath(dir, head);
    assert.ok(fs.existsSync(p), 'writer should create .claude/review-log/<HEAD>.md');
    const body = fs.readFileSync(p, 'utf8');
    assert.ok(new RegExp(`^sha:\\s*${head}`, 'm').test(body), 'sha line should equal HEAD');
    assert.ok(/kind:\s*review/.test(body), 'default kind is review');
    assert.ok(/0 CRITICAL, 2 MEDIUM fixed/.test(body), 'summary recorded');
  } finally { rimraf(dir); }
});

test('writer refuses an empty summary (writes nothing)', () => {
  const { dir, head } = makeGitRepo();
  try {
    const res = runWriter(dir, ['--summary', '   ']);
    assert.notStrictEqual(res.status, 0, 'writer should reject empty summary');
    assert.ok(!fs.existsSync(logPath(dir, head)), 'no log should be written');
  } finally { rimraf(dir); }
});

test('writer fails clearly when a flag has no value', () => {
  const { dir, head } = makeGitRepo();
  try {
    const res = runWriter(dir, ['--summary']);   // trailing flag, no value
    assert.notStrictEqual(res.status, 0, 'should reject a value-less flag');
    assert.ok(/requires a value/i.test(res.stderr), `stderr should name the missing value: ${res.stderr}`);
    assert.ok(!fs.existsSync(logPath(dir, head)), 'no log should be written');
  } finally { rimraf(dir); }
});

test('writer records a waiver kind', () => {
  const { dir, head } = makeGitRepo();
  try {
    const res = runWriter(dir, ['--kind', 'waiver', '--summary', 'doc-only, no code']);
    assert.strictEqual(res.status, 0, `writer should succeed, got ${res.status}: ${res.stderr}`);
    const body = fs.readFileSync(logPath(dir, head), 'utf8');
    assert.ok(/kind:\s*waiver/.test(body), 'waiver kind recorded');
  } finally { rimraf(dir); }
});

test('a log written by the writer is then ACCEPTED by the gate (end-to-end)', () => {
  const { dir } = makeGitRepo();
  try {
    assert.strictEqual(runWriter(dir, ['--summary', 'looks good']).status, 0, 'writer ok');
    const res = runGate(envelope(dir, PROPOSE));
    assert.strictEqual(res.status, 0, `gate should accept writer's log, got ${res.status}: ${res.stderr}`);
  } finally { rimraf(dir); }
});

run().catch(err => { console.error('runner crashed:', err); process.exit(1); });
