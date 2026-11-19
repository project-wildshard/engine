import { expect, test } from 'vitest';
import { DedicatedRoom } from '../src/server/host/dedicated/dedicatedRoom';
import { admitDoc } from '../src/server/host/dedicated/playerDoc';
import { bookOf, enter, post, quit, readBack, rooms, run, sliceInput, stand } from './fixtures/dedicatedDoc';

// TEMPLATE-E2E TC-SHIP-e2 (opus-te2e7, 2026-11-17): on staging v0.1.34 a Template player who came back found an empty world: the door
// read "PlayerDoc v1 on _template does not parse" and refused the save as quarantined. The grid cell runs shard `_template` (the
// catalogue's slug, its save rows and its reward store), but the room filed the player's purse under the product's identity slug,
// `template`, and a store namespace other than the shard's fails the doc. Goods now go under the room's shard.
test('a Template player\'s coins save under the cell\'s shard and read back', { timeout: 60_000 }, async () => {
  const boot = async (id: string): Promise<DedicatedRoom> => {
    const room = await DedicatedRoom.boot({ slug: '_template', cell: 'template-2', build: '', bootId: id, input: await sliceInput(), now: () => 0, post });
    rooms.push(room); return room;
  };
  const room = await boot('template-store'), phone = enter(room, 'device:hut');
  run(room, [phone], 10);
  stand(room, phone.device, -3, -11); run(room, [phone], 30);
  expect(bookOf(room, phone.device).flags.has('template.hut')).toBe(true);
  // the quest's pay, filed the way a tick files it
  room.cell.owned.of(room.bodyOf(phone.device)?.id ?? '').file({ grant: 'coins', name: 'coins', amount: 5 }); run(room, [phone], 3);
  const saved = quit(phone), issues: string[] = [];
  const raw = JSON.parse(JSON.stringify(saved.doc)) as { store: Record<string, string> };
  expect(Object.keys(raw.store).filter(key => !/\.(device|session|global)$/u.test(key))).toEqual(['wildshard.save.v2._template']);
  expect(admitDoc(raw, saved.saveVersion, '_template', issue => { issues.push(issue); })).not.toBeNull();
  expect(issues).toEqual([]);
  // back in a fresh room: the purse comes with them
  const next = await boot('template-store-back'); enter(next, 'device:hut', saved);
  expect(readBack(saved)).not.toBeNull();
  expect(next.cell.owned.of(next.bodyOf('device:hut')?.id ?? '').purse.coins).toBe(5);
});
