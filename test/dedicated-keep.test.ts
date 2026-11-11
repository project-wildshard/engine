import { Vector3 } from 'three';
import { afterEach, expect, test } from 'vitest';
import { NetClient } from '../src/client/engine/net/client';
import { DedicatedRoom } from '../src/server/host/dedicated/dedicatedRoom';
import { parseDoc } from '../src/server/host/dedicated/playerDoc';
import { playerSavesOver } from '../src/server/host/dedicated/playerSaves';
import { migrate } from '../src/server/host/dedicated/saves/migrate';
import type { SaveWrite } from '../src/server/host/dedicated/saves/saveStore';
import type { AnimalSim } from '../src/shared/engine/entities/AnimalSim';
import { directLoopback, type DirectLoopback } from '../src/test/engine/netLoopback';
import { serverInput } from './fixtures/dedicated/roomBench';
import { openPglite } from './fixtures/pgliteDatabase';

// What a player keeps on the one world (MMO-PLAN MP3.1, MP3.3, and J202's world-state rule). A restart gives a fresh world and keeps
// progress; the ledger never pays a fact twice, however kills and restarts fall; coins live in the shard they were earned in.
const DRIFTWOOD = 'driftwood-isle', NALATI = 'nalati-grasslands';
const closers: (() => Promise<void> | void)[] = [];
afterEach(async () => { for (const close of closers.splice(0).reverse()) await close(); });
let clock = 0;
interface Phone { readonly client: NetClient; readonly link: DirectLoopback; readonly heard: string[] }
interface Room { readonly room: DedicatedRoom; readonly writes: SaveWrite[] }

async function boot(slug: string, bootId: string, wrote: (write: SaveWrite) => void = () => undefined): Promise<Room> {
  const writes: SaveWrite[] = [];
  const room = await DedicatedRoom.boot({ slug, build: '', bootId, input: await serverInput(slug), now: () => clock, post: row => {
    if (row.kind === 'save') { writes.push(row.write); wrote(row.write); } else if (row.kind === 'refused') throw new Error(row.reason);
  } });
  closers.push(() => { room.dispose(); });
  return { room, writes };
}
// oxlint-disable-next-line unicorn/prefer-structured-clone -- The persisted JSON, as Postgres hands it back.
const docOf = (write: SaveWrite | undefined, slug: string): ReturnType<typeof parseDoc> => write === undefined ? null : parseDoc(JSON.parse(JSON.stringify(write.doc)), write.saveVersion, slug);
function enter(at: Room, slug: string, device: string, saved?: SaveWrite, ledger = 0): Phone { return seat(at, device, docOf(saved, slug), saved?.seq ?? 0, ledger); }
function seat(at: Room, device: string, doc: ReturnType<typeof parseDoc>, seq: number, ledger = 0): Phone {
  const link = directLoopback(), client = new NetClient(link.client), heard: string[] = [];
  client.onLedger(row => { heard.push(row.id); });
  at.room.seat({ device, name: device, body: `p.${device}`, doc, seq }, link.server, () => { client.hello('', { player: device, name: device }, ledger); link.pump(); });
  link.pump();
  return { client, link, heard };
}
function run(at: Room, phone: Phone, ticks: number): void {
  for (let tick = 0; tick < ticks; tick++) {
    phone.client.command({ viewTick: 0, steer: { keyX: 0, keyY: 0, stickX: 0, stickY: 0 }, yaw: 0, pitch: 0, buttons: 0 }); phone.client.flush(); phone.link.pump();
    clock += 1000 / 60; at.room.tick(); phone.link.pump();
  }
}
function quit(at: Room, phone: Phone): SaveWrite {
  const before = at.writes.length;
  phone.link.server.close('left');
  const write = at.writes.slice(before).at(-1);
  if (write === undefined) throw new Error('No write on leaving');
  return write;
}
const coins = (at: Room, device: string): number => at.room.cell.owned.of(at.room.bodyOf(device)?.id ?? '').purse.coins;
function kill(at: Room, device: string, creature: AnimalSim): boolean {
  const player = at.room.bodyOf(device);
  if (player === undefined) throw new Error('No body');
  return at.room.host.combat.hit({ source: player.health, sourceTags: [player.id, 'cover.checked'], target: creature.combatActor(), amount: creature.maxHp * 10, point: creature.position.clone(), dir: new Vector3(0, 0, 1) })?.killed ?? false;
}
const living = (at: Room): [string, AnimalSim][] => [...at.room.host.entities].filter(([, sim]) => sim.alive);
/** A seeded die, so a red run can be read again. */
function die(seed: number): () => number {
  let state = seed >>> 0;
  return () => { state = (state + 0x6d2b79f5) >>> 0; let t = state; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 2 ** 32; };
}

test('J202: a restart gives a fresh world, and the player keeps what they had', { timeout: 120_000 }, async () => {
  const first = await boot(DRIFTWOOD, 'world-one'), a = enter(first, DRIFTWOOD, 'a');
  run(first, a, 10);
  const [id, creature] = living(first)[0] ?? [];
  if (id === undefined || creature === undefined) throw new Error('No creature');
  expect(kill(first, 'a', creature)).toBe(true);
  first.room.cell.owned.of(first.room.bodyOf('a')?.id ?? '').file({ grant: 'coins', name: 'coins', amount: 5 });
  run(first, a, 30);
  const had = coins(first, 'a'), tick = first.room.host.state.tick, saved = quit(first, a);
  expect(had).toBeGreaterThanOrEqual(5);
  const second = await boot(DRIFTWOOD, 'world-two'), back = enter(second, DRIFTWOOD, 'a', saved, a.client.ledgerSerial);
  run(second, back, 3);
  expect(second.room.host.entities.get(id)?.alive, 'the creature that died is back: the world is fresh').toBe(true);
  expect(second.room.host.entities.get(id)?.hp).toBe(second.room.host.entities.get(id)?.maxHp);
  expect(second.room.host.state.tick, 'and its clock starts over').toBeLessThan(tick);
  expect(coins(second, 'a'), 'progress is kept').toBe(had);
});

test('MP3.3: coins live in the shard that paid them, there on return and absent everywhere else', { timeout: 120_000 }, async () => {
  const db = await openPglite(); closers.push(db.close); await migrate(db);
  const saves = playerSavesOver(db, 1, () => undefined), drift = await boot(DRIFTWOOD, 'bags-1', write => { saves.write(write); }), a = enter(drift, DRIFTWOOD, 'a');
  run(drift, a, 5);
  drift.room.cell.owned.of(drift.room.bodyOf('a')?.id ?? '').file({ grant: 'coins', name: 'coins', amount: 13 });
  run(drift, a, 5);
  quit(drift, a);
  expect(await saves.drain(5000)).toBe(true);
  const there = await saves.read('a', NALATI);
  expect(there.doc, 'Nalati has no bag of theirs').toBeNull();
  const nalati = await boot(NALATI, 'bags-2', write => { saves.write(write); }), visitor = enter(nalati, NALATI, 'a');
  run(nalati, visitor, 5);
  expect(coins(nalati, 'a'), 'Driftwood\'s coins are not in Nalati').toBe(0);
  quit(nalati, visitor);
  expect(await saves.drain(5000)).toBe(true);
  const home = await saves.read('a', DRIFTWOOD);
  const again = await boot(DRIFTWOOD, 'bags-3'), back = seat(again, 'a', home.doc, home.seq);
  run(again, back, 5);
  expect(coins(again, 'a'), 'and back in Driftwood they are there').toBe(13);
});

test('MP3.1: 100 random kills, with restarts among them, pay no fact twice', { timeout: 300_000 }, async () => {
  const db = await openPglite(); closers.push(db.close); await migrate(db);
  const saves = playerSavesOver(db, 1, () => undefined), roll = die(20261111), heard: string[] = [];
  let boots = 0, kills = 0, saved: SaveWrite | undefined;
  const open = async (): Promise<{ at: Room; phone: Phone }> => {
    const at = await boot(DRIFTWOOD, `kills-${String(++boots)}`, write => { saves.write(write); });
    const phone = enter(at, DRIFTWOOD, 'a', saved, saved === undefined ? 0 : (docOf(saved, DRIFTWOOD)?.ledger.serial ?? 0));
    phone.client.onLedger(row => { heard.push(row.id); });
    run(at, phone, 5);
    return { at, phone };
  };
  let { at, phone } = await open();
  while (kills < 100) {
    const alive = living(at);
    if (alive.length === 0 || roll() < 0.1) { saved = quit(at, phone); at.room.dispose(); ({ at, phone } = await open()); continue; }
    const [, creature] = alive[Math.floor(roll() * alive.length)] ?? [];
    if (creature === undefined) continue;
    if (kill(at, 'a', creature)) kills++;
    run(at, phone, 2 + Math.floor(roll() * 40));
  }
  const purse = coins(at, 'a');
  saved = quit(at, phone);
  expect(await saves.drain(10_000)).toBe(true);
  expect(boots, 'restarts fell among the kills').toBeGreaterThan(3);
  expect(new Set(heard).size, 'no grant was heard twice').toBe(heard.length);
  const { rows } = await db.query('select fact_id, grant_kind, amount from ledger_receipt where player_id = $1', ['a']);
  const receipts = rows as { fact_id: string; grant_kind: string; amount: number }[];
  expect(receipts.filter(row => row.grant_kind === 'coins').length, 'kills paid coins: the property has something to hold').toBeGreaterThan(10);
  expect(new Set(receipts.map(row => row.fact_id)).size, 'one row a fact').toBe(receipts.length);
  expect(receipts.filter(row => row.grant_kind === 'coins').reduce((sum, row) => sum + Number(row.amount), 0), 'the purse is exactly what the ledger paid').toBe(purse);
  expect(docOf(saved, DRIFTWOOD)?.ledger.serial, 'and the doc saw every receipt').toBe(receipts.length);
});
