/**
 * Purse — a shard's doubloons (E314 L1, project/archive/2026-09-30-driftwood-loot.md): Driftwood's one currency. Coins come only from
 * kills (src/client/game/loot/coins.ts); stage 2's trader spends them. Saved per shard in localStorage ('ws.purse.v1'), the
 * Inventory pattern. Whole coins only; never below 0.
 *
 *   const purse = new Purse(chunk.id);
 *   purse.add(2);                 // coins in, saved at once
 *   purse.add(2, false)           // a coin of a burst landed: counted and told, not written (a captain = 12 landings)
 *   purse.flush()                 // write what is unsaved — the burst's end (CoinBurst onDone), pagehide, a hidden tab
 *   purse.spend(15)               // → false, nothing taken, when there are fewer (saved at once)
 *   purse.coins                   // the total (the HUD chip, GEAR)
 *   purse.onChange((n, delta) => chip.set(n))   // returns an unsubscribe
 */
import { purseSave, saveSlug } from '../saves';
import * as schema from 'valibot';
import type { Scope } from '@wildshard/engine/app/scope';

const entered = new WeakMap<Scope, Purse>();
/** Publish the loot mechanism's actual purse; a quest shop never creates another save owner. */
export function publishPurse(scope: Scope, purse: Purse): () => void {
  if (scope.disposed || entered.has(scope)) throw new Error('Purse already entered or disposed');
  const release = (): void => { if (entered.get(scope) === purse) entered.delete(scope); };
  entered.set(scope, purse); scope.onDispose(release); return release;
}
export function enteredPurse(scope: Scope): Purse {
  const purse = entered.get(scope); if (scope.disposed || purse === undefined) throw new Error('Missing entered purse'); return purse;
}

export class Purse {
  private n: number;
  private dirty = false;
  private listeners: ((coins: number, delta: number) => void)[] = [];

  /** The default game save or an injected local slot owns durable coin storage. */
  constructor(readonly shard: string, private readonly save: Pick<typeof purseSave, 'read' | 'write'> = purseSave) {
    const saved = this.save.read(saveSlug(shard));
    this.n = typeof saved === 'number' && Number.isFinite(saved) && saved > 0 ? Math.floor(saved) : 0;
  }

  /** The current balance and its pending durable write; no callback or save runs. */
  snapshot(): { coins: number; unsaved: boolean } { return { coins: this.n, unsaved: this.dirty }; }
  /** Rehydrate the same continuation silently; earned changes still use add/spend. */
  restore(input: unknown): void {
    const saved = schema.parse(schema.strictObject({ coins: schema.pipe(schema.number(), schema.finite(), schema.integer(), schema.minValue(0)), unsaved: schema.boolean() }), input);
    this.n = saved.coins; this.dirty = saved.unsaved;
  }

  /** Take the balance from who owns it (J130): it tells who listens and writes nothing. */
  mirror(coins: number): void {
    const delta = coins - this.n;
    if (delta === 0) return;
    this.n = coins; this.dirty = false;
    for (const listener of this.listeners.slice()) listener(coins, delta);
  }
  get coins(): number { return this.n; }
  /** coins counted but not written yet */
  get unsaved(): boolean { return this.dirty; }

  add(n: number, save = true): void {
    const k = Math.floor(n);
    if (!(k > 0)) return;
    this.set(this.n + k, save);
  }

  /** take `n` coins; false (nothing taken) when the purse holds fewer */
  spend(n: number): boolean {
    const k = Math.floor(n);
    if (k <= 0) return true;
    if (this.n < k) return false;
    this.set(this.n - k, true);
    return true;
  }

  /** Confirm durable storage; failed writes keep the current balance dirty for retry. */
  flush(): boolean {
    if (!this.dirty) return true;
    if (!this.save.write(this.n, saveSlug(this.shard))) return false;
    this.dirty = false;
    return true;
  }

  onChange(fn: (coins: number, delta: number) => void): () => void {
    this.listeners.push(fn);
    return () => { const i = this.listeners.indexOf(fn); if (i !== -1) this.listeners.splice(i, 1); };
  }

  private set(v: number, save: boolean): void {
    const delta = v - this.n;
    this.n = v;
    this.dirty = true;
    if (save) this.flush();
    for (const l of this.listeners) l(v, delta);
  }
}
