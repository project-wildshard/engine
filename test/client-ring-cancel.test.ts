import { BufferGeometry, Group } from 'three';
import { expect, test } from 'vitest';
import { Scope } from '../src/shared/engine/app/scope';
import { emptyShardfile } from '../src/shared/host/author';
import { ClientAssets } from '../src/client/game/shardfile/clientAssets';
import { clientRingPorts, type PreparedRingTile } from '../src/client/game/shardfile/tileContent';
import type { RingTile } from '../src/client/engine/world/tileStreamer';
import { TileDecoder } from '../src/client/game/grid/tileDecoder';

const tile: RingTile = { key: 'home:l0/0/0', instance: 'home', type: 'level', level: 'l0', x: 0, z: 0 };
function fixture() {
  const source = emptyShardfile({ slug: 'scope-fixture', name: 'Scope', author: 'Test', revision: 1, seed: 1 });
  const scope = new Scope('region'), root = new Group(), decoder = new TileDecoder();
  const assets = new ClientAssets(source, new Map(), { base: 'https://example.invalid/', offline: true, firstParty: true,
    fetch: () => Promise.reject(new Error('No fixture network')), hash: () => Promise.reject(new Error('No fixture hashing')) });
  const waiting: { scope: Scope; finish: () => void }[] = [];
  let preparedReady: () => void = () => undefined;
  let resources = 0;
  const ports = clientRingPorts(new Map([['home', { source, assets, root, views: {
    terrain: () => { throw new Error('No fixture terrain'); }, props: () => Promise.resolve(null), panels: () => Promise.resolve(new Map()),
  } }]]), { scope, decoder, prepare: prepared => {
    const geometry = prepared.scope.own(new BufferGeometry()); resources++;
    geometry.addEventListener('dispose', () => { resources--; });
    return new Promise<void>(resolve => { waiting.push({ scope: prepared.scope, finish: resolve }); preparedReady(); });
  } });
  const start = async () => {
    const ready = new Promise<void>(resolve => { preparedReady = resolve; });
    const result = new Promise<PreparedRingTile | Error>(resolve => { ports.fetch(tile, resolve); });
    await ready;
    const gate = waiting.shift(); if (gate === undefined) throw new Error('Missing preparation gate');
    return { result, ...gate };
  };
  return { scope, root, ports, start, resources: () => resources, close: () => { scope.dispose(); decoder.dispose(); } };
}

test('20 cancelled preparations release resources and child ownership before late completion', async () => {
  const f = fixture(), baseline = f.scope.census;
  try {
    for (let cycle = 0; cycle < 20; cycle++) {
      const work = await f.start();
      expect(f.resources()).toBe(1);
      f.ports.cancel?.(tile);
      expect(work.scope.disposed).toBe(true);
      expect(f.resources()).toBe(0);
      expect(f.scope.census).toEqual(baseline);
      work.finish();
      expect(await work.result).toBeInstanceOf(Error);
      expect(f.root.children).toHaveLength(0);
    }
  } finally { f.close(); }
});

test('late old completion cannot cancel a replacement for the same tile key', async () => {
  const f = fixture();
  try {
    const old = await f.start(); f.ports.cancel?.(tile);
    const next = await f.start();
    old.finish(); expect(await old.result).toBeInstanceOf(Error);
    expect(next.scope.disposed).toBe(false); expect(f.resources()).toBe(1);
    f.ports.cancel?.(tile); expect(next.scope.disposed).toBe(true);
    next.finish(); expect(await next.result).toBeInstanceOf(Error);
    expect(f.resources()).toBe(0);
  } finally { f.close(); }
});

test('queued and uploaded views cancel synchronously, and a retired region refuses new work', async () => {
  const f = fixture();
  try {
    const queued = await f.start(); queued.finish(); const prepared = await queued.result;
    if (prepared instanceof Error) throw prepared;
    f.ports.cancel?.(tile);
    expect(() => f.ports.upload(tile, prepared)).toThrow('disposed tile');
    f.ports.discard?.(tile, prepared);
    const loaded = await f.start(); loaded.finish(); const ready = await loaded.result;
    if (ready instanceof Error) throw ready;
    const view = f.ports.upload(tile, ready); expect(f.root.children).toHaveLength(1);
    f.ports.cancel?.(tile); expect(f.root.children).toHaveLength(0); view.dispose();
    expect(f.resources()).toBe(0);
    f.scope.dispose();
    const refused = await new Promise<PreparedRingTile | Error>(resolve => { f.ports.fetch(tile, resolve); });
    expect(refused).toBeInstanceOf(Error);
    expect(f.resources()).toBe(0);
  } finally { f.close(); }
});
