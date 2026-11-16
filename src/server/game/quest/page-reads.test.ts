import { expect, test, vi } from 'vitest';
import type { QuestPageRows } from '@wildshard/format/questPageComposition';
import { createShardFolder } from '../../../shared/game/shardfile/shardFolder';
import { parseShardfile } from '@wildshard/format/shardSchema';
import { SHARDFILE_VERSION } from '@wildshard/format/version';
import { startQuestPageReads } from '../../../shared/game/quest/pageReads';

function deferred<T>() {
  let finish: (value: T) => void = () => { throw new Error('Deferred read not initialized'); };
  let fail: (error: unknown) => void = () => { throw new Error('Deferred read not initialized'); };
  const promise = new Promise<T>((resolve, reject) => { finish = resolve; fail = reject; });
  return { promise, resolve: finish, reject: fail };
}

const files: QuestPageRows['files'] = { services: 'services.json', stall: 'stall.json', discovery: 'discovery.json', assembly: 'assembly.json' };
function fixture() {
  const edge = { heights: Array.from({ length: 257 }, () => 0), colours: Array.from({ length: 257 }, () => [.5, .5, .5]), roadHeight: 0 };
  const source = parseShardfile({ version: SHARDFILE_VERSION,
    identity: { slug: 'quest-read-fixture', name: 'Quest reads', author: 'Fixture', revision: 1, seed: 1 }, accent: 'sand',
    requires: { sdk: SHARDFILE_VERSION, capabilities: [], commons: [], commonsWire: {}, commonsCosts: {} },
    budgets: { library: { resident: 0, compressed: 0 }, sim: { resident: 0, compressed: 0 }, overlap: 0 },
    entryways: ['north', 'east', 'south', 'west'].map((side, i) => ({ edge: side, at: [[0, 0, 250], [250, 0, 0], [0, 0, -250], [-250, 0, 0]][i], width: 8 })),
    look: { families: [], grade: { exposure: 0, saturation: 1, contrast: 1, lut: null }, clock: 'engine', dayOverride: null, keys: [] },
    sim: { fixedHz: 60, scriptTickDivisor: 2, commandVersion: 0, snapshotVersion: 0, scripts: [] },
    state: { version: 1, sharedOwner: 'host', playerKey: 'actorId', shared: [], player: [] }, authorCaps: { players: 32, speed: 15 },
    serverBudget: { tickMicros: 1000, memory: 1000000, entities: 100, commandsPerTick: 32 },
    edge: { north: edge, south: edge, east: edge, west: edge }, files: [], tiles: [], library: [], critical: [], far: null });
  const discovery = deferred<Uint8Array>(), assembly = deferred<Uint8Array>(), stall = deferred<Uint8Array>();
  const order: string[] = [];
  const product = createShardFolder({ slug: source.identity.slug, revision: 1, shardfile: source, sections: new Map(),
    files: new Map(['discovery.json', 'stall.json', 'assembly.json'].map(name => [name, { hash: name, url: `/${name}` }])),
    read: name => {
      order.push(name);
      if (name === files.discovery) return discovery.promise;
      if (name === files.assembly) return assembly.promise;
      if (name === files.stall) return stall.promise;
      throw new Error(`Unexpected read ${name}`);
    } });
  // This pure read scheduler owns no shipping documents. Preserve its exact
  // byte ports and JSON decoding without declaring private product families.
  const readBytes = product.file.bind(product);
  const json = vi.spyOn(product, 'json').mockImplementation(async name => {
    const value: unknown = JSON.parse(new TextDecoder('utf-8', {fatal:true}).decode(await readBytes(name)));
    return value;
  }), file = vi.spyOn(product, 'file');
  return { product, json, file, order, discovery, assembly, stall };
}
const encode = (value: unknown): Uint8Array => new TextEncoder().encode(JSON.stringify(value));

test('all three immutable reads start before the first pending discovery resolves', async () => {
  const f = fixture(), reads = startQuestPageReads(f.product, files);
  expect(f.order).toEqual(['discovery.json', 'stall.json', 'assembly.json']);
  const discovery = { places: ['harbour'] }, interact = { entries: [] }, interactSpots = [{ x: 2, z: 3 }];
  // The last read can finish first; it neither blocks nor publishes the earlier input.
  f.assembly.resolve(encode({ constants: { interact, interactSpots } }));
  f.stall.resolve(new TextEncoder().encode('{"label":"keeper"}'));
  f.discovery.resolve(encode(discovery));
  expect(await reads.discovery()).toEqual(discovery);
  expect(await reads.stall()).toEqual({ label: 'keeper' });
  const constants = await reads.assembly();
  expect(constants).toEqual({ interact, interactSpots });
  expect(await reads.assembly()).toBe(constants);
  expect(f.json).toHaveBeenCalledTimes(2);
  expect(f.file).toHaveBeenCalledOnce();
});

test('absent optional inputs perform no read and remain null', async () => {
  const f = fixture(), reads = startQuestPageReads(f.product, { services: files.services, stall: files.stall });
  expect(f.order).toEqual(['stall.json']);
  f.stall.resolve(new TextEncoder().encode('null'));
  expect(await reads.discovery()).toBeNull();
  expect(await reads.assembly()).toBeNull();
  expect(await reads.stall()).toBeNull();
});

test('early failure keeps its diagnostic while every later rejection is observed', async () => {
  const f = fixture(), reads = startQuestPageReads(f.product, files);
  const first = new Error('discovery integrity'), second = new Error('stall bytes'), last = new Error('assembly integrity');
  f.assembly.reject(last); f.stall.reject(second);
  // Flush later refusals before discovery can be consumed; Vitest must see no
  // unhandled rejection even if the original caller stops at its first failure.
  // A full task turn lets an actually unobserved later rejection surface.
  await new Promise<void>(resolve => { setTimeout(resolve, 0); });
  f.discovery.reject(first);
  await expect(reads.discovery()).rejects.toBe(first);
  await expect(reads.stall()).rejects.toBe(second);
  await expect(reads.assembly()).rejects.toBe(last);
});

test.each([new Uint8Array([255]), new TextEncoder().encode('{broken')])('stall parsing still refuses invalid bytes only when consumed', async bytes => {
  const f = fixture(), reads = startQuestPageReads(f.product, files);
  f.stall.resolve(bytes); f.assembly.resolve(encode({ constants: { interact: {}, interactSpots: null } }));
  f.discovery.resolve(encode({ ready: true }));
  await expect(reads.discovery()).resolves.toEqual({ ready: true });
  await expect(reads.stall()).rejects.toBeInstanceOf(Error);
});
