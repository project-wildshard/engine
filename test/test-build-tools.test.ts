// oxlint-disable-next-line import/no-nodejs-modules -- Check the native tool producer/consumer wiring without starting CI.
import { readFileSync } from 'node:fs';
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

test('behaviour restores the exact native tool cache published before its matrix starts', () => {
  const workflow = readFileSync('.github/workflows/deploy.yml', 'utf8');
  const job = (name: string): string => workflow.split(`\n  ${name}:\n`)[1]?.split(/\n {2}[a-z][\w-]*:\n/u)[0] ?? '';
  const step = (source: string, name: string): string => source.split(`      - name: ${name}\n`)[1]?.split(/\n {6}- /u)[0] ?? '';
  const prepare = job('prepare'), behaviour = job('behaviour');
  const producer = step(prepare, 'Cache the checked Basis compiler');
  const consumer = step(behaviour, 'Restore the checked Basis compiler');
  expect(producer).toMatch(/uses: actions\/cache@[0-9a-f]{40} # v4\./u); // public-ci.mjs pins every action to a commit.
  expect(consumer).toMatch(/uses: actions\/cache\/restore@[0-9a-f]{40} # v4\./u);
  const key = (source: string): string | undefined => /^ {10}key: (.+)$/mu.exec(source)?.[1];
  expect(key(producer)).toBeDefined(); expect(key(consumer)).toBe(key(producer));
  for (const source of [producer, consumer]) {
    expect(source).toContain('path: ~/.cache/wildshard/basis');
    expect(source).not.toContain('restore-keys:');
    expect(source).not.toContain('continue-on-error:');
    for (const input of ['runner.os', 'runner.arch', 'src/sharddev/bake/basisTool.ts', 'src/sharddev/bake/basisToolInputs.ts'])
      expect(key(source)).toContain(input);
  }
  expect(prepare.indexOf('Cache the checked Basis compiler')).toBeLessThan(prepare.indexOf('node scripts/gen.mjs --reuse'));
  expect(behaviour).toMatch(/^ {4}needs: .*prepare/mu);
  expect(behaviour.indexOf('Restore the checked Basis compiler')).toBeLessThan(behaviour.indexOf('pnpm exec vitest run'));
});
