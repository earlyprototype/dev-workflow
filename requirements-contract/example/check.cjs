'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const doc = fs.readFileSync(path.join(__dirname, 'README.md'), 'utf8');
const criteria = Array.from(doc.matchAll(/^- \[[ x]\] (AC\d+)\./gm), match => match[1]);
const mapping = new Map();
for (const line of doc.split(/\r?\n/)) {
  const row = /^\|\s*(AC\d+)\s*\|\s*R\d+\s*\|([^|]*)\|$/.exec(line);
  if (row) mapping.set(row[1], row[2].trim());
}

const suite = path.resolve(__dirname, '../../toolkit/.claude/hooks/tests/review-gate.test.cjs');
const result = spawnSync(process.execPath, [suite], { encoding: 'utf8' });
if (result.status !== 0) {
  console.error(result.error || result.stdout + result.stderr);
  process.exit(1);
}
const passed = new Set(Array.from(result.stdout.matchAll(/^  PASS  (.+)$/gm), match => match[1]));
if (!criteria.length) {
  console.error('The example checklist has no acceptance criteria.');
  process.exitCode = 1;
}
for (const criterion of criteria) {
  const name = mapping.get(criterion);
  if (passed.has(name)) {
    console.log(`${criterion}: passed "${name}"`);
  } else {
    console.error(name ? `${criterion}: no passing test named "${name}"` : `${criterion}: missing test reference`);
    process.exitCode = 1;
  }
}
