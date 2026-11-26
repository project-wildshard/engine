// Ring 1 steps a declared shard's server slice (shard-pin run 44689685887: Nine Dragon r5, once declared, failed to record its
// digest on ENOENT for a prop GLB, as the worker path wants the whole asset table and a slice holds none of the art). A room
// runs a declared cell on its server inputs alone (cellWorld's `openDataCell`), so the slice steps that way and must reach the
// same state the whole head reaches in the tick worker. Brasscap Mesa is Ring 1's declared product: its pin is in the cache.
// oxlint-disable-next-line import/no-unassigned-import -- A room steps on the portable Math, as ring-step does: before any module body.
import '../src/shared/engine/core/portableMathFirst';
// oxlint-disable-next-line import/no-nodejs-modules -- Expand one actual immutable pin into an owned fixture root.
import {mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Confine fixture bodies to repository scratch.
import {dirname, resolve} from 'node:path';
// oxlint-disable-next-line import/no-nodejs-modules -- Locate the immutable public pin installed before every suite.
import {homedir} from 'node:os';
import {readTar} from '@wildshard/format/tar';
import {expect, test} from 'vitest';
import {openShardfile, serverRows} from '../src/cook/game/shardCook';
import {stepRingFolder} from '../src/scripts/ring-step-paths';

test('a declared server slice steps on its server inputs to the whole head\'s state', async () => {
  mkdirSync('tmp', {recursive: true});
  const root = mkdtempSync(resolve('tmp/ring-declared-slice-')), slug = 'brasscap-mesa';
  try {
    const pins = JSON.parse(readFileSync('test/pins/shardfiles.json', 'utf8')) as {shards: {slug: string; hash: string}[]};
    const pin = pins.shards.find(row => row.slug === slug);
    if (pin === undefined) throw new Error('Missing actual Brasscap Mesa pin');
    const bytes = readFileSync(resolve(process.env['WILDSHARD_PIN_CACHE'] ?? resolve(homedir(), '.cache/wildshard/pins'), `${pin.hash}.tar`));
    const write = (folder: string, path: string, body: Uint8Array): void => {
      const file = resolve(folder, path); mkdirSync(dirname(file), {recursive: true}); writeFileSync(file, body);
    };
    const full = resolve(root, 'full'), slice = resolve(root, 'slice'), opened = openShardfile(bytes);
    for (const [path, body] of readTar(bytes)) if (!path.endsWith('/')) write(full, path, body);
    // The production server inventory, as `pins.ts slice` cuts it.
    for (const row of serverRows(opened)) write(slice, row.path, opened.read(row.path));
    const options = {ticks: 60, link: 30};
    const whole = await stepRingFolder(full, false, options);
    expect(whole.path).toBe('declared');
    const sliced = await stepRingFolder(slice, true, options);
    expect(sliced.path).toBe('declared-slice');
    expect(sliced.chain).toHaveLength(2);
    expect(sliced.chain).toEqual(whole.chain);
  } finally { rmSync(root, {recursive: true, force: true}); }
}, 60_000);
