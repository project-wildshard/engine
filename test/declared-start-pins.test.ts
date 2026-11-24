// FORMAT-PRUNE FP35: a pinned product with no `ui/level` manifest (the open plots, Mirror Salt, Mossgate) stands its player
// where its own `world/spawn` says (declaredStart.ts), not where the discovery document says. This reads every pin in
// `test/pins/shardfiles.json` from its built product and holds the two equal, so the discovery's spawn is redundant for
// them and FP36 can stop writing it.
// oxlint-disable-next-line import/no-nodejs-modules -- The proof reads each pinned product's sections and discovery.
import { existsSync, readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { DEFAULT_SPAWN } from '@wildshard/format/level-start';
import { builtFolder } from '../src/test/game/builtFolder';

interface PinRow { readonly slug: string; readonly revision: number }
interface Spawn { readonly x: number; readonly y?: number; readonly z: number; readonly yaw: number }
const read = <T>(path: string): T => JSON.parse(readFileSync(path, 'utf8')) as T;

test('every pinned product with no level manifest declares the spawn its discovery repeats (FP35)', () => {
  const pins = read<{ shards: readonly PinRow[] }>('test/pins/shardfiles.json').shards;
  const bare = pins.filter(pin => !existsSync(`${builtFolder(pin.slug)}/sections/ui/level.json`));
  expect(bare.length).toBeGreaterThan(0);
  const differ = bare.flatMap(pin => {
    const folder = builtFolder(pin.slug);
    const { spawn } = read<{ spawn: Spawn }>(`${folder}/sections/world/spawn.json`);
    const discovery = read<{ data: { spawn?: Spawn } }>(`${folder}/mounts/shardfiles/${pin.slug}/discovery.json`).data.spawn;
    const declared = !(spawn.x === DEFAULT_SPAWN.x && spawn.y === DEFAULT_SPAWN.y && spawn.z === DEFAULT_SPAWN.z && spawn.yaw === DEFAULT_SPAWN.yaw);
    const same = discovery !== undefined && discovery.x === spawn.x && discovery.z === spawn.z && discovery.yaw === spawn.yaw
      && (discovery.y === undefined || discovery.y === spawn.y);
    return declared && (same || discovery === undefined) ? [] : [`${pin.slug} r${pin.revision}`];
  });
  expect(differ, 'pins whose world/spawn is undeclared or differs from the discovery spawn').toEqual([]);
});
