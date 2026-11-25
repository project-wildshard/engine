/**
 * Owned — what a shard's player has for good (E314, project/archive/2026-09-30-driftwood-loot.md): the trader's upgrades and cosmetics
 * (stage 2 writes them), the sea glass charms and the trophies (stage 3), the found iron sword (stage 1), and which
 * cosmetics are worn. Saved per shard in localStorage ('ws.owned.v1': { owned: id[], worn: id[] }). The Bag's GEAR and
 * FINDS tabs read it; nothing here applies an effect (the fights read `has()` when their stage lands).
 *
 *   const owned = new Owned(chunk.id, ownedSave, keptItems(shardfile.items));
 *   owned.has(id)                       // bought / found?
 *   owned.grant(id)                     // → true the first time (the shop's BUY, a trophy drop, the charm at 5 glass)
 *   owned.sharpen                       // the highest `sharpen` gauge level owned (GEAR's sharpening pips)
 *   owned.hearts                        // the highest `hearts` gauge level owned (max health, stage 2)
 *   owned.charms                        // the highest `charms` gauge level owned (stage 3)
 *   owned.wear(id) / owned.takeOff(id) / owned.toggleWorn(id) / owned.worn(id)
 *                                       // cosmetics only, and only once owned (a locked slot can't be worn)
 *   owned.onChange(() => menu.refresh()) // returns an unsubscribe
 *   owned.revoke(id)                    // dev / tests only (window.__loot): take it back (and off)
 *
 * ONE-FORMAT OF31f2 (Q37): which ids a shard keeps, their kind, label and Bag gauge come from that shard's own items
 * section (`kept` rows, `keptItems(items)`); a shard that declares none keeps nothing (OF31f5 deleted the old engine
 * table once Driftwood r9 and Pine r11 carried theirs). A saved id the shard's rows don't name is never dropped: it stays
 * in the save, unread, so a missing row costs a player nothing.
 */
import { ownedSave, saveSlug } from '../saves';

export type OwnedKind = 'upgrade' | 'cosmetic' | 'charm' | 'trophy' | 'gear';
/** The Bag's three pip rows a kept item can fill (GEAR's sharpening, sturdy hearts, the charms). */
export type KeptGauge = 'sharpen' | 'hearts' | 'charms';
/** One kept row, as the items section declares it (format `kept`). */
export interface KeptRow { readonly id: string; readonly kind: OwnedKind; readonly label: string; readonly gauge?: { readonly name: KeptGauge; readonly level: number } }

/** One shard's kept items: which ids it keeps, how each is labelled, which are worn looks and which fill a Bag gauge. */
export class KeptItems {
  private readonly rows: ReadonlyMap<string, KeptRow>;
  constructor(rows: readonly KeptRow[]) {
    this.rows = new Map(rows.map(row => [row.id, row]));
    if (this.rows.size !== rows.length) throw new Error('Kept item ids must be unique');
  }
  has(id: unknown): boolean { return typeof id === 'string' && this.rows.has(id); }
  cosmetic(id: unknown): boolean { return typeof id === 'string' && this.rows.get(id)?.kind === 'cosmetic'; }
  label(id: string): string { const row = this.rows.get(id); if (row === undefined) throw new Error(`Unknown kept item: ${id}`); return row.label; }
  get ids(): readonly string[] { return [...this.rows.keys()]; }
  /** The highest level of `gauge` among the ids `owns` says are held (0 for none). */
  level(gauge: KeptGauge, owns: (id: string) => boolean): number {
    let level = 0;
    for (const row of this.rows.values()) if (row.gauge?.name === gauge && row.gauge.level > level && owns(row.id)) level = row.gauge.level;
    return level;
  }
}
const NONE = new KeptItems([]);
/**
 * SHARD-COMPAT CP16: the kept rows a shard written before items carried `kept` (OF31f3) kept: the old engine table OF31f5
 * deleted. Kept originals Driftwood r4 (prod's head) to r8 and Pine r5 to r10 declare no kept rows yet name these ids (their
 * loadout effects, shop, progression rewards and trophies), so a room refused Driftwood r4 ("Unknown progression reward
 * charm-1"). A shard with no kept rows whose items section names one of its goods (not a trophy) keeps the whole table, as it did when
 * stored; one naming none keeps nothing.
 */
const gauge = (name: KeptGauge, level: number) => ({ gauge: { name, level } });
const STORED_KEPT = new KeptItems([
  { id: 'whetstone-1', kind: 'upgrade', label: 'Whetstone I', ...gauge('sharpen', 1) },
  { id: 'whetstone-2', kind: 'upgrade', label: 'Whetstone II', ...gauge('sharpen', 2) },
  { id: 'heart-1', kind: 'upgrade', label: 'Sturdy heart I', ...gauge('hearts', 1) },
  { id: 'heart-2', kind: 'upgrade', label: 'Sturdy heart II', ...gauge('hearts', 2) },
  { id: 'sea-chart', kind: 'upgrade', label: 'Sea chart' },
  { id: 'cape', kind: 'cosmetic', label: 'Sailcloth cape' },
  { id: 'captain-hat', kind: 'cosmetic', label: "Captain's hat" },
  { id: 'charm-1', kind: 'charm', label: 'Sea glass charm I', ...gauge('charms', 1) },
  { id: 'charm-2', kind: 'charm', label: 'Sea glass charm II', ...gauge('charms', 2) },
  { id: 'charm-3', kind: 'charm', label: 'Sea glass charm III', ...gauge('charms', 3) },
  { id: 'bear-claw', kind: 'trophy', label: 'Bear claw' },
  { id: 'boar-tusk', kind: 'trophy', label: 'Boar tusk' },
  { id: 'iron-sword', kind: 'gear', label: 'Iron sword' },
  { id: 'warden-longbow', kind: 'gear', label: "The Warden's Longbow" },
  { id: 'lever-rifle', kind: 'gear', label: 'Lever-action' },
]);
/** The trophies are ordinary drop ids too (Mossgate's boar tusk), so only the table's own goods mark a stored shard. */
const TROPHIES = new Set(['bear-claw', 'boar-tusk']);
/** Whether `value` holds, anywhere, a string that is one of the stored table's goods. */
function namesStoredKept(value: unknown, depth = 0): boolean {
  if (typeof value === 'string') return STORED_KEPT.has(value) && !TROPHIES.has(value);
  if (depth > 32 || typeof value !== 'object' || value === null) return false;
  return (Array.isArray(value) ? value : Object.values(value)).some(entry => namesStoredKept(entry, depth + 1));
}
const storedKeptOf = new WeakMap<object, KeptItems>();
/** Where kept rows come from: a shard's items section (its `version` makes this no weak type, so a format from before
 *  `kept` still type-checks, P1 11-21), or bare rows. */
export type KeptSource = { readonly version: 1; readonly kept?: readonly KeptRow[] } | { readonly kept: readonly KeptRow[] };
/** A shard's kept items from its items section's `kept` rows; none when it declares none (OF31f5), but a kept original's
 *  stored table when its items name those ids (CP16). */
export function keptItems(items?: KeptSource | null): KeptItems {
  const kept = items?.kept;
  if (kept !== undefined) return new KeptItems(kept);
  if (items === undefined || items === null) return NONE;
  let held = storedKeptOf.get(items);
  if (held === undefined) { held = namesStoredKept(items) ? STORED_KEPT : NONE; storedKeptOf.set(items, held); }
  return held;
}

export class Owned {
  private have = new Set<string>();
  private wearing = new Set<string>();
  /** Saved ids this shard's kept rows don't name: never read, always written back (OF31f2). */
  private readonly retained: { readonly owned: readonly string[]; readonly worn: readonly string[] };
  private listeners: (() => void)[] = [];

  readonly shard: string;
  /** The page save or an injected continuation slot owns the same durable rows; `kept` is the shard's kept rows. */
  private readonly save: Pick<typeof ownedSave, 'read' | 'write'>;
  readonly kept: KeptItems;
  constructor(shard: string, save: Pick<typeof ownedSave, 'read' | 'write'> = ownedSave, kept: KeptItems = keptItems()) {
    this.save = save; this.kept = kept;
    this.shard = shard;
    const saved = this.save.read(saveSlug(shard));
    const { owned, worn } = saved as { owned?: unknown; worn?: unknown };
    const keptOwned: string[] = [], keptWorn: string[] = [];
    const ids = (list: unknown): string[] => Array.isArray(list) ? list.filter((id: unknown): id is string => typeof id === 'string') : [];
    for (const id of ids(owned)) { if (kept.has(id)) this.have.add(id); else if (!keptOwned.includes(id)) keptOwned.push(id); }
    for (const id of ids(worn)) { if (kept.cosmetic(id) && this.have.has(id)) this.wearing.add(id); else if (!kept.has(id) && !keptWorn.includes(id)) keptWorn.push(id); }
    this.retained = { owned: keptOwned, worn: keptWorn };
  }

  /** Row-authored identity reads return false for an unregistered or unowned item. */
  has(id: string): boolean { return this.kept.has(id) && this.have.has(id); }
  get all(): string[] { return [...this.have]; }

  /** true when it is new */
  grant(id: string): boolean {
    if (!this.kept.has(id)) throw new Error(`Unknown owned identity: ${id}`);
    if (this.have.has(id)) return false;
    this.have.add(id);
    this.changed();
    return true;
  }
  revoke(id: string): void {
    if (!this.have.has(id)) return;
    this.have.delete(id);
    if (this.kept.cosmetic(id)) this.wearing.delete(id);
    this.changed();
  }

  /** The Bag's gauges: the highest level owned among the kept rows that fill each one. */
  get sharpen(): number { return this.kept.level('sharpen', id => this.have.has(id)); }
  get hearts(): number { return this.kept.level('hearts', id => this.have.has(id)); }
  get charms(): number { return this.kept.level('charms', id => this.have.has(id)); }

  worn(id: string): boolean { return this.wearing.has(id); }
  /** false when it is not owned yet */
  wear(id: string): boolean {
    if (!this.have.has(id)) return false;
    if (!this.wearing.has(id)) { this.wearing.add(id); this.changed(); }
    return true;
  }
  takeOff(id: string): void { if (this.wearing.delete(id)) this.changed(); }
  /** wear it / take it off; the new state (false for a locked one) */
  toggleWorn(id: string): boolean {
    if (this.wearing.has(id)) { this.takeOff(id); return false; }
    return this.wear(id);
  }

  onChange(fn: () => void): () => void {
    this.listeners.push(fn);
    return () => { const i = this.listeners.indexOf(fn); if (i !== -1) this.listeners.splice(i, 1); };
  }

  private changed(): void {
    this.save.write({ owned: [...this.have, ...this.retained.owned], worn: [...this.wearing, ...this.retained.worn] }, saveSlug(this.shard));
    for (const l of this.listeners) l();
  }
}
