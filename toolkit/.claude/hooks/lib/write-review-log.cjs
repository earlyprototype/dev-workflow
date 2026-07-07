#!/usr/bin/env node
'use strict';
/**
 * write-review-log.cjs — stamps the fresh-context-review proof the gate checks.
 * Invoked by the /review command after a review runs.
 *
 * Computes HEAD ITSELF (never trusts a pasted sha) and writes
 *   <cwd>/.claude/review-log/<HEAD>.md
 * with: sha, reviewed_at (ISO-8601 UTC), kind (review|waiver), standards, summary.
 *
 * Usage:
 *   node write-review-log.cjs --summary "<text>" [--kind review|waiver]
 *                             [--standards "<text>"] [--cwd <dir>]
 *
 * Uses fs directly (not an editor tool) so it never trips editor hooks. Exits
 * non-zero with a message on bad input (empty summary, unknown kind, no HEAD).
 */

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const DEFAULT_STANDARDS = 'coding-standards';

function fail(msg) { process.stderr.write(`write-review-log: ${msg}\n`); process.exit(1); }

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    // Consume the flag's value, with a clear error if it is missing — otherwise
    // a trailing "--summary" with no value surfaces the misleading
    // "non-empty --summary required" instead of "flag needs a value".
    const next = () => {
      const v = argv[++i];
      if (v === undefined) fail(`${a} requires a value`);
      return v;
    };
    if (a === '--summary') out.summary = next();
    else if (a === '--kind') out.kind = next();
    else if (a === '--standards') out.standards = next();
    else if (a === '--cwd') out.cwd = next();
    else fail(`unknown argument: ${a}`);
  }
  return out;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const cwd = args.cwd || process.cwd();
  const kind = args.kind || 'review';
  const standards = args.standards || DEFAULT_STANDARDS;
  const summary = (args.summary || '').trim();

  if (!summary) fail('a non-empty --summary is required');
  if (kind !== 'review' && kind !== 'waiver') fail(`--kind must be "review" or "waiver", got "${kind}"`);

  const headRes = spawnSync('git', ['rev-parse', 'HEAD'], { cwd, encoding: 'utf8', timeout: 5000 });
  if (!headRes || headRes.status !== 0) fail(`cannot read git HEAD in ${cwd}`);
  const head = String(headRes.stdout).trim();

  const dir = path.join(cwd, '.claude', 'review-log');
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${head}.md`);

  const body = [
    `sha: ${head}`,
    `reviewed_at: ${new Date().toISOString()}`,
    `kind: ${kind}`,
    `standards: ${standards}`,
    `summary: ${summary}`,
    ''
  ].join('\n');

  fs.writeFileSync(file, body, 'utf8');
  process.stdout.write(`write-review-log: wrote ${kind} for ${head.slice(0, 8)} -> ${file}\n`);
}

main();
