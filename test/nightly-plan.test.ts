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
