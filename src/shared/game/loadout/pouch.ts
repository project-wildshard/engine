/** Parked stacks for a native quiver. The selected stack stays live in the weapon;
 * selection stashes it before returning the next stack. Content supplies kinds,
 * fallback and capacity, so another shard can use unrelated ammunition names. */
export interface AmmoPouchRows<K extends string> {
  readonly kinds: readonly K[];
  readonly fallback: K;
  readonly capacity: number;
}

/** One selected live stack plus bounded parked stacks; no save or input service is installed. */
export class AmmoPouch<K extends string> {
  readonly counts: Record<K, number>;
  selected: K;
  constructor(readonly rows: AmmoPouchRows<K>, start: Partial<Record<K, number>> = {}) {
    if (rows.kinds.length === 0 || new Set(rows.kinds).size !== rows.kinds.length || !rows.kinds.includes(rows.fallback)
      || !Number.isSafeInteger(rows.capacity) || rows.capacity < 0) throw new Error('Invalid ammunition pouch rows');
    this.selected = rows.fallback;
    this.counts = Object.fromEntries(rows.kinds.map(kind => [kind, kind === rows.fallback ? rows.capacity : 0])) as Record<K, number>;
    for (const kind of rows.kinds) { const value = start[kind]; if (value !== undefined) this.counts[kind] = this.clamp(value); }
  }
  private clamp(n: number): number { return Math.max(0, Math.min(this.rows.capacity, Math.round(n))); }
  /** Copy the selected weapon's live count before a swap or save. */
  stash(live: number): void { this.counts[this.selected] = this.clamp(live); }
  /** An empty special stack refuses; the fallback is always selectable. */
  select(kind: K, live: number): number | null {
    if (!this.rows.kinds.includes(kind)) throw new Error(`Unknown ammunition kind: ${kind}`);
    this.stash(live);
    if (kind === this.selected || (kind !== this.rows.fallback && this.counts[kind] <= 0)) return null;
    this.selected = kind; return this.counts[kind];
  }
  /** Cycle in authored order, skipping empty special stacks. */
  next(): K {
    const at = this.rows.kinds.indexOf(this.selected);
    for (let step = 1; step <= this.rows.kinds.length; step++) {
      const kind = this.rows.kinds[(at + step) % this.rows.kinds.length] ?? this.rows.fallback;
      if (kind === this.rows.fallback || this.counts[kind] > 0) return kind;
    }
    return this.rows.fallback;
  }
  /** Select the next stack while retaining the previous live count. */
  cycle(live: number): number | null { this.stash(live); return this.select(this.next(), this.counts[this.selected]); }
  /** The selected stack is updated by the caller's native weapon API. */
  add(kind: K, n: number): void { if (kind !== this.selected) this.counts[kind] = this.clamp(this.counts[kind] + n); }
  /** Read a parked stack or the selected weapon's live count. */
  count(kind: K, live: number): number { return kind === this.selected ? live : this.counts[kind]; }
}
