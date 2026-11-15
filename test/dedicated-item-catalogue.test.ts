import { afterEach, expect, test } from 'vitest';
import { DedicatedRoom } from '../src/server/host/dedicated/dedicatedRoom';
import type { RoomNews } from '../src/server/host/dedicated/cellProtocol';
import { parseDoc } from '../src/server/host/dedicated/playerDoc';
import { PlayerStore } from '../src/server/host/dedicated/playerStore';
import type { HeadlessRuntimeInput } from '../src/server/host/headlessRuntime';
import { Ledger } from '../src/shared/game/ledger';
import { NetClient } from '../src/client/engine/net/client';
import { directLoopback } from '../src/test/engine/netLoopback';
import { serverInput } from './fixtures/dedicated/roomBench';

const rooms: DedicatedRoom[] = [];
afterEach(() => { for (const room of rooms.splice(0)) room.dispose(); });
const catalogue = [{ id: 'sword', maxTier: 2 }];
async function input(tier = 2, item = 'sword'): Promise<HeadlessRuntimeInput> {
  const source = await serverInput('driftwood-isle');
  return { ...source, catalogue, shard: { ...source.shard, ledger: [{ fact: 'catalogue:test', origin: { kind: 'engine', source: 'quest:catalogue-test' }, rewards: [{ kind: 'catalogue', item, tier, quantity: 1 }] }] } };
}
async function open(source: HeadlessRuntimeInput, news: RoomNews[] = []): Promise<DedicatedRoom> {
  const room = await DedicatedRoom.boot({ slug: 'driftwood-isle', build: '', bootId: 'catalogue-test', input: source, now: () => 0, post: row => { news.push(row); } });
  rooms.push(room); return room;
}

test.each([[3, 'sword'], [1, 'unknown']])('a real native room refuses tier %s / %s before it can seat anyone', async (tier, item) => {
  await expect(open(await input(tier, item))).rejects.toThrow('Reward is outside the platform catalogue policy');
});

test('a legacy release cannot admit catalogue rewards without a trusted catalogue', async () => {
  const source = await input();
  await expect(open({ ...source, catalogue: [] })).rejects.toThrow('Reward is outside the platform catalogue policy');
});

test('an allowed max-tier grant stays in its player document and never pays another seat or repeats', async () => {
  const source = await input(), news: RoomNews[] = [], room = await open(source, news);
  for (const device of ['a', 'b']) {
    const link = directLoopback(), client = new NetClient(link.client);
    room.seat({ device, name: device, body: `p.${device}`, doc: null, seq: 0 }, link.server,
      () => { client.hello('', { player: device, name: device }); link.pump(); });
    link.pump();
  }
  const owner = room.bodyOf('a'); if (owner === undefined) throw new Error('Missing first seat');
  expect(room.cell.fact('catalogue:test', 'reward', owner.id)?.status).toBe('granted');
  expect(room.cell.fact('catalogue:test', 'reward', owner.id)?.status).toBe('duplicate');
  room.drain();
  const items = (device: string): ReturnType<Ledger['state']>['items'] => {
    const saved = news.find(row => row.kind === 'save' && row.write.player === device);
    if (saved?.kind !== 'save') throw new Error('Missing drained player document');
    const doc = parseDoc(saved.write.doc, saved.write.saveVersion, 'driftwood-isle');
    if (doc === null) throw new Error('Saved catalogue grant was refused');
    return new Ledger(new PlayerStore(doc.store, () => undefined).saves, [], [], catalogue).state().items;
  };
  expect(items('a')).toEqual({ '["sword",2]': { item: 'sword', tier: 2, quantity: 1 } });
  expect(items('b')).toEqual({});
});
