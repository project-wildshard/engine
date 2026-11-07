import { bitsToFloat, floatToBits, NetDecodeError, type BitReader, type BitWriter } from './bits';

// P1-E5.2c (§4.3, M8): a ledger receipt on the wire. It tells one player what the server granted them; the grant itself is the
// server's, and is never decided or repeated by this message.

/** What was granted: a declared fact, coins, or an item by its id. */
export type LedgerGrantKind = 'fact' | 'coins' | 'item';
const GRANT_KINDS = ['fact', 'coins', 'item'] as const;
/** One grant the server witnessed. `id` is stable: the same grant is the same id however often it is offered. */
export interface LedgerGrant { readonly id: string; readonly tick: number; readonly grant: LedgerGrantKind; readonly name: string; readonly amount: number; /** Not yet durable: a pending receipt may yet be retried, never repaid. */ readonly pending: boolean }
/** A receipt for this client's own player (J105, J106): `serial` counts that player's grants, and a client applies each once. */
export interface NetLedger extends LedgerGrant { readonly kind: 'ledger'; readonly serial: number }

/** Write a receipt after its event id. */
export function writeLedger(writer: BitWriter, event: NetLedger): void {
  writer.write(event.tick, 32); writer.write(event.serial, 32); writer.writeText(event.id); writer.write(GRANT_KINDS.indexOf(event.grant), 2);
  writer.writeText(event.name); writer.write(floatToBits(event.amount), 32); writer.writeBool(event.pending);
}
/** Read a receipt after its event id. */
export function readLedger(reader: BitReader): NetLedger {
  const tick = reader.read(32), serial = reader.read(32), id = reader.readText(), grant = GRANT_KINDS[reader.read(2)];
  if (grant === undefined) throw new NetDecodeError('Unknown grant');
  return { kind: 'ledger', tick, serial, id, grant, name: reader.readText(), amount: bitsToFloat(reader.read(32)), pending: reader.readBool() };
}
