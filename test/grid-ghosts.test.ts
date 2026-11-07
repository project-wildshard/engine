import { expect, test } from 'vitest';
// oxlint-disable-next-line import/no-nodejs-modules -- Collection must execute in an isolated real-GC test child.
import { execFileSync } from 'node:child_process';
// oxlint-disable-next-line import/no-nodejs-modules -- Own and remove only this fixture's repository scratch configuration.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Resolve the installed runner and exact fixture without a shell.
import { resolve as resolvePath } from 'node:path';
import { Group } from 'three';
import { GHOST_AFTER_MS, GhostWorlds } from '../src/shared/game/grid/ghosts';
import { Scope } from '../src/shared/engine/app/scope';
import { TileStreamer, scopedTilePorts, type RingPorts, type RingTile } from '../src/client/engine/world/tileStreamer';
import { ResidencyAllocator } from '../src/shared/game/grid/allocator';
import { clientRingPorts, type PreparedRingTile } from '../src/client/game/shardfile/tileContent';
import { ClientAssets } from '../src/client/game/shardfile/clientAssets';
import { emptyShardfile } from '../src/shared/host/author';
import { TileDecoder } from '../src/client/game/grid/tileDecoder';
import { AssetService } from '../src/client/engine/app/assets';
import { AssetResidencyBridge } from '../src/client/game/grid/assetResidency';

let childProved = false;
function collectionRuntime(): (() => void) | null {
  const gc: unknown = Reflect.get(globalThis, 'gc');
  if (typeof gc === 'function') return () => { Reflect.apply(gc, globalThis, []); };
  if (!childProved) {
    const { WS_GRID_GHOST_GC: child } = process.env;
    if (child === '1') throw new Error('Collection requires --expose-gc');
    mkdirSync('tmp', { recursive: true });
    const directory = mkdtempSync(resolvePath('tmp/grid-ghost-gc-'));
    try {
      const config = resolvePath(directory, 'vitest.config.mjs');
      writeFileSync(config, `export default {root:${JSON.stringify(resolvePath('.'))},test:{include:['test/grid-ghosts.test.ts'],setupFiles:[],pool:'forks',maxWorkers:1,execArgv:['--expose-gc']}};`);
      const output = execFileSync(process.execPath, ['--expose-gc', resolvePath('node_modules/vitest/vitest.mjs'), 'run', '--config', config], {
        env: { ...process.env, WS_GRID_GHOST_GC: '1', NO_COLOR: '1' }, encoding: 'utf8', stdio: 'pipe', timeout: 30_000,
      });
      expect(output).toContain('5 passed'); childProved = true;
    } finally { rmSync(directory, { recursive: true, force: true }); }
  }
  expect(childProved).toBe(true);
  return null;
}

// M6 (G628): a retired region whose roots stay alive 30 s after its retirement is a ghost world (O18's leak after unload)
test('a retired region counts as a ghost once it is still alive 30 s after retiring', () => {
  const ghosts = new GhostWorlds(), roots = [{}, {}];
  ghosts.retired('driftwood-isle', roots, 1000);
  ghosts.retired('far-reach', [], 1000); // nothing to watch: never a ghost
  expect(ghosts.regions(1000 + 12_000)).toEqual([{ instance: 'driftwood-isle', ageS: 12 }]);
  expect(ghosts.count(1000 + GHOST_AFTER_MS - 1)).toBe(0);
  expect(ghosts.count(1000 + GHOST_AFTER_MS)).toBe(1);
  expect(roots).toHaveLength(2); // the counter itself holds no root
});

async function retireClientTile(ports: RingPorts<PreparedRingTile>, tile: RingTile): Promise<void> {
  const prepared = await new Promise<PreparedRingTile | Error>(resolve => { ports.fetch(tile, resolve); });
  if (prepared instanceof Error) throw prepared;
  const view = ports.upload(tile, prepared); view.dispose(); view.dispose(); ports.cancel?.(tile);
}

test('the client retirement observer watches roots weakly through repeated publication and disposal', async () => {
  const gc = collectionRuntime(); if (gc === null) return;
  const source = emptyShardfile({ slug: 'tile-ghost', name: 'Tile', author: 'Test', revision: 1, seed: 1 });
  const page = new Scope('client tile page'), root = new Group(), ghosts = new GhostWorlds(), decoder = new TileDecoder();
  const assets = new ClientAssets(source, new Map(), { base: 'https://example.invalid/', offline: true, firstParty: true,
    fetch: () => Promise.reject(new Error('No fixture network')), hash: () => Promise.reject(new Error('No fixture hashing')) });
  const refs: WeakRef<object>[] = [], frameSteps: (() => void)[] = []; let retired = 0;
  const ports = clientRingPorts(new Map([['home', { source, assets, root, views: {
    terrain: () => { throw new Error('No fixture terrain'); }, props: () => Promise.resolve(null), panels: () => Promise.resolve(new Map()),
  } }]]), { scope: page, decoder, frame: step => { frameSteps.push(step); }, retired: (tile, roots) => {
    retired++; ghosts.retired(tile.key, roots, 0); for (const value of roots) refs.push(new WeakRef(value));
  } });
  const tile: RingTile = { key: 'home:l0/0/0', instance: 'home', type: 'level', level: 'l0', x: 0, z: 0 };
  try {
    for (let cycle = 0; cycle < 20; cycle++) {
      await retireClientTile(ports, tile); expect(root.children).toHaveLength(0);
    }
    expect(retired).toBe(20); expect(refs).toHaveLength(40);
    expect(frameSteps).toHaveLength(1); frameSteps[0]?.();
    for (let turn = 0; turn < 40; turn++) {
      await new Promise<void>(resolve => { setTimeout(resolve, 0); }); gc();
      if (refs.every(ref => ref.deref() === undefined) && ghosts.count(GHOST_AFTER_MS) === 0) break;
    }
    expect(refs.every(ref => ref.deref() === undefined)).toBe(true);
    expect(ghosts.regions(GHOST_AFTER_MS)).toEqual([]); expect(page.disposed).toBe(false);
    await retireClientTile(ports, tile); expect(retired).toBe(21);
  } finally { page.dispose(); decoder.dispose(); }
});

test('a region whose roots are all collected leaves the count', async () => {
  const gc = collectionRuntime();
  if (gc === null) return; // The real-GC child above ran both collection contracts.
  const ghosts = new GhostWorlds();
  ((): void => { ghosts.retired('driftwood-isle', [{ world: Array.from({ length: 1000 }, () => 0) }], 0); })();
  for (let i = 0; i < 20 && ghosts.regions(1).length > 0; i++) { gc(); await new Promise<void>(resolve => { setTimeout(resolve, 10); }); }
  expect(ghosts.regions(GHOST_AFTER_MS)).toEqual([]);
  expect(ghosts.count(GHOST_AFTER_MS)).toBe(0);
});

test('twenty tile load/evict cycles collect roots while their page and ports stay live', async () => {
  const gc = collectionRuntime(); if (gc === null) return;
  const page = new Scope('live tile page'), allocator = new ResidencyAllocator(), ghosts = new GhostWorlds();
  const refs: WeakRef<object>[] = []; let live = 0, prepared = 0;
  const ports = scopedTilePorts(page, async (tile, scope) => {
    const root = new Group(); prepared++; live++;
    refs.push(new WeakRef(scope), new WeakRef(root));
    scope.onDispose(() => { live--; ghosts.retired(tile.key, [scope, root], 0); root.removeFromParent(); });
    await Promise.resolve(); return { scope, root };
  }, (_tile, data) => ({ mask: () => { data.root.visible = true; }, shadow: () => undefined, dispose: () => { data.scope.dispose(); } }));
  const streamer = new TileStreamer([{ instance: 'retirement', origin: { x: 0, z: 0 } }],
    { reserve: claim => allocator.reserve(claim), now: () => 0 }, (_instance, level) => level === 'far' ? 256 : null, ports,
    { viewDistance: 500, farRadius: 1000 });
  const near = { x: 0, z: 0, vx: 0, vz: 0 }, away = { ...near, x: 10_000 };
  try {
    for (let cycle = 0; cycle < 20; cycle++) {
      for (let step = 0; step < 6; step++) { streamer.step(near); await Promise.resolve(); }
      expect(streamer.stats().resident.far).toBe(1); expect(live).toBe(1);
      streamer.step(away); await Promise.resolve();
      expect(streamer.stats().resident.far).toBe(0); expect(live).toBe(0);
      expect(allocator.entries()).toHaveLength(0);
    }
    expect(prepared).toBe(20); expect(refs).toHaveLength(40);
    for (let turn = 0; turn < 40; turn++) {
      await new Promise<void>(resolve => { setTimeout(resolve, 0); }); gc();
      if (refs.every(ref => ref.deref() === undefined) && ghosts.count(GHOST_AFTER_MS) === 0) break;
    }
    expect(refs.every(ref => ref.deref() === undefined)).toBe(true);
    expect(ghosts.regions(GHOST_AFTER_MS)).toEqual([]);
    expect(page.disposed).toBe(false);
    for (let step = 0; step < 6; step++) { streamer.step(near); await Promise.resolve(); }
    expect(streamer.stats().resident.far).toBe(1); expect(live).toBe(1); expect(prepared).toBe(21);
  } finally { streamer.dispose(); page.dispose(); }
});

test('a shared live cache does not keep its retired tile consumers or their region parents', async () => {
  const gc = collectionRuntime(); if (gc === null) return;
  const page = new Scope('cache page'), allocator = new ResidencyAllocator(), ghosts = new GhostWorlds();
  let disposals = 0;
  const resource = { dispose: () => { disposals++; } }, backing = new Uint8Array(128);
  const assets = new AssetService<typeof resource>(), bridge = new AssetResidencyBridge(allocator,
    () => [{ identity: backing.buffer, bytes: backing.byteLength, kind: 'cpu' }]);
  const unbind = assets.bindResidency(bridge), refs: WeakRef<Scope>[] = [];
  assets.register('shared', resource, { retain: true, cache: true, reusable: true });
  assets.acquire('shared'); assets.observeResidency(resource, page);
  const visit = (cycle: number): void => {
    const region = page.child(`region:${String(cycle)}`), tile = region.child('tile');
    refs.push(new WeakRef(region), new WeakRef(tile));
    assets.acquire('shared'); tile.onDispose(() => { assets.release('shared'); });
    assets.observeResidency(resource, tile);
    region.dispose(); ghosts.retired(String(cycle), [region, tile], 0);
  };
  try {
    for (let cycle = 0; cycle < 20; cycle++) visit(cycle);
    expect(assets.retained()).toEqual([{ key: 'shared', refs: 1, retained: true }]);
    expect(disposals).toBe(0);
    expect(allocator.entries().filter(row => row.category === 'commons').map(row => row.accountedBytes)).toEqual([128]);
    for (let turn = 0; turn < 40; turn++) {
      await new Promise<void>(resolve => { setTimeout(resolve, 0); }); gc();
      if (refs.every(ref => ref.deref() === undefined) && ghosts.count(GHOST_AFTER_MS) === 0) break;
    }
    expect(refs.every(ref => ref.deref() === undefined)).toBe(true);
    expect(ghosts.regions(GHOST_AFTER_MS)).toEqual([]);
    expect(assets.acquire('shared')).toBe(resource); assets.release('shared');
    expect(page.disposed).toBe(false); expect(disposals).toBe(0);
  } finally {
    page.dispose(); assets.release('shared'); assets.evictCached('shared'); unbind(); bridge.dispose();
  }
  expect(disposals).toBe(1); expect(allocator.entries()).toEqual([]);
});
