import { expect, test, vi } from 'vitest';
import { Scope } from '@wildshard/engine/app/scope';
import { SceneHandles } from './sceneHandles';
import { TileDriver, followResidentTiles, residentTiles, tileRing } from './tileDriver';
import type { TileContent } from './tileContent';
import { bindResidentTileEntry } from './tileEntry';

function content(id: string): TileContent & { render: Map<number, Scope>; colliders: Map<number, Scope> } {
  const render = new Map<number, Scope>(), colliders = new Map<number, Scope>();
  const attach = (entries: Map<number, Scope>, key: number, owner: Scope): Promise<void> => {
    entries.set(key, owner); owner.onDispose(() => { entries.delete(key); }); return Promise.resolve();
  };
  return { id, render, colliders, tiles: () => new Set(Array.from({ length: 64 }, (_, key) => key)),
    attach: (key, owner) => attach(render, key, owner), attachColliders: (key, owner) => attach(colliders, key, owner) };
}
const spawn = { x: 0, z: 0 };

test('a bound crossing requires its actual entry ring, leaving unrelated spawn and exits to streaming', async () => {
  const owner = new Scope('actual-entry'), source = content('world'), point = { x: 240, z: 0 };
  const exits = [{ at: [-250, 0, -250], width: 10 }] as const;
  const sources: TileContent[] = [source];
  bindResidentTileEntry(owner, point);
  try {
    await residentTiles(owner, sources, spawn, exits, tileRing);
    expect([...source.render.keys()]).toEqual([30, 31, 38, 39, 46, 47]);
    expect([...source.colliders.keys()]).toEqual([...source.render.keys()]);
    expect(source.render.has(36)).toBe(false); expect(source.render.has(0)).toBe(false);
    // Later content still fills the same required entry under the old owners.
    const roots = new Map(source.render), later = content('later'); sources.push(later);
    await residentTiles(owner, sources, spawn, exits, tileRing);
    expect(source.render).toEqual(roots);
    expect([...later.render.keys()]).toEqual([...roots.keys()]);
    expect([...later.colliders.keys()]).toEqual([...roots.keys()]);
  } finally { owner.dispose(); }
});

test('unbound construction requires the spawn ring, leaving distant exits to play', async () => {
  const owner = new Scope('authored-entry'), source = content('world');
  try {
    await residentTiles(owner, [source], spawn, [{ at: [-250, 0, -250], width: 10 }], tileRing);
    expect([...source.render.keys()]).toEqual([27,28,29,35,36,37,43,44,45]);
    expect([...source.colliders.keys()]).toEqual([...source.render.keys()]);
    expect(source.render.has(0)).toBe(false); expect(source.colliders.has(0)).toBe(false);
  } finally { owner.dispose(); }
});

test('bound entry failures still refuse before controls while an unrelated tile is not touched', async () => {
  const owner = new Scope('entry-refusal'), failure = new Error('required entry failed'), seen: number[] = [];
  bindResidentTileEntry(owner, { x: 240, z: 0 });
  const source: TileContent = { id: 'entry', tiles: () => new Set([0, 30]), attach: key => {
    seen.push(key); return Promise.reject(key === 30 ? failure : new Error('unrelated tile'));
  } };
  try { await expect(residentTiles(owner, [source], spawn, [{ at: [-250, 0, -250], width: 10 }], tileRing)).rejects.toBe(failure); }
  finally { owner.dispose(); }
  expect(seen).toEqual([30]);
});

test('a later scene stage attaches its rank-0 content without rebuilding earlier content', async () => {
  const owner = new Scope('staged-scenes'), scenes = new SceneHandles(), initial = content('initial'), later = content('later');
  const firstCoarse = vi.fn(() => Promise.resolve()), laterCoarse = vi.fn(() => Promise.resolve());
  scenes.addTiled({ ...initial, coarse: firstCoarse });
  try {
    await residentTiles(owner, scenes.tiled(), spawn, [], tileRing);
    const original = new Map(initial.render);
    scenes.addTiled({ ...later, coarse: laterCoarse });
    await residentTiles(owner, scenes.tiled(), spawn, [], tileRing);
    expect(later.render.size).toBe(9); expect(later.colliders.size).toBe(9);
    expect(initial.render).toEqual(original);
    expect(firstCoarse).toHaveBeenCalledTimes(1); expect(laterCoarse).toHaveBeenCalledTimes(1);
  } finally { owner.dispose(); }
  expect(initial.render.size + later.render.size + initial.colliders.size + later.colliders.size).toBe(0);
});

test('re-entry restores required tiles evicted by the previous entry', async () => {
  const owner = new Scope('returning-world'), source = content('world');
  let at = spawn;
  try {
    await residentTiles(owner, [source], spawn, [], tileRing);
    const follow = followResidentTiles(owner, () => at);
    if (follow === null) throw new Error('Missing resident driver');
    at = { x: -240, z: -240 }; follow(); await Promise.resolve(); await Promise.resolve();
    expect(source.render.has(36)).toBe(false); expect(source.colliders.has(36)).toBe(false);
    await residentTiles(owner, [source], spawn, [], tileRing);
    expect(source.render.has(36)).toBe(true); expect(source.colliders.has(36)).toBe(true);
  } finally { owner.dispose(); }
});

test('late content also fills already attached background tiles once, under their existing scopes', async () => {
  const owner = new Scope('late-background'), initial = content('initial'), later = content('later'), sources: TileContent[] = [initial];
  const driver = new TileDriver(owner, sources, () => 1, () => Promise.resolve());
  const settle = async (): Promise<void> => {
    for (let frame = 0; frame < 90; frame++) { driver.step(0, 0); await Promise.resolve(); await Promise.resolve(); }
  };
  try {
    await settle(); expect(initial.render.size).toBe(9);
    const original = new Map(initial.render); sources.push(later);
    await settle();
    expect(later.render.size).toBe(9); expect(later.colliders.size).toBe(9);
    expect(initial.render).toEqual(original);
  } finally { owner.dispose(); }
});

test('required attachment awaits an in-flight background failure and refuses it', async () => {
  const owner = new Scope('shared-background'), failure = new Error('background collider failed');
  let refuse = (_error: Error): void => { throw new Error('Missing background preparation'); };
  let started = (): void => { throw new Error('Missing start witness'); };
  const waiting = new Promise<void>(resolve => { started = resolve; });
  const source: TileContent = { id: 'world', tiles: () => new Set([36]),
    attach: () => { started(); return new Promise<void>((_resolve, reject) => { refuse = reject; }); } };
  const driver = new TileDriver(owner, [source], () => 1, () => Promise.resolve());
  const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  try {
    for (let frame = 0; frame < 80; frame++) { driver.step(0, 0); await Promise.resolve(); await Promise.resolve(); }
    await waiting;
    const required = driver.require([36]); refuse(failure);
    await expect(required).rejects.toBe(failure);
    expect(warning).toHaveBeenCalledTimes(1);
  } finally { warning.mockRestore(); owner.dispose(); }
});

test('a failing tile cleanup rejects required callers without stranding their shared promise', async () => {
  const owner = new Scope('failed-cleanup');
  const source: TileContent = { id: 'cleanup', tiles: () => new Set([36]), attach: (_key, tile) => {
    tile.onDispose(() => { throw new Error('cleanup failed'); });
    return Promise.reject(new Error('attachment failed'));
  } };
  const driver = new TileDriver(owner, [source], () => 1, () => Promise.resolve());
  try { await expect(driver.require([36])).rejects.toThrow('cleanup failed'); }
  finally { owner.dispose(); }
});
