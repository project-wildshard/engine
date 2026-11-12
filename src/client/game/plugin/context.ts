import type { Scope } from '@wildshard/engine/app/scope';
import { pageGridCells } from '../../../shared/game/grid/cellEvents';
import type { HomeResidencyClaim, PageResidency } from '../grid/pageResidency';
import { currentPageMode } from '../../../shared/game/grid/pageMode';
import type { ShardManifest } from '../shard/manifest';
import { CHUNK_HALF } from '@wildshard/engine/core/config';
import type { TabId as BagTabId, TabSpec as BagTabSpec, TabFragment as BagFragment } from '@wildshard/engine/ui/tabs';
import { registerItemRow } from '../../../shared/game/bag/itemCatalog';
import { registerAchievements, type AchievementDef } from '../../../shared/game/achievements';
import { registerCompendium } from '../../../shared/game/compendium/registry';
import type { ShardCompendium } from '../../../shared/game/compendium/types';
import type { ShardRuntime } from '../../../shared/game/shard/runtime';
import { normalizeItemRow, type ItemRow } from '../../../shared/game/bag/items';
import type { ContentRow, EngineRows, LevelContext } from '@wildshard/engine/level/context';
import type { SkinDef } from '@wildshard/engine/player/Skins';
import type { AudioData } from '@wildshard/format/audio';
import { parseShardSlug } from '../../../shared/game/shard/slug';
import type { Shardfile } from '@wildshard/format/shardSchema';
import { ownedPresentationImages } from '../shardfile/presentation';
import { lookLightManifest } from '@wildshard/engine/render/lookLight';
import { lookLightOn } from '@wildshard/engine/ui/lookLightOption';
import { absentShardProduct, type ShardProduct } from '../../../shared/game/shardfile/shardProduct';


/** The page's chosen entry mode. */
export type PageMode = 'grid' | 'shard';
/** A stable catalogue cell identity, independent of its current placement. */
export interface GridCellRef { readonly instance: string; readonly slug: string }
export const gridCells: typeof pageGridCells = pageGridCells;

/** The home cell's restored simulation as its client hands it over (sp-x5's `onSimulation`, SF15a): the existing driver's gate and its durable save. */
export interface GridHomeSimulation { readonly setActive: (active: boolean) => void; readonly checkpoint: () => boolean; readonly disposed: () => boolean; readonly residency?: HomeResidencyClaim }
/**
 * The seam between the home cell's client (its shardfile simulation, when one runs: Driftwood's hybrid boot) and the live
 * grid owner. The client offers its handoff once; the grid's live session takes it and gates the existing home driver
 * while the traveller is in another region (the freeze fence). A late taker hears the current offer.
 */
export class GridHomeHandoff {
  private current: GridHomeSimulation | null = null;
  private readonly takers = new Set<(sim: GridHomeSimulation) => void>();
  get simulation(): GridHomeSimulation | null { return this.current !== null && !this.current.disposed() ? this.current : null; }
  private expected = false;
  /** the home client announces a handoff on its way (a hybrid home in a grid page), so the entry reveal waits for it (G98) */
  expect(): void { this.expected = true; }
  /** true while an announced handoff has not arrived (the reveal's third wait; false when none was announced) */
  get pending(): boolean { return this.expected && this.current === null; }
  offer(sim: GridHomeSimulation): void { this.current = sim; for (const fn of this.takers) fn(sim); }
  take(fn: (sim: GridHomeSimulation) => void): () => void {
    this.takers.add(fn);
    const now = this.simulation; if (now !== null) fn(now);
    return () => { this.takers.delete(fn); };
  }
}
/** this page's home handoff (only a grid page's home client offers one) */
export const gridHomeSim: GridHomeHandoff = new GridHomeHandoff();

/** this page's mode, decided once at boot (held in the leaf grid/pageMode.ts) */
export function pageMode(): PageMode { return currentPageMode(); }
/** the catalogue instance this grid page booted into (null in shard mode) */
export function pageGridInstance(): string | null { return currentPageMode() === 'grid' ? gridCells.cell?.instance ?? null : null; }
/** Scoped bag registration verbs supplied to trusted plugins. */
export interface BagVerbs { tab: (spec: BagTabSpec) => void; fragment: (tab: BagTabId, fragment: BagFragment) => void }
/** Content rows a trusted plugin may register through its owned context. */
export interface GameRowMap { item: ItemRow; lootTable: ContentRow; skin: SkinDef; feat: AchievementDef; shop: ContentRow; compendium: ShardCompendium & { id: string } }
/** Typed registration verbs for game content rows. */
export type GameRows = { [K in keyof GameRowMap]: (value: GameRowMap[K] | readonly GameRowMap[K][]) => void };
/** Game services provided by the composition root, scoped to one shard. */
export interface GameServices {
  /** The composition root's pre-bootstrap residency owner, shared with trusted hybrid data and the grid. */
  readonly residency?: PageResidency;
  readonly runtime?: ShardRuntime;
  /** The admitted emitted audio rows for this runtime's own resident; absent for legacy-only entries. */
  readonly declaredAudio?: AudioData;
  readonly shard: ShardManifest;
  readonly rows: Map<keyof GameRowMap, Map<string, ContentRow>>;
  readonly bag: {
    tab: (spec: BagTabSpec) => () => void;
    fragment: (tab: BagTabId, fragment: BagFragment) => () => void;
  };
}
/** A trusted plugin's owned engine and game context. */
export interface ShardContext extends LevelContext {
  /** the shard's own manifest */
  readonly manifest: ShardManifest;
  /** the game's services: progress, inventory, loot, the compendium, travel */
  readonly game: GameServices;
  /** the Bag's verbs: tabs, fragments and finds a shard adds */
  readonly bag: BagVerbs;
  /** the engine's rows plus the game's (items, feats, quests …), for the shard's life */
  readonly rows: EngineRows & GameRows;
  /**
   * G99: the shard's cube while it runs as a grid cell (home or neighbour): every shard is a 500 × 500 × 500 cube, so
   * nothing it draws may stand past `half` metres from its centre in x or z (the road and the neighbours are there).
   * `null` standalone, where the shard keeps its own horizon. A shard reads it to leave out or clip its out-of-cube
   * dressing (a skirt, backdrop props); the platform already drops the level's horizon rings and cloud sea in the grid.
   */
  readonly cube: ShardCube | null;
  /**
   * The shard's built output as its runtime reads it (SHARD-PLATFORM P2a): `section()`, `strings()`, `file()`. The loader
   * passes the admitted product; an entry with no built output gets one whose every read refuses (`absentShardProduct`).
   */
  readonly product: ShardProduct;
}
/** A grid cell's extent in shard-local metres (G99): the cube's half width, its centre at the shard's origin. */
interface ShardCube { readonly half: number }
const GRID_CUBE: ShardCube = Object.freeze({ half: CHUNK_HALF });

/** Construct the owned game context without installing services at import time. */
export function shardContext(ctx: LevelContext, manifest: ShardManifest, game: GameServices, product: ShardProduct = absentShardProduct(manifest.slug)): ShardContext {
  const live = (): void => { if (ctx.scope.disposed) throw new Error('The shard scope is disposed'); };
  const add = <K extends keyof GameRowMap>(kind: K, values: GameRowMap[K] | readonly GameRowMap[K][]): void => {
    ctx.app.levelRegistrations.assertKit(ctx.scope);
    const list: readonly GameRowMap[K][] = Array.isArray(values) ? values : [values as GameRowMap[K]];
    const rows = game.rows.get(kind) ?? new Map<string, ContentRow>();
    const ids = new Set<string>();
    for (const value of list) {
      if (rows.has(value.id) || ids.has(value.id)) throw new Error(`Duplicate ${kind} row: ${value.id}`);
      ids.add(value.id);
    }
    game.rows.set(kind, rows);
    for (const value of list) {
      rows.set(value.id, kind === 'item' ? normalizeItemRow(value) : value);
      ctx.scope.onDispose(() => { rows.delete(value.id); if (rows.size === 0) game.rows.delete(kind); });
    }
  };
  // Retain progress as a getter: its stage changes while the same context serves all hooks.
  return {
    ...ctx, get progress() { return ctx.progress; }, manifest, game, product, cube: pageMode() === 'grid' ? GRID_CUBE : null,
    bag: {
      tab: (spec) => { live(); ctx.scope.onDispose(game.bag.tab(spec)); },
      fragment: (tab, fragment) => { live(); ctx.scope.onDispose(game.bag.fragment(tab, fragment)); },
    },
    rows: { ...ctx.rows,
      item: (values) => { add('item', values); const list: readonly ItemRow[] = Array.isArray(values) ? values : [values as ItemRow]; for (const value of list) ctx.scope.onDispose(registerItemRow(value)); }, lootTable: (values) => add('lootTable', values),
      skin: (values) => add('skin', values), feat: (values) => { add('feat', values); ctx.scope.onDispose(registerAchievements(manifest.slug, [...(game.rows.get('feat')?.values() ?? [])] as AchievementDef[])); },
      shop: (values) => add('shop', values), compendium: (values) => { add('compendium', values); const list: readonly (ShardCompendium & { id: string })[] = Array.isArray(values) ? values : [values as ShardCompendium & { id: string }]; for (const value of list) ctx.scope.onDispose(registerCompendium(value)); },
    },
  };
}

/** Read the current counted world-step sink through the defining game context port. */
export function buildProgress(context: Pick<ShardContext, 'progress'>): ShardContext['progress'] { return context.progress; }


/** A fully declared page reads world bytes through its admitted product, not
 * the authored predecessor's eager pack inventory. Preserve other boot policy. */
export function compiledPageBoot(authored: ShardManifest['boot'], compiled: ShardManifest['boot']): NonNullable<ShardManifest['boot']> {
  if (compiled?.sources === undefined) throw new Error('Compiled page has no admitted boot sources');
  return { ...authored, files: compiled.files, sources: compiled.sources };
}

/** Map parsed data and admitted immutable image bytes into catalogue/level metadata.
 * No fetch, browser decode, world allocation or service installation occurs here. Absent presentation keeps the empty card.
 * Image-bearing manifests require an owner that atomically replaces its per-identity URL batch.
 * The caller owns asset admission and the library lease; the returned hooks enter the ordinary session later. */
export function sourceManifest(source: Pick<Shardfile, 'identity' | 'accent' | 'spawn' | 'look' | 'presentation' | 'map'> & Partial<Pick<Shardfile, 'navigation'>>, assets: ReadonlyMap<string, Uint8Array> = new Map(), imageOwner?: Scope): ShardManifest {
  const presentation = source.presentation;
  if (imageOwner === undefined && (presentation !== undefined || source.map !== undefined)) throw new Error('Image owner required');
  const navigation = source.navigation === null || source.navigation === undefined ? undefined : assets.get(source.navigation.file);
  if (source.navigation !== null && source.navigation !== undefined && navigation === undefined) throw new Error('Navigation is missing admitted bytes');
  const map = source.map === undefined ? undefined : assets.get(source.map.image);
  if (source.map !== undefined && map === undefined) throw new Error('Map image is missing admitted bytes');
  const slug = parseShardSlug(source.identity.slug);
  const images = imageOwner === undefined ? undefined : ownedPresentationImages(source, assets, imageOwner);
  // LF1-4: the look's light settings (height fog, bloom, desktop AO) behind Settings ▸ Debug ▸ Look ▸ "Look light"
  const light = lookLightManifest(source.look, lookLightOn());
  const card = 'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/%3E';
  return {
    ...(source.navigation === null || source.navigation === undefined || navigation === undefined ? {} : { navigation: { row: source.navigation, bytes: navigation } }),
    api: 1, accent: source.accent, slug, name: source.identity.name, seed: source.identity.seed,
    order: 0, status: 'live', label: '(0, 0)', biome: presentation?.biome ?? 'Empty world', blurb: presentation?.blurb ?? 'An empty shardfile world.',
    card: images?.card ?? { thumb: card, portrait: card, landscape: card }, style: 'greybox', kitLook: 'toon', hands: 'toon', weapon: 'custom',
    treeCount: 0, trees: { factory: 'none', noun: 'trees' }, ground: { structures: true, paths: 'plugin' }, horizon: { rings: [], cloudSea: false },
    spawn: { ...source.spawn }, spawns: [], species: [], uses: [], boundary: { visible: false },
    sky: { sunColor: [1, 1, 1], sunIntensity: 1, envIntensity: 0.5, bgIntensity: 1, fogSunColor: [1, 1, 1], cloudSunColor: [1, 1, 1], hemiSky: 0x9ca7b4, hemiGround: 0x606060, hemiIntensity: 0.7, sun: { azimuth: 35, elevation: 45 } },
    atmosphere: { ...light.atmosphere, fogDistDensity: 0, volumetricSunColor: [1, 1, 1] },
    grade: { saturation: source.look.grade.saturation - 1, brightness: 0, contrast: source.look.grade.contrast - 1, bloomIntensity: light.bloom.intensity, bloomThreshold: light.bloom.threshold, shadowTint: [1, 1, 1], highTint: [1, 1, 1], lift: [0, 0, 0], gain: [1, 1, 1], gamma: 1 },
    budgets: {}, fight: {}, loadout: { weapons: [], tools: [], start: [] }, minimap: images?.map === undefined ? {} : { image: images.map },
    render: async () => source.look.keys.length === 0 ? (await import('../shardfile/emptyLook')).emptyLook(source.look.dayOverride) : (await import('../shardfile/look')).shardfileLook(source.look), tiers: { phone: { ao: false, godRays: false }, desktop: light.ao === null ? { ao: false, godRays: false } : { ao: true, godRays: false, 'ao.intensity': light.ao.intensity, 'ao.radius': light.ao.radius } },
    audio: { ambience: 'none', score: 'none' },
    boot: { files: () => [], sources: () => ({ sky: [], baked: [], terrain: [], trees: [], physics: [], cabins: [], props: [], art: [], music: [], sfx: [] }), viewmodelSets: [], audio: () => Promise.resolve([]), precache: [] },
    // A plugin source enters the ordinary staged LevelLoader, even with no authored hooks.
    load: async () => { const { EmptyEquipment } = await import('../shardfile/emptyEquipment'); return { default: class {
      kit(ctx: ShardContext): void {
        const runtime = ctx.game.runtime;
        if (runtime === undefined) throw new Error('Shardfile source requires the session host');
        runtime.buildEquipment = () => Promise.resolve({ primary: new EmptyEquipment(), secondary: null, rifle: null });
      }
    } }; },
  };
}

/** Staged trusted plugin hooks; invoked only by the owning session. */
export abstract class ShardPlugin {
  world?(ctx: ShardContext): Promise<void> | void;
  kit?(ctx: ShardContext): Promise<void> | void;
  play?(ctx: ShardContext): Promise<void> | void;
}
