// E7.4: what a player carries out of a room. Nothing here names a seat: a doc taken from the lead's seat reads back on an added one, and
// the other way round, so a player who comes back to a different seat loses nothing. World state is never in it (C7).
// oxlint-disable-next-line import/no-nodejs-modules -- A script's lane is mostly its empty memory, and a doc goes over the wire to Postgres each checkpoint.
import { deflateRawSync, inflateRawSync } from 'node:zlib';
import * as v from 'valibot';
import type { NetLedger } from '@wildshard/engine/net/ledgerWire';
import { LedgerRowSchema } from '@wildshard/engine/net/ledgerBook';
import { questBooks, type QuestBookSaved } from '@wildshard/engine/quest/players';
import type { PlayerHealth } from '@wildshard/engine/combat/health';
import type { SimHost } from '@wildshard/engine/sim';
import type { PlayerSim } from '@wildshard/engine/sim/playerSim';
import { mountedPlayerOf } from '@wildshard/engine/game/riding/native';
import { exportSeats, importSeats } from '@wildshard/engine/game/plugin/playerSeats';
import type { RespawnRowFields } from '@wildshard/engine/sim/respawn';
import { validPlayerStore } from './playerStore';

/** Bumped only with a migration: a doc that does not parse boots from `previous`, then fresh. */
export const PLAYER_DOC_VERSION = 1;
/** Where a player stands in a doc. */
export interface DocPlace { readonly x: number; readonly y: number; readonly z: number; readonly yaw: number }
/** One player's whole save on one shard. */
export interface PlayerDoc {
  readonly at: DocPlace;
  readonly health: { readonly state: Omit<ReturnType<PlayerHealth['snapshot']>, 'lastHurt'>; readonly sinceHurt: number };
  readonly book: QuestBookSaved;
  readonly respawn: Omit<RespawnRowFields, 'id'> | null;
  readonly seats: readonly unknown[];
  /** Their own store's documents: purse, pack, gear and facts. */
  readonly store: Readonly<Record<string, string>>;
  readonly ledger: { readonly serial: number; readonly rows: readonly NetLedger[] };
}
const finite = v.pipe(v.number(), v.finite()), natural = v.pipe(finite, v.integer(), v.minValue(0));
// A defensive numeric envelope before a room checks its own authored extent.
const coordinate = v.pipe(finite, v.minValue(-1_000_000), v.maxValue(1_000_000));
const PlayerLedger: v.GenericSchema<unknown, PlayerDoc['ledger']> = v.pipe(v.strictObject({ serial: natural, rows: v.array(LedgerRowSchema) }), v.check(ledger => ledger.rows.every((row, index) => row.serial > 0 && row.serial <= ledger.serial && (index === 0 || row.serial > (ledger.rows[index - 1]?.serial ?? 0))) && new Set(ledger.rows.map(row => row.id)).size === ledger.rows.length, 'Invalid player ledger order'));
export const PlayerDocSchema: v.GenericSchema<unknown, PlayerDoc> = v.pipe(v.strictObject({
  at: v.strictObject({ x: coordinate, y: coordinate, z: coordinate, yaw: finite }),
  health: v.strictObject({ state: v.looseObject({ version: v.literal(1), attributes: v.record(v.string(), finite) }), sinceHurt: finite }),
  book: v.strictObject({ player: v.string(), flags: v.array(v.string()), quests: v.array(v.unknown()), parts: v.record(v.string(), v.string()) }),
  respawn: v.nullable(v.looseObject({ fade: finite, falls: natural })),
  seats: v.array(v.unknown()),
  store: v.record(v.string(), v.string()),
  ledger: PlayerLedger,
}), v.transform(doc => doc as unknown as PlayerDoc));
/** A read doc, or null if it is not fit to load. */
export function parseDoc(doc: unknown, version: number, shard?: string): PlayerDoc | null {
  if (version !== PLAYER_DOC_VERSION) return null;
  const parsed = v.safeParse(PlayerDocSchema, doc);
  return parsed.success && validPlayerStore(parsed.output.store, shard, parsed.output.ledger.rows.some(row => row.grant === 'coins')) ? parsed.output : null;
}
/** What a seat's owner keeps of a player beside the sim. */
export interface DocStores { readonly store: Readonly<Record<string, string>>; readonly ledger: PlayerDoc['ledger'] }
const NOW_MS = 1000;
/** Past this a book's part is packed: a script lane is 137 KB of mostly nothing (E7.4's 64 KB target). */
const PACK_CHARS = 1024, PACKED = 'z:';
const packed = (book: QuestBookSaved): QuestBookSaved => ({ ...book, parts: Object.fromEntries(Object.entries(book.parts).map(([id, text]) => [id, text.length < PACK_CHARS ? text : `${PACKED}${deflateRawSync(text).toString('hex')}`])) });
const unpacked = (book: QuestBookSaved): QuestBookSaved => ({ ...book, parts: Object.fromEntries(Object.entries(book.parts).map(([id, text]) => [id, text.startsWith(PACKED) ? inflateRawSync(Buffer.from(text.slice(PACKED.length), 'hex')).toString() : text])) });
/** A player as a doc. A rider saves on foot. JSON has no Infinity, so a cap with no limit is left out, and reads back as the seat's own. */
export function exportPlayer(host: SimHost, player: PlayerSim, stores: DocStores): PlayerDoc {
  const mounted = mountedPlayerOf(host, player.id);
  const { x, y, z } = mounted?.mounted === true ? mounted.body.feet : player.position, { lastHurt, attributes, ...rest } = player.health.snapshot();
  const state = { ...rest, attributes: Object.fromEntries(Object.entries(attributes).filter(([, value]) => Number.isFinite(value))) as typeof attributes };
  return { at: { x, y, z, yaw: player.yaw }, health: { state, sinceHurt: host.clock.now * NOW_MS - lastHurt }, book: packed(questBooks(host).exportOf(player.id)),
    respawn: host.respawn.rowOf(player.id), seats: exportSeats(host, player), store: stores.store, ledger: stores.ledger };
}
/** A doc onto a seat, in a world that has been running without them. Health's clock is the host's, so it is moved onto this one. */
export function importPlayer(host: SimHost, player: PlayerSim, doc: PlayerDoc): void {
  const { at, health } = doc;
  player.resetPose(at, at.yaw);
  player.health.restore({ ...health.state, attributes: { ...player.health.attributes, ...health.state.attributes }, lastHurt: host.clock.now * NOW_MS - health.sinceHurt });
  questBooks(host).importOf(player.id, unpacked(doc.book));
  host.respawn.seatRow(player.id, doc.respawn);
  importSeats(host, player, doc.seats);
}
