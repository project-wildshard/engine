import { Group } from 'three';
import { expect, test } from 'vitest';
import { ResidencyAllocator } from '../src/shared/game/grid/allocator';
import { Scope } from '../src/shared/engine/app/scope';
import { emptyShardfile } from '../src/shared/host/author';
import { hashImmutableBytes } from '../src/shared/host/immutable';
import { ClientAssets } from '../src/client/game/shardfile/clientAssets';
import { standaloneClientTiles, clientRingPorts, type ResidentTile } from '../src/client/game/shardfile/tileContent';
import { TileDecoder } from '../src/client/game/grid/tileDecoder';

function fixture(mode: 'entered' | 'neighbour', pending = false) {
  const source = emptyShardfile({ slug: 'tile-input-fixture', name: 'Tile inputs', author: 'Test', seed: 1, revision: 1 });
  const scope = new Scope('tile-inputs'), root = new Group(), decoder = new TileDecoder();
  scope.onDispose(() => { decoder.dispose(); });
  const bytes = [new Uint8Array([1, 2]), new Uint8Array([3, 4]), new Uint8Array([5, 6])];
  const [primary, extra, dependency] = bytes.map(hashImmutableBytes);
  if (primary === undefined || extra === undefined || dependency === undefined) throw new Error('Missing fixture hashes');
  const wire = new Map(bytes.map(value => [hashImmutableBytes(value), value]));
  for (const [hash, value] of wire) source.files.push({ hash, kind: 'binary', compressed: value.length, decoded: 1, gpu: 1,
    triangles: 0, draws: 1, dependencies: hash === primary ? [dependency] : [], critical: false });
  source.props = { version: 1, family: 'fixture-ground', tiles: [{ lod: 1, x: 0, z: 0, file: primary, additionalFiles: [extra] }],
    wholeLibrary: [], models: [], panels: [], far: null, colliders: [], textures: [] };
  source.tiles.push({ lod: 1, x: 0, z: 0, files: [primary, extra], compressed: 4, decoded: 2, gpu: 2, triangles: 0, draws: 1, geometricError: 0, bounds: { min: [-250, 0, -250], max: [-125, 0, -125] } });
  const reads: string[] = [], pinned = new Map<string, number>(), installed: string[] = [];
  let started: () => void = () => undefined, finish: () => void = () => undefined;
  const waiting = new Promise<void>(resolve => { started = resolve; });
  const assets = new ClientAssets(source, new Map(), { base: 'https://example.invalid/', firstParty: true, offline: true,
    fetch: () => Promise.reject(new Error('Unexpected network')), hash: value => Promise.resolve(hashImmutableBytes(value)), cache: {
      product: () => Promise.resolve(null), putProduct: () => Promise.resolve(), putAsset: () => Promise.resolve(true),
      pin: refs => {
        for (const ref of refs) pinned.set(ref, (pinned.get(ref) ?? 0) + 1);
        return () => { for (const ref of refs) { const count = (pinned.get(ref) ?? 0) - 1; if (count === 0) pinned.delete(ref); else pinned.set(ref, count); } };
      },
      asset: (_base, hash) => {
        reads.push(hash);
        // Every declared tile dependency is leased before its first transport read.
        expect(new Set(pinned.keys())).toEqual(new Set([primary, extra, dependency]));
        if (hash !== extra || !pending) return Promise.resolve(wire.get(hash) ?? null);
        started(); return new Promise<Uint8Array | null>(resolve => { finish = () => { resolve(wire.get(hash) ?? null); }; });
      },
    } });
  const props = (key: string, main: Uint8Array, owner: Scope, additional?: ReadonlyMap<string, Uint8Array>): Promise<ResidentTile> => {
    expect(main).toEqual(wire.get(primary)); expect(additional?.get(extra)).toEqual(wire.get(extra));
    installed.push(key); owner.onDispose(() => { installed.splice(installed.indexOf(key), 1); });
    return Promise.resolve({ mask: () => undefined, shadow: () => undefined });
  };
  const start = (): Promise<void> => {
    if (mode === 'entered') return standaloneClientTiles({ source, assets, root, views: {
      terrain: () => { throw new Error('No fixture terrain'); }, panels: () => Promise.resolve(new Map()),
      props: (_props, key, main, _root, owner, additional) => props(key, main, owner, additional),
    } }, scope, { instance: 'home', budget: new ResidencyAllocator(), start: { x: -200, z: -200 }, radius: () => 2,
      library: () => Promise.resolve(null), viewer: () => ({ x: -200, z: -200 }), pause: () => Promise.resolve(), frame: () => undefined,
    }).then(() => undefined);
    const ports = clientRingPorts(new Map([['home', { source, assets, root, views: {
      terrain: () => { throw new Error('No fixture terrain'); }, panels: () => Promise.resolve(new Map()),
      props: (_props, key, main, _root, owner, additional) => props(key, main, owner, additional),
    } }]]), { scope, decoder });
    const tile = { key: 'home:l1/0/0', instance: 'home', type: 'level', level: 'l1', x: 0, z: 0 } as const;
    return new Promise((resolve, reject) => { ports.fetch(tile, result => {
      if (result instanceof Error) { reject(result); return; }
      expect(root.children).toHaveLength(0); ports.upload(tile, result); resolve();
    }); });
  };
  return { scope, root, start, waiting, finish: () => { finish(); }, reads, pinned, installed, primary, extra };
}

for (const mode of ['entered', 'neighbour'] as const) {
  test(`${mode} tile preparation leases and reads primary plus additional files identically`, async () => {
    const f = fixture(mode);
    try {
      await f.start();
      expect(f.reads).toEqual([f.primary, f.extra]); expect(f.installed).toEqual(['1/0/0']);
    } finally { f.scope.dispose(); }
    expect(f.pinned.size).toBe(0); expect(f.installed).toEqual([]); expect(f.root.children).toHaveLength(0);
  });

  test(`${mode} retirement during an additional-file read prevents a late installer`, async () => {
    const f = fixture(mode, true);
    try {
      const work = f.start(), refused = expect(work).rejects.toThrow(mode === 'entered' ? 'Standalone tile owner left' : 'Tile unloaded while reading');
      await f.waiting; f.scope.dispose(); expect(f.pinned.size).toBe(0);
      f.finish(); await refused; expect(f.installed).toEqual([]); expect(f.root.children).toHaveLength(0);
    } finally { f.scope.dispose(); }
  });
}
