/**
 * Owned — what a shard's player has for good (E314, project/archive/2026-09-30-driftwood-loot.md): the trader's upgrades and cosmetics
 * (stage 2 writes them), the sea glass charms and the trophies (stage 3), the found iron sword (stage 1), and which
 * cosmetics are worn. Saved per shard in localStorage ('ws.owned.v1': { owned: id[], worn: id[] }). The Bag's GEAR and
 * FINDS tabs read it; nothing here applies an effect (the fights read `has()` when their stage lands).
 *
 *   const owned = new Owned(chunk.id);
 *   owned.has('whetstone-1')            // bought / found?
 *   owned.grant('whetstone-1')          // → true the first time (the shop's BUY, a trophy drop, the charm at 5 glass)
 *   owned.sharpen                       // 0 | 1 | 2 — whetstones owned (GEAR's sharpening pips)
 *   owned.hearts                        // 0 | 1 | 2 — sturdy hearts owned (max health 100 → 120 → 140, stage 2)
 *   owned.charms                        // 0…3 — sea glass charms strung (stage 3)
 *   owned.wear('cape') / owned.takeOff('cape') / owned.toggleWorn('captain-hat') / owned.worn('cape')
 *                                       // cosmetics only, and only once owned (a locked slot can't be worn)
 *   owned.onChange(() => menu.refresh()) // returns an unsubscribe
 *   owned.revoke(id)                    // dev / tests only (window.__loot): take it back (and off)
 *
 * ONE-FORMAT OF31f2 (Q37): which ids a shard keeps, their kind, label and Bag gauge come from that shard's own items
 * section (`kept` rows, `keptItems(items)`). `OWNED` is the old engine table, read only for a shard that declares no
 * kept rows; OF31f5 deletes it once Driftwood and Pine carry theirs. A saved id the shard's rows don't name is never
 * dropped: it stays in the save, unread, so a missing row costs a player nothing.
 */
import { ownedSave, saveSlug } from '../saves';

export type OwnedKind = 'upgrade' | 'cosmetic' | 'charm' | 'trophy' | 'gear';
/** The Bag's three pip rows a kept item can fill (GEAR's sharpening, sturdy hearts, the charms). */
export type KeptGauge = 'sharpen' | 'hearts' | 'charms';
/** One kept row, as the items section declares it (format `kept`). */
export interface KeptRow { readonly id: string; readonly kind: OwnedKind; readonly label: string; readonly gauge?: { readonly name: KeptGauge; readonly level: number } }
/** The old engine table: OF31f5 deletes it with the two shards' kept rows pinned. */
export const OWNED: { readonly 'whetstone-1': { readonly kind: "upgrade"; readonly label: "Whetstone I"; }; readonly 'whetstone-2': { readonly kind: "upgrade"; readonly label: "Whetstone II"; }; readonly 'heart-1': { readonly kind: "upgrade"; readonly label: "Sturdy heart I"; }; readonly 'heart-2': { readonly kind: "upgrade"; readonly label: "Sturdy heart II"; }; readonly 'sea-chart': { readonly kind: "upgrade"; readonly label: "Sea chart"; }; readonly cape: { readonly kind: "cosmetic"; readonly label: "Sailcloth cape"; }; readonly 'captain-hat': { readonly kind: "cosmetic"; readonly label: "Captain's hat"; }; // the Drowned Captain's trophy, worn from GEAR
readonly 'charm-1': { readonly kind: "charm"; readonly label: "Sea glass charm I"; }; readonly 'charm-2': { readonly kind: "charm"; readonly label: "Sea glass charm II"; }; readonly 'charm-3': { readonly kind: "charm"; readonly label: "Sea glass charm III"; }; readonly 'bear-claw': { readonly kind: "trophy"; readonly label: "Bear claw"; }; readonly 'boar-tusk': { readonly kind: "trophy"; readonly label: "Boar tusk"; }; readonly 'iron-sword': { readonly kind: "gear"; readonly label: "Iron sword"; }; // taken from the wreck's rack: kept between sessions
// Pine Hollow (E314 C, src/shards/pine-hollow/loadout/loadout.ts): kept here, never in a pack slot a full pack could refuse
readonly 'warden-longbow': { readonly kind: "gear"; readonly label: "The Warden's Longbow"; }; // the Antler King's reward
readonly 'lever-rifle': { readonly kind: "gear"; readonly label: "Lever-action"; }; } = {
  'whetstone-1': { kind: 'upgrade', label: 'Whetstone I' },
  'whetstone-2': { kind: 'upgrade', label: 'Whetstone II' },
  'heart-1': { kind: 'upgrade', label: 'Sturdy heart I' },
  'heart-2': { kind: 'upgrade', label: 'Sturdy heart II' },
  'sea-chart': { kind: 'upgrade', label: 'Sea chart' },
  'cape': { kind: 'cosmetic', label: 'Sailcloth cape' },
  'captain-hat': { kind: 'cosmetic', label: "Captain's hat" },   // the Drowned Captain's trophy, worn from GEAR
  'charm-1': { kind: 'charm', label: 'Sea glass charm I' },
  'charm-2': { kind: 'charm', label: 'Sea glass charm II' },
  'charm-3': { kind: 'charm', label: 'Sea glass charm III' },
  'bear-claw': { kind: 'trophy', label: 'Bear claw' },
  'boar-tusk': { kind: 'trophy', label: 'Boar tusk' },
  'iron-sword': { kind: 'gear', label: 'Iron sword' },        // taken from the wreck's rack: kept between sessions
  // Pine Hollow (E314 C, src/shards/pine-hollow/loadout/loadout.ts): kept here, never in a pack slot a full pack could refuse
  'warden-longbow': { kind: 'gear', label: "The Warden's Longbow" }, // the Antler King's reward
  'lever-rifle': { kind: 'gear', label: 'Lever-action' },      // the ranger's cabin's rifle
} as const satisfies Record<string, { kind: OwnedKind; label: string }>;
/** A kept item's id: any id its shard's kept rows name. */
export type OwnedId = string;
export type CosmeticId = string;

const LEGACY_GAUGES: Readonly<Record<string, { readonly name: KeptGauge; readonly level: number }>> = {
  'whetstone-1': { name: 'sharpen', level: 1 }, 'whetstone-2': { name: 'sharpen', level: 2 }, 'heart-1': { name: 'hearts', level: 1 },
  'heart-2': { name: 'hearts', level: 2 }, 'charm-1': { name: 'charms', level: 1 }, 'charm-2': { name: 'charms', level: 2 }, 'charm-3': { name: 'charms', level: 3 },
};
/** `OWNED` as kept rows, gauges included: what a shard with no kept rows reads until OF31f5. */
export const LEGACY_KEPT: readonly KeptRow[] = Object.entries(OWNED).map(([id, row]): KeptRow => {
  const gauge = LEGACY_GAUGES[id]; return gauge === undefined ? { id, kind: row.kind, label: row.label } : { id, kind: row.kind, label: row.label, gauge };
});

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
const LEGACY = new KeptItems(LEGACY_KEPT);
/** Where kept rows come from: a shard's items section (its `version` makes this no weak type, so a format from before
 *  `kept` still type-checks, P1 11-21), or bare rows. */
export type KeptSource = { readonly version: 1; readonly kept?: readonly KeptRow[] } | { readonly kept: readonly KeptRow[] };
/** A shard's kept items from its items section's `kept` rows, or the old `OWNED` table when it declares none (OF31f2). */
export function keptItems(items?: KeptSource | null): KeptItems {
  const kept = items?.kept;
  return kept === undefined ? LEGACY : new KeptItems(kept);
}
/** The old table's checks, for code with no shard in hand; OF31f5 deletes them. */
export const isOwnedId = (v: unknown): v is OwnedId => LEGACY.has(v);
export const isCosmetic = (id: unknown): id is CosmeticId => LEGACY.cosmetic(id);

export class Owned {
  private have = new Set<OwnedId>();
  private wearing = new Set<CosmeticId>();
  /** Saved ids this shard's kept rows don't name: never read, always written back (OF31f2). */
  private readonly retained: { readonly owned: readonly string[]; readonly worn: readonly string[] };
  private listeners: (() => void)[] = [];

  readonly shard: string;
  /** The page save or an injected continuation slot owns the same durable rows; `kept` is the shard's kept rows. */
  constructor(shard: string, private readonly save: Pick<typeof ownedSave, 'read' | 'write'> = ownedSave, readonly kept: KeptItems = keptItems()) {
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
  get all(): OwnedId[] { return [...this.have]; }

  /** true when it is new */
  grant(id: string): boolean {
    if (!this.kept.has(id)) throw new Error(`Unknown owned identity: ${id}`);
    if (this.have.has(id)) return false;
    this.have.add(id);
    this.changed();
    return true;
  }
  revoke(id: OwnedId): void {
    if (!this.have.has(id)) return;
    this.have.delete(id);
    if (this.kept.cosmetic(id)) this.wearing.delete(id);
    this.changed();
  }

  /** The Bag's gauges: the highest level owned among the kept rows that fill each one. */
  get sharpen(): number { return this.kept.level('sharpen', id => this.have.has(id)); }
  get hearts(): number { return this.kept.level('hearts', id => this.have.has(id)); }
  get charms(): number { return this.kept.level('charms', id => this.have.has(id)); }

  worn(id: CosmeticId): boolean { return this.wearing.has(id); }
  /** false when it is not owned yet */
  wear(id: CosmeticId): boolean {
    if (!this.have.has(id)) return false;
    if (!this.wearing.has(id)) { this.wearing.add(id); this.changed(); }
    return true;
  }
  takeOff(id: CosmeticId): void { if (this.wearing.delete(id)) this.changed(); }
  /** wear it / take it off; the new state (false for a locked one) */
  toggleWorn(id: CosmeticId): boolean {
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
