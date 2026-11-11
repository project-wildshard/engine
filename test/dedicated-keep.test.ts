import { Vector3 } from 'three';
import { afterEach, expect, test, vi } from 'vitest';
import { NetClient } from '../src/client/engine/net/client';
import { OWNED_ROW } from '../src/shared/game/loot/ownedRows';
import { DedicatedRoom } from '../src/server/host/dedicated/dedicatedRoom';
import { playerSavesOver } from '../src/server/host/dedicated/playerSaves';
import { migrate } from '../src/server/host/dedicated/saves/migrate';
import type { Database, Sql } from '../src/server/host/dedicated/saves/database';
import type { SaveWrite } from '../src/server/host/dedicated/saves/saveStore';
import type { SavedPlayer } from '../src/server/host/dedicated/world';
import type { AnimalSim } from '../src/shared/engine/entities/AnimalSim';
import { Rng } from '../src/shared/engine/core/rng';
import { personalCoinTable, personalItemTable } from '../src/server/game/loot/personal';
import { directLoopback, type DirectLoopback } from '../src/test/engine/netLoopback';
import { roomBench, serverInput, type RoomBench } from './fixtures/dedicated/roomBench';
import { RoomBot } from './fixtures/dedicated/roomBot';
import { openPglite } from './fixtures/pgliteDatabase';

// What a player keeps on the one world (MMO-PLAN MP3.1, MP3.3, and J202's world-state rule), through the paths a restart really takes:
// the room's drain, the write queue, Postgres, and `saves.read()` with its recovery receipts. A restart gives a fresh world and keeps
// progress; the ledger pays every entitlement exactly once, however kills, crashes and replays fall; a bag is one player's in one shard.
const DRIFTWOOD = 'driftwood-isle', NALATI = 'nalati-grasslands', EPOCH = 1;
const closers: (() => Promise<void> | void)[] = [];
afterEach(async () => { for (const close of closers.splice(0).reverse()) await close(); });
let clock = 0;
type Saves = ReturnType<typeof playerSavesOver>;
interface Phone { readonly client: NetClient; readonly link: DirectLoopback; readonly heard: string[] }
interface Room { readonly room: DedicatedRoom; readonly bootId: string; readonly writes: SaveWrite[]; close: () => void }

/** What a process does to its next transaction: nothing, fail before the commit, or commit and lose the answer. */
interface Faults { dead: boolean; next: 'none' | 'before-commit' | 'ack-lost' }
/** One process's connection to the shared database. A dead process's statements fail, so a crash rolls back what it had in flight. */
function processDb(db: Database, faults: Faults): Database {
  const alive = (): void => { if (faults.dead) throw new Error('The process is gone'); };
  const sql = (inner: Sql): Sql => ({ query: async (text, params) => { alive(); return inner.query(text, params); }, exec: async text => { alive(); await inner.exec(text); } });
  return { ...sql(db), close: () => Promise.resolve(),
    transaction: async work => {
      alive();
      const fault = faults.next; faults.next = 'none';
      const result = await db.transaction(async inner => { const out = await work(sql(inner)); if (fault === 'before-commit') throw new Error('Lost before the commit'); return out; });
      if (fault === 'ack-lost') throw new Error('Committed, and the answer was lost');
      return result;
    } };
}
async function database(): Promise<Database> { const db = await openPglite(); closers.push(db.close); await migrate(db); return db; }
function savesOf(db: Database, faults: Faults = { dead: false, next: 'none' }): Saves {
  const saves = playerSavesOver(processDb(db, faults), EPOCH, () => undefined);
  closers.push(() => { saves.queue.dispose(); saves.reports.dispose(); });
  return saves;
}
async function boot(slug: string, bootId: string, saves: Saves | null): Promise<Room> {
  const writes: SaveWrite[] = [];
  const room = await DedicatedRoom.boot({ slug, build: '', bootId, input: await serverInput(slug), now: () => clock, post: row => {
    if (row.kind === 'save') { writes.push(row.write); saves?.write(row.write); } else if (row.kind === 'refused') throw new Error(row.reason);
  } });
  let open = true;
  const close = (): void => { if (open) { open = false; room.dispose(); } };
  closers.push(close);
  return { room, bootId, writes, close };
}
/** The door's admission: the player's save read back from Postgres, recovery receipts and last-good copy included. */
async function admit(at: Room, saves: Saves, device: string, shard = DRIFTWOOD): Promise<Phone> {
  return seat(at, device, await saves.read(device, shard));
}
function seat(at: Room, device: string, saved: SavedPlayer): Phone {
  const link = directLoopback(), client = new NetClient(link.client), heard: string[] = [];
  const ledger = saved.recovery?.at(-1)?.serial ?? saved.doc?.ledger.serial ?? 0;
  client.onLedger(row => { heard.push(row.id); });
  at.room.seat({ device, name: device, body: `p.${device}`, doc: saved.doc, seq: saved.seq, ...(saved.recovery === undefined ? {} : { recovery: saved.recovery }), ...(saved.previous === undefined ? {} : { previous: saved.previous }) },
    link.server, () => { client.hello('', { player: device, name: device }, ledger); link.pump(); });
  link.pump();
  return { client, link, heard };
}
function run(at: Room, phone: Phone, ticks: number): void {
  for (let tick = 0; tick < ticks; tick++) {
    phone.client.command({ viewTick: 0, steer: { keyX: 0, keyY: 0, stickX: 0, stickY: 0 }, yaw: 0, pitch: 0, buttons: 0 }); phone.client.flush(); phone.link.pump();
    clock += 1000 / 60; at.room.tick(); phone.link.pump();
  }
}
const coins = (at: Room, device: string): number => at.room.cell.owned.of(at.room.bodyOf(device)?.id ?? '').purse.coins;
function kill(at: Room, device: string, creature: AnimalSim): boolean {
  const player = at.room.bodyOf(device);
  if (player === undefined) throw new Error('No body');
  return at.room.host.combat.hit({ source: player.health, sourceTags: [player.id as `${string}.${string}`, 'cover.checked'], target: creature.combatActor(), amount: creature.maxHp * 10, point: creature.position.clone(), dir: new Vector3(0, 0, 1) })?.killed ?? false;
}
const living = (at: Room): [string, AnimalSim][] => [...at.room.host.entities].filter(([, sim]) => sim.alive);
/** A seeded die, so a red run can be read again. */
function die(seed: number): () => number {
  let state = seed >>> 0;
  return () => { state = (state + 0x6d2b79f5) >>> 0; let t = state; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 2 ** 32; };
}
interface Receipt { readonly fact_id: string; readonly grant_kind: string; readonly name: string; readonly amount: number }
async function receiptsOf(db: Database, player: string): Promise<Receipt[]> {
  return (await db.query('select fact_id, grant_kind, name, amount from ledger_receipt where player_id = $1 order by serial', [player])).rows as Receipt[];
}
const paid = (rows: readonly Receipt[]): number => rows.filter(row => row.grant_kind === 'coins').reduce((sum, row) => sum + Number(row.amount), 0);
const sorted = (rows: readonly string[]): string[] => [...rows].sort();

test('J202: a restart through the drain and the database gives a fresh world, and the player keeps what they had', { timeout: 120_000 }, async () => {
  const db = await database(), before = savesOf(db), first = await boot(DRIFTWOOD, 'world-one', before), a = await admit(first, before, 'a');
  run(first, a, 10);
  const [id, creature] = living(first)[0] ?? [];
  if (id === undefined || creature === undefined) throw new Error('No creature');
  expect(kill(first, 'a', creature)).toBe(true);
  first.room.cell.owned.of(first.room.bodyOf('a')?.id ?? '').file({ grant: 'coins', name: 'coins', amount: 5 });
  run(first, a, 30);
  const had = coins(first, 'a'), tick = first.room.host.state.tick;
  expect(had).toBeGreaterThanOrEqual(5);
  // SIGTERM's order: the room drains (everyone written, told `restart`), the queue empties into Postgres, and the process is gone.
  first.room.drain();
  expect(await before.drain(5000), 'the drain wrote everything').toBe(true);
  first.close();
  expect((await db.query('select reason from player_save where player_id = $1', ['a'])).rows).toEqual([{ reason: 'restart' }]);
  const after = savesOf(db), second = await boot(DRIFTWOOD, 'world-two', after), back = await admit(second, after, 'a');
  run(second, back, 3);
  expect(second.room.host.entities.get(id)?.alive, 'the creature that died is back: the world is fresh').toBe(true);
  expect(second.room.host.entities.get(id)?.hp).toBe(second.room.host.entities.get(id)?.maxHp);
  expect(second.room.host.state.tick, 'and its clock starts over').toBeLessThan(tick);
  expect(coins(second, 'a'), 'progress is kept, read back from Postgres').toBe(had);
});

test('MP3.3: two players\' bags in two shards, through the door\'s where(): each is there on return and absent everywhere else', { timeout: 120_000 }, async () => {
  const db = await database(), saves = savesOf(db);
  const bench: RoomBench = await roomBench({ cells: [DRIFTWOOD, NALATI], saves, holdMs: 50 }); closers.push(bench.close);
  const bots: RoomBot[] = []; closers.push(() => { for (const bot of bots) bot.drop(); });
  /** One visit through the door: where() picks the cell, the bag that loads is checked, `earn` is paid into it, and the player leaves. */
  const visit = async (device: string, cell: string, has: number, earn = 0): Promise<void> => {
    const bot = new RoomBot(bench.url, 'bench', device, device); bots.push(bot);
    expect(await bot.arrived()).toBe(true);
    expect(JSON.parse(bot.resume ?? '{}'), `${device} stands where where() says`).toMatchObject({ cell });
    const room = bench.room(cell), body = room?.bodyOf(device);
    if (room === undefined || body === undefined) throw new Error(`${device} has no body in ${cell}`);
    expect(room.cell.owned.of(body.id).purse.coins, `${device}'s bag in ${cell}`).toBe(has);
    if (earn > 0) room.cell.owned.of(body.id).file({ grant: 'coins', name: 'coins', amount: earn });
    await vi.waitFor(() => { expect(bot.coins(OWNED_ROW.coins)).toBe(has + earn); }, { timeout: 5000 });
    bot.drop();
    await vi.waitFor(() => { expect(room.bodyOf(device)).toBeUndefined(); }, { timeout: 5000 });
    expect(await saves.drain(5000)).toBe(true);
    await vi.waitFor(() => { expect(bench.world.health().players).toBe(0); }, { timeout: 5000 });
  };
  // Travel between cells is unbuilt; it will move the place row, which is what this does.
  const travel = async (device: string, cell: string): Promise<void> => { await db.query('update player_place set cell = $2 where player_id = $1 and epoch = $3', [device, cell, EPOCH]); };
  await visit('a', DRIFTWOOD, 0, 13); await visit('b', DRIFTWOOD, 0, 7);
  await travel('a', NALATI); await travel('b', NALATI);
  await visit('a', NALATI, 0, 4); await visit('b', NALATI, 0, 21);
  await travel('a', DRIFTWOOD); await travel('b', DRIFTWOOD);
  await visit('a', DRIFTWOOD, 13); await visit('b', DRIFTWOOD, 7);
  await travel('a', NALATI); await travel('b', NALATI);
  await visit('a', NALATI, 4); await visit('b', NALATI, 21);
  const { rows } = await db.query('select player_id, shard from player_save order by player_id, shard');
  expect(rows, 'four bags, one per player and shard').toEqual([{ player_id: 'a', shard: DRIFTWOOD }, { player_id: 'a', shard: NALATI }, { player_id: 'b', shard: DRIFTWOOD }, { player_id: 'b', shard: NALATI }]);
});

test('MP3.1: a replayed fact pays nothing twice, though the purse hears it again', { timeout: 120_000 }, async () => {
  // A boot whose id repeats (or any replayed tick) files a grant whose id the player's book already holds: it must not reach the purse.
  const db = await database(), sequence = async (saves: Saves): Promise<{ at: Room; phone: Phone }> => {
    const at = await boot(DRIFTWOOD, 'same-boot', saves), phone = await admit(at, saves, 'a');
    run(at, phone, 10);
    const [, creature] = living(at)[0] ?? [];
    if (creature === undefined) throw new Error('No creature');
    expect(kill(at, 'a', creature)).toBe(true);
    run(at, phone, 90);
    return { at, phone };
  };
  const before = savesOf(db), first = await sequence(before), earned = coins(first.at, 'a');
  expect(earned, 'the kill paid').toBeGreaterThan(0);
  first.at.room.drain(); expect(await before.drain(5000)).toBe(true); first.at.close();
  const after = savesOf(db), second = await sequence(after);
  second.at.room.drain(); expect(await after.drain(5000)).toBe(true);
  const receipts = await receiptsOf(db, 'a');
  expect(receipts.filter(row => row.grant_kind === 'coins'), 'one fact, one receipt').toHaveLength(1);
  expect(coins(second.at, 'a'), 'and the purse holds it once').toBe(paid(receipts));
});

test('MP3.1: 100 random kills, with drains, crashes, lost answers and replays among them, pay every entitlement exactly once', { timeout: 300_000 }, async () => {
  const db = await database(), roll = die(20261111), heard: string[] = [], allWrites: SaveWrite[] = [];
  // What the player is owed, by boot. A crash loses what its process never committed.
  const durable: string[] = [], lost: string[] = [], orderings: Record<string, number> = {};
  // The oracle, apart from grant emission: for each death the test causes, the shard's own loot tables are rolled on a copy of the
  // room's loot stream, so the expected coins and items are known before the room pays anything. Items already paid this boot are
  // owned, as the room counts them.
  const input = await serverInput(DRIFTWOOD), economy = input.product.has('economy/loot') ? input.product.section('economy/loot') : undefined;
  const coinRoll = personalCoinTable(economy), itemRoll = personalItemTable(economy), owned = new Map<string, Set<string>>();
  if (coinRoll === null) throw new Error('Driftwood\'s kills pay coins');
  let died: Parameters<Parameters<DedicatedRoom['host']['events']['on']>[1]>[0] | null = null;
  let pending: string[] = [], boots = 0, kills = 0, recovered = 0, entitled = 0;
  const open = async (): Promise<{ at: Room; phone: Phone; saves: Saves; faults: Faults }> => {
    const faults: Faults = { dead: false, next: 'none' }, saves = savesOf(db, faults), at = await boot(DRIFTWOOD, `kills-${String(++boots)}`, saves);
    at.room.host.events.on('actor.died', row => { died = row; }, at.room.host.scope);
    const saved = await saves.read('a', DRIFTWOOD), phone = seat(at, 'a', saved);
    if ((saved.recovery?.length ?? 0) > 0) recovered++;
    phone.client.onLedger(row => { heard.push(row.id); });
    run(at, phone, 5);
    return { at, phone, saves, faults };
  };
  /** A kill the test caused, counted on its own. */
  const slay = (at: Room, creature: AnimalSim): boolean => {
    const copy = new Rng(0); copy.restore(at.room.host.rng.stream('loot').snapshot());
    const next = (): number => copy.next(), mine = owned.get(at.bootId) ?? new Set<string>(); owned.set(at.bootId, mine);
    const amount = coinRoll(creature.kind, next), items = itemRoll?.({ kind: creature.kind, variant: creature.variant, owned: item => mine.has(item) }, next) ?? [];
    if (!kill(at, 'a', creature)) return false;
    if (amount > 0 || items.length > 0) {
      if (amount > 0) pending.push(`${at.bootId}|coins|${String(amount)}`);
      for (const { item } of items) { mine.add(item); pending.push(`${at.bootId}|item|${item}`); }
      entitled++;
    }
    return true;
  };
  /** Let every checkpoint due land: the debounce passes, and the queue empties into Postgres. */
  const settle = async (at: Room, phone: Phone, saves: Saves): Promise<void> => { run(at, phone, 90); expect(await saves.drain(10_000)).toBe(true); durable.push(...pending); pending = []; };
  let { at, phone, saves, faults } = await open();
  while (kills < 100) {
    const alive = living(at);
    if (alive.length === 0 || roll() < 0.12) {
      const ordering = (['drain', 'crash', 'before-commit', 'ack-lost', 'torn'] as const)[Math.floor(roll() * 5)] ?? 'drain';
      orderings[ordering] = (orderings[ordering] ?? 0) + 1;
      if (ordering === 'torn') {
        // A kill lands in a checkpoint, the process dies, and that newest doc is torn: the player boots from `previous`, and the
        // receipts it lacks come back through recovery.
        const [, last] = living(at)[0] ?? [];
        if (last !== undefined && slay(at, last)) kills++;
        await settle(at, phone, saves);
        faults.dead = true;
        const { rows } = await db.query('select revision from player_save where player_id = $1', ['a']);
        if (Number((rows[0] as { revision: number } | undefined)?.revision ?? 0) >= 2) await db.query('update player_save set doc = \'{"torn":true}\'::jsonb where player_id = $1', ['a']);
      } else if (ordering === 'crash') {
        // Everything checkpointed lands; then one more kill is paid live, and the process dies before its checkpoint.
        await settle(at, phone, saves);
        const [, last] = living(at)[0] ?? [];
        if (last !== undefined && slay(at, last)) kills++;
        run(at, phone, 2);
        lost.push(...pending); pending = [];
        faults.dead = true;
      } else {
        // A failed or unanswered commit is written again; a drain then ends the process cleanly.
        if (ordering === 'before-commit' || ordering === 'ack-lost') faults.next = ordering;
        await settle(at, phone, saves);
        at.room.drain();
        expect(await saves.drain(10_000)).toBe(true);
        // Replayed save writes: this process's last, and any older one, from any process. None may move a doc or add a receipt.
        allWrites.push(...at.writes);
        for (const again of [at.writes.at(-1), allWrites[Math.floor(roll() * allWrites.length)]]) if (again !== undefined) saves.write(again);
        expect(await saves.drain(10_000)).toBe(true);
      }
      at.close();
      ({ at, phone, saves, faults } = await open());
      continue;
    }
    const [, creature] = alive[Math.floor(roll() * alive.length)] ?? [];
    if (creature === undefined) continue;
    if (slay(at, creature)) {
      kills++;
      // A replayed death: the very death is heard again, and the corpse is hit again. Neither may pay.
      if (roll() < 0.3 && died !== null) { at.room.host.events.emit('actor.died', died); expect(kill(at, 'a', creature), 'a corpse does not die twice').toBe(false); }
    }
    run(at, phone, 2 + Math.floor(roll() * 40));
  }
  await settle(at, phone, saves);
  const purse = coins(at, 'a');
  at.room.drain();
  expect(await saves.drain(10_000)).toBe(true);
  expect(boots, 'restarts fell among the kills').toBeGreaterThan(5);
  expect(Object.keys(orderings).sort(), 'every ordering ran').toEqual(['ack-lost', 'before-commit', 'crash', 'drain', 'torn']);
  expect(entitled, 'most deaths were owed something').toBeGreaterThan(50);
  expect(recovered, 'a torn doc was admitted through its recovery receipts').toBeGreaterThan(0);
  expect(new Set(heard).size, 'no grant was heard twice').toBe(heard.length);
  const receipts = await receiptsOf(db, 'a');
  expect(receipts.filter(row => row.grant_kind === 'coins').length, 'kills paid coins: the property has something to hold').toBeGreaterThan(10);
  expect(new Set(receipts.map(row => row.fact_id)).size, 'one row a fact').toBe(receipts.length);
  // Exactly once against what the game granted: every committed reward has its one receipt, and nothing else does.
  const booked = receipts.filter(row => row.grant_kind !== 'fact').map(row => `${row.fact_id.split('.')[0] ?? ''}|${row.grant_kind}|${row.grant_kind === 'coins' ? String(Number(row.amount)) : row.name}`);
  expect(sorted(booked), 'the receipts are exactly the committed entitlements').toEqual(sorted(durable));
  // A durable fact (a kill counter) is entitled once per count: each name's counts run 1..n, none missing and none twice.
  const counts = new Map<string, number[]>();
  for (const row of receipts.filter(row => row.grant_kind === 'fact')) { const [, , , occurrence = ''] = JSON.parse(row.fact_id) as string[]; counts.set(row.name, [...counts.get(row.name) ?? [], Number(occurrence.split(':').at(-1))]); }
  expect(counts.size, 'kills counted facts too').toBeGreaterThan(0);
  for (const [name, seen] of counts) expect([...seen].sort((x, y) => x - y), `${name} counts once each`).toEqual(seen.map((_, index) => index + 1));
  expect(lost.length, 'a crash lost a live grant, so the oracle has a gap to check').toBeGreaterThan(0);
  expect(purse, 'the purse is exactly what the ledger paid').toBe(paid(receipts));
  const saved = await savesOf(db).read('a', DRIFTWOOD);
  expect(saved.doc?.ledger.serial, 'and the last doc saw every receipt').toBe(receipts.length);
});
