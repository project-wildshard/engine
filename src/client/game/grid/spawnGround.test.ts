import { expect, test } from 'vitest';
import { holdSpawnGround, spawnGroundCell, L1_QUADRANTS, type SpawnGround } from './spawnGround';
import { stepRingsUntil } from './loadingRings';
import { ResidencyAllocator } from '../../../shared/game/grid/allocator';
import { TileStreamer, type RingPorts, type RingTile, type TileRequirement } from '@wildshard/engine/world/tileStreamer';

/** Pine at spawn: its far proxy uploaded, its tiles offered only once its views are admitted, each L1 fetch one ring step. */
function pine(options: { readonly stall?: boolean } = {}) {
  const allocator = new ResidencyAllocator(), cells = [{ instance: 'pine', origin: { x: 0, z: 0 } }];
  let offered = false;
  const far = { excluded: new Set<number>() }, waiting: (() => void)[] = [];
  const ports: RingPorts<string> = {
    fetch: (tile: RingTile, done) => {
      if (tile.level === 'far') { done(tile.key); return; }
      if (tile.level === 'l1' && options.stall === true) return; // a tile that never arrives
      waiting.push(() => { done(tile.key); });
    },
    upload: (tile: RingTile) => ({ mask: excluded => { if (tile.level === 'far') far.excluded = new Set(excluded); }, shadow: () => undefined, dispose: () => undefined }),
  };
  let revision = 0;
  const catalogue = Object.assign((_id: string, level: RingTile['level']): number | null => (level === 'far' ? 1000 : offered ? 100 : null), { revision: () => revision });
  const streamer = new TileStreamer(cells, allocator, catalogue, ports);
  const step = (): void => { waiting.shift()?.(); streamer.step({ x: 0, z: 0, vx: 0, vz: 0 }); };
  for (let frame = 0; frame < 10; frame++) step(); // the loader's own steps: the far proxy is up, nothing finer
  const held: TileRequirement[] = [];
  const hold = (limitMs: number): Promise<SpawnGround> => holdSpawnGround({ instance: 'pine', limitMs,
    admit: async () => { await new Promise(resolve => { setTimeout(resolve, 5); }); offered = true; revision++; return true; },
    require: (id, keys, level) => streamer.require(id, keys, level),
    pump: entry => stepRingsUntil(entry, { frames: () => 0, step, wait: () => new Promise<void>(resolve => { setTimeout(resolve, 0); }) }),
    after: ms => new Promise<void>(resolve => { setTimeout(resolve, ms); }) }, requirement => { held.push(requirement); });
  return { far, streamer, hold, held, release: () => { for (const row of held) row.release(); } };
}

test('control waits until the entered cell ground hides its whole far proxy (PINE-FLASH)', async () => {
  const cell = pine();
  try {
    // today: the far proxy is the only ground at the loader's end, so control would arrive over the tan canyon walls
    expect(cell.far.excluded.size).toBe(0);
    const outcome = await cell.hold(5000);
    expect(outcome).toBe('ready');
    // control arrives only once every one of the proxy's 16 regions is masked by its uploaded L1 quadrant
    expect([...cell.far.excluded].sort((a, b) => a - b)).toEqual(L1_QUADRANTS);
  } finally { cell.release(); cell.streamer.dispose(); }
});

test('a tile that never arrives ends the hold at its ceiling, and the pins release', async () => {
  const cell = pine({ stall: true });
  try {
    const at = Date.now();
    expect(await cell.hold(40)).toBe('timeout');
    expect(Date.now() - at).toBeLessThan(2000);
    expect(cell.held).toHaveLength(1);
    cell.release();
    await expect(cell.held[0]?.ready).rejects.toThrow();
  } finally { cell.streamer.dispose(); }
});

test('only a runtime-drawn cell whose ground is its ring tiles holds the loader', () => {
  expect(spawnGroundCell('pine-hollow', false, false)).toBe('pine-hollow');
  // Nalati draws its whole ground (`cellGround: 'world'`); a runtime in the tile registration has its own entry wait
  expect(spawnGroundCell('nalati-grasslands', false, true)).toBeNull();
  expect(spawnGroundCell('sunscar-dunes', true, false)).toBeNull();
  expect(spawnGroundCell(null, false, false)).toBeNull();
});
