import { Group, type Object3D } from 'three';
import { Scope } from '../../src/shared/engine/app/scope';
import { TileStreamer } from '../../src/client/engine/world/tileStreamer';
import { emptyShardfile } from '../../src/shared/host/author';
import { hashImmutableBytes } from '../../src/shared/host/immutable';
import { ResidencyAllocator } from '../../src/shared/game/grid/allocator';
import { TileDecoder } from '../../src/client/game/grid/tileDecoder';
import { ClientAssets } from '../../src/client/game/shardfile/clientAssets';
import { clientRingCatalogue, clientRingPorts, clientTileRegistration, type ClientRingInstance } from '../../src/client/game/shardfile/tileContent';
import type { Shardfile } from '@wildshard/format/shardSchema';

function isGroup(object: Object3D): object is Group { return object instanceof Group; }

export const camera = { x: -31.25, z: -31.25, vx: 0, vz: 0 };
export function clientTileFixture(coarse = true, fail = false, holdDistant = false, cell = false,
  fault: { hold?: string; fail?: string } = {}) {
  const scope = new Scope('page'), resident = scope.child('resident'), allocator = new ResidencyAllocator(), decoder = new TileDecoder();
  const source = emptyShardfile({ slug: 'registered-fixture', name: 'Registered', author: 'Test', seed: 1, revision: 1 });
  if (cell) source.ring = 'cell';
  const wire = new Map<string, Uint8Array>(), rows: NonNullable<Shardfile['props']>['tiles'] = [];
  for (const lod of coarse ? [1, 0] as const : [0] as const) for (let z = 0; z < (lod === 1 ? 4 : 8); z++) for (let x = 0; x < (lod === 1 ? 4 : 8); x++) {
    const bytes = new Uint8Array([lod, x, z]), hash = hashImmutableBytes(bytes), size = lod === 1 ? 125 : 62.5;
    rows.push({ lod, x, z, file: hash }); wire.set(hash, bytes);
    source.files.push({ hash, kind: 'binary', compressed: bytes.length, decoded: 1, gpu: 1, triangles: 0, draws: 1, dependencies: [], critical: false });
    source.tiles.push({ lod, x, z, files: [hash], compressed: bytes.length, decoded: 1, gpu: 1, triangles: 0, draws: 1, geometricError: 0,
      bounds: { min: [-250 + x * size, 0, -250 + z * size], max: [-250 + (x + 1) * size, 0, -250 + (z + 1) * size] } });
  }
  source.props = { version: 1, family: 'fixture', tiles: rows, wholeLibrary: [], models: [], panels: [], far: null, colliders: [], textures: [] };
  let pins = 0, radius = 1;
  const distant: (() => void)[] = [];
  const active = new Map<Group, { key: string; root: Group; excluded: ReadonlySet<number> }>();
  const make = (name: string): ClientRingInstance & { root: Group } => {
    const root = new Group(); root.name = name;
    const assets = new ClientAssets(source, wire, { base: 'https://example.invalid/', firstParty: true, offline: true,
      hash: bytes => Promise.resolve(hashImmutableBytes(bytes)), fetch: () => Promise.reject(new Error('Unexpected network')), cache: {
        product: () => Promise.resolve(null), putFolder: () => Promise.resolve(), putAsset: () => Promise.resolve(true),
        asset: (_base, hash) => Promise.resolve(wire.get(hash) ?? null),
        pin: () => { pins++; return () => { pins--; }; },
      } });
    return { source, assets, root, views: {
      terrain: () => { throw new Error('No fixture terrain'); }, panels: () => Promise.resolve(new Map()),
      props: (_props, key, _bytes, group, owner) => {
        if (!isGroup(group)) throw new Error('Expected detached group');
        if (fail && key === (fault.fail ?? '0/3/3') && name === 'entered') throw new Error('Fixture preparation refused');
        const tile: { key: string; root: Group; excluded: ReadonlySet<number> } = { key, root, excluded: new Set() };
        active.set(group, tile); owner.onDispose(() => { active.delete(group); });
        const prepared = {mask: (excluded: ReadonlySet<number>): void => { tile.excluded = new Set(excluded); }, shadow: (): void => undefined};
        if (holdDistant && name !== 'neighbour' && key === (fault.hold ?? '1/0/0')) return new Promise<typeof prepared>(resolve => {distant.push(() => {resolve(prepared);});});
        return Promise.resolve(prepared);
      },
    } };
  };
  const neighbour = make('neighbour'), entered = make('entered'), instances = new Map([['home', neighbour]]);
  const ports = clientRingPorts(instances, { scope, decoder });
  const streamer = new TileStreamer([{ instance: 'home', origin: { x: 0, z: 0 } }], { reserve: claim => allocator.reserve(claim), now: () => 0 }, clientRingCatalogue(instances), ports);
  const registration = clientTileRegistration(instances, streamer, () => radius);
  scope.onDispose(() => { registration.dispose(); streamer.dispose(); decoder.dispose(); });
  const drive = async (view = camera, check?: () => void): Promise<void> => {
    for (let frame = 0; frame < 150; frame++) { streamer.step(view); await Promise.resolve(); check?.(); }
  };
  const coverage = (root: Group): number[] => Array.from({ length: 64 }, (_, key) => {
    const x = key % 8, z = Math.floor(key / 8); let draws = 0;
    for (const [group, tile] of active) if (tile.root === root && group.parent === root) {
      if (tile.key === `0/${String(x)}/${String(z)}`) draws++;
      if (tile.key === `1/${String(Math.floor(x / 2))}/${String(Math.floor(z / 2))}` && !tile.excluded.has(x % 2 + 2 * (z % 2))) draws++;
    }
    return draws;
  });
  return { scope, resident, allocator, streamer, registration, neighbour, entered, instances, make, drive, coverage,
    radius: (value: number) => { radius = value; }, pins: () => pins,
    releaseDistant: () => {for (const release of distant.splice(0)) release();}, distant: () => distant.length };
}
