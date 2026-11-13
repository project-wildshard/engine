// SHARD-AUTHORING SA48 (meta SHARD-AUTHORING-PLAN): a placed slug's spawn rows, learnt at runtime from the cook's index
// (`grid/placedContent.ts`), for a shard uploaded after this page's build. A bake writes the same rows into the boot bank and the packs
// book (`addCookedShards`); a page that never saw the shard reads them here instead. A leaf: the title's placement read writes it and
// the spawn download reads it, with no import of either.
import type { SpawnManifestAddress } from '../../../shared/game/shardfile/spawnManifest';

type Tiers = Readonly<Partial<Record<'phone' | 'desktop', SpawnManifestAddress>>>;
export interface PlacedSpawn {
  /** The product's slug, as the cook names it (no grid `_`). */
  readonly slug: string;
  /** The default book's rows (`spawnManifests.client`), which a grid entry also reads: no build has a grid manifest for it. */
  readonly entry: Tiers;
  /** The packs book's whole-level rows. */
  readonly whole: Tiers;
  /** The store's root, where its manifests, parts and header are (a J138 home). */
  readonly base: string;
  /** Whether the cook published its recorded entry programs. */
  readonly programs: boolean;
}
const placed = new Map<string, PlacedSpawn>();
const bare = (slug: string): string => slug.replace(/^_/u, '');
export function installPlacedSpawn(row: PlacedSpawn): void { placed.set(bare(row.slug), row); }
/** A placed slug's rows, by its grid slug or its product's; undefined for every slug the build has. */
export function placedSpawn(slug: string): PlacedSpawn | undefined { return placed.get(bare(slug)); }
export function clearPlacedSpawns(): void { placed.clear(); }
