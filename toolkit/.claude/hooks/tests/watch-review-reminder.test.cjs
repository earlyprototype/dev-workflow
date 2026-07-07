#!/usr/bin/env node
'use strict';
/**
 * watch-review-reminder.test.cjs — plain node:assert tests for the PostToolUse
 * reminder hook that nudges the agent to run /watch-review after `gh pr create`
 * succeeds. No framework — mirrors the repo's node-only test style.
 *
 * Run:  node .claude/hooks/tests/watch-review-reminder.test.cjs
 */

const assert = require('node:assert');
const { isGhPrCreate, reminderFor } = require('../watch-review-reminder.cjs');

let count = 0;

function ok(name, actual, expected) {
  count++;
  assert.strictEqual(actual, expected, `${name}: expected ${expected}, got ${actual}`);
}

// ---------- isGhPrCreate: only a real invocation, never a substring ----------
ok('bare command', isGhPrCreate('gh pr create'), true);
ok('with flags', isGhPrCreate('gh pr create --title "x" --body-file f.md'), true);
ok('chained after another command', isGhPrCreate('cd repo && gh pr create --title x'), true);
ok('chained with semicolon', isGhPrCreate('git push; gh pr create --title x'), true);
ok('not a substring match — echoing the phrase', isGhPrCreate('echo "gh pr create is great"'), false);
ok('a different gh subcommand', isGhPrCreate('gh pr edit --title x'), false);
ok('gh issue create is not gh pr create', isGhPrCreate('gh issue create --title x'), false);
ok('unrelated command', isGhPrCreate('git status'), false);
ok('non-string command (defensive)', isGhPrCreate(undefined), false);
ok('non-string command, number (defensive)', isGhPrCreate(42), false);

// ---------- reminderFor: names the PR when resolved, generic otherwise ----------
count++;
{
  const msg = reminderFor({ number: 188, url: 'https://github.com/o/r/pull/188' });
  assert.ok(msg.includes('#188'), 'reminder should name the PR number');
  assert.ok(msg.includes('https://github.com/o/r/pull/188'), 'reminder should include the PR url');
  assert.ok(msg.includes('/watch-review'), 'reminder should tell the agent to run /watch-review');
}
count++;
{
  const msg = reminderFor(null);
  assert.ok(!msg.includes('#'), 'no PR resolved -> no fabricated PR number');
  assert.ok(msg.includes('/watch-review'), 'still tells the agent to run /watch-review');
}

console.log(`PASS: all ${count} watch-review-reminder cases green`);
