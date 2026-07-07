#!/usr/bin/env node
'use strict';
/**
 * watch-review-reminder.cjs — PostToolUse hook.
 *
 * THE GAP THIS CLOSES. /watch-review only helps if the agent that opened a PR
 * remembers to run it. A hook cannot run the watch itself and report back later
 * — a hook-spawned process has no tracked task id, so nothing would wake the
 * agent when it finished. What a hook CAN do is make sure the agent never
 * forgets the step: this fires right after `gh pr create` succeeds and injects
 * one line telling the agent to background /watch-review now, on its own tracked
 * call.
 *
 * Matched (in .claude/settings.json) on Bash calls whose command is
 * `gh pr create ...` via the `if` filter — but this script independently
 * re-checks tool_input.command too, because an older Claude Code build that
 * ignores `if` would otherwise fire this on every Bash call. A false
 * negative here (missing a real PR) is the failure mode that matters; a
 * stray false positive is just a spurious reminder, not a broken gate — so
 * this never blocks anything and never throws on an error, it just goes
 * quiet.
 *
 * Pure core (unit-tested in .claude/hooks/tests/watch-review-reminder.test.cjs):
 *   isGhPrCreate(command) -> boolean
 *   reminderFor(pr)       -> string
 * CLI (require.main === module): reads the PostToolUse stdin payload, resolves
 *   the just-created PR via `gh pr view`, and prints the additionalContext
 *   JSON. Everything stdin/process-related lives inside this guard, so
 *   requiring this file for tests never attaches a stdin listener or calls
 *   process.exit.
 */

const { spawnSync } = require('child_process');

// ─────────────────────────── pure core ───────────────────────────

/** True only for an actual `gh pr create` invocation — a plain substring
 *  test would also fire on e.g. `echo "gh pr create is great"`. */
function isGhPrCreate(command) {
  return typeof command === 'string'
    && /(^|[;&|]|\s)gh\s+pr\s+create(\s|$)/.test(command);
}

/** Pure — the reminder text, given whether the just-created PR resolved. */
function reminderFor(pr) {
  const base = 'Per this repo\'s workflow, run /watch-review now — backgrounded ' +
    '— so its review outcome comes back to you instead of the PR going quiet.';
  return pr && pr.number
    ? `A PR was just opened (#${pr.number}, ${pr.url}). ${base}`
    : `A PR was just opened. ${base}`;
}

module.exports = { isGhPrCreate, reminderFor };

// ─────────────────────────── CLI ───────────────────────────
if (require.main === module) {
  const MAX_STDIN = 1024 * 1024;
  const STDIN_TIMEOUT_MS = 2000;

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
    try { main(); } catch (_) { /* a reminder hook must never error out or block */ }
    process.exit(0);
  }

  function parseJson(text, fallback) {
    try { return JSON.parse(text); } catch (_) { return fallback; }
  }

  function main() {
    const env = parseJson(stdinData || '{}', {});
    if (env.tool_name !== 'Bash') return;
    if (env.tool_error) return; // the command failed — no PR exists to watch
    const command = env.tool_input && env.tool_input.command;
    if (!isGhPrCreate(command)) return;

    const res = spawnSync('gh', ['pr', 'view', '--json', 'number,url'],
      { encoding: 'utf8', timeout: 5000, cwd: typeof env.cwd === 'string' ? env.cwd : undefined });
    const pr = parseJson(res.stdout, null);

    process.stdout.write(JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PostToolUse',
        additionalContext: reminderFor(pr),
      },
    }));
  }
}
