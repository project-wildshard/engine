import * as v from 'valibot';
import { ExchangeSchema, type ExchangeRows } from '@wildshard/format/exchange';
import { bindBorrowedMethod } from '../plugin/borrowed';
import type { ShopCost, ShopState } from '../../../client/game/loot/ui/ShopPanel';

const saved = v.strictObject({ version: v.literal(1), open: v.boolean() });
/** Validate all immutable decisions before binding owners or changing live state. */
export function parseExchange(input: unknown): ExchangeRows {
  const rows = v.parse(ExchangeSchema, input);
  if (new Set(rows.goods.map(good => good.id)).size !== rows.goods.length
    || rows.goods.some(good => good.capacity !== undefined) && rows.room === undefined) throw new Error('Invalid exchange catalogue');
  return rows;
}
/** Coin and barter counters borrow the same real owners. Reads precede ordered payments and grants;
 * a required payment returning false stops before any grant. The original modal envelope restores silently. */
export class Exchange {
  private opened = false;
  readonly rows: ExchangeRows;
  private readonly count: (item: string) => number;
  private readonly owns: (id: string) => boolean;
  private readonly room: (id: string, n: number) => boolean;
  private readonly payments: readonly (readonly (() => boolean)[])[];
  private readonly grants: readonly (readonly (() => boolean)[])[];
  constructor(input: unknown, owners: ReadonlyMap<string, unknown>) {
    this.rows = parseExchange(input);
    const count = bindBorrowedMethod(owners, this.rows.count), owns = bindBorrowedMethod(owners, this.rows.owns);
    const room = this.rows.room === undefined ? null : bindBorrowedMethod(owners, this.rows.room);
    this.count = item => v.parse(v.pipe(v.number(), v.finite()), count(item));
    this.owns = id => v.parse(v.boolean(), owns(id));
    this.room = (id, n) => room === null || v.parse(v.boolean(), room(id, n));
    const bind = (calls: ExchangeRows['goods'][number]['payments']) => calls.map(call => {
      const run = bindBorrowedMethod(owners, call);
      return () => { const result = run(...call.args); return call.required !== true || result !== false; };
    });
    this.payments = this.rows.goods.map(good => bind(good.payments));
    this.grants = this.rows.goods.map(good => bind(good.grants));
  }
  get active(): boolean { return this.opened; }
  open(): void { this.opened = true; }
  close(): void { this.opened = false; }
  check(index: number): { ok: boolean; owned: boolean; locked: boolean; full: boolean; missing: { item: string; n: number }[] } {
    const good = this.rows.goods[index];
    if (good === undefined) throw new RangeError('Unknown exchange good');
    const owned = good.owns !== undefined && this.owns(good.owns), locked = good.needs !== undefined && !this.owns(good.needs);
    const missing = good.costs.filter(cost => this.count(cost.item) < cost.n).map(cost => ({ item: cost.item, n: cost.n - this.count(cost.item) }));
    const full = good.capacity !== undefined && !this.room(good.capacity.item, good.capacity.n);
    return { ok: !owned && !locked && !full && missing.length === 0, owned, locked, full, missing };
  }
  state(index: number): ShopState {
    const check = this.check(index);
    return check.owned ? 'owned' : check.locked ? 'locked' : check.full ? 'full' : check.ok ? 'buy' : 'short';
  }
  cost(index: number): ShopCost[] {
    const good = this.rows.goods[index];
    if (good === undefined) throw new RangeError('Unknown exchange good');
    return good.costs.map(cost => { const have = this.count(cost.item); return { text: `${cost.text ?? cost.item} (${have})`, have: have >= cost.n }; });
  }
  use(index: number): boolean {
    if (index === -1) { this.close(); return false; }
    if (!this.opened || !Number.isInteger(index) || this.rows.goods[index] === undefined || !this.check(index).ok) return false;
    for (const pay of this.payments[index] ?? []) if (!pay()) return false;
    for (const grant of this.grants[index] ?? []) grant();
    return true;
  }
  snapshot(): { version: 1; open: boolean } { return { version: 1, open: this.opened }; }
  prepareRestore(value: unknown): () => void {
    const state = v.parse(saved, value);
    return () => { this.opened = state.open; };
  }
  restore(value: unknown): void { this.prepareRestore(value)(); }
}
