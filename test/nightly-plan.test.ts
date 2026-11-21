// oxlint-disable-next-line import/no-nodejs-modules -- Exercise the same CLI as the nightly head job.
import { spawnSync } from 'node:child_process';
// oxlint-disable-next-line import/no-nodejs-modules -- read the pins file the nightly reads
import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { plan } from '../scripts/nightly-model';
import { DEFAULT_LIMITS } from '../src/cook/game/cookWorker';

// Ring 2's nightly plans one row per pinned head. A hard-coded 28 stopped the night before any head ran after a pin
// was dropped (27 heads, 2026-11-13): the plan must take the pins file as it stands.
test('the nightly plan holds every pinned head, each once', () => {
  const pinned = (JSON.parse(readFileSync('test/pins/shardfiles.json', 'utf8')) as {shards: {slug: string}[]}).shards.map(row => row.slug);
  const heads = plan().heads.map(row => row.slug);
  expect([...heads].sort()).toEqual([...pinned].sort());
  expect(new Set(heads).size).toBe(heads.length);
});

test('FS30 the Ring 2 CLI accepts the nightly cook allowance and refuses anything longer', () => {
  const maximum = DEFAULT_LIMITS.seconds * 1000;
  // A nonempty output directory stops after argument validation, before a cook can start.
  const cook = (timeout: number) => spawnSync(process.execPath,
    ['scripts/ring-cook.mjs', '--ring2', '--out=test', `--timeout-ms=${timeout}`],
    { encoding: 'utf8', timeout: 10_000 });
  expect(cook(maximum).stderr).toContain('Cook output must be empty');
  expect(cook(maximum + 1).stderr).toContain(`Cook timeout must be in (0, ${maximum}] ms`);
}, 25_000);

test('FS30 the browser lease cannot end a hosted head job before its own deadline', () => {
  const workflow = readFileSync('.github/workflows/nightly.yml', 'utf8');
  const heads = /\n  heads:\n([\s\S]+?)\n  report:/u.exec(workflow)?.[1] ?? '';
  const jobMinutes = /timeout-minutes: (\d+)/u.exec(heads)?.[1];
  const leaseMinutes = /scripts\/browser-lane\.sh --max (\d+) node scripts\/nightly-heads\.ts/u.exec(heads)?.[1];
  expect(jobMinutes).toBeDefined();
  expect(leaseMinutes).toBe(jobMinutes);
});

test('FS30 begins recording live draws before running the hover journey', () => {
  const source = readFileSync('scripts/parity/boot-smoke.mjs', 'utf8');
  const ready = source.indexOf('await until(page, faults, () => gameplay(true)');
  const start = source.indexOf('const enteredProof = gameplayEvidence?.onEnter?.(page)');
  const hover = source.indexOf('gameplayProbeTime(() => afterGameplay(page))');
  expect(ready).toBeGreaterThan(-1);
  expect(start).toBeGreaterThan(ready);
  expect(hover).toBeGreaterThan(start);
  expect(source).toContain('await enteredProof');
});

test('FS30 Pine Chromium gets its own job without duplicating any head', () => {
  const output = spawnSync(process.execPath, ['scripts/nightly.ts', 'plan'], { encoding: 'utf8', timeout: 5_000 });
  expect(output.status).toBe(0);
  const { include } = JSON.parse(output.stdout) as { include: { browser: string; heads: string }[] };
  const pinned = plan().heads.map(head => head.slug);
  expect(include.find(row => row.browser === 'chromium' && row.heads.includes('pine-hollow'))?.heads).toBe('pine-hollow');
  for (const browser of ['chromium', 'webkit']) {
    const heads = include.filter(row => row.browser === browser).flatMap(row => row.heads.split(',').filter(Boolean));
    expect(heads.sort()).toEqual(pinned);
  }
});
