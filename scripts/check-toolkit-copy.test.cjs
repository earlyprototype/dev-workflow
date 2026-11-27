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
const runtimeHelpers = [
  '.claude/hooks/lib/watch-review.cjs',
  '.claude/hooks/lib/write-review-log.cjs',
  '.github/scripts/automerge-eligible.cjs',
];
const ciTests = [
  '.claude/hooks/tests/review-gate.test.cjs',
  '.claude/hooks/tests/watch-review.test.cjs',
  '.claude/hooks/tests/watch-review-reminder.test.cjs',
  '.github/scripts/automerge-eligible.test.cjs',
];

function fixture(t, preload = '') {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'copy check '));
  t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
  const target = path.join(temp, 'target project');
  const cwd = path.join(temp, 'unrelated');
  fs.mkdirSync(cwd);
  fs.cpSync(toolkit, target, { recursive: true });

  // Run the CLI with filesystem writes and child processes denied. Catch a
  // direct network call or an imported target hook even if its caller recovers.
  const offline = path.join(cwd, 'offline.cjs');
  fs.writeFileSync(offline, "require('node:net').Socket.prototype.connect = globalThis.fetch = () => process.exit(90);\n" + preload);
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

for (const helper of runtimeHelpers) {
  test(`a missing runtime helper is reported: ${helper}`, t => {
    const { target, check } = fixture(t);
    fs.unlinkSync(path.join(target, helper));
    expectIncomplete(check(), helper);
  });
}

for (const file of ciTests) {
  test(`a missing CI test script is reported: ${file}`, t => {
    const { target, check } = fixture(t);
    fs.unlinkSync(path.join(target, file));
    const result = check();
    expectIncomplete(result, `${file}: missing`);
    assert.equal(result.stdout, '');
  });
}

test('an unregistered hook fails even when its script is present', t => {
  const { check, editSettings } = fixture(t);
  editSettings(settings => { delete settings.hooks.PostToolUse; });
  expectIncomplete(check(), settingsPath, 'PostToolUse', reminderPath);
});

for (const parent of ['toolkit', 'dev-workflow']) {
  test(`a copy one directory too deep under ${parent} reports expected and actual paths`, t => {
    const { target, check } = fixture(t);
    const nested = path.join(target, parent);
    fs.mkdirSync(nested);
    for (const name of ['.claude', '.github', '.mcp.json']) {
      fs.renameSync(path.join(target, name), path.join(nested, name));
    }
    const result = check();
    for (const file of [
      settingsPath, gatePath, reminderPath, ...runtimeHelpers, ...ciTests, '.claude/commands/review.md',
      '.claude/commands/watch-review.md', '.github/workflows/ci.yml',
      '.github/workflows/auto-merge.yml', '.github/workflows/claude-pr-review.yml', '.mcp.json',
    ]) {
      expectIncomplete(result, `${file}: found at ${parent}/${file}`);
    }
    assert.ok(!result.stderr.includes(target), result.stderr);
  });
}

for (const [original, renamed, suffix] of [
  ['.github', '.GitHub', '/workflows/ci.yml'],
  ['.github/workflows', '.github/Workflows', '/ci.yml'],
  ['.github/workflows/ci.yml', '.github/workflows/CI.yml', ''],
]) {
  test(`case-only rename to ${renamed} reports the spelling on disk`, t => {
    const { target, check } = fixture(t);
    fs.renameSync(path.join(target, original), path.join(target, renamed));
    expectIncomplete(check(), `${original}${suffix}: found at ${renamed}${suffix}`);
  });
}

test('a workflow directory linked outside the target is reported', t => {
  const { target, check } = fixture(t);
  const github = path.join(target, '.github');
  const outside = target + ' sibling';
  fs.renameSync(github, outside);
  fs.symlinkSync(outside, github, 'junction');
  const result = check();
  expectIncomplete(result, '.github/workflows/ci.yml', 'outside');
  assert.ok(!result.stderr.includes(target), result.stderr);
});

for (const directory of ['.github', '.github/workflows']) {
  test(`a link at ${directory} cannot supply repository workflows`, t => {
    const { target, check } = fixture(t);
    const source = path.join(target, directory);
    const inside = path.join(target, 'workflow files');
    fs.renameSync(source, inside);
    fs.symlinkSync(inside, source, 'junction');
    const result = check();
    for (const name of ['ci.yml', 'auto-merge.yml', 'claude-pr-review.yml']) {
      expectIncomplete(result, `.github/workflows/${name}: ${directory} is a symbolic link`);
    }
  });
}

test('a link at a workflow filename cannot supply a repository workflow', t => {
  const { target, check } = fixture(t);
  const workflow = '.github/workflows/ci.yml';
  const source = path.join(target, workflow);
  const inside = path.join(target, 'ci.yml');
  fs.renameSync(source, inside);
  try {
    fs.symlinkSync(inside, source, 'file');
  } catch (err) {
    if (process.platform !== 'win32' || err.code !== 'EPERM') throw err;
    // Without file symlink privileges, put a junction at the same workflow path.
    fs.symlinkSync(inside, source, 'junction');
  }
  const result = check();
  expectIncomplete(result, `${workflow}: ${workflow} is a symbolic link`);
});

test('the misplaced-file search skips a child replaced after the root listing', t => {
  const { target, check } = fixture(t, `
    const fs = require('node:fs');
    const path = require('node:path');
    const root = fs.realpathSync.native(process.argv[2]);
    const outside = fs.realpathSync.native(root + ' sibling');
    const list = fs.readdirSync;
    fs.readdirSync = (directory, options) => {
      if (fs.realpathSync.native(directory) === outside) process.exit(94);
      const entries = list(directory, options);
      if (directory === root && options?.withFileTypes) {
        // The initial snapshot predates the junction now on disk.
        entries.find(entry => entry.name === 'nested').isDirectory = () => true;
      }
      return entries;
    };
  `);
  const outside = target + ' sibling';
  fs.mkdirSync(outside);
  fs.renameSync(path.join(target, '.mcp.json'), path.join(outside, '.mcp.json'));
  fs.symlinkSync(outside, path.join(target, 'nested'), 'junction');
  expectIncomplete(check(), '.mcp.json: missing');
});

test('a misplaced file that resolves outside the target at reporting time is ignored', t => {
  const { target, check } = fixture(t, `
    const fs = require('node:fs');
    const path = require('node:path');
    const root = fs.realpathSync.native(process.argv[2]);
    const candidate = path.join(root, 'nested', '.mcp.json');
    const resolve = fs.realpathSync.native;
    fs.realpathSync.native = file => file === candidate
      ? path.join(root + ' sibling', '.mcp.json')
      : resolve(file);
  `);
  const nested = path.join(target, 'nested');
  fs.mkdirSync(nested);
  fs.renameSync(path.join(target, '.mcp.json'), path.join(nested, '.mcp.json'));
  expectIncomplete(check(), '.mcp.json: missing');
});

test('an external link at a required filename is reported', t => {
  const { target, check } = fixture(t);
  const config = path.join(target, '.mcp.json');
  const outside = path.join(path.dirname(target), 'external config');
  const externalConfig = path.join(outside, '.mcp.json');
  fs.mkdirSync(outside);
  fs.renameSync(config, externalConfig);
  try {
    fs.symlinkSync(externalConfig, config, 'file');
  } catch (err) {
    if (process.platform !== 'win32' || err.code !== 'EPERM') throw err;
    // A junction exercises the same leaf check on Windows without file symlink privileges.
    fs.symlinkSync(outside, config, 'junction');
  }
  expectIncomplete(check(), '.mcp.json', 'outside');
});

test('settings in a linked project directory are read from the verified handle', t => {
  const { target, check } = fixture(t, `
    const fs = require('node:fs');
    const path = require('node:path');
    const root = path.resolve(process.argv[2]);
    const read = fs.readFileSync;
    fs.readFileSync = (file, ...args) => {
      if (typeof file === 'string' && path.resolve(file).startsWith(root + path.sep)) process.exit(93);
      return read(file, ...args);
    };
  `);
  const claude = path.join(target, '.claude');
  const inside = path.join(target, 'project settings');
  fs.renameSync(claude, inside);
  fs.symlinkSync(inside, claude, 'junction');
  const result = check();
  assert.equal(result.status, 0, result.stderr);
});

test('a settings handle with a changed identity is rejected before reading', t => {
  const { check } = fixture(t, `
    const fs = require('node:fs');
    const fstat = fs.fstatSync;
    fs.fstatSync = (...args) => {
      const stat = fstat(...args);
      stat.ino++;
      return stat;
    };
    const read = fs.readFileSync;
    fs.readFileSync = (file, ...args) => {
      if (typeof file === 'number') process.exit(93);
      return read(file, ...args);
    };
  `);
  expectIncomplete(check(), settingsPath, 'changed');
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
