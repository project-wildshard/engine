import * as v from 'valibot';
import { Scope } from '@wildshard/engine/app/scope';
import type { Database, Sql } from './database';

/** A read's wait: a join must not hang on a database that has stopped answering. */
const READ_MS = 3000;

/** Durable data needs repair; retrying this admission cannot make it valid. */
export class SaveQuarantinedError extends Error { override name = 'SaveQuarantinedError'; }

/** One receipt, as it goes in the same transaction as the doc that paid it. */
export interface SaveReceipt { readonly serial: number; readonly factId: string; readonly grant: string; readonly name: string; readonly amount: number }
/** One player's save on one shard. `seq` only ever rises for a player and a shard, and an older write never lands on a newer one. The epoch is the store's, from the release. */
export interface SaveWrite {
  readonly player: string; readonly name: string; readonly shard: string;
  /** GO3 (ZS7): the grid instance the doc was written in, the player's place. Left out, the shard's name stands for it. */
  readonly cell?: string;
  readonly build: string; readonly saveVersion: number; readonly seq: number; readonly reason: string;
  readonly doc: unknown; readonly receipts: readonly SaveReceipt[];
}
/** What a read found. `source` says which copy `doc` is; `none` is a row with nothing fit to load, so the player starts fresh. */
export interface LoadedSave<Doc> { readonly doc: Doc | null; readonly source: 'doc' | 'previous' | 'none'; readonly seq: number; readonly revision: number; readonly previous?: Doc }
/** A copy's check. Null: this copy is not fit to load. */
export type SaveParse<Doc> = (doc: unknown, saveVersion: number) => Doc | null;

// `pg` reads a bigint as a string, and PGlite as a number.
const Whole = v.pipe(v.union([v.number(), v.string(), v.bigint()]), v.transform(Number));
const CellSchema = v.array(v.object({ shard: v.string() }));
const PlaceSchema = v.array(v.object({ cell: v.string() }));
const RowSchema = v.array(v.object({ doc: v.unknown(), previous: v.unknown(), seq: Whole, revision: Whole, save_version: Whole }));

// MP2.4: a save never renames a player. The Name and its tag are the door's claim (`names.ts`), and a save only says they were here.
const WRITE_PLAYER = 'insert into player (id, name) values ($1, $2) on conflict (id) do update set seen_at = now()';
// A write moves `doc` to `previous`, which is J102's last-good copy on the server, and `seq` keeps an older write from landing.
const WRITE_SAVE = `insert into player_save (player_id, epoch, shard, revision, build, save_version, seq, reason, doc)
  values ($1, $2, $3, 1, $4, $5, $6, $7, $8::jsonb)
  on conflict (player_id, epoch, shard) do update set revision = player_save.revision + 1, build = excluded.build, save_version = excluded.save_version,
    seq = excluded.seq, reason = excluded.reason, doc = excluded.doc, previous = player_save.doc, updated_at = now()
  where player_save.seq < excluded.seq
  returning seq`;
// ZS7 (GO3, MP1.4's `player.at`): one place a player and epoch, moved by every doc that lands. `pose` is that doc's own stand.
const WRITE_PLACE = `insert into player_place (player_id, epoch, cell, pose, reason) values ($1, $2, $3, $4::jsonb, $5)
  on conflict (player_id, epoch) do update set cell = excluded.cell, pose = excluded.pose, reason = excluded.reason, updated_at = now()`;
const READ_PLACE = 'select cell from player_place where player_id = $1 and epoch = $2';
// Only `fact_id` may repeat. A serial on a different fact is a book restarted without its save, and it must fail loudly: a bare
// `do nothing` would drop a real grant in silence.
const WRITE_RECEIPT = `insert into ledger_receipt (player_id, epoch, shard, serial, fact_id, grant_kind, name, amount)
  values ($1, $2, $3, $4, $5, $6, $7, $8) on conflict (player_id, epoch, shard, fact_id) do nothing`;
const READ_SAVE = 'select doc, previous, seq, revision, save_version from player_save where player_id = $1 and epoch = $2 and shard = $3';
const LAST_CELL = 'select shard from player_save where player_id = $1 and epoch = $2 order by updated_at desc limit 1';
// The bad copy stays in `previous` to be looked at, and the next write replaces it. `seq` is checked so a newer write stands.
const HEAL = 'update player_save set doc = previous, previous = doc where player_id = $1 and epoch = $2 and shard = $3 and seq = $4';

/** Where a doc stands, if it says: a room's doc always does. */
function poseOf(doc: unknown): unknown { return typeof doc === 'object' && doc !== null && 'at' in doc ? doc.at ?? null : null; }
/** Write a player's doc and its receipts in one transaction. Receipts stand even if an older doc doesn't land: they are facts. */
export async function writeSave(db: Database, epoch: number, write: SaveWrite): Promise<void> {
  await db.transaction(async (sql: Sql) => {
    await sql.query(WRITE_PLAYER, [write.player, write.name]);
    const landed = await sql.query(WRITE_SAVE, [write.player, epoch, write.shard, write.build, write.saveVersion, write.seq, write.reason, JSON.stringify(write.doc)]);
    // An older doc that doesn't land doesn't move the player either.
    if (landed.rows.length > 0) await sql.query(WRITE_PLACE, [write.player, epoch, write.cell ?? write.shard, JSON.stringify(poseOf(write.doc)), write.reason]);
    for (const row of write.receipts) await sql.query(WRITE_RECEIPT, [write.player, epoch, write.shard, row.serial, row.factId, row.grant, row.name, row.amount]);
  });
}
/** The answer, or a rejection once `ms` has passed. */
export async function within<Result>(ms: number, read: () => Promise<Result>): Promise<Result> {
  const scope = new Scope('dedicated.saves.read');
  try {
    return await Promise.race([read(), new Promise<never>((_resolve, reject) => { scope.timeout(ms, () => { reject(new Error(`Save read took over ${String(ms)} ms`)); }); })]);
  } finally { scope.dispose(); }
}
/** ZS7: the place row's cell, this epoch, or null for a player whose docs all predate it. */
export async function placeOf(db: Database, epoch: number, player: string): Promise<string | null> {
  const [row] = v.parse(PlaceSchema, (await within(READ_MS, () => db.query(READ_PLACE, [player, epoch]))).rows);
  return row?.cell ?? null;
}
/** The cell this player last stood in, this epoch: where they load. */
export async function lastCell(db: Database, epoch: number, player: string): Promise<string | null> {
  const [row] = v.parse(CellSchema, (await within(READ_MS, () => db.query(LAST_CELL, [player, epoch]))).rows);
  return row?.shard ?? null;
}
/**
 * A player's save, or null if they have none. A `doc` that fails `parse` boots from `previous` (J102), which becomes `doc`, so the
 * next write cannot push the last good copy out. With neither fit to load, the player starts fresh and the row waits to be looked at.
 */
export async function readSave<Doc>(db: Database, epoch: number, player: string, shard: string, parse: SaveParse<Doc>): Promise<LoadedSave<Doc> | null> {
  const [row] = v.parse(RowSchema, (await within(READ_MS, () => db.query(READ_SAVE, [player, epoch, shard]))).rows);
  if (row === undefined) return null;
  const { seq, revision, save_version: version } = row, doc = parse(row.doc, version);
  const previous = row.previous === null ? null : parse(row.previous, version);
  if (doc !== null) return { doc, source: 'doc', seq, revision, ...(previous === null ? {} : { previous }) };
  if (previous === null) return { doc: null, source: 'none', seq, revision };
  await healSave(db, epoch, player, shard, seq);
  return { doc: previous, source: 'previous', seq, revision };
}

/** Promote a successfully imported previous copy, without overwriting a newer checkpoint. */
export async function healSave(db: Database, epoch: number, player: string, shard: string, seq: number): Promise<void> {
  await within(READ_MS, () => db.query(HEAL, [player, epoch, shard, seq]));
}

/** Durable grants beyond a recovered document. Reconcile these before admission. */
export async function recoveryReceipts(db: Database, epoch: number, player: string, shard: string, after: number): Promise<readonly SaveReceipt[]> {
  const schema = v.array(v.object({ serial: Whole, fact_id: v.string(), grant_kind: v.string(), name: v.string(), amount: v.number() }));
  const result = await within(READ_MS, () => db.query('select serial, fact_id, grant_kind, name, amount from ledger_receipt where player_id = $1 and epoch = $2 and shard = $3 and serial > $4 order by serial', [player, epoch, shard, after]));
  return v.parse(schema, result.rows).map(row => ({ serial: row.serial, factId: row.fact_id, grant: row.grant_kind, name: row.name, amount: row.amount }));
}
