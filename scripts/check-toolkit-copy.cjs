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
  '.claude/hooks/lib/watch-review.cjs',
  '.claude/hooks/lib/write-review-log.cjs',
  '.claude/hooks/tests/review-gate.test.cjs',
  '.claude/hooks/tests/watch-review.test.cjs',
  '.claude/hooks/tests/watch-review-reminder.test.cjs',
  '.claude/commands/review.md',
  '.claude/commands/watch-review.md',
  '.github/scripts/automerge-eligible.cjs',
  '.github/scripts/automerge-eligible.test.cjs',
  '.github/workflows/ci.yml',
  '.github/workflows/claude-pr-review.yml',
  '.github/workflows/auto-merge.yml',
  '.mcp.json',
];

function checkRegistrations(target, inspected, problems) {
  const file = path.join(target, settingsPath);
  let settings;
  let fd;
  try {
    fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NONBLOCK);
    const opened = fs.fstatSync(fd, { bigint: true });
    if (!opened.isFile() || opened.dev !== inspected.dev || opened.ino !== inspected.ino ||
        outsideTarget(target, fs.realpathSync.native(file))) {
      problems.push(`${settingsPath}: file changed during inspection`);
      return;
    }
    settings = JSON.parse(fs.readFileSync(fd, 'utf8'));
  } catch (err) {
    problems.push(`${settingsPath}: ${err instanceof SyntaxError ? 'invalid JSON' : 'cannot read file'}`);
    return;
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
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

function outsideTarget(root, destination) {
  const relative = path.relative(root, destination);
  return path.isAbsolute(relative) || relative === '..' || relative.startsWith('..' + path.sep);
}

function resolveTargetLink(root, link) {
  const destination = path.resolve(path.dirname(link), fs.readlinkSync(link));
  if (outsideTarget(root, destination)) return null;
  const resolved = fs.realpathSync.native(link);
  return outsideTarget(root, resolved) ? null : resolved;
}

function inspectFile(root, file, parent = '') {
  const workflow = file.startsWith('.github/workflows/');
  let actual = parent;
  let current = path.join(root, parent);
  try {
    for (const part of file.split('/')) {
      // current is the expected physical path inside root. A cached child or
      // a directory checked on the previous iteration may now be a link.
      if (fs.realpathSync.native(current) !== current) {
        return { problem: 'path changed during inspection' };
      }
      const names = fs.readdirSync(current);
      const name = names.includes(part) ? part : names.find(entry => entry.toLowerCase() === part.toLowerCase());
      if (name === undefined) return {};
      actual = path.posix.join(actual, name);
      current = path.join(current, name);
      if (fs.lstatSync(current).isSymbolicLink()) {
        if (workflow) return { problem: `${actual} is a symbolic link` };
        current = resolveTargetLink(root, current);
        if (!current) return { problem: `${actual} links outside the target` };
      }
    }
    const stat = fs.lstatSync(current, { bigint: true });
    // Verify that the reported repository path still names the inspected path.
    if (fs.realpathSync.native(path.join(root, actual)) !== current) {
      return { problem: 'path changed during inspection' };
    }
    return stat.isFile() ? { found: actual, stat } : { problem: 'expected a file' };
  } catch {
    return { problem: 'cannot inspect path' };
  }
}

function checkCopy(target) {
  let root;
  let children;
  try {
    root = fs.realpathSync.native(target);
    children = fs.readdirSync(root, { withFileTypes: true }).filter(entry => entry.isDirectory());
  } catch {
    return ['.: cannot inspect target directory'];
  }

  const problems = [];
  for (const file of requiredFiles) {
    let { found, problem, stat } = inspectFile(root, file);
    if (!found && !problem) {
      for (const child of children) {
        found = inspectFile(root, file, child.name).found;
        if (found) break;
      }
    }
    if (found === file) {
      if (file === settingsPath) checkRegistrations(root, stat, problems);
    } else {
      const reason = found ? `found at ${found}` : problem ?? 'missing';
      problems.push(`${file}: ${reason}`);
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
