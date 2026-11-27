'use strict';

const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const checker = path.join(__dirname, 'check-toolkit-copy.cjs');
const toolkit = path.resolve(__dirname, '../toolkit');
const settingsPath = '.claude/settings.json';
const gatePath = '.claude/hooks/review-gate.cjs';
const reminderPath = '.claude/hooks/watch-review-reminder.cjs';

function fixture(t) {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'copy check '));
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
  const target = path.join(temp, 'target project');
  const cwd = path.join(temp, 'unrelated');
  fs.mkdirSync(cwd);
  fs.cpSync(toolkit, target, { recursive: true });

  // Run the CLI with filesystem writes and child processes denied. Catch a
  // direct network call or an imported target hook even if its caller recovers.
  const offline = path.join(cwd, 'offline.cjs');
  fs.writeFileSync(offline, "require('node:net').Socket.prototype.connect = globalThis.fetch = () => process.exit(90);");
  function run(...args) {
    const result = spawnSync(process.execPath, [
      '--permission', '--allow-fs-read=*', '--require', offline, checker, ...args,
    ], { cwd, encoding: 'utf8', timeout: 5000 });
    if (result.error) throw result.error;
    return result;
  }
  function check() { return run(path.relative(cwd, target)); }
  function editSettings(edit) {
    const file = path.join(target, settingsPath);
    const settings = JSON.parse(fs.readFileSync(file, 'utf8'));
    edit(settings);
    fs.writeFileSync(file, JSON.stringify(settings));
  }
  return { target, check, editSettings, run };
}

function expectIncomplete(result, ...paths) {
  assert.equal(result.status, 1, result.stderr);
  for (const file of paths) assert.ok(result.stderr.includes(file), result.stderr);
}

test('a full copy passes from an unrelated directory, including with extra hooks and settings', t => {
  const { target, check, editSettings } = fixture(t);
  const complete = check();
  assert.equal(complete.status, 0, complete.stderr);
  for (const file of [gatePath, reminderPath]) {
    fs.writeFileSync(path.join(target, file), 'process.exit(91);');
  }
  editSettings(settings => {
    settings.language = 'french';
    const extra = { type: 'command', command: 'exit 92' };
    settings.hooks.PreToolUse.unshift({ matcher: 'Read', hooks: [extra] });
    settings.hooks.PostToolUse[0].hooks.unshift(extra);
  });
  const merged = check();
  assert.equal(merged.status, 0, merged.stderr);
});

test('a missing script fails even when its hook is registered', t => {
  const { target, check } = fixture(t);
  fs.unlinkSync(path.join(target, gatePath));
  expectIncomplete(check(), gatePath);
});

test('an unregistered hook fails even when its script is present', t => {
  const { check, editSettings } = fixture(t);
  editSettings(settings => { delete settings.hooks.PostToolUse; });
  expectIncomplete(check(), settingsPath, 'PostToolUse', reminderPath);
});

test('a toolkit copied one directory too deep reports expected and actual paths', t => {
  const { target, check } = fixture(t);
  const nested = path.join(target, 'toolkit');
  fs.mkdirSync(nested);
  for (const name of ['.claude', '.github', '.mcp.json']) {
    fs.renameSync(path.join(target, name), path.join(nested, name));
  }
  const result = check();
  for (const file of [
    settingsPath, gatePath, reminderPath, '.claude/commands/review.md',
    '.claude/commands/watch-review.md', '.github/workflows/ci.yml',
    '.github/workflows/auto-merge.yml', '.github/workflows/claude-pr-review.yml', '.mcp.json',
  ]) {
    expectIncomplete(result, file, 'toolkit/' + file);
  }
  assert.ok(!result.stderr.includes(target), result.stderr);
});

test('the matcher, condition and command path must belong to the correct registration', t => {
  const { check, editSettings } = fixture(t);
  editSettings(settings => {
    const group = settings.hooks.PreToolUse[0];
    const copy = structuredClone(group);
    copy.matcher = 'Read';
    group.hooks[0].command = group.hooks[0].command.replace("'.claude'", "'elsewhere'");
    settings.hooks.PreToolUse.push(copy);
    delete settings.hooks.PostToolUse[0].hooks[0].if;
  });
  expectIncomplete(check(), settingsPath, 'PreToolUse', gatePath, 'PostToolUse', reminderPath);
});

test('invalid settings and a directory in place of a file are reported together', t => {
  const { target, check } = fixture(t);
  fs.writeFileSync(path.join(target, settingsPath), '{');
  const mcp = path.join(target, '.mcp.json');
  fs.unlinkSync(mcp);
  fs.mkdirSync(mcp);
  expectIncomplete(check(), settingsPath, 'JSON', '.mcp.json');
});

test('a target argument is required', t => {
  const result = fixture(t).run();
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /usage/i);
});
