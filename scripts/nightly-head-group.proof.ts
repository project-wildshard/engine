// Explicit diagnostic workflow only; never hook/Vitest discovery.
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {test} from 'node:test';
import {groups, partition, plan} from './nightly-model.ts';

await test('the diagnostic CLI selects each actual pinned head in its ordinary nightly partition', () => {
  const heads = plan().heads;
  for (let group = 0; group < groups; group++) {
    const head = partition(heads, group)[0]; assert.notEqual(head, undefined);
    const result = spawnSync(process.execPath, ['scripts/nightly-head-group.ts', head.slug], {encoding:'utf8', timeout:3000});
    assert.equal(result.status, 0, result.stderr); assert.equal(result.stdout.trim(), String(group));
  }
});
await test('an absent, unknown or path-shaped head refuses before any browser or cook runs', () => {
  for (const slug of [undefined, 'not-a-pinned-head', '../template']) {
    const result = spawnSync(process.execPath, ['scripts/nightly-head-group.ts', ...(slug === undefined ? [] : [slug])], {encoding:'utf8', timeout:3000});
    assert.equal(result.status, 1); assert.match(result.stderr, /No committed nightly head/u);
  }
});
