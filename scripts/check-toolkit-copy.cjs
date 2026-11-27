'use strict';

const fs = require('node:fs');
const path = require('node:path');
const shipped = require('../toolkit/.claude/settings.json');

const settingsPath = '.claude/settings.json';
const hookScripts = {
  PreToolUse: '.claude/hooks/review-gate.cjs',
  PostToolUse: '.claude/hooks/watch-review-reminder.cjs',
};
const requiredFiles = [
  settingsPath,
  ...Object.values(hookScripts),
  '.claude/commands/review.md',
  '.claude/commands/watch-review.md',
  '.github/workflows/ci.yml',
  '.github/workflows/claude-pr-review.yml',
  '.github/workflows/auto-merge.yml',
  '.mcp.json',
];

function checkRegistrations(target, problems) {
  let settings;
  try {
    settings = JSON.parse(fs.readFileSync(path.join(target, settingsPath), 'utf8'));
  } catch (err) {
    problems.push(`${settingsPath}: ${err instanceof SyntaxError ? 'invalid JSON' : 'cannot read file'}`);
    return;
  }

  for (const [event, script] of Object.entries(hookScripts)) {
    const [group] = shipped.hooks[event];
    const [expected] = group.hooks;
    const groups = settings?.hooks?.[event];
    const registered = Array.isArray(groups) && groups.some(entry =>
      entry?.matcher === group.matcher && Array.isArray(entry.hooks) &&
      entry.hooks.some(hook => hook?.type === expected.type &&
        hook.if === expected.if && hook.command === expected.command));
    if (!registered) {
      problems.push(`${settingsPath}: missing ${event} registration for ${script} (matcher ${group.matcher})`);
    }
  }
}

function checkCopy(target) {
  const problems = [];
  for (const file of requiredFiles) {
    try {
      const stat = fs.statSync(path.join(target, file), { throwIfNoEntry: false });
      if (stat?.isFile()) {
        if (file === settingsPath) checkRegistrations(target, problems);
      } else if (stat) {
        problems.push(`${file}: expected a file`);
      } else {
        const nested = `toolkit/${file}`;
        const misplaced = fs.statSync(path.join(target, nested), { throwIfNoEntry: false });
        problems.push(misplaced?.isFile() ? `${file}: found at ${nested}` : `${file}: missing`);
      }
    } catch {
      problems.push(`${file}: cannot inspect path`);
    }
  }
  return problems;
}

if (process.argv.length !== 3 || !process.argv[2]) {
  console.error('Usage: node check-toolkit-copy.cjs <target-project-directory>');
  process.exitCode = 2;
} else {
  const problems = checkCopy(process.argv[2]);
  if (problems.length) {
    console.error(problems.join('\n'));
    process.exitCode = 1;
  } else {
    console.log('Toolkit copy complete.');
  }
}
