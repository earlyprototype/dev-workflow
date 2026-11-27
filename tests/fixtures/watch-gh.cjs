'use strict';

// Preload only in the watcher subprocess. Advance its clock by each requested
// sleep so the CLI exercises its normal 20-second polls and 25-minute deadline.
const assert = require('node:assert/strict');
let now = 0;
Date.now = () => now;
global.setTimeout = (callback, ms) => {
  now += ms;
  return setImmediate(callback);
};

require('node:child_process').spawnSync = (command, args) => {
  assert.equal(command, 'gh');
  const scenario = process.env.WATCH_FIXTURE;
  const json = value => ({ status: 0, stdout: JSON.stringify(value) });
  if (args[0] === 'pr' && args[1] === 'view') {
    return json({ number: 7, title: 'Fixture', state: 'OPEN', isDraft: false, url: 'https://example.invalid/pr/7' });
  }
  if (args[0] === 'pr' && args[1] === 'checks') {
    if (scenario === 'unavailable') return { status: 1, stderr: 'unavailable' };
    if (now === 0) return json([]);
    return json([{ name: 'review', bucket: now === 20000 ? 'pending' : 'pass',
      link: 'https://example.invalid/actions/runs/17/job/80' }]);
  }
  if (args[0] === 'api' && args[1].includes('/comments')) {
    if (scenario === 'unreadable') return { status: 1, stderr: 'unavailable' };
    return json(['/actions/runs/170\nAUTOMERGE_VERDICT: PASS']);
  }
  if (args[0] === 'run' && args[1] === 'view') {
    assert.equal(args[2], '17');
    return json({ jobs: [{ name: 'review', steps: [{ name: 'Report review self-skip',
      conclusion: scenario === 'skip' ? 'success' : 'skipped' }] }] });
  }
  throw new Error('Unexpected gh command: ' + args.join(' '));
};
