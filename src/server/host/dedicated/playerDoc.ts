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
import { keepUnknown, known } from '@wildshard/engine/saves/shape';
import { validPlayerStore } from './playerStore';

/** Bumped only with a migration. A doc at this version that does not parse boots from `previous`, then fresh, and is reported
 *  as a contract failure; a doc from a newer server is never loaded, migrated or overwritten here (WIRE-STABILITY WR7). */
export const PLAYER_DOC_VERSION = 1;
/** A newer server wrote this player's save: the door answers `retry` ("Server updating") and writes nothing. */
export class SaveNewerError extends Error { override name = 'SaveNewerError'; }
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
const PlayerLedger: v.GenericSchema<unknown, PlayerDoc['ledger']> = v.pipe(v.looseObject({ serial: natural, rows: v.array(LedgerRowSchema) }), v.check(ledger => ledger.rows.every((row, index) => row.serial > 0 && row.serial <= ledger.serial && (index === 0 || row.serial > (ledger.rows[index - 1]?.serial ?? 0))) && new Set(ledger.rows.map(row => row.id)).size === ledger.rows.length, 'Invalid player ledger order'));
// WR7: loose, so a field a newer server adds at the same version is kept rather than refused.
export const PlayerDocSchema: v.GenericSchema<unknown, PlayerDoc> = v.pipe(v.looseObject({
  at: v.looseObject({ x: coordinate, y: coordinate, z: coordinate, yaw: finite }),
  health: v.looseObject({ state: v.looseObject({ version: v.literal(1), attributes: v.record(v.string(), finite) }), sinceHurt: finite }),
  book: v.looseObject({ player: v.string(), flags: v.array(v.string()), quests: v.array(v.looseObject({ version: v.number(), id: v.string(), started: v.boolean(), currentId: v.nullable(v.string()) })), parts: v.record(v.string(), v.string()) }),
  respawn: v.nullable(v.looseObject({ fade: finite, falls: natural })),
  seats: v.array(v.unknown()),
  store: v.record(v.string(), v.string()),
  ledger: PlayerLedger,
}), v.transform(doc => doc as unknown as PlayerDoc));
/** A read doc, or null if it is not fit to load. Fields it does not name ride along, so the next write keeps them. */
export function parseDoc(doc: unknown, version: number, shard?: string): PlayerDoc | null {
  if (version !== PLAYER_DOC_VERSION) return null;
  const parsed = v.safeParse(PlayerDocSchema, known(PlayerDocSchema, doc));
  return parsed.success && validPlayerStore(parsed.output.store, shard, parsed.output.ledger.rows.some(row => row.grant === 'coins')) ? keepUnknown(PlayerDocSchema, doc, parsed.output) as PlayerDoc : null;
}
/** A stored doc for a seat. A newer server's throws `SaveNewerError`; one at this version that fails is told to `contract`. */
export function admitDoc(doc: unknown, version: number, shard: string, contract?: (issue: string) => void): PlayerDoc | null {
  if (version > PLAYER_DOC_VERSION) throw new SaveNewerError(`Player save is version ${String(version)}; this server reads ${String(PLAYER_DOC_VERSION)}`);
  const parsed = parseDoc(doc, version, shard);
  if (parsed === null && version === PLAYER_DOC_VERSION && doc !== null && doc !== undefined) {
    try { contract?.(`PlayerDoc v${String(version)} on ${shard} does not parse`); } catch { /* a report never breaks a read */ }
  }
  return parsed;
}
/** The doc to write: `next`, with every field of the doc the seat was read from that this server does not know. */
export function carryDoc(read: PlayerDoc | null, next: PlayerDoc): PlayerDoc {
  if (read === null) return next;
  const carried = keepUnknown(PlayerDocSchema, read, next) as PlayerDoc;
  // Quests match by id (keepUnknown), and the shard's pack fixes which there are: QuestBook.restore refuses any other set.
  // Weapon seats are by place: seats past this server's own stay, and importSeats never reads them.
  return read.seats.length > next.seats.length ? { ...carried, seats: [...carried.seats, ...read.seats.slice(next.seats.length)] } : carried;
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
