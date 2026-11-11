import * as v from 'valibot';
import { fnv1a32 } from '../../../shared/engine/core/rng';
import type { LedgerGrant, NetLedger } from '../../../shared/engine/net/ledgerWire';

/** Receipts a player can still ask for. Grants are rare, and the durable ledger holds them all. */
const KEPT_RECEIPTS = 256;
/** Text the wire can always carry for an id or a name. */
const WIRE_TEXT = 200;
const fits = (text: string): string => new TextEncoder().encode(text).length <= WIRE_TEXT ? text : `${fnv1a32(text).toString(36)}:${text.slice(-(WIRE_TEXT >> 2))}`;

/** A grant on its way to a player's book. */
export interface LedgerFiling extends LedgerGrant { readonly player: string }
interface Book { serial: number; readonly rows: NetLedger[]; readonly ids: Set<string> }
const natural = v.pipe(v.number(), v.integer(), v.minValue(0));
/** Complete ledger events, shared by room continuation and dedicated document admission. */
export const LedgerRowSchema: v.GenericSchema<NetLedger> = v.strictObject({ kind: v.literal('ledger'), tick: natural, serial: natural, id: v.string(), grant: v.picklist(['fact', 'coins', 'item']), name: v.string(), amount: v.pipe(v.number(), v.finite()), pending: v.boolean() });
/** A book's saved form: it goes with the continuation, beside the sim and not in it. */
export const LedgerBookSchema: v.GenericSchema<LedgerBookSave> = v.record(v.string(), v.strictObject({ serial: natural, rows: v.array(LedgerRowSchema) }));
/** Every player's serial and the receipts still kept. */
export type LedgerBookSave = Readonly<Record<string, { readonly serial: number; readonly rows: readonly NetLedger[] }>>;

/**
 * P1-E5.2c (M8): each player's receipts, kept by the server so that nothing about a grant depends on a link. An id is filed
 * once, so a retry cannot add a receipt. A player who drops off misses nothing: their book waits, and `since` hands over only
 * what they have not had, so a client that comes back with its last serial cannot be told of a grant twice.
 */
export class LedgerBook {
  private readonly books = new Map<string, Book>();
  /** File one grant; false if this player already has this id. */
  file(filing: LedgerFiling): boolean {
    const { player, ...grant } = filing, book = this.of(player), id = fits(grant.id);
    if (book.ids.has(id)) return false;
    book.ids.add(id); book.rows.push({ ...grant, id, name: fits(grant.name), kind: 'ledger', serial: ++book.serial });
    if (book.rows.length > KEPT_RECEIPTS) book.rows.splice(0, book.rows.length - KEPT_RECEIPTS);
    return true;
  }
  /** Whether this player's book already holds this grant: a filing it would refuse. */
  has(player: string, id: string): boolean { return this.books.get(player)?.ids.has(fits(id)) ?? false; }
  /** A player's receipts after `serial`. */
  since(player: string, serial: number): readonly NetLedger[] {
    const book = this.books.get(player);
    return book === undefined || book.serial <= serial ? [] : book.rows.filter(row => row.serial > serial);
  }
  /** The book's saved form. */
  snapshot(): LedgerBookSave { return Object.fromEntries([...this.books].map(([player, book]) => [player, { serial: book.serial, rows: book.rows.slice() }])); }
  /** Take a saved book. */
  restore(saved: LedgerBookSave): void {
    this.books.clear();
    for (const [player, book] of Object.entries(saved)) this.books.set(player, { serial: book.serial, rows: book.rows.slice(), ids: new Set(book.rows.map(row => row.id)) });
  }
  /** One player's serial and kept receipts: what goes in their own save. */
  rowOf(player: string): LedgerBookSave[string] {
    const book = this.books.get(player);
    return { serial: book?.serial ?? 0, rows: book?.rows.slice() ?? [] };
  }
  /** Seat a player's book as it was saved: their serial goes on from there, so a client that remembers a higher one still hears what comes next (E7.4). */
  seat(player: string, saved: LedgerBookSave[string]): void { this.books.set(player, { serial: saved.serial, rows: saved.rows.slice(), ids: new Set(saved.rows.map(row => row.id)) }); }
  private of(player: string): Book {
    let book = this.books.get(player);
    if (book === undefined) { book = { serial: 0, rows: [], ids: new Set() }; this.books.set(player, book); }
    return book;
  }
}
