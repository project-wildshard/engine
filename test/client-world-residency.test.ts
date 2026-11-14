import { afterAll, beforeAll, expect, test } from 'vitest';
import { Group, type Object3D } from 'three';
import { TileStreamer } from '../src/client/engine/world/tileStreamer';
import { TileDecoder } from '../src/client/game/grid/tileDecoder';
import { tileOf } from '../src/shared/game/shardfile/tileOrder';
import { Scope } from '../src/shared/engine/app/scope';
import { emptyShardfile } from '../src/shared/host/author';
import { hashImmutableBytes } from '../src/shared/host/immutable';
import { ResidencyAllocator } from '../src/shared/game/grid/allocator';
import { ClientAssets } from '../src/client/game/shardfile/clientAssets';
import { clientRingCatalogue, clientRingPorts, clientTileRegistration, ring } from '../src/client/game/shardfile/tileContent';
import type { ClientTileViews } from '../src/client/game/shardfile/clientViews';
import type { Shardfile } from '@wildshard/format/shardSchema';
import { jsonSlot } from '../src/client/engine/saves/slots';
import { LEVEL_DOWNLOAD_SLOT, runtimePacksOn } from '../src/client/engine/boot/loadingPacks';

// These pending-read and retirement rulers require a moving device ring.
const download = jsonSlot(LEVEL_DOWNLOAD_SLOT, 'device'), previous = download.read();
beforeAll(() => { download.write('shardfile'); expect(runtimePacksOn()).toBe(false); });
afterAll(() => { download.write(previous); });

function fixture() {
  const source = emptyShardfile({ slug: 'residency-fixture', name: 'Residency', author: 'Test', seed: 1, revision: 1 });
  const scope = new Scope('resident-world'), allocator = new ResidencyAllocator(), wire = new Map<string, Uint8Array>();
  const rows: NonNullable<Shardfile['props']>['tiles'] = [];
  for (const lod of [1, 0] as const) {
    const side = lod === 1 ? 4 : 8, size = 500 / side;
    for (let z = 0; z < side; z++) for (let x = 0; x < side; x++) {
      const bytes = new Uint8Array([lod, x, z]), hash = hashImmutableBytes(bytes);
      wire.set(hash, bytes); rows.push({ lod, x, z, file: hash });
      source.files.push({ hash, kind: 'binary', compressed: 3, decoded: 1, gpu: 1, triangles: 0, draws: 1, dependencies: [], critical: false });
      source.tiles.push({ lod, x, z, files: [hash], compressed: 3, decoded: 1, gpu: 1, triangles: 0, draws: 1, geometricError: 0,
        bounds: { min: [-250 + x * size, 0, -250 + z * size], max: [-250 + (x + 1) * size, 0, -250 + (z + 1) * size] } });
    }
  }
  source.props = { version: 1, family: 'fixture-ground', tiles: rows, wholeLibrary: [], models: [], panels: [], far: null, colliders: [], textures: [] };
  const live = new Map<string, { excluded: ReadonlySet<number>; root: Object3D }>();
  let leases = 0;
  let hold: { enter: () => void; read: () => Promise<Uint8Array | null> } | undefined;
  let currentBytes: Uint8Array | null = null;
  const blockNext = () => {
    let enter: () => void = () => undefined, finish: () => void = () => undefined, refuse: () => void = () => undefined;
    const entered = new Promise<void>(resolve => { enter = resolve; });
    hold = { enter, read: () => new Promise<Uint8Array | null>((resolve, reject) => {
      finish = () => { resolve(currentBytes); }; refuse = () => { reject(new Error('Fixture read failed')); };
    }) };
    return { entered, finish: () => { finish(); }, refuse: () => { refuse(); } };
  };
  const assets = new ClientAssets(source, wire, { base: 'https://example.invalid/', offline: true, firstParty: true,
    fetch: () => Promise.reject(new Error('Unexpected network')), hash: bytes => Promise.resolve(hashImmutableBytes(bytes)), cache: {
      product: () => Promise.resolve(null), putFolder: () => Promise.resolve(), putAsset: () => Promise.resolve(true),
      pin: () => { leases++; return () => { leases--; }; },
      asset: (_base, hash) => {
        const pending = hold; if (pending === undefined) return Promise.resolve(wire.get(hash) ?? null);
        hold = undefined; currentBytes = wire.get(hash) ?? null; const result = pending.read(); pending.enter(); return result;
      },
    } });
  const views: ClientTileViews = {
    terrain: () => { throw new Error('No fixture terrain'); }, panels: () => Promise.resolve(new Map()),
    props: (_props, _key, bytes, root, owner) => {
      const [lod, x, z] = bytes; if (lod === undefined || x === undefined || z === undefined) throw new Error('Missing fixture address');
      const key = `${String(lod)}/${String(x)}/${String(z)}`, view: { excluded: ReadonlySet<number>; root: Object3D } = { excluded: new Set(), root };
      live.set(key, view); owner.onDispose(() => { live.delete(key); });
      return Promise.resolve({ mask: (excluded: ReadonlySet<number>) => { view.excluded = new Set(excluded); }, shadow: () => undefined });
    },
  };
  const coverage = (): number[] => Array.from({ length: 64 }, (_, key) => {
    const x = key % 8, z = Math.floor(key / 8), coarse = live.get(`1/${String(Math.floor(x / 2))}/${String(Math.floor(z / 2))}`);
    return Number(coarse !== undefined && coarse.root.parent !== null && !coarse.excluded.has(x % 2 + 2 * (z % 2))) + Number(live.get(`0/${String(x)}/${String(z)}`)?.root.parent !== null && live.has(`0/${String(x)}/${String(z)}`));
  });
  const decoder = new TileDecoder(), instances = new Map([['home', { source, assets, root: new Group(), views }]]);
  const streamer = new TileStreamer([{ instance: 'home', origin: { x: 0, z: 0 } }], allocator,
    clientRingCatalogue(instances), clientRingPorts(instances, { scope, decoder }));
  const registration = clientTileRegistration(instances, streamer, () => 2);
  scope.onDispose(() => { registration.dispose(); streamer.dispose(); decoder.dispose(); });
  let camera = { x: -200, z: -200, vx: 0, vz: 0 };
  const pump = async <T>(work: Promise<T>): Promise<T> => {
    let settled = false;
    void work.then(() => { settled = true; return undefined; }, () => { settled = true; return undefined; });
    const pending = (): boolean => !settled;
    for (let frame = 0; frame < 2000 && pending() && !scope.disposed; frame++) { streamer.step(camera); await Promise.resolve(); }
    if (pending() && !scope.disposed) throw new Error('Fixture tile work did not settle');
    return work;
  };
  const load = async () => {
    const entry = instances.get('home'); if (entry === undefined) throw new Error('Missing fixture instance');
    const world = await pump(registration.enter('home', entry, scope, camera));
    return { get fine() { return world.fine; }, refresh: async (x: number, z: number): Promise<void> => {
      camera = { x, z, vx: 0, vz: 0 };
      const required = streamer.require('home', ring(tileOf(x, z), 2));
      try { await pump(required.ready); } finally { required.release(); }
    } };
  };
  return { scope, allocator, live, assets, blockNext, load, coverage, blockedKey: () => currentBytes === null ? null : [...currentBytes].join('/'), leases: () => leases };
}

test('active loader keeps complete coarse coverage while the next fine read is pending', async () => {
  const f = fixture();
  try {
    const world = await f.load(), original = new Set(world.fine), held = f.blockNext();
    expect(f.coverage()).toEqual(Array.from({ length: 64 }, () => 1));
    const refresh = world.refresh(200, 200); await held.entered;
    expect(world.fine.size).toBeLessThanOrEqual(25); expect(f.coverage()).toEqual(Array.from({ length: 64 }, () => 1));
    held.finish(); await refresh;
    expect([...world.fine].some(key => !original.has(key))).toBe(true);
    expect(f.coverage()).toEqual(Array.from({ length: 64 }, () => 1));
    expect(f.assets.retained.size).toBe(0);
  } finally { f.scope.dispose(); }
  expect(f.live.size).toBe(0); expect(f.leases()).toBe(0); expect(f.allocator.entries()).toHaveLength(0);
});

test('a failed incoming read preserves old coverage and its next refresh can still progress', async () => {
  const f = fixture();
  try {
    const world = await f.load();
    const held = f.blockNext(), refresh = world.refresh(200, 200), refused = expect(refresh).rejects.toThrow('Fixture read failed');
    await held.entered; held.refuse(); await refused;
    expect(world.fine.size).toBeLessThanOrEqual(25); expect(f.coverage()).toEqual(Array.from({ length: 64 }, () => 1));
    const failed = f.blockedKey(); if (failed === null) throw new Error('Missing failed tile');
    expect(f.live.has(failed)).toBe(false);
    expect(f.allocator.entries().length).toBeLessThanOrEqual(80);
    await world.refresh(200, 200); expect(f.coverage()).toEqual(Array.from({ length: 64 }, () => 1));
  } finally { f.scope.dispose(); }
  expect(f.live.size).toBe(0); expect(f.leases()).toBe(0); expect(f.allocator.entries()).toHaveLength(0);
});

test('retirement during a fine read releases claims and forbids late view publication', async () => {
  const f = fixture();
  try {
    const world = await f.load(), held = f.blockNext(), refresh = world.refresh(200, 200);
    const refused = expect(refresh).rejects.toThrow('Tile streamer disposed');
    await held.entered; f.scope.dispose();
    expect(f.live.size).toBe(0); expect(f.leases()).toBe(0); expect(f.allocator.entries()).toHaveLength(0);
    held.finish(); await refused; expect(f.live.size).toBe(0);
  } finally { f.scope.dispose(); }
});
