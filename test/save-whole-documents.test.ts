// WIRE-STABILITY WR7: a save is a whole document. A field this build does not know survives its read-modify-write, a save
// at its own version that fails is a reported contract failure, and a newer server's PlayerDoc is never loaded or overwritten.
// Capture the whole-document pin (WR8 recaptures it at the epoch-2 cut): SAVES_PIN_WRITE=1 pnpm exec vitest run test/save-whole-documents.test.ts
// oxlint-disable-next-line import/no-nodejs-modules -- Write the captured whole-document pin.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import * as v from 'valibot';
import { expect, test } from 'vitest';
import { SaveStore, type SaveKeyDef, type SaveStorage, type SchemaFailure } from '../src/shared/engine/saves/store';
import { inventoryKey } from '../src/shared/game/localSaveKeys';
import { walletSaves } from '../src/shared/game/grid/wallet';
import { admitDoc, parseDoc, PLAYER_DOC_VERSION, SaveNewerError, type PlayerDoc } from '../src/server/host/dedicated/playerDoc';
import { memoryPlayerSaves, playerSavesOver } from '../src/server/host/dedicated/playerSaves';
import { writeSave, type SaveWrite } from '../src/server/host/dedicated/saves/saveStore';
import { migrate } from '../src/server/host/dedicated/saves/migrate';
import { openPglite } from './fixtures/pgliteDatabase';
import { SHARD, open, enter, earn, quit } from './fixtures/dedicatedDoc';
import { definitions } from './fixtures/saveDefinitions';

class MemoryStorage implements SaveStorage {
  readonly values = new Map<string, string>();
  get length(): number { return this.values.size; }
  key(index: number): string | null { return [...this.values.keys()][index] ?? null; }
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  setItem(key: string, value: string): void { this.values.set(key, value); }
  removeItem(key: string): void { this.values.delete(key); }
}
const NS = 'driftwood-isle';
/** The storage name the store gives `scope`, learned from a real write. */
function nameOf(local: MemoryStorage, scope: string): string {
  const name = [...local.values.keys()].find(key => key.endsWith(`.${scope}`) && !key.includes('.corrupt.'));
  if (name === undefined) throw new Error(`No ${scope} document`);
  return name;
}

test('a document with an unknown field survives a read-modify-write by the older build', () => {
  const local = new MemoryStorage(), failures: SchemaFailure[] = [], store = new SaveStore({ local, session: new MemoryStorage(), report: failure => { failures.push(failure); } });
  const strict: SaveKeyDef<{ a: number }> = { key: 'wr7.strict', scope: 'shard', version: 1, schema: v.strictObject({ a: v.number() }), initial: () => ({ a: 0 }) };
  const loadoutKey = walletSaves[0] as SaveKeyDef<{ selected: string | null; items: { id: string; tick: number; cooldown: number; fuel: number; lit: boolean }[] }>;
  const inventory = store.define(inventoryKey), loadout = store.define(loadoutKey), strictSlot = store.define(strict);
  inventory.write({ counts: {}, order: [] }, NS);
  const name = nameOf(local, NS);
  // A newer build wrote these at the same versions, with fields this build has never heard of.
  local.setItem(name, JSON.stringify({ newer: true, keys: {
    inventory: { v: 1, data: { counts: { shell: 2 }, order: ['shell'], dyes: { shell: 'red' } } },
    'platform.loadout': { v: 1, data: { selected: 'lamp', items: [{ id: 'lamp', tick: -1, cooldown: 0, fuel: 0.5, lit: false, glow: 3 }], charm: 'luck' } },
    'wr7.strict': { v: 1, data: { a: 1, b: 2 } },
    'future.key': { v: 3, data: { anything: true } },
  } }));
  expect(inventory.read(NS)).toEqual({ counts: { shell: 2 }, order: ['shell'] });
  inventory.write({ counts: { shell: 3 }, order: ['shell'] }, NS);
  const kit = loadout.read(NS);
  loadout.write({ selected: null, items: kit.items.map(item => ({ id: item.id, tick: item.tick, cooldown: item.cooldown, fuel: 1, lit: true })) }, NS);
  expect(strictSlot.read(NS)).toEqual({ a: 1 });
  strictSlot.write({ a: 5 }, NS);
  const saved = JSON.parse(local.getItem(name) ?? '') as { newer: boolean; keys: Record<string, { v: number; data: unknown }> };
  expect(saved.newer).toBe(true);
  expect(saved.keys['inventory']).toEqual({ v: 1, data: { counts: { shell: 3 }, order: ['shell'], dyes: { shell: 'red' } } });
  expect(saved.keys['platform.loadout']).toEqual({ v: 1, data: { selected: null, items: [{ id: 'lamp', tick: -1, cooldown: 0, fuel: 1, lit: true, glow: 3 }], charm: 'luck' } });
  expect(saved.keys['wr7.strict']).toEqual({ v: 1, data: { a: 5, b: 2 } });
  expect(saved.keys['future.key']).toEqual({ v: 3, data: { anything: true } });
  expect(Object.keys(saved.keys).filter(key => key.includes('.corrupt.'))).toEqual([]);
  expect(failures).toEqual([]);
});

test('a failed parse at the same version keeps its .corrupt copy and is reported as a contract failure; a failed migration is not', () => {
  const local = new MemoryStorage(), failures: SchemaFailure[] = [], store = new SaveStore({ local, session: new MemoryStorage(), report: failure => { failures.push(failure); } });
  const same: SaveKeyDef<number> = { key: 'wr7.same', scope: 'shard', version: 1, schema: v.number(), initial: () => 0 };
  const moved: SaveKeyDef<number> = { key: 'wr7.moved', scope: 'shard', version: 2, schema: v.number(), initial: () => 0, migrate: { 1: () => { throw new Error('no way up'); } } };
  const sameSlot = store.define(same), movedSlot = store.define(moved);
  sameSlot.write(1, NS);
  const name = nameOf(local, NS);
  local.setItem(name, JSON.stringify({ keys: { 'wr7.same': { v: 1, data: 'seven' }, 'wr7.moved': { v: 1, data: 7 } } }));
  expect([sameSlot.read(NS), movedSlot.read(NS)]).toEqual([0, 0]);
  expect(failures.map(({ key, contract }) => ({ key, contract }))).toEqual([{ key: 'wr7.same', contract: true }, { key: 'wr7.moved', contract: undefined }]);
  const kept = Object.keys((JSON.parse(local.getItem(name) ?? '') as { keys: object }).keys);
  expect(kept.filter(key => key.startsWith('wr7.same.corrupt.')).length).toBe(1);
});

test('a PlayerDoc at version 2 seated by a version-1 server is unchanged afterwards', { timeout: 20_000 }, async () => {
  const room = await open('wr7-newer'), saved = quit(enter(room, 'device:newer'));
  const newer: SaveWrite = { ...saved, saveVersion: PLAYER_DOC_VERSION + 1, seq: 4, doc: { ...(saved.doc as object), pets: ['otter'] } };
  const db = await openPglite(); await migrate(db);
  const told: string[] = [], saves = playerSavesOver(db, 0, () => undefined, issue => { told.push(issue); });
  try {
    await writeSave(db, 0, newer);
    const row = async (): Promise<unknown> => (await db.query('select doc, previous, save_version, seq, revision, build from player_save')).rows;
    const before = await row();
    await expect(saves.read('device:newer', SHARD)).rejects.toBeInstanceOf(SaveNewerError);
    // An older server's checkpoint for this player, even with a later seq, never lands on the newer doc.
    await writeSave(db, 0, { ...saved, seq: 9 });
    expect(await row()).toEqual(before);
    expect(told).toEqual([]);
    const memory = memoryPlayerSaves();
    memory.write(newer); memory.write({ ...saved, seq: 9 });
    await expect(memory.read('device:newer', SHARD)).rejects.toBeInstanceOf(SaveNewerError);
  } finally { saves.queue.dispose(); saves.reports.dispose(); await db.close(); }
});

test('a same-version PlayerDoc keeps fields this server does not know, and a broken one is a contract failure', { timeout: 20_000 }, async () => {
  const room = await open('wr7-unknown'), phone = enter(room, 'device:unknown'); earn(room, phone.device, 'paid');
  const saved = quit(phone), doc = saved.doc as PlayerDoc;
  const richer = { ...doc, pets: ['otter'], at: { ...doc.at, floor: 2 } };
  expect(parseDoc(richer, PLAYER_DOC_VERSION, SHARD)).not.toBeNull();
  const again = await open('wr7-unknown-2'), back = quit(enter(again, 'device:unknown', { ...saved, doc: richer }));
  expect(back.doc).toMatchObject({ pets: ['otter'], at: { floor: 2 } });
  const told: string[] = [];
  expect(admitDoc({ ...doc, at: 'nowhere' }, PLAYER_DOC_VERSION, SHARD, issue => { told.push(issue); })).toBeNull();
  expect(admitDoc(doc, PLAYER_DOC_VERSION - 1, SHARD, issue => { told.push(issue); })).toBeNull();
  expect(told).toEqual([`PlayerDoc v${String(PLAYER_DOC_VERSION)} on ${SHARD} does not parse`]);
});

test.runIf(process.env['SAVES_PIN_WRITE'] === '1')('capture the whole-document pin', { timeout: 20_000 }, async () => {
  const room = await open('wr7-pin'), phone = enter(room, 'device:pin'); earn(room, phone.device, 'paid');
  const player = quit(phone), local = new MemoryStorage(), store = new SaveStore({ local, session: local });
  for (const definition of definitions().values()) store.define(definition).write(definition.initial(), definition.scope === 'shard' ? NS : undefined);
  const prefix = nameOf(local, 'global').slice(0, -'global'.length);
  const docs = Object.fromEntries([...local.values].map(([name, raw]) => [name.slice(prefix.length), JSON.parse(raw) as unknown]));
  const epoch = (JSON.parse(readFileSync('save-epoch.json', 'utf8')) as { saveEpoch: number }).saveEpoch;
  const release = (JSON.parse(readFileSync('package.json', 'utf8')) as { version: string }).version;
  mkdirSync('test/pins/saves/documents', { recursive: true });
  writeFileSync(`test/pins/saves/documents/epoch-${String(epoch)}.json`, `${JSON.stringify({ release, saveEpoch: epoch, shard: SHARD, docs, player: { saveVersion: player.saveVersion, doc: player.doc } }, null, 1)}\n`);
});
