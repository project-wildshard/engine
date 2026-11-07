import * as THREE from 'three';
import { viewmodelMaterial, whiteColors } from '@wildshard/engine/combat/view/ranged';
import type { Game } from '@wildshard/engine/core/Game';
import type { ModelContext } from '@wildshard/engine/models/model';
import type { ShardContext } from './context';
import { HeldPlayback } from './weaponFamily';
import { createModelLibrary, paintedPrimitives, type PaintedPrimitiveRow } from './geometry';
import * as v from 'valibot';
import { HeldEquipmentSchema } from '@wildshard/format/heldEquipment';

/**
 * Client-only presentation: a first-person tool held through a timed beat (SHARD-PLATFORM M3, the kit system): a gloved hand holding a knife, a
 * brush, a trowel, at the lower right of the view on the viewmodels' shared lit program (no program of its own). Its look
 * is one GLB (one mesh, one baked atlas: albedo / normal / ARM), fetched once the level has loaded, with a vertex-coloured
 * stand-in of primitive rows until it lands (or when it fails). Through the beat it rises into view as the beat starts,
 * makes one stroke per cut (a short wind-up and a fast draw that lands on the cut) and drops out of view from the rise.
 * Every number is the shard's row; the Model Explorer's specimen is `heldToolSpecimen`.
 */

/** A beat's clock (seconds): its length, the rise-in, the cuts, and where it starts to drop out. */
export interface HeldToolBeat { readonly len: number; readonly kneelIn: number; readonly cuts: readonly number[]; readonly rise: number }

/** A held tool's look and motion (a shard's data row). */
export interface HeldToolRow {
  /** its object's and material's name, and its GLB */
  readonly name: string;
  readonly url: string;
  /** the stand-in's roughness and metalness (one set over every part), the file's environment intensity and its atlas's
   *  anisotropy; ms after the level loads before the fetch (its shard's schedule reads it); its render order */
  readonly standIn: { readonly roughness: number; readonly metalness: number };
  readonly envMapIntensity: number;
  readonly anisotropy: number;
  readonly loadDelayMs: number;
  /** Event identity and system owner declared by the held-tool row. */
  readonly loadedLevel: string;
  readonly loadSystemId: `shard.${string}`;
  readonly renderOrder: number;
  /** Admitted, read-only held transform programme; its phase reads the existing harvest clock. */
  readonly playback: readonly unknown[];
  /** the stand-in: painted primitive rows in the GLB's model space */
  readonly parts: readonly PaintedPrimitiveRow[];
}

/** A held tool's file: its one mesh as plain float geometry and its atlas (albedo, normal, ARM). */
export interface HeldToolFile { geo: THREE.BufferGeometry; tex: { map: THREE.Texture; normalMap: THREE.Texture; arm: THREE.Texture } }

/** Admit the catalogue's tool look, motion and delayed-load ownership as one native tool row. */
export function heldToolRows(input: unknown): HeldToolRow {
  const row = v.parse(HeldEquipmentSchema.entries.tool, input);
  return { ...row.look, url: row.url, playback: row.pose, loadedLevel: row.loadedLevel, loadSystemId: row.loadSystemId };
}

/** The existing model library owns one immutable decoded primitive and its original atlas. */
export async function loadHeldToolFile(row: Pick<HeldToolRow, 'name' | 'url' | 'anisotropy'>): Promise<HeldToolFile> {
  const library = createModelLibrary({ meshes: [], meshUrls: {}, hd: [], hdUrls: {}, hdLooks: {}, aoFloor: 1,
    geometryPools: [{ url: row.url, parts: ['held'], native: { first: true, requireIndex: false, white: true, disposeSource: true },
      atlases: [{ id: 'held', part: 'held', anisotropy: row.anisotropy }] }],
  }, `[${row.name}]`);
  await library.preload(); const geo = library.geometry('held', { borrow: true }), atlas = library.atlas('held');
  if (geo === null || atlas === null) throw new Error(`[${row.name}] held resources unavailable`);
  return { geo, tex: { map: atlas.map, normalMap: atlas.normalMap, arm: atlas.armMap } };
}

/** the atlas on a viewmodel material: albedo, normal (glTF's v runs down the image) and ARM, full factors */
function dressAtlas(m: THREE.MeshPhysicalMaterial, tex: HeldToolFile['tex'], envMapIntensity: number): void {
  m.map = tex.map; m.normalMap = tex.normalMap; m.aoMap = tex.arm; m.roughnessMap = tex.arm; m.metalnessMap = tex.arm;
  m.normalScale.set(1, -1); // glTF's v runs down the image (three's GLTFLoader flips the green the same way)
  m.roughness = 1; m.metalness = 1; m.envMapIntensity = envMapIntensity;
}

/** A first-person tool held through its beat (see the module comment): parented to the camera, hidden until `update`. */
export class HeldTool {
  readonly group: THREE.Group = new THREE.Group();
  private readonly pivot = new THREE.Group();
  private mesh: THREE.Mesh | null = null;
  private ownsGeometry = true;
  private readonly mat: THREE.MeshPhysicalMaterial;
  private readonly game: Game;
  private readonly ctx: ShardContext;
  private readonly row: HeldToolRow;
  private readonly playback: HeldPlayback;
  private readonly observations: Record<string, number>;

  /** `row` its look and motion, `beat` the clock `update` reads. `file`, prepared with the level (DL17), draws at once;
   *  without it the row owns its delayed file fetch in game time. */
  constructor(ctx: ShardContext, row: HeldToolRow, beat: HeldToolBeat, file?: HeldToolFile) {
    const world = ctx.game.runtime?.world;
    if (world === undefined || world === null) throw new Error('Held tool needs its world stage');
    const { game, sky } = world;
    this.game = game; this.ctx = ctx; this.row = row;
    this.playback = new HeldPlayback({ pose: row.playback }, new Map([['root', this.group], ['pivot', this.pivot]]));
    this.observations = { beatTime: -1, aspect: 1, length: beat.len, kneelIn: beat.kneelIn, rise: beat.rise, ...Object.fromEntries(beat.cuts.map((cut, at) => [`cut.${at}`, cut])) };
    this.mat = viewmodelMaterial(sky, row.name, { roughness: row.standIn.roughness, metalness: row.standIn.metalness });
    this.group.name = row.name;
    this.group.add(this.pivot);
    // no depth clear (the weapons' viewmodels have one): the tool works close and a clear washed the view in the haze
    this.group.visible = false;
    game.camera.add(this.group);
    this.use(paintedPrimitives(row.parts), null);
    if (file !== undefined) this.use(file.geo, file.tex);
    // the stand-in holds until the file lands
    let left = file === undefined ? -1 : 0;
    ctx.on('level.loaded', ({ id }) => { if (id === row.loadedLevel && left === -1) left = Math.max(row.loadDelayMs / 1000, 1e-6); });
    ctx.system({ id: row.loadSystemId, phase: 'update', run: dt => { if (left <= 0) return; left = Math.max(0, left - dt); if (left === 0) void this.load(); } });
    ctx.scope.onDispose(() => { this.group.removeFromParent(); if (this.ownsGeometry) this.mesh?.geometry.dispose(); this.mat.dispose(); });
  }

  private async load(): Promise<void> {
    try {
      const m = await loadHeldToolFile(this.row);
      if (this.ctx.scope.disposed) return; // cached immutable resources remain with the asset owner
      this.use(m.geo, m.tex);
    } catch (e: unknown) { console.warn(`[${this.row.name}] the model did not load — the stand-in stays:`, e); }
  }

  private use(geo: THREE.BufferGeometry, tex: HeldToolFile['tex'] | null): void {
    whiteColors(geo);
    const m = this.mat;
    if (tex) {
      dressAtlas(m, tex, this.row.envMapIntensity);
      // upload now, not on the first harvest
      for (const t of [tex.map, tex.normalMap, tex.arm]) this.game.renderer.initTexture(t);
    } else { m.roughness = this.row.standIn.roughness; m.metalness = this.row.standIn.metalness; } // one set of factors over every part
    const old = this.mesh, disposeOld = this.ownsGeometry; this.ownsGeometry = tex === null;
    const mesh = new THREE.Mesh(geo, m);
    mesh.frustumCulled = false; mesh.castShadow = false; mesh.receiveShadow = true; mesh.renderOrder = this.row.renderOrder;
    m.transparent = true; m.depthWrite = true;
    this.pivot.add(mesh);
    this.mesh = mesh;
    if (old) { old.removeFromParent(); if (disposeOld) old.geometry.dispose(); }
  }

  /** the beat's clock (−1 = none): place the hand for it */
  update(t: number): void {
    if (t < 0) { this.group.visible = false; return; }
    this.observations['beatTime'] = t; this.observations['aspect'] = this.game.camera.aspect;
    this.playback.apply('pose', this.observations);
  }
}

/**
 * The Model Explorer's specimen: the stand-in at once, then the file from its own load (parsed once per shard under
 * `onceKey`), each on its own copy of the viewmodel material dressed as the held one but opaque, in the normal queue.
 */
export function heldToolSpecimen(ctx: ModelContext, id: string, row: Omit<HeldToolRow, 'loadedLevel' | 'loadSystemId'>, onceKey: string): THREE.Group {
  const holder = new THREE.Group();
  const show = (geo: THREE.BufferGeometry, tex: HeldToolFile['tex'] | null): void => {
    whiteColors(geo);
    const m = viewmodelMaterial(ctx.sky, row.name, { roughness: row.standIn.roughness, metalness: row.standIn.metalness }); // the stand-in's factors
    if (tex) dressAtlas(m, tex, row.envMapIntensity);
    const mesh = new THREE.Mesh(geo, m);
    mesh.castShadow = true; mesh.receiveShadow = true;
    holder.clear();
    holder.add(mesh);
  };
  show(paintedPrimitives(row.parts), null);
  const file = ctx.once(onceKey, (): Promise<HeldToolFile> => loadHeldToolFile(row));
  void (async (): Promise<void> => {
    try {
      const k = await file;
      show(k.geo, k.tex);
      if ('document' in globalThis) document.dispatchEvent(new CustomEvent('ws:model-ready', { detail: { id } }));
    } catch (e: unknown) { console.warn(`[${row.name}] Model Explorer: the model did not load — the stand-in stays:`, e); }
  })();
  return holder;
}
