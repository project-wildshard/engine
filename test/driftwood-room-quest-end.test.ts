import { Vector3 } from 'three';
import { afterEach, expect, test, vi } from 'vitest';
import { questBooks } from '../src/shared/engine/quest/players';
import { applyDev, devCellState } from '../src/server/host/dedicated/devControl';
import { memoryPlayerSaves } from '../src/server/host/dedicated/playerSaves';
import { roomBench, type RoomBench } from './fixtures/dedicated/roomBench';
import { RoomBot } from './fixtures/dedicated/roomBot';

// meta QA-FEEDBACK-2026-11-20-mini row 10 (IPHONE13-DRIFTWOOD). On a dev world, after the completion card the chip still read
// STAND IN THE RING and the room's save held neither `seen:reward` nor `quest:driftwood-done`. The Captain had been raised by
// the dev hook, which filed `dead:captain` as the player's credit only; a kill also files the world's record of his fall, and
// that is what Driftwood's chapter reads before it starts the reward. Killed for real, the room finishes the quest; raised by
// hand, the hook now files the fall as a kill does.
const HOME = 'driftwood-isle', DEVICE = 'device:quest-end', POOL = { x: -92.5, y: 8.2, z: 100.5 }, REWARD = { x: -96.2, y: 9.6, z: 105.5 };
const DONE = ['seen:reward', 'quest:driftwood-done'], BEFORE = ['talked:castaway', 'shard:lookout', 'shard:wreck', 'shard:cave', 'used:altar', 'quest:shrine-set'];
let bench: RoomBench | undefined;
const bots: RoomBot[] = [];
afterEach(async () => { for (const bot of bots.splice(0)) bot.drop(); await bench?.close(); bench = undefined; });

type Captain = { readonly alive: boolean; readonly position: Vector3; readonly combatActor: () => unknown };
async function seated(saves = memoryPlayerSaves()) {
  bench = await roomBench({ cells: [HOME], workers: 1, saves });
  const bot = new RoomBot(bench.url, 'bench', DEVICE, 'Quest'); bots.push(bot);
  expect(await bot.arrived()).toBe(true);
  const room = bench.room(HOME), body = room?.bodyOf(DEVICE);
  if (room === undefined || body === undefined) throw new Error('No seat');
  const host = room.host, flags = questBooks(host).of(body.id).flags, player = host.players.get(body.id);
  if (player === undefined) throw new Error('No body');
  for (const flag of BEFORE) flags.set(flag);
  return { host, body: body.id, flags, player, saves };
}

test('Driftwood\'s quest ends in a room: the Captain killed, the player stands in the ring, and the room files the quest done', { timeout: 120_000 }, async () => {
  const { host, body, flags, player, saves } = await seated();
  // the altar is set: at the pool the Captain surfaces, and the player's blow kills him
  player.resetPose(POOL, 2.51);
  let captain: Captain | undefined;
  await vi.waitFor(() => { captain = [...host.entities.values()].find(actor => actor.kind === 'captain') as Captain | undefined; expect(captain?.alive).toBe(true); }, { timeout: 15_000, interval: 100 });
  if (captain === undefined) throw new Error('No Captain');
  // Driftwood rev 7 (OF22e2): he is a declared boss fight, whose phases each take their own blows; strike until he falls
  const fighting = captain;
  await vi.waitFor(() => {
    if (fighting.alive) host.combat.hit({ source: (player as unknown as { health: never }).health, sourceTags: ['actor.player'], target: fighting.combatActor() as never, amount: 1e9, point: fighting.position.clone(), dir: new Vector3(), cause: { kind: 'test', label: 'test' } });
    expect(fighting.alive, 'the Captain falls').toBe(false);
  }, { timeout: 15_000, interval: 250 });
  await vi.waitFor(() => { expect(host.flags.has('dead:captain'), 'his fall is the world\'s').toBe(true); expect(flags.has('dead:captain'), 'and the player\'s credit').toBe(true); }, { timeout: 5000, interval: 50 });
  player.resetPose(REWARD, 2.51);
  await vi.waitFor(() => { expect(DONE.filter(flag => flags.has(flag))).toEqual(DONE); }, { timeout: 30_000, interval: 250 });
  expect(questBooks(host).exportOf(body).quests, 'no step left: the chip clears').toEqual([expect.objectContaining({ id: 'sealed-ring', started: true, currentId: null })]);
  await vi.waitFor(async () => { expect((await saves.read(DEVICE, HOME)).doc?.book.flags, 'the room\'s save').toEqual(expect.arrayContaining(DONE)); }, { timeout: 10_000, interval: 250 });
});

test('a death raised by the dev hook is filed as a kill: the world\'s record and the player\'s credit', { timeout: 60_000 }, async () => {
  const { host, body, flags } = await seated();
  expect(applyDev(host, body, { flag: 'dead:captain' }, devCellState(), () => undefined)).toEqual(expect.objectContaining({ ok: true }));
  expect(host.flags.has('dead:captain')).toBe(true);
  expect(flags.has('dead:captain')).toBe(true);
  expect(applyDev(host, body, { flag: 'test:not-a-death' }, devCellState(), () => undefined)).toEqual(expect.objectContaining({ ok: true }));
  expect(flags.has('test:not-a-death')).toBe(true);
});
