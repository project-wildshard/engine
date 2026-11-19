// MAIN RED run 44599964235 (tests 1): a main dispatch's history scan re-read bef3e3273, whose public Web Analytics site
// token sat in a constant named like a credential, and every main run stayed red; the lander's ALLOW_SECRET=1 covered only
// its own push. A reviewed false positive names one line of one exact blob, and nothing wider.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { secretProblems } from './lib.mjs';

const list = JSON.parse(readFileSync(new URL('./secret-false-positives.json', import.meta.url), 'utf8'));
const blob = 'a'.repeat(40), path = 'src/beacon.ts';
// built at run time, so this file's own source never looks like a quoted credential to the blob checks
const quoted = (name, fill) => `const ${name} = ${"'"}${fill.repeat(24)}${"'"};`;
const text = ['// beacon', quoted('SITE_TOKEN', 'f'), quoted('API_KEY', '0')].join('\n');

test('a reviewed line of its exact blob is skipped, and the next matching line is still found', () => {
  const reviewed = [{ blob, path, line: 2 }];
  assert.match(secretProblems(path, blob, text, []).join(), /^src\/beacon\.ts:2: looks like a quoted credential/u);
  assert.match(secretProblems(path, blob, text, reviewed).join(), /^src\/beacon\.ts:3: looks like a quoted credential/u);
  assert.deepEqual(secretProblems(path, blob, text, [...reviewed, { blob, path, line: 3 }]), []);
});

test('an entry covers neither other bytes nor another path', () => {
  const reviewed = [{ blob, path, line: 2 }];
  assert.equal(secretProblems(path, 'b'.repeat(40), text, reviewed).length, 1);
  assert.equal(secretProblems('src/other.ts', blob, text, reviewed).length, 1);
});

test('every listed false positive names an exact blob, line and commit, and says why it was reviewed', () => {
  assert.ok(list.entries.length > 0);
  for (const row of list.entries) {
    assert.match(row.blob, /^[0-9a-f]{40}$/u);
    assert.match(row.commit, /^[0-9a-f]{40}$/u);
    assert.ok(Number.isSafeInteger(row.line) && row.line > 0);
    assert.doesNotMatch(row.path, /[*?]/u);
    assert.ok(row.why.length > 40);
    assert.match(row.reviewed, /\d{4}-\d{2}-\d{2}/u);
  }
});
