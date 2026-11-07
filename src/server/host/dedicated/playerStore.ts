import { ForwardedStorage } from '@wildshard/engine/saves/forwardedStorage';
import { SaveStore } from '@wildshard/engine/saves/store';
import { installedIdentity } from '@wildshard/engine/app/identity';
import { admittedQuestLedger, createQuestLedger } from '@wildshard/engine/game/quest/ledger';
import type { RuntimeFacts } from '@wildshard/engine/game/plugin/runtimeRows';
import { playerSlots } from '@wildshard/engine/game/saves';
import { PlayerOwned, type OwnedSlots } from '@wildshard/engine/game/loot/playerOwned';
import * as v from 'valibot';
import type { SaveReceipt } from './saves/saveStore';
import type { PlayerDoc } from './playerDoc';
import type { HeadlessRuntimeInput } from '../headlessRuntime';

const StoredDocument = v.object({ keys: v.record(v.string(), v.unknown()), reset: v.optional(v.pipe(v.number(), v.integer(), v.minValue(1))) });
/** Validate every persisted slot without SaveStore's playable-page fallback or mutation.
 * Normalize only the application prefix; the shard namespace and slot schemas still have to match. */
export function validPlayerStore(seed: Readonly<Record<string, string>>, shard?: string, requirePurse = false): boolean {
  try {
    const prefix = installedIdentity()?.savePrefix ?? 'unsaved.', normalized: Record<string, string> = {}, namespaces = new Set<string>();
    for (const [name, text] of Object.entries(seed)) {
      const namespace = name.slice(name.lastIndexOf('.') + 1), profile = namespace === 'profile';
      const document = v.parse(StoredDocument, JSON.parse(text));
      if (['device', 'session', 'global'].includes(namespace)) { if (Object.keys(document.keys).length > 0) return false; normalized[`${prefix}${namespace}`] = text; continue; }
      if (!profile && (!/^_?[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(namespace) || (shard !== undefined && namespace !== shard))) return false;
      const allowed = profile ? ['platform.ledger'] : ['purse', 'inventory', 'owned', 'creature-rewards'];
      if (Object.keys(document.keys).some(key => !allowed.includes(key)) || normalized[`${prefix}${namespace}`] !== undefined) return false;
      normalized[`${prefix}${namespace}`] = text;
      if (!profile) namespaces.add(namespace);
    }
    const storage = new ForwardedStorage(normalized, () => undefined), store = new SaveStore({ local: storage, session: storage }), slots = playerSlots(store);
    if (requirePurse && ![...namespaces].some(namespace => slots.purse.status?.(namespace) === 'valid')) return false;
    return admittedQuestLedger(store) && [...namespaces].every(namespace => Object.values(slots).every(slot => { const status = slot.status?.(namespace); return status === 'absent' || status === 'valid'; }));
  } catch { return false; }
}

/**
 * E7.4: one player's saves in a room: their own `SaveStore` over their own `ForwardedStorage`, so a purse, a pack and a fact ledger
 * written the way a page writes them land here and nowhere else. Nothing waits on a real storage: the doc is what is durable.
 */
export class PlayerStore {
  readonly saves: SaveStore;
  readonly slots: OwnedSlots;
  readonly rewards: ReturnType<typeof playerSlots>['rewards'];
  private readonly storage: ForwardedStorage;
  private ledger: RuntimeFacts | null = null;
  /** `changed` hears every write: a grant is a checkpoint. */
  constructor(seed: Readonly<Record<string, string>>, changed: () => void) {
    const storage: ForwardedStorage = new ForwardedStorage(seed, write => { storage.acked(write.seq, true); changed(); });
    this.storage = storage; this.saves = new SaveStore({ local: storage, session: storage });
    const slots = playerSlots(this.saves); this.slots = slots; this.rewards = slots.rewards;
  }
  /** This player's fact ledger on this shard. */
  facts(input: HeadlessRuntimeInput, instance: string): RuntimeFacts {
    this.ledger ??= createQuestLedger(this.saves, input.shard, instance);
    return this.ledger;
  }
  /** Every document held, as its text. */
  documents(): Record<string, string> {
    const { storage } = this, out: Record<string, string> = {};
    for (let index = 0; index < storage.length; index++) { const key = storage.key(index), value = key === null ? null : storage.getItem(key); if (key !== null && value !== null) out[key] = value; }
    return out;
  }
}

/** Reapply durable grants missing from an older checkpoint, then reserve their serials.
 * Fact identities that cannot be reconstructed are quarantined rather than guessed. */
export function recoverPlayer(doc: PlayerDoc, receipts: readonly SaveReceipt[], input: HeadlessRuntimeInput, shard: string): PlayerDoc {
  if (receipts.length === 0) return doc;
  const store = new PlayerStore(doc.store, () => undefined), goods = new PlayerOwned(shard, store.slots, Object.keys(input.shard.items.pickups ?? {}));
  const rows = [...doc.ledger.rows]; let serial = doc.ledger.serial;
  for (const receipt of receipts) {
    if (receipt.serial <= serial) throw new Error('Recovery receipts are out of order');
    if (receipt.grant === 'fact') {
      const identity = v.parse(v.tuple([v.literal(shard), v.literal(input.shard.identity.slug), v.literal(input.shard.identity.revision), v.string(), v.number(), v.number()]), JSON.parse(receipt.factId));
      const recovered = store.facts(input, shard)(receipt.name, identity[3]);
      if (recovered.id !== receipt.factId || recovered.status === 'pending') throw new Error('Recovery fact identity does not match');
    } else if (receipt.grant === 'coins' || receipt.grant === 'item') goods.file({ grant: receipt.grant, name: receipt.name, amount: receipt.amount });
    else throw new Error('Unknown recovery grant');
    serial = receipt.serial;
    rows.push({ kind: 'ledger', serial, id: receipt.factId, grant: receipt.grant, name: receipt.name, amount: receipt.amount, tick: 0, pending: false });
  }
  return { ...doc, store: store.documents(), ledger: { serial, rows: rows.slice(-256) } };
}
