import * as v from 'valibot';
import type { SaveStore, InstanceSaveSlot } from '@wildshard/engine/saves/store';
import type { ItemRuntime } from '@wildshard/engine/combat/items';
import { instanceSave, type LocalSaveInstance } from '../instanceSaves';
import { inventoryKey, purseKey } from '../localSaveKeys';

const name = v.pipe(v.string(), v.minLength(1), v.maxLength(128));
const natural = v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(Number.MAX_SAFE_INTEGER));
const finite = v.pipe(v.number(), v.finite(), v.minValue(0));
const packSchema: v.GenericSchema<BoundedWalletSaveInput, BoundedWalletSave> = v.strictObject({ counts: v.record(name, natural), order: v.array(name) });
const itemSchema = v.strictObject({ id: name, tick: v.pipe(v.number(), v.integer(), v.minValue(-1), v.maxValue(Number.MAX_SAFE_INTEGER)), cooldown: finite,
  fuel: v.pipe(finite, v.maxValue(1)), lit: v.boolean() });
const loadoutSchema = v.pipe(v.strictObject({ selected: v.nullable(name), items: v.pipe(v.array(itemSchema), v.maxLength(64)) }),
  v.check((data) => new Set(data.items.map((item) => item.id)).size === data.items.length
    && (data.selected === null || data.items.some((item) => item.id === data.selected)), 'Unique local items and admitted selection'));
type LocalPack = v.InferOutput<typeof packSchema>;
type LocalLoadout = v.InferOutput<typeof loadoutSchema>;
const loadoutKey = { key: 'platform.loadout', scope: 'shard' as const, version: 1, schema: loadoutSchema,
  initial: (): LocalLoadout => ({ selected: null, items: [] }) };

/** A shard's money, bag and item continuation stay bound to its stable instance in either entry mode. */
export class GridWallet {
  readonly instance: string;
  private readonly bag: InstanceSaveSlot<LocalPack>;
  private readonly purse: InstanceSaveSlot<number>;
  private readonly loadout: InstanceSaveSlot<LocalLoadout>;
  constructor(store: SaveStore, identity: LocalSaveInstance) {
    this.instance = identity.id;
    this.bag = instanceSave(store, inventoryKey, identity);
    this.purse = instanceSave(store, purseKey, identity);
    this.loadout = instanceSave(store, loadoutKey, identity);
  }
  /** Local coins are never part of a crossing payload or a profile balance. */
  coins(): number { return this.purse.read(); }
  /** Existing bag order and counts, detached from live save data. */
  pack(): LocalPack { return this.bag.read(); }
  /** Credit whole local coins; false means SaveStore retained a retryable memory fallback. */
  addCoins(amount: number): boolean {
    if (!Number.isSafeInteger(amount) || amount < 0 || !Number.isSafeInteger(this.coins() + amount)) throw new RangeError('Invalid local coin credit');
    return this.purse.write(this.coins() + amount);
  }
  /** Spend only from this instance; insufficient funds change nothing. */
  spendCoins(amount: number): boolean {
    if (!Number.isSafeInteger(amount) || amount < 0) throw new RangeError('Invalid local coin debit');
    const balance = this.coins(); return balance >= amount && this.purse.write(balance - amount);
  }
  /** Save an admitted local bag; crossing does not drain it into the destination. */
  savePack(pack: LocalPack): boolean {
    const parsed = v.parse(packSchema, pack);
    if (new Set(parsed.order).size !== parsed.order.length || Object.keys(parsed.counts).some((id) => !parsed.order.includes(id))) throw new Error('Invalid local bag order');
    return this.bag.write(parsed);
  }
  /** Retry local money and bag persistence without changing the saved equipment selection or continuation. */
  flush(): boolean {
    const bag = this.bag.write(this.bag.read()), purse = this.purse.write(this.purse.read());
    return bag && purse;
  }
  /** Persist continuation after stowing: charge/input edges do not fire when the shard is revisited. */
  checkpoint(selected: string | null, runtimes: ReadonlyMap<string, ItemRuntime>): boolean {
    if (selected !== null && !runtimes.has(selected)) throw new Error('Selected item is not local');
    const items = [...runtimes.values()].map((runtime) => {
      const state = runtime.snapshot();
      return { id: state.id, tick: state.tick, cooldown: state.cooldown, fuel: state.fuel, lit: state.lit };
    });
    const durable = this.flush();
    return this.loadout.write({ selected, items }) && durable;
  }
  /** Restore into the current host clock (or a fresh document); input edges remain cancelled and new items keep defaults. */
  restore(runtimes: ReadonlyMap<string, ItemRuntime>, tick = -1): string | null {
    if (!Number.isSafeInteger(tick) || tick < -1) throw new RangeError('Invalid restored item clock');
    const saved = this.loadout.read();
    for (const state of saved.items) {
      const runtime = runtimes.get(state.id);
      if (runtime === undefined) throw new Error(`Missing saved local item ${state.id}`);
      if ((runtime.spec.kind === 'weapon' && state.lit) || (state.fuel === 0 && state.lit)) throw new Error('Invalid saved item continuation');
    }
    if (saved.selected !== null && !runtimes.has(saved.selected)) throw new Error('Missing saved selection');
    for (const state of saved.items) runtimes.get(state.id)?.restore({ ...state, tick, version: 1, held: false, chargeTime: 0, pending: [] });
    return saved.selected;
  }
}


/** Retire a shard-owned ride through its original owner; the platform hoverboard is a separate traveller mode. */
export function stowGridMount(traveller: { readonly ride?: { dismount: () => void } | null }): void {
  traveller.ride?.dismount();
}

/** Source-local ports consumed by crossing; the normal equipment service retains catalogue gear and owns presentation. */
export interface GridLoadout {
  checkpoint: () => boolean;
  stow: () => void;
  interior: () => void;
}

/** Complete admitted data, independent of validator implementation metadata. */
type BoundedWalletSaveInput = BoundedWalletSave;
interface BoundedWalletSaveFields {
    counts: Record<string, number>;
    order: string[];
}
type BoundedWalletSave = { [Key in keyof BoundedWalletSaveFields]: BoundedWalletSaveFields[Key] };
