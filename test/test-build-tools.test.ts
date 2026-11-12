// oxlint-disable-next-line import/no-nodejs-modules -- Check workflow cache inputs without starting CI.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { prepareTestBuildTools, selectTestBuildTools } from '../scripts/test-build-tools';
import registry from './build-tools.json' with { type: 'json' };

const fixture = { 'test/native-a.test.ts': ['basis'], 'test/native-b.test.ts': ['basis'] };

test('only the selected native suites request one preparation, independent of selection order', () => {
  expect(selectTestBuildTools(['test/pure.test.ts'], fixture)).toEqual([]);
  expect(selectTestBuildTools([], fixture)).toEqual([]);
  for (const selected of [['test/native-a.test.ts', 'test/native-b.test.ts'], ['test/native-b.test.ts', 'test/native-a.test.ts', 'test/native-a.test.ts']]) {
    expect(selectTestBuildTools(selected, fixture)).toEqual(['basis']);
  }
  expect(selectTestBuildTools(['test/basis-build-provider.test.ts', 'test/sky-creature-rig-output.test.ts'], registry)).toEqual(['basis']);
});

test('the preparation boundary waits before cases and does not invoke tools for pure suites', async () => {
  let calls = 0, ready = false;
  let release = (): void => undefined;
  const ports = { basis: () => { calls++; return new Promise<void>(resolve => { release = resolve; }); } };
  expect(await prepareTestBuildTools(['test/pure.test.ts'], fixture, ports)).toEqual([]);
  expect(calls).toBe(0);
  const pending = prepareTestBuildTools(['test/native-a.test.ts', 'test/native-b.test.ts'], fixture, ports).then(tools => { ready = true; return tools; });
  expect(calls).toBe(1); expect(ready).toBe(false);
  release();
  expect(await pending).toEqual(['basis']); expect(ready).toBe(true);
});

test('unknown tools, escaped suite names and duplicate declarations refuse before installation', async () => {
  let calls = 0;
  const ports = { basis: () => { calls++; return Promise.resolve(); } };
  for (const invalid of [null, [], ['basis'], { 'test/native-a.test.ts': ['foreign'] }, { '../native.test.ts': ['basis'] },
    { 'test/native-a.test.ts': ['basis', 'basis'] }, { 'test/native-a.test.ts': [] }]) {
    await expect(prepareTestBuildTools(['test/native-a.test.ts'], invalid, ports)).rejects.toThrow();
  }
  expect(calls).toBe(0);
});

test('a refused native installation remains a run failure without a cached-byte fallback', async () => {
  await expect(prepareTestBuildTools(['test/native-a.test.ts'], fixture,
    { basis: () => Promise.reject(new Error('Pinned Basis executable identity differs')) }))
    .rejects.toThrow('Pinned Basis executable identity differs');
});

// The Basis tool moved to sharddev at P3 (ENGINE-MOVE-CLEANUP PG1). A cache keyed on a source file that isn't in the
// tree hashes nothing, so its key never changes: every committed source a workflow hashes must exist.
test('workflow cache keys hash only committed sources that exist', () => {
  const workflows = readdirSync('.github/workflows').filter(file => file.endsWith('.yml'));
  const sources = workflows.flatMap(file => [...readFileSync(`.github/workflows/${file}`, 'utf8').matchAll(/hashFiles\(([^)]*)\)/gu)]
    .flatMap(call => [...(call[1] ?? '').matchAll(/'([^']+)'/gu)].map(arg => arg[1] ?? '')))
    .filter(path => /^(?:src|scripts|test|lint)\//u.test(path));
  expect(sources.length).toBeGreaterThan(0);
  for (const path of sources) expect(existsSync(path), path).toBe(true);
});
