import { afterEach, expect, test, vi } from 'vitest';
import type { NetChat } from '../src/shared/engine/net/chatWire';
import { cleanName } from '../src/server/engine/net/chatFilter';
import { migrate } from '../src/server/host/dedicated/saves/migrate';
import { claimName, NameFullError, TAG_MAX, TAG_MIN } from '../src/server/host/dedicated/saves/names';
import { playerSavesOver } from '../src/server/host/dedicated/playerSaves';
import type { Database } from '../src/server/host/dedicated/saves/database';
import { openPglite } from './fixtures/pgliteDatabase';
import { roomBench, type RoomBench } from './fixtures/dedicated/roomBench';
import { RoomBot } from './fixtures/dedicated/roomBot';

// MMO-PLAN MP2.4 (Q31): "Names: unique with a tag", through the J110 filter. Done when no two match, and a refused Name reaches no client.
const SHARD = 'driftwood-isle';
const closers: (() => Promise<void>)[] = [];
const bots: RoomBot[] = [];
let bench: RoomBench | undefined;
afterEach(async () => { for (const bot of bots.splice(0)) bot.drop(); await bench?.close(); bench = undefined; for (const close of closers.splice(0)) await close(); });
async function fresh(): Promise<Database> { const db = await openPglite(); closers.push(db.close); await migrate(db); return db; }
const tagOf = (shown: string): number => Number(shown.split('#')[1]);
/**
 * A die that rolls `tags` in turn, as fractions of the tag range. Each roll aims at the middle of its tag's slice: aimed at the
 * slice's edge, `(tag - TAG_MIN) / 9000 * 9000` floors to the tag below for 323 of the 9000 tags (6980 among them), so a roll meant
 * for a taken tag landed on a free one.
 */
const dice = (...tags: number[]): (() => number) => { let at = 0; return () => ((tags[at++ % tags.length] ?? TAG_MIN) - TAG_MIN + 0.5) / (TAG_MAX - TAG_MIN + 1); };

test('a Name gets a tag, keeps it while the Name stays, and a second player with the same Name reads differently', async () => {
  const db = await fresh();
  // 6980 is the tag CI drew when the old die rolled 6979 for it (main ci 43114882127): pinned, so every run reads the same.
  const ann = await claimName(db, 'device:a', 'Ann', dice(6980));
  expect(ann).toBe('Ann#6980');
  expect(tagOf(ann)).toBeGreaterThanOrEqual(TAG_MIN); expect(tagOf(ann)).toBeLessThanOrEqual(TAG_MAX);
  expect(await claimName(db, 'device:a', 'Ann'), 'rejoining keeps the tag').toBe(ann);
  expect(await claimName(db, 'device:a', 'ANN'), 'a new case keeps it too').toBe(`ANN#${String(tagOf(ann))}`);
  const other = await claimName(db, 'device:b', 'ann', dice(tagOf(ann), 4242));
  expect(other, 'the taken tag is skipped, case folded').toBe('ann#4242');
  const renamed = await claimName(db, 'device:a', 'Bea', dice(4242));
  expect(renamed, 'a new Name draws its own tag; 4242 is free for Bea').toBe('Bea#4242');
  expect((await db.query('select id, name, tag from player order by id')).rows).toEqual([{ id: 'device:a', name: 'Bea', tag: 4242 }, { id: 'device:b', name: 'ann', tag: 4242 }]);
});

test('the die lands every roll on the tag it names', () => {
  const missed: number[] = [];
  for (let tag = TAG_MIN; tag <= TAG_MAX; tag++) if (TAG_MIN + Math.floor(dice(tag)() * (TAG_MAX - TAG_MIN + 1)) !== tag) missed.push(tag);
  expect(missed).toEqual([]);
});

test('a crowded Name reads which tags are left, and a full one is refused loudly', async () => {
  const db = await fresh();
  await db.exec(`insert into player (id, name, tag) select 'device:' || g, 'Guest', g from generate_series(${String(TAG_MIN)}, ${String(TAG_MAX - 1)}) g`);
  const last = await claimName(db, 'device:new', 'guest', dice(TAG_MIN));
  expect(last, 'eight draws all hit, so it reads the one tag left').toBe(`guest#${String(TAG_MAX)}`);
  await expect(claimName(db, 'device:newer', 'Guest')).rejects.toThrow(NameFullError);
});

test('two claims at once never share a tag', async () => {
  const db = await fresh();
  const shown = await Promise.all(Array.from({ length: 12 }, (_, index) => claimName(db, `device:${String(index)}`, 'Twin', dice(5000, 5001, 5002, 5003, 5004, 5005, 5006, 5007, 5008, 5009, 5010, 5011))));
  expect(new Set(shown).size).toBe(12);
});

test('one device\'s claims run in turn: two at once agree, and a claim that timed out can\'t move the Name under the next', { timeout: 30_000 }, async () => {
  const db = await fresh(), saves = playerSavesOver(db, 0, () => undefined), name = saves.name;
  if (name === undefined) throw new Error('The database saves claim Names');
  const [first, second] = await Promise.all([name('device:a', 'Ann'), name('device:a', 'Ann')]);
  expect(second).toBe(first);
  const row = async (device: string): Promise<unknown> => (await db.query('select name, tag from player where id = $1', [device])).rows[0];
  expect(await row('device:a')).toEqual({ name: 'Ann', tag: tagOf(first) });
  // A database that takes 3.5 s over one claim: the door stops waiting at 3 s, and the claim still lands after.
  let slow = true;
  const sluggish: Database = { ...db, query: async (text, params) => {
    if (slow && text.startsWith('insert into player (id, name, tag)')) { slow = false; await new Promise(resolve => { setTimeout(resolve, 3500); }); }
    return await db.query(text, params);
  } };
  const late = playerSavesOver(sluggish, 0, () => undefined).name;
  if (late === undefined) throw new Error('The database saves claim Names');
  await expect(late('device:b', 'Bea'), 'the door gives up').rejects.toThrow(/over 3000 ms/u);
  const retried = await late('device:b', 'Bea');
  expect(await row('device:b'), 'the retry waited for the claim it replaces, so the Name it shows is the one held').toEqual({ name: 'Bea', tag: tagOf(retried) });
});

test('a Name with a listed word is refused whole, never starred', () => {
  expect(cleanName('Sh1t Lord')).toBe('Guest');
  expect(cleanName('  Lord  of\u0007Ash ')).toBe('Lord of Ash');
  expect(cleanName('Scunthorpe')).toBe('Scunthorpe');
});

test('on the one world, two players called Ann read as two, and a refused Name reaches nobody', { timeout: 60_000 }, async () => {
  const db = await fresh();
  bench = await roomBench({ saves: playerSavesOver(db, 0, () => undefined) });
  const heard: NetChat[] = [];
  const join = async (device: string, name: string): Promise<RoomBot> => {
    const bot = new RoomBot(bench?.url ?? '', 'bench', device, name); bots.push(bot);
    expect(await bot.arrived()).toBe(true);
    return bot;
  };
  const listener = await join('device:ear', 'Ear');
  listener.client.onChat(line => { heard.push(line); });
  const a = await join('device:a', 'Ann'), b = await join('device:b', 'Ann'), rude = await join('device:rude', 'Sh1t Lord');
  for (const bot of [a, b, rude]) bot.client.say('room', 'hi');
  await vi.waitFor(() => { expect(heard).toHaveLength(3); }, { timeout: 10_000, interval: 20 });
  const names = heard.map(line => line.name);
  expect(names.filter(name => /^Ann#\d{4}$/u.test(name))).toHaveLength(2);
  expect(new Set(names).size, 'no two match').toBe(3);
  expect(names.find(name => name.startsWith('Guest#')), 'the refused Name reads as a Guest').toBeDefined();
  expect(names.join(' ')).not.toMatch(/sh1t|\*/iu);
  const room = bench.room(SHARD);
  expect(room?.bodyOf('device:rude')?.netName, 'and so does its body').toMatch(/^Guest#\d{4}$/u);
  expect(new Set(['device:a', 'device:b', 'device:rude'].map(device => room?.bodyOf(device)?.netName)), 'bodies read as their lines do').toEqual(new Set(names));
});

test('a held body keeps the Name it was seated with; a new Name is claimed on the next fresh join', { timeout: 60_000 }, async () => {
  const db = await fresh();
  bench = await roomBench({ saves: playerSavesOver(db, 0, () => undefined), holdMs: 50 });
  const heard: NetChat[] = [];
  const join = async (device: string, name: string): Promise<RoomBot> => {
    const bot = new RoomBot(bench?.url ?? '', 'bench', device, name); bots.push(bot);
    expect(await bot.arrived()).toBe(true);
    return bot;
  };
  const listener = await join('device:ear', 'Ear');
  listener.client.onChat(line => { heard.push(line); });
  const first = await join('device:a', 'Ann'), ann = bench.room(SHARD)?.bodyOf('device:a')?.netName ?? '';
  expect(ann).toMatch(/^Ann#\d{4}$/u);
  const again = await join('device:a', 'Bea');
  expect(await first.ended(), 'the second tab takes the seat').toBe('replaced');
  again.client.say('room', 'still me');
  await vi.waitFor(() => { expect(heard.map(line => line.name)).toEqual([ann]); }, { timeout: 5000, interval: 20 });
  expect((await db.query('select name, tag from player where id = $1', ['device:a'])).rows, 'the reservation stands while its body does').toEqual([{ name: 'Ann', tag: tagOf(ann) }]);
  again.drop();
  await vi.waitFor(() => { expect(bench?.world.health().players).toBe(1); }, { timeout: 10_000, interval: 20 });
  await join('device:a', 'Bea');
  expect(bench.room(SHARD)?.bodyOf('device:a')?.netName).toMatch(/^Bea#\d{4}$/u);
});
