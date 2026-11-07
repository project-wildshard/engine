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
 * Every id is typed (OwnedId); `OWNED` says what kind each is and how GEAR / FINDS label it.
 */
import { ownedSave, saveSlug } from '../saves';

export type OwnedKind = 'upgrade' | 'cosmetic' | 'charm' | 'trophy' | 'gear';
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
export type OwnedId = keyof typeof OWNED;
export type CosmeticId = { [K in OwnedId]: (typeof OWNED)[K]['kind'] extends 'cosmetic' ? K : never }[OwnedId];

export const isOwnedId = (v: unknown): v is OwnedId => typeof v === 'string' && Object.hasOwn(OWNED, v);
export const isCosmetic = (id: OwnedId): id is CosmeticId => OWNED[id].kind === 'cosmetic';

export class Owned {
  private have = new Set<OwnedId>();
  private wearing = new Set<CosmeticId>();
  private listeners: (() => void)[] = [];

  readonly shard: string;
  /** The page save or an injected continuation slot owns the same durable rows. */
  constructor(shard: string, private readonly save: Pick<typeof ownedSave, 'read' | 'write'> = ownedSave) {
    this.shard = shard;
    const saved = this.save.read(saveSlug(shard));
    const { owned, worn } = saved as { owned?: unknown; worn?: unknown };
    if (Array.isArray(owned)) for (const id of owned) if (isOwnedId(id)) this.have.add(id);
    if (Array.isArray(worn)) for (const id of worn) if (isOwnedId(id) && isCosmetic(id) && this.have.has(id)) this.wearing.add(id);
  }

  /** Row-authored identity reads return false for an unregistered or unowned item. */
  has(id: string): boolean { return isOwnedId(id) && this.have.has(id); }
  get all(): OwnedId[] { return [...this.have]; }

  /** true when it is new */
  grant(id: string): boolean {
    if (!isOwnedId(id)) throw new Error(`Unknown owned identity: ${id}`);
    if (this.have.has(id)) return false;
    this.have.add(id);
    this.changed();
    return true;
  }
  revoke(id: OwnedId): void {
    if (!this.have.has(id)) return;
    this.have.delete(id);
    if (isCosmetic(id)) this.wearing.delete(id);
    this.changed();
  }

  get sharpen(): 0 | 1 | 2 { return this.has('whetstone-2') ? 2 : this.has('whetstone-1') ? 1 : 0; }
  get hearts(): 0 | 1 | 2 { return this.has('heart-2') ? 2 : this.has('heart-1') ? 1 : 0; }
  get charms(): number { return (['charm-1', 'charm-2', 'charm-3'] as const).filter((c) => this.have.has(c)).length; }

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
    this.save.write({ owned: [...this.have], worn: [...this.wearing] }, saveSlug(this.shard));
    for (const l of this.listeners) l();
  }
}
