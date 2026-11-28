import { expect, test } from 'vitest';
import { admitEnteredGround, EnteredGroundAdmission, holdSpawnGround, spawnGroundCell, L1_QUADRANTS, type SpawnGround } from './spawnGround';
import { GridViewAdmissions } from './viewAdmissions';
import { ApproachInputsDeferredError } from './folderInputs';
import { stepRingsUntil } from './loadingRings';
import { ResidencyAllocator } from '../../../shared/game/grid/allocator';
import { TileStreamer, type RingPorts, type RingTile, type TileRequirement } from '@wildshard/engine/world/tileStreamer';

/** Pine at spawn: its far proxy uploaded, its tiles offered only once its views are admitted, each L1 fetch one ring step. */
function pine(options: { readonly stall?: boolean; readonly admit?: (offer: () => void) => Promise<boolean> } = {}) {
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
    admit: options.admit === undefined ? async () => { await new Promise(resolve => { setTimeout(resolve, 5); }); offered = true; revision++; return true; }
      : () => options.admit?.(() => { offered = true; revision++; }) ?? Promise.resolve(false),
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

/** QA 82: the page budget at a phone's grid entry into Pine: its envelope already full, the headroom taken by claims that can
 *  go (far views, cached products), and the entered cell's tile views admitted through the session's real admission queue, the
 *  optional read fitting only the headroom (`reserveIfFits`) and the required one evicting for it (`reserve`). */
function fullPhoneBudget() {
  let evicted = 0;
  const filler = { id: 'far:elsewhere', category: 'far' as const, owner: 'mossgate', bytes: 39_000_000, distance: 900, needed: false, evictSync: () => { evicted++; } };
  const measure = new ResidencyAllocator({ playing: Number.MAX_SAFE_INTEGER }); measure.reserve(filler);
  // the envelope is the page's playing cost now, plus a megabyte: no 16 MB read fits without making room
  const page = new ResidencyAllocator({ playing: measure.cost().playing + 1_000_000 });
  page.reserve(filler);
  const admissions = new GridViewAdmissions<{ readonly instance: string }>((cell, required, offered) => {
    const claim = { id: `product-input:grid:${cell.instance}:1`, category: 'product' as const, owner: 'grid', bytes: 16_000_000, distance: 0, needed: true };
    if ((required ? page.reserve(claim) : page.reserveIfFits(claim)) === null) return Promise.reject(new ApproachInputsDeferredError());
    offered();
    return Promise.resolve();
  }, () => page.revision);
  const render = async (offer: () => void): Promise<boolean> => {
    try { await admissions.render({ instance: 'pine' }); offer(); return true; } catch (error) { if (error instanceof ApproachInputsDeferredError) return false; throw error; }
  };
  return { admissions, render, evicted: () => evicted };
}

test('a full phone budget still admits the entered cell ground, so its far proxy never encloses the camera (QA 82)', async () => {
  // before: the hold admitted only through the optional path, which deferred on the full budget: no tile, the proxy stayed
  const before = fullPhoneBudget(), stuck = pine({ admit: offer => before.render(offer) });
  try {
    expect(await stuck.hold(5000)).toBe('none');
    expect(stuck.far.excluded.size).toBe(0);
  } finally { stuck.release(); stuck.streamer.dispose(); }
  const budget = fullPhoneBudget();
  const cell = pine({ admit: offer => admitEnteredGround(() => budget.render(offer), async () => { await budget.admissions.complete({ instance: 'pine' }, true); offer(); }) });
  try {
    expect(await cell.hold(5000)).toBe('ready');
    expect([...cell.far.excluded].sort((a, b) => a - b)).toEqual(L1_QUADRANTS);
    expect(budget.evicted()).toBe(1); // the far view elsewhere made room for the ground under the player
  } finally { cell.release(); cell.streamer.dispose(); }
});

test('in play the entered cell ground is asked for as required work once per entry (QA 82)', async () => {
  const asked: string[] = [], failed: string[] = [];
  const ground = new EnteredGroundAdmission(instance => { asked.push(instance); return instance === 'broken' ? Promise.reject(new Error('refused')) : Promise.resolve(); },
    instance => { failed.push(instance); });
  for (let step = 0; step < 5; step++) ground.step('pine-hollow');
  expect(asked).toEqual(['pine-hollow']);
  ground.step(null); ground.step('pine-hollow');
  expect(asked).toEqual(['pine-hollow', 'pine-hollow']);
  ground.step('broken'); ground.step('broken');
  await Promise.resolve(); await Promise.resolve();
  expect(asked).toEqual(['pine-hollow', 'pine-hollow', 'broken']);
  expect(failed).toEqual(['broken']);
});
