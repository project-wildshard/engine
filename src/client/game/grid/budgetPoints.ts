/**
 * The points budget (SHARD-PLATFORM SF38, G30): one cost score per tile, per shard and for the crossroads, read from the
 * one residency allocator (`allocator.ts`, SF18b / G144) on the SF22a cost model (§3.2). Points are the percentage of a
 * budget: green below {@link AMBER_AT}, amber up to {@link RED_AT}, red above it. G556 (Jake, 2026-10-21): the playing
 * and loading limits (1.2 / 1.8 GB) are per shard, so each shard alone is scored against them ({@link ShardLimit}); the
 * page total is information only, with no cap. A shard's category budget warns, and a shard may trade one category
 * against another, so it scores its whole accounted sum against the sum of its categories' budgets.
 *
 * Budgets, all from `CONTENT_CAPS` (§3.2 caps v1): a tile against its level's resident cap (L0 4 MB, L1 2 MB, far proxy
 * 1.6 MB); a shard against one of four shards at a crossroads (library 25 MB + sim 25 MB + its far proxy + a quarter of
 * the L0 disc and the L1 ring); each shard alone against the playing and loading limits. The road (`platform` render
 * claims) is its own category with no byte budget (it warns on triangles and draws instead, G101).
 *
 * Node-safe and pure: no DOM, no timers; the overlay (`budgetOverlay.ts`) and its tests read the same numbers.
 */
import { CONTENT_CAPS } from '@wildshard/engine/core/config';
import type { ContentCostInput } from '@wildshard/format/contentCost';
import { shardCost, type ResidencyAllocator, type ResidencyEntry } from '../../../shared/game/grid/allocator';

/** At or above this many points a score turns amber. */
export const AMBER_AT = 80;
/** Above this many points (over budget) a score turns red. */
export const RED_AT = 100;
export type PointsTone = 'green' | 'amber' | 'red';
/** The overlay's byte categories: the allocator's, with the platform's render claims split out as `road`. */
export const BUDGET_CATEGORIES = ['library', 'l0', 'l1', 'sim', 'road', 'far', 'commons', 'product'] as const;
export type BudgetCategory = (typeof BUDGET_CATEGORIES)[number];
export type BudgetBytes = Readonly<Record<BudgetCategory, number>>;
/** The owner the allocator gives page-wide claims (the road, the commons). */
export const PLATFORM_OWNER = 'platform';

/** One resident render tile or far proxy and its score against its level's resident cap. */
export interface BudgetTile {
  readonly id: string; readonly owner: string; readonly level: 'l0' | 'l1' | 'far';
  readonly bytes: number; readonly budget: number; readonly points: number; readonly tone: PointsTone;
}
/** G556: one shard alone on the cost model (the engine base, the page's shared renderer components, its own accounted
 * bytes at the resident factor and the decode overlap) against its own playing and loading limits. */
export interface ShardLimit {
  readonly playing: number; readonly playingCap: number; readonly playingPoints: number;
  readonly loading: number; readonly loadingCap: number; readonly loadingPoints: number;
  readonly tone: PointsTone;
}
/** One owner's (a cell instance's, or the platform's) bytes and score. */
export interface BudgetShard {
  readonly owner: string; readonly name: string;
  readonly bytes: BudgetBytes; readonly total: number;
  /** null for a page-wide owner (the platform): the road has no byte budget */
  readonly budget: number | null; readonly points: number | null; readonly tone: PointsTone | null;
  /** null for a page-wide owner */
  readonly limit: ShardLimit | null;
  readonly tiles: { readonly count: number; readonly green: number; readonly amber: number; readonly red: number; readonly worst: number };
  /** the shard's reviewed standalone measurement (WebContent + GL, MB), when it has one */
  readonly measuredMB: number | null;
}
/** The whole assembled neighbourhood: information only, no cap (G556). */
export interface BudgetCrossroads {
  readonly bytes: BudgetBytes; readonly accounted: number;
  readonly engineBase: number; readonly overlap: number; readonly residentFactor: number;
  readonly playing: number; readonly loading: number;
}
export interface BudgetPoints {
  readonly crossroads: BudgetCrossroads;
  /** heaviest first; owners with no byte budget (the platform) last */
  readonly shards: readonly BudgetShard[];
  /** heaviest score first, ties by id */
  readonly tiles: readonly BudgetTile[];
}
/** What the points read: the allocator's table and its `cost()`, plus optional names and receipts per owner. */
export interface BudgetPointsInput {
  readonly entries: readonly ResidencyEntry[];
  readonly cost: { readonly playing: number; readonly loading: number; readonly accounted: number; readonly input: ContentCostInput };
  readonly name?: (owner: string) => string;
  readonly measuredMB?: (owner: string) => number | null;
  /** whether an owner is a shard (scored against {@link SHARD_BUDGET}); default: every owner but the platform. Page-wide owners (the road, the platform's sims and products) have no byte budget. */
  readonly shard?: (owner: string) => boolean;
}

/** Whole points (a percentage of the budget), rounded half up. */
export function points(bytes: number, budget: number): number { return budget <= 0 ? 0 : Math.round((bytes / budget) * 100); }
export function tone(score: number): PointsTone { return score > RED_AT ? 'red' : score >= AMBER_AT ? 'amber' : 'green'; }

const TILE_CAP = { l0: CONTENT_CAPS.l0.resident, l1: CONTENT_CAPS.l1.resident, far: CONTENT_CAPS.far.resident } as const;
/** One of four shards at a crossroads: its library, its sim, its far proxy and a quarter of the L0 disc and L1 ring. */
export const SHARD_BUDGET: number = CONTENT_CAPS.library.resident + CONTENT_CAPS.sim.resident + CONTENT_CAPS.far.resident
  + (CONTENT_CAPS.l0Count / CONTENT_CAPS.simCount) * CONTENT_CAPS.l0.resident + (CONTENT_CAPS.l1Count / CONTENT_CAPS.simCount) * CONTENT_CAPS.l1.resident;

/** One shard alone against its own limits, on the page's engine base, shared renderer components and overlap. */
export function shardLimit(accounted: number, page: ContentCostInput): ShardLimit {
  const { playing, loading } = shardCost(accounted, page);
  const playingPoints = points(playing, CONTENT_CAPS.playing), loadingPoints = points(loading, CONTENT_CAPS.loading);
  return { playing, playingCap: CONTENT_CAPS.playing, playingPoints, loading, loadingCap: CONTENT_CAPS.loading, loadingPoints, tone: tone(Math.max(playingPoints, loadingPoints)) };
}

const zero = (): Record<BudgetCategory, number> => ({ library: 0, l0: 0, l1: 0, sim: 0, road: 0, far: 0, commons: 0, product: 0 });
function categoryOf(entry: ResidencyEntry): BudgetCategory {
  if (entry.category === 'page') return 'commons';
  if (entry.category === 'near') return 'far'; // G342: the near placeholders score with the far proxies they stand in for
  return entry.owner === PLATFORM_OWNER && (entry.category === 'l0' || entry.category === 'l1') ? 'road' : entry.category;
}

/** Score the allocator's table. Every byte lands in exactly one owner and one category, so the sums equal `cost().accounted`. */
export function budgetPoints(input: BudgetPointsInput): BudgetPoints {
  const byOwner = new Map<string, Record<BudgetCategory, number>>(), crossroads = zero(), tiles: BudgetTile[] = [];
  const isShard = input.shard ?? ((owner: string): boolean => owner !== PLATFORM_OWNER);
  for (const entry of input.entries) {
    const category = categoryOf(entry);
    let owned = byOwner.get(entry.owner);
    if (owned === undefined) { owned = zero(); byOwner.set(entry.owner, owned); }
    owned[category] += entry.accountedBytes; crossroads[category] += entry.accountedBytes;
    if (category === 'l0' || category === 'l1' || category === 'far') {
      const budget = TILE_CAP[category], score = points(entry.bytes, budget);
      tiles.push({ id: entry.id, owner: entry.owner, level: category, bytes: entry.bytes, budget, points: score, tone: tone(score) });
    }
  }
  tiles.sort((a, b) => b.points - a.points || a.id.localeCompare(b.id));
  const shards = [...byOwner].map(([owner, bytes]): BudgetShard => {
    const total = BUDGET_CATEGORIES.reduce((sum, category) => sum + bytes[category], 0);
    const own = tiles.filter((tile) => tile.owner === owner);
    const tileScores = { count: own.length, green: own.filter((t) => t.tone === 'green').length, amber: own.filter((t) => t.tone === 'amber').length,
      red: own.filter((t) => t.tone === 'red').length, worst: own.reduce((worst, t) => Math.max(worst, t.points), 0) };
    const platform = !isShard(owner), score = platform ? null : points(total, SHARD_BUDGET);
    return { owner, name: input.name?.(owner) ?? owner, bytes: Object.freeze(bytes), total,
      budget: platform ? null : SHARD_BUDGET, points: score, tone: score === null ? null : tone(score),
      limit: platform ? null : shardLimit(total, input.cost.input), tiles: tileScores,
      measuredMB: input.measuredMB?.(owner) ?? null };
  }).sort((a, b) => Number(a.budget === null) - Number(b.budget === null) || b.total - a.total || a.owner.localeCompare(b.owner));
  const { playing, loading, accounted } = input.cost;
  return {
    crossroads: { bytes: Object.freeze(crossroads), accounted, engineBase: input.cost.input.engineBase ?? CONTENT_CAPS.engineBase, overlap: input.cost.input.overlap,
      residentFactor: CONTENT_CAPS.residentFactor, playing, loading },
    shards, tiles,
  };
}

/** One resident world's own share of the headline: its claimed bytes at the resident factor (no base, no overlap). */
export interface BreakdownWorld { readonly owner: string; readonly bytes: number }
/** One page-wide part of the headline (the engine base, a page component, the road and commons, the decode overlap). */
export interface BreakdownShared { readonly label: string; readonly bytes: number }
/**
 * G628 M2: the page's memory headline split into parts that add up to it (bytes): the worlds (owners holding a world: a
 * `sim` claim), each its own bytes at the resident factor; the page-wide parts; and every other cell (far proxies, near
 * placeholders, edges) grouped. worlds + shared + cells = headline, within the cost model's one rounding.
 */
export interface BudgetBreakdown {
  readonly headline: number;
  /** heaviest first */
  readonly worlds: readonly BreakdownWorld[];
  readonly shared: readonly BreakdownShared[];
  readonly cells: { readonly count: number; readonly bytes: number };
}

/** Split the cost model's playing headline (`cost.playing`) over the allocator's table. */
export function budgetBreakdown(entries: readonly ResidencyEntry[], cost: BudgetPointsInput['cost']): BudgetBreakdown {
  const factor = CONTENT_CAPS.residentFactor, own = new Map<string, number>(), worlds = new Set<string>(), page = new Map<string, number>();
  let road = 0;
  for (const entry of entries) {
    if (entry.category === 'page') { const label = entry.id.replace(/^page:/u, ''); page.set(label, (page.get(label) ?? 0) + entry.accountedBytes); continue; }
    if (entry.owner === PLATFORM_OWNER) { road += entry.accountedBytes; continue; }
    own.set(entry.owner, (own.get(entry.owner) ?? 0) + entry.accountedBytes);
    if (entry.category === 'sim') worlds.add(entry.owner);
  }
  const listed = [...page.values()].reduce((sum, bytes) => sum + bytes, 0), pageBytes = cost.input.page ?? 0;
  const shared: BreakdownShared[] = [{ label: 'engine base', bytes: cost.input.engineBase ?? CONTENT_CAPS.engineBase },
    ...[...page].filter(([, bytes]) => bytes > 0).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([label, bytes]) => ({ label, bytes })),
    ...(pageBytes === listed ? [] : [{ label: 'page (unlisted)', bytes: pageBytes - listed }]),
    { label: 'road + commons', bytes: road * factor }, { label: 'decode overlap', bytes: cost.input.overlap }];
  let cellBytes = 0, cellCount = 0;
  const resident: BreakdownWorld[] = [];
  for (const [owner, bytes] of own) {
    if (worlds.has(owner)) resident.push({ owner, bytes: bytes * factor });
    else { cellBytes += bytes * factor; cellCount++; }
  }
  resident.sort((a, b) => b.bytes - a.bytes || a.owner.localeCompare(b.owner));
  return { headline: cost.playing, worlds: resident, shared, cells: { count: cellCount, bytes: cellBytes } };
}

/** Score the live allocator now: its table and its cost model, read once each. */
export function readBudgetPoints(allocator: Pick<ResidencyAllocator, 'entries' | 'cost'>, labels: Pick<BudgetPointsInput, 'name' | 'measuredMB' | 'shard'> = {}): BudgetPoints {
  return budgetPoints({ entries: allocator.entries(), cost: allocator.cost(), ...labels });
}

/** Decimal megabytes (MB = 10^6, §3.2) with one decimal, for the readout. */
export function megabytes(bytes: number): string { return (Math.round(bytes / 1e5) / 10).toFixed(1); }
