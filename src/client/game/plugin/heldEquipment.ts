import * as THREE from 'three';
import { retainCachedResources, ResourceMemo } from '@wildshard/engine/app/cachedAssets';
import { cacheUntilDisposed } from '@wildshard/engine/app/disposalCache';
import { loadTexture } from '@wildshard/engine/core/assets';
import { emitFault } from '@wildshard/engine/core/faults';
import { viewmodelRowMaterial, type RangedWorld, type TexSet, type ViewmodelSet } from '@wildshard/engine/combat/view/ranged';
import { prepareRangedFeel } from '@wildshard/engine/combat/view/rangedFeel';
import type { ShardContext } from './context';
import { installEnteredRuntimeService } from '../shard/retainedHooks';
import type { EquipmentRow } from '@wildshard/engine/combat/Equipment';
import type { Targets } from '@wildshard/engine/combat/types';
import type { SkyRig } from '@wildshard/engine/world/skyRig';
import { parseNativeFirearmProfile, parseHeldFirearmRows, parseHeldFirearmView, type FirearmWeaponProfileSchema } from '@wildshard/format/weaponProfiles';
import { HeldEquipmentSchema, type HeldEquipmentRows } from '@wildshard/format/heldEquipment';
import * as v from 'valibot';
import type { ShardFolder } from '../../../shared/game/shardfile/shardFolder';
import { createModelLibrary, type ModelLibrary } from './geometry';
import { HeldFirearm, heldFirearmDisplay, type HeldFirearmModel, type HeldHandRow } from './heldFirearm';
import { HeldLauncher, bindHeldBow, type HeldLauncherRows, type HeldLauncherProfile } from '../weapons/heldLauncher';
import { HeldTool, heldToolRows, loadHeldToolFile, type HeldToolBeat, type HeldToolFile } from './heldTool';
import { bindRuntimeEquipment, type RuntimeEquipmentFactory } from './headless';
import { ItemCatalogue } from '../../../shared/game/loadout/itemCatalogue';
import { Bow } from '../weapons/Bow';

/** Install row-selected ranged feel alongside the held families, retaining entered-cell lifetime. */
export function installHeldRangedFeel(context: ShardContext): void {
  const runtime = context.game.runtime, game = runtime?.world?.game, weapons = runtime?.play?.weapons;
  if (game === undefined || weapons === undefined) throw new Error('Ranged feel needs its player stage');
  const events = weapons.events;
  if (events === undefined) return;
  const bind = prepareRangedFeel(game);
  installEnteredRuntimeService(context, scope => { bind(events, scope, id => weapons.list.find(weapon => weapon.row.id === id)?.row); });
}

/** Native bolt profile plus row-authored page feel. Native clocks and ballistics have one source, combat/items. */
export function heldLauncherProfile(input: unknown, tuning: HeldEquipmentRows['launcherTuning']): HeldLauncherProfile & { family: 'crossbow' } {
  const p = parseNativeFirearmProfile(input, 'bolt'), projectile = p.projectile;
  if (projectile.muzzle === undefined || p.spreadAxisScale === undefined) throw new Error('Missing admitted bolt launch');
  return { family: 'crossbow' as const, quiver: p.magazine + p.reserve, speed: projectile.speed, gravity: projectile.flight.gravity, drag: projectile.flight.drag,
    radius: projectile.radius, ...tuning, reload: p.reload, autoReload: p.autoReload, cooldown: p.interval, maxFlying: projectile.pool,
    spreadAds: p.spreadAds, spreadHip: p.spreadHip, spreadRadius: p.spreadRadius, spreadAxisScale: p.spreadAxisScale,
    muzzle: projectile.muzzle, substeps: projectile.substeps, lifetime: projectile.lifetime, damageScale: p.damageScale };
}
/** Native lever clocks plus its admitted view. No native number is copied into the held catalogue. */
export function heldFirearmSettings(input: unknown, presentation: HeldEquipmentRows['firearm']['rows']['view'], tuning: HeldEquipmentRows['firearmTuning']): { profile: v.InferOutput<typeof FirearmWeaponProfileSchema> & HeldEquipmentRows['firearmTuning'] & { action: 'lever' }; view: HeldEquipmentRows['firearm']['rows']['view'] & { magazine: number; reserve: number; timing: { autoReloadDelay: number; autoReloadClose: number; reloadIn: number; reloadOut: number; roundTime: number } } } {
  const p = parseNativeFirearmProfile(input, 'lever');
  if (p.lever === undefined) throw new Error('Missing admitted lever timing');
  return { profile: { ...p, action: 'lever' as const, ...tuning }, view: { ...presentation, magazine: p.magazine, reserve: p.reserve,
    timing: { autoReloadDelay: p.autoReload, autoReloadClose: p.lever.autoReloadClose, reloadIn: p.lever.reloadIn, reloadOut: p.lever.reloadOut, roundTime: p.reload } } };
}
/** Types of the unchanged live families, independent of any shard's weapon wrapper. */
export type CatalogueLauncher = HeldLauncher<ReturnType<typeof heldLauncherProfile>>;
/** Native lever action with row-authored first-person presentation. */
export type CatalogueFirearm = HeldFirearm<ReturnType<typeof heldFirearmSettings>['profile']>;
interface FirearmModel { geo: Record<string, THREE.BufferGeometry>; steel: TexSet; wood: TexSet; rows: HeldEquipmentRows['firearm']['rows'] }
const catalogues = new Map<string, HeldEquipment>();

/** Client-only held presentation loaded from the platform section. Construction and preparation are explicit session operations;
 * immutable pools are borrowed, detail copies and atlases retain the original ownership policy. */
export class HeldEquipment {
  readonly rows: HeldEquipmentRows;
  readonly library: ModelLibrary<never, never>;
  private readonly firearmLibrary: ModelLibrary<never, never>;
  private readonly textures = new ResourceMemo<string, THREE.Texture>();
  private firearmLoad: Promise<FirearmModel> | null = null;
  private firearmReady: FirearmModel | null = null;
  private toolLoad: Promise<HeldToolFile> | null = null;
  private toolReady: HeldToolFile | null = null;

  constructor(private readonly product: ShardFolder) {
    this.rows = v.parse(HeldEquipmentSchema, product.section('held/equipment'));
    const { launcher, hands, firearm } = this.rows;
    this.library = createModelLibrary({ meshes: [], meshUrls: {}, hd: [], hdUrls: {}, aoFloor: 1, hdLooks: {}, geometryPools: [
      { url: product.url(launcher.pool.url), parts: launcher.pool.parts }, { url: product.url(hands.pool.url), parts: hands.pool.parts },
    ] }, '[held equipment]');
    this.firearmLibrary = createModelLibrary({ meshes: [], meshUrls: {}, hd: [], hdUrls: {}, hdLooks: {}, aoFloor: 1, geometryPools: [
      { url: firearm.asset.url, parts: firearm.asset.parts, native: { requireIndex: true, white: true, disposeSource: true },
        atlases: [{ id: 'steel', part: 'steel', anisotropy: 8, refresh: true }, { id: 'wood', part: 'forend', anisotropy: 8, refresh: true }] },
      { url: product.url(firearm.pool.url), parts: firearm.pool.parts },
    ] }, '[held firearm]');
  }
  /** Prepare once per admitted slug; the current owner is available to the cold Explorer after admission. */
  static async prepare(product: ShardFolder): Promise<HeldEquipment> {
    let host = catalogues.get(product.slug);
    if (host === undefined) { host = new HeldEquipment(product); catalogues.set(product.slug, host); }
    await host.library.preload(); await host.preloadFirearm(); await host.preloadTool(); return host;
  }
  /** DL17 (G1000): the held tool's file is level content, read with the level rather than after control (Pine's knife
   *  was read 0.5 s after it). Only a failed preload keeps the stand-in and the tool's own delayed retry in play (root's
   *  ruling, G872, as the dressing textures' fallback); the failure is reported as a fault, never silent. */
  async preloadTool(): Promise<HeldToolFile | null> {
    this.toolLoad ??= loadHeldToolFile(heldToolRows(this.rows.tool));
    try { this.toolReady = await this.toolLoad; return this.toolReady; }
    catch (error: unknown) {
      this.toolLoad = null;
      console.warn('[held tool] preload failed; the stand-in holds and the tool loads in play', error);
      emitFault({ system: 'held.tool', error, verdict: 'retry' });
      return null;
    }
  }
  /** Refuse an unprepared catalogue, rather than inventing a default weapon. */
  static current(slug: string): HeldEquipment { const host = catalogues.get(slug); if (host === undefined) throw new Error(`Held equipment not admitted: ${slug}`); return host; }
  /** Install the admitted native families by item ids. The platform resolves its world and targets itself. */
  install(context: ShardContext): void {
    const runtime = context.game.runtime, world = runtime?.world;
    if (runtime === undefined || world === undefined || world === null) throw new Error('Held equipment needs its world stage');
    const items = context.product.section('combat/items').items;
    const catalogue = new ItemCatalogue(items);
    const factories = new Map<string, RuntimeEquipmentFactory>();
    for (const item of items.rows) {
      if (item.kind !== 'weapon') continue;
      const row = catalogue.equipment(item.id), profile = item.profile;
      if (profile?.family === 'firearm' && profile.action === 'bolt') factories.set(item.id, {
        prepare: this.prepareHands,
        create: (native, targets, allowUnlocked) => this.launcher(world, targets, { row, allowUnlocked, profile: native.profile }),
      });
      else if (profile?.family === 'firearm' && profile.action === 'lever') factories.set(item.id, {
        create: (native, targets, allowUnlocked) => this.firearm(world, targets, { row, allowUnlocked, profile: native.profile }),
      });
      else if (profile?.family === 'bow') factories.set(item.id, {
        create: (_native, targets, allowUnlocked) => new Bow(world, targets, { row, profile: this.bow().profile, allowUnlocked }),
      });
    }
    runtime.buildEquipment = bindRuntimeEquipment(context, context.product.shardfile, { factories });
  }
  /** Borrow a baked hand and sleeve by its semantic part. */
  hand(part: string): { geometry: THREE.BufferGeometry; sleeve: THREE.BufferGeometry | null; wrist: THREE.Vector3; dir: THREE.Vector3 } {
    const row = Object.values(this.rows.hands.hands).find(hand => hand.geometry === `hand-${part}`);
    if (row === undefined) throw new Error(`Held hand is not baked: ${part}`);
    const geometry = (id: string): THREE.BufferGeometry => { const made = this.library.geometry(id, { borrow: true }); if (made === null) throw new Error(`Held part is not loaded: ${id}`); return made; };
    return { geometry: geometry(row.geometry), sleeve: row.sleeve === null ? null : geometry(row.sleeve), wrist: new THREE.Vector3().fromArray(row.wrist), dir: new THREE.Vector3().fromArray(row.dir) };
  }
  /** Load the coat maps before constructing sleeves; keep the existing cooperative boot yield. */
  private readonly prepareHands = async (due: () => Promise<void> | null): Promise<void> => {
    await Promise.all(Object.values(this.rows.coatTextures).map(row => this.textures.load(row.url, () => loadTexture(this.product.url(row.url), row.srgb, 1, undefined, texture => { if (!row.repeat) texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping; }))));
    const wait = due(); if (wait !== null) await wait;
  };
  private coat(): ViewmodelSet {
    const get = (name: string): THREE.Texture => { const texture = this.textures.peek(name); if (texture === undefined) throw new Error(`Held coat is not loaded: ${name}`); return texture; };
    const row = this.rows.coatTextures; return { map: get(row.map.url), normalMap: get(row.normalMap.url), armMap: get(row.armMap.url) };
  }
  /** The launcher's exact playback groups, with an empty playback for a static Explorer specimen. */
  launcherRows(held = false): HeldLauncherRows {
    const { launcher, playback, inputs, sights } = this.rows;
    const groups = held ? { frame: inputs.frames.crossbow.program, pose: playback.crossbow, parts: playback.crossbowParts, sight: sights.sight, string: sights.string, peep: sights.peep }
      : { frame: [], pose: [], parts: [], sight: [], string: [], peep: [] };
    return { ...launcher.rows.launcher, scene: launcher.hierarchy, playback: { groups,
      inputs: held ? [{ group: 'frame', rows: inputs.frames.crossbow.inputs }, { group: 'pose', rows: inputs.crossbow }, { group: 'sight', rows: sights.sightInputs }, { group: 'string', rows: sights.stringInputs }, { group: 'peep', rows: sights.peepInputs }] : [],
      outputs: held ? [{ group: 'frame', rows: inputs.frames.crossbow.outputs, target: 'frame' }, { group: 'sight', rows: sights.sightOutputs, target: 'sight' }] : [] } };
  }
  /** Borrow the same launcher primitives for held, pickup and Explorer builds. */
  launcherModel(): HeldFirearmModel {
    return { geometry: new Map(this.rows.launcher.hierarchy.nodes.flatMap(node => {
      if (node.kind !== 'mesh') return [];
      const geometry = this.library.geometry(node.geometry, { borrow: true }); if (geometry === null) throw new Error('Held launcher part missing');
      return [[node.geometry, geometry] as const];
    })) };
  }
  /** Construct the native single-bolt family from the item's profile and platform rows. */
  private launcher(world: RangedWorld, targets: Targets | undefined, opts: { row: EquipmentRow; allowUnlocked?: boolean; profile: unknown }): CatalogueLauncher {
    const { hands, view } = this.rows.launcher.rows, looks = this.rows.hands.presentation, names = this.rows.handNames;
    const hand = ({ part, ...hold }: typeof hands.left): HeldHandRow => ({ ...hold, ...this.hand(part) });
    return new HeldLauncher(world, targets, { ...opts, allowUnlocked: opts.allowUnlocked ?? false, profile: heldLauncherProfile(opts.profile, this.rows.launcherTuning), view,
      rows: this.launcherRows(true), model: this.launcherModel(), hands: { material: viewmodelRowMaterial(world.sky, names.hands, looks.hands),
        coatMaterial: viewmodelRowMaterial(world.sky, names.coat, looks.coat, { coat: this.coat() }), left: hand(hands.left), right: hand(hands.right) } });
  }
  /** Original native GLB, detail geometry and PBR atlases; failed loads remain retryable after disposal. */
  preloadFirearm(): Promise<FirearmModel> {
    if (this.firearmLoad !== null) return this.firearmLoad;
    this.firearmLoad = this.firearmLibrary.preload().then(() => {
      const geo = Object.fromEntries(this.rows.firearm.asset.parts.map(name => { const part = this.firearmLibrary.geometry(name, { borrow: true }); if (part === null) throw new Error(`Missing firearm part ${name}`); return [name, part]; }));
      const steel = this.firearmLibrary.atlas('steel'), wood = this.firearmLibrary.atlas('wood'); if (steel === null || wood === null) throw new Error('Missing firearm atlases');
      for (const name of ['sight-bead', 'round-live', 'round-case']) this.detail(name).dispose();
      const ready = retainCachedResources({ geo, steel, wood, rows: this.rows.firearm.rows }); this.firearmReady = ready;
      cacheUntilDisposed(ready, () => { if (this.firearmReady === ready) { this.firearmReady = null; this.firearmLoad = null; } }); return ready;
    }); return this.firearmLoad;
  }
  private detail(name: string): THREE.BufferGeometry { const geometry = this.firearmLibrary.geometry(name); if (geometry === null) throw new Error(`Missing firearm detail ${name}`); return geometry; }
  private firearmModel(model: FirearmModel): HeldFirearmModel {
    const geometry = new Map(Object.entries(model.geo));
    for (const name of ['sight-bead', 'round-live', 'round-case']) geometry.set(name, this.detail(name));
    return { geometry, textures: { wood: model.wood, steel: model.steel } };
  }
  /** Static world/Explorer copy on its own materials. */
  firearmSpecimen(sky: SkyRig, model: FirearmModel): THREE.Group { return heldFirearmDisplay(sky, model.rows.model, this.firearmModel(model)); }
  /** The same item-native lever action, with the rows' viewmodel and channel bindings. */
  private firearm(world: RangedWorld, targets: Targets | undefined, opts: { row: EquipmentRow; allowUnlocked?: boolean; profile: unknown }): CatalogueFirearm {
    const model = this.firearmReady; if (model === null) throw new Error('Held firearm not loaded');
    const { playback, inputs, action } = this.rows, frame = inputs.frames.lever;
    const rows = action.bindings.slice(0, 5), { hands, presentation } = model.rows;
    const { profile, view } = heldFirearmSettings(opts.profile, model.rows.view, this.rows.firearmTuning);
    return new HeldFirearm(world, targets, { ...opts, allowUnlocked: opts.allowUnlocked ?? false, profile, view: parseHeldFirearmView(view), model: this.firearmModel(model),
      hands: { material: viewmodelRowMaterial(world.sky, this.rows.handNames.hands, this.rows.hands.presentation.hands), left: { ...this.hand('lever-left'), ...hands.left }, right: { ...this.hand('lever-right'), ...hands.right }, gate: hands.gate },
      rows: parseHeldFirearmRows({ ...model.rows.model, mount: 'ownPass', gate: 'gate', round: 'round', brass: { geometry: 'round-case', material: 'brass' }, rotationReads: { hammerAngle: 'hammer' }, playback: {
        groups: { frame: frame.program, pose: playback.lever, parts: playback.leverParts, sight: action.sight, cycle: action.cycle, handAt: action.handAt, handAxis: action.handAxis, handPalm: action.handPalm },
        inputs: [{ group: 'frame', rows: frame.inputs }, { group: 'pose', rows: inputs.lever }, { group: 'parts', rows: action.partInputs }, ...rows.map(row => ({ group: row.group, rows: row.inputs }))],
        outputs: [{ group: 'frame', rows: frame.outputs, target: 'frame' }, ...rows.map(row => ({ group: row.group, rows: row.outputs, target: row.target === 'sight' ? 'sight' : row.target === 'cycle' ? 'values' : 'grip' }))],
        schedule: { frame: 'frame', sight: 'sight', pose: 'pose', action: ['cycle', 'parts'], grip: ['handAt', 'handAxis', 'handPalm'] },
      }, presentation }),
    });
  }
  /** Bow and its baked arrow share the same admitted hand library. */
  bow(): ReturnType<typeof bindHeldBow> { return bindHeldBow(this.rows.hands.heldBow, this.library); }
  /** Construct the row's timed tool, including its delayed admitted model load. */
  tool(context: ShardContext, beat: HeldToolBeat): HeldTool {
    return new HeldTool(context, heldToolRows(this.rows.tool), beat, this.toolReady ?? undefined);
  }
}
