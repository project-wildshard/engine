// SHARD-AUTHORING SA48 (meta SHARD-AUTHORING-PLAN): a placed slug's spawn rows, learnt at runtime from the cook's index
// (`grid/placedContent.ts`), for a shard uploaded after this page's build. A bake writes the same rows into the boot bank and the packs
// book (`addCookedShards`); a page that never saw the shard reads them here instead. A leaf: the title's placement read writes it and
// the spawn download reads it, with no import of either.
import type { SpawnManifestAddress } from '../../../shared/game/shardfile/spawnManifest';
import { cookedMapPath, type CookedMapSize } from '../../../shared/game/shardfile/cookedMapPath';

type Tiers = Readonly<Partial<Record<'phone' | 'desktop', SpawnManifestAddress>>>;
export interface PlacedSpawn {
  /** The product's slug, as the cook names it (no grid `_`). */
  readonly slug: string;
  /** The default book's rows (`spawnManifests.client`), which a grid entry also reads: no build has a grid manifest for it. */
  readonly entry: Tiers;
  /** The packs book's whole-level rows. */
  readonly whole: Tiers;
  /** The store's root, where its manifests and parts are (a J138 home). */
  readonly base: string;
  /** This upload's loose files (its header, programs, its mounts' loose rows) in the store (`loose/<hash>/`): the slug's own keys are
   *  whichever upload the cook last cooked, which may be another channel's. */
  readonly loose: string;
  /** Whether the cook published its recorded entry programs. */
  readonly programs: boolean;
  /** J450: whether the cook drew this upload's map (`cookedMapPath`, both sizes, under `loose`); an index from before J450 has none. */
  readonly maps?: boolean;
  /** The page paths this upload's loose folder holds (the cook index's `keys`). v0.1.75 K4 (staging, Pine r12 baked, its rooms on
   *  r13): r13's manifests list 1,809 content-named blobs its folder does not hold, the ones r12 already had, which the build serves
   *  itself; read from the folder they 404ed and the world never downloaded. Absent (an older row): every path is the folder's. */
  readonly listed?: ReadonlySet<string>;
}
const placed = new Map<string, PlacedSpawn>();
const bare = (slug: string): string => slug.replace(/^_/u, '');
export function installPlacedSpawn(row: PlacedSpawn): void { placed.set(bare(row.slug), row); }
/** A placed slug's rows, by its grid slug or its product's; undefined for every slug the build has. */
export function placedSpawn(slug: string): PlacedSpawn | undefined { return placed.get(bare(slug)); }
/** SHARD-COMPAT NB2 (J494, Jake 2026-11-22: "the page should always run the server revision"): a slug this build baked whose rooms
 *  run other bytes (the signed placement file's hash), until the page installs the rooms' own copy (`placedCells.ts`). P1: staging's
 *  rooms ran Driftwood r9 while the page drew its baked r8 and every enemy was invisible. Entering it refuses with Reload instead. */
const behind = new Map<string, string>(), rechecks = new Map<string, () => Promise<boolean>>();
/** `recheck` (QA 11-25 row 35): asks again whether the page can load those bytes now (the cook's index is written), for the
 *  updating card (`roomsAhead.ts`). */
export function markBehindRooms(slug: string, hash: string, recheck?: () => Promise<boolean>): void {
  behind.set(bare(slug), hash);
  if (recheck === undefined) rechecks.delete(bare(slug)); else rechecks.set(bare(slug), recheck);
}
export function clearBehindRooms(slug: string): void { behind.delete(bare(slug)); rechecks.delete(bare(slug)); }
/** How the updating card asks again for `slug`; undefined when the mark gave none. */
export function behindRecheck(slug: string): (() => Promise<boolean>) | undefined { return rechecks.get(bare(slug)); }
/** The hash the rooms run for `slug` when this page could not load it; undefined when the page runs what the rooms run. */
export function behindRooms(slug: string): string | undefined { return behind.get(bare(slug)); }
export function clearPlacedSpawns(): void { placed.clear(); behind.clear(); rechecks.clear(); }
const LOOSE_PATH = /^\/(?:shardfiles\/([a-z0-9_-]+)\/|programs\/([a-z0-9_-]+)\.json$)/u;
/** A content-named file (`…/blobs/<kind>/<sha256>.<ext>`): the same bytes wherever it is served. */
const NAMED_BLOB = /\/blobs\/[a-z0-9]+\/[a-f0-9]{64}\.[a-z0-9]+$/u;
/** Where a placed slug's loose file is read, by its page path (`/shardfiles/<slug>/…`, `/programs/<slug>.json`): this upload's own copy.
 *  Undefined for every other path, and for every slug the build has. */
export function placedLoose(pathname: string, search = ''): string | undefined {
  const owner = looseSlug(pathname), row = owner === undefined ? undefined : placed.get(owner);
  if (row === undefined) return undefined;
  // a content-named blob the upload's folder does not hold is the build's own copy of the same bytes
  if (row.listed !== undefined && !row.listed.has(pathname) && NAMED_BLOB.test(pathname)) return undefined;
  return new URL(`.${pathname}${search}`, row.loose).href;
}
/** J450: the cook's map of a placed slug at `size`, at its upload's loose copy; undefined for a slug the cook drew none for, and
 *  for every slug the build has (its atlas tile covers it). */
export function placedCookedMap(slug: string, size: CookedMapSize): string | undefined {
  const row = placed.get(bare(slug));
  return row?.maps === true ? placedLoose(`/${cookedMapPath(row.slug, size)}`) : undefined;
}
/** The local author server stamps the slug only after its two map images are ready. */
export function devCookedMap(slug: string, size: CookedMapSize, stamp: unknown): string | undefined {
  return stamp === bare(slug) ? `/${cookedMapPath(slug, size)}` : undefined;
}
/** The bare slug a loose page path (`/shardfiles/<slug>/…`, `/programs/<slug>.json`) belongs to; undefined for any other path. */
export function looseSlug(pathname: string): string | undefined {
  const match = LOOSE_PATH.exec(pathname), named = match?.[1] ?? match?.[2];
  return named === undefined ? undefined : bare(named);
}
