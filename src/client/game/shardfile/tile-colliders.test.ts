import { expect, test } from 'vitest';
import { Scope } from '@wildshard/engine/app/scope';
import { colliderTileKeys, SharedTileBuilds, tileKey, type TileContent } from './tileContent';
import { TileDriver } from './tileDriver';
import { tileOf } from '../../../shared/game/shardfile/tileOrder';

// Tile streaming T3 (the collider ring, D2 B): colliders follow the 3 x 3 around the player, apart from the 5 x 5 of draws.
const key = (x: number, z: number): number => tileKey(tileOf(x, z));
const box = (x: number, z: number, h: number) => ({ kind: 'box' as const, x, y: 0, z, hx: h, hy: 1, hz: h });

test('a collider stands in every tile its footprint reaches', () => {
  expect(colliderTileKeys(box(-200, -200, 2))).toEqual([key(-200, -200)]);                       // inside one tile
  expect(colliderTileKeys(box(-187.5, -200, 2)).sort((a, b) => a - b)).toEqual([key(-189, -200), key(-186, -200)].sort((a, b) => a - b)); // on an edge
  expect(colliderTileKeys(box(-187.5, -187.5, 2))).toHaveLength(4);                              // on a corner
  const stair = colliderTileKeys({ kind: 'treads', from: { x: -240, y: 0, z: -200 }, to: { x: -115, y: 3, z: -200 }, width: 2 });
  for (const at of [key(-240, -200), key(-180, -200), key(-115, -200)]) expect(stair).toContain(at);   // a stair across two edges
});

test('a tile builds once for every hold on it, and goes with the last', async () => {
  const owner = new Scope('owner'), built: number[] = [], ended: number[] = [];
  const builds = new SharedTileBuilds(owner, (tile, scope) => { built.push(tile); scope.onDispose(() => { ended.push(tile); }); return Promise.resolve(tile * 10); });
  const render = owner.child('render'), colliders = owner.child('colliders');
  expect(await builds.hold(5, render)).toBe(50); expect(await builds.hold(5, colliders)).toBe(50);
  expect(built).toEqual([5]);
  render.dispose(); expect(ended).toEqual([]); expect([...builds.tiles]).toEqual([5]);
  colliders.dispose(); expect(ended).toEqual([5]); expect([...builds.tiles]).toEqual([]);
  await builds.hold(5, owner.child('again')); expect(built).toEqual([5, 5]);
  owner.dispose();
});

test('shared tile preparation cannot outlive its resident or start for a retired holder', async () => {
  const owner=new Scope('resident'), holder=new Scope('independent-ring'), retired=new Scope('retired-ring');
  let calls=0;
  const builds=new SharedTileBuilds(owner,()=>{calls++;return Promise.resolve(50);});
  retired.dispose();
  try{
    await expect(builds.hold(5,retired)).rejects.toThrow('retired');
    expect(calls).toBe(0);
    expect(await builds.hold(5,holder)).toBe(50);
    owner.dispose();
    expect([...builds.tiles]).toEqual([]);
    await expect(builds.hold(5,holder)).rejects.toThrow('retired');
    expect(calls).toBe(1);
  }finally{owner.dispose();holder.dispose();}
});

test.each(['synchronous','asynchronous'] as const)('failed %s tile preparation releases its child before a fresh hold',async mode=>{
  const owner=new Scope('resident'), failed=new Scope('failed-ring'), retry=new Scope('retry-ring');
  let attempts=0, ended=0;
  const builds=new SharedTileBuilds(owner,(_tile,scope)=>{
    attempts++;scope.onDispose(()=>{ended++;});
    if(attempts>1)return Promise.resolve(50);
    if(mode==='synchronous')throw new Error('prepare failed');
    return Promise.reject(new Error('prepare failed'));
  });
  try{
    await expect(Promise.resolve().then(()=>builds.hold(5,failed))).rejects.toThrow('prepare failed');
    expect(ended).toBe(1);expect([...builds.tiles]).toEqual([]);
    expect(await builds.hold(5,retry)).toBe(50);expect(attempts).toBe(2);
    // The failed generation's later holder cleanup must not evict its replacement.
    failed.dispose();expect([...builds.tiles]).toEqual([5]);
    retry.dispose();expect(ended).toBe(2);expect([...builds.tiles]).toEqual([]);
  }finally{failed.dispose();retry.dispose();owner.dispose();}
});

test('resident retirement during preparation refuses its late result',async()=>{
  const owner=new Scope('resident'), holder=new Scope('independent-ring');
  let finish:(value:number)=>void=()=>{throw new Error('Preparation not started');};
  const builds=new SharedTileBuilds(owner,()=>new Promise<number>(resolve=>{finish=resolve;}));
  const pending=builds.hold(5,holder);
  owner.dispose();finish(50);
  try{await expect(pending).rejects.toThrow('retired');expect([...builds.tiles]).toEqual([]);}
  finally{holder.dispose();}
});

test('ring cancellation preserves late completion without retiring its replacement',async()=>{
  const owner=new Scope('resident'), first=owner.child('first-ring'), retry=owner.child('retry-ring');
  let finish:(value:number)=>void=()=>{throw new Error('Preparation not started');};
  let attempts=0;
  const builds=new SharedTileBuilds(owner,()=>{
    attempts++;
    return attempts===1?new Promise<number>(resolve=>{finish=resolve;}):Promise.resolve(60);
  });
  try{
    const cancelled=builds.hold(5,first);first.dispose();
    expect(await builds.hold(5,retry)).toBe(60);
    finish(50);
    // TileDriver checks the retired holder after this await; cancellation must
    // not enter its failure branch and permanently blacklist the tile.
    await expect(cancelled).resolves.toBe(50);
    expect([...builds.tiles]).toEqual([5]);
    retry.dispose();expect([...builds.tiles]).toEqual([]);
  }finally{first.dispose();retry.dispose();owner.dispose();}
});

test('each ring step registers exactly the colliders reaching the 3 x 3, with none missing at its edges', async () => {
  // a box at every tile corner and every tile centre: each corner box reaches four tiles, each centre box one
  const rows = Array.from({ length: 9 * 9 }, (_, k) => box(-250 + (k % 9) * 62.5, -250 + Math.floor(k / 9) * 62.5, 3))
    .concat(Array.from({ length: 64 }, (_, k) => box(-218.75 + (k % 8) * 62.5, -218.75 + Math.floor(k / 8) * 62.5, 3)))
    .filter(row => Math.abs(row.x) < 250 && Math.abs(row.z) < 250);
  const byTile = new Map<number, number[]>();
  rows.forEach((row, i) => { for (const tile of colliderTileKeys(row)) { const list = byTile.get(tile); if (list === undefined) byTile.set(tile, [i]); else list.push(i); } });
  const live = new Map<number, Set<number>>(); // tile -> the collider rows it registered
  const content: TileContent = { id: 'made-up', tiles: () => new Set(byTile.keys()), attach: () => Promise.resolve(),
    attachColliders: (tile, scope) => { live.set(tile, new Set(byTile.get(tile))); scope.onDispose(() => { live.delete(tile); }); return Promise.resolve(); } };
  const scope = new Scope('tiles'), driver = new TileDriver(scope, [content], () => 2, () => Promise.resolve());
  const settle = async (x: number, z: number): Promise<void> => { for (let i = 0; i < 80; i++) { driver.step(x, z); await Promise.resolve(); await Promise.resolve(); } };
  try {
    for (const [x, z] of [[-200, -200], [-100, -200], [30, 30], [200, 150]] as const) {
      await settle(x, z);
      const centre = tileOf(x, z), ring = new Set<number>();
      for (let j = centre.j - 1; j <= centre.j + 1; j++) for (let i = centre.i - 1; i <= centre.i + 1; i++) if (i >= 0 && i < 8 && j >= 0 && j < 8) ring.add(tileKey({ i, j }));
      expect(driver.resident('colliders')).toEqual(ring);
      const registered = new Set([...live.values()].flatMap(set => Array.from(set)));
      const expected = new Set([...ring].flatMap(tile => byTile.get(tile) ?? []));
      expect(registered).toEqual(expected);                                   // identity: in the ring's tiles, nothing else
      for (const tile of colliderTileKeys(box(x, z, 0))) for (const row of byTile.get(tile) ?? []) expect(registered.has(row)).toBe(true); // the player's tile: no gap
    }
  } finally { scope.dispose(); }
  expect(live.size).toBe(0);
});
