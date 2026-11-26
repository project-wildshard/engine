// Explicit diagnostic workflow only; never hook/Vitest discovery.
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {test} from 'node:test';
import {browsers, headGroups, headRunner, plan} from './nightly-model.ts';

await test('the diagnostic CLI selects each actual pinned head in its ordinary nightly partition', () => {
  const heads = plan().heads;
  for (const browser of browsers) for (const [group, members] of headGroups(heads, browser).entries()) {
    const [head] = members;
    if (head === undefined) continue;
    const result = spawnSync(process.execPath, ['src/scripts/nightly-head-group.ts', head.slug, browser], {encoding:'utf8', timeout:3000});
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), {group, os: headRunner(browser, members)});
  }
});
await test('an absent, unknown or path-shaped head refuses before any browser or cook runs', () => {
  for (const slug of [undefined, 'not-a-pinned-head', '../template']) {
    const result = spawnSync(process.execPath, ['src/scripts/nightly-head-group.ts', ...(slug === undefined ? [] : [slug])], {encoding:'utf8', timeout:3000});
    assert.equal(result.status, 1); assert.match(result.stderr, /No committed nightly head/u);
  }
});
