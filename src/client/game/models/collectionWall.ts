import { GeometryPack } from '@wildshard/engine/models/geometryPack';
import { packedRows } from '@wildshard/format/geometryPack';
import { fetchDeflatedBytes } from '@wildshard/engine/core/deflate';
import type { Scope } from '@wildshard/engine/app/scope';
import { loadTexture } from '@wildshard/engine/core/assets';
import { ResourceMemo } from '@wildshard/engine/app/cachedAssets';
import type { ShardFolder } from '../../../shared/game/shardfile/shardFolder';
import { declarePanel, type PanelView } from '@wildshard/engine/ui/panel';
import { mountUi, uiScope } from '@wildshard/engine/ui/ownership';
/**
 * Client-only presentation. The trophy wall (SHARD-PLATFORM M3: the game's, any shard's compendium may hang one; first drawn for a remaster's
 * journal board, the chalk-outline wall).
 * A wall of mount slots from the shard's compendium (`ShardCompendium.trophies`): a slot whose entry is TAKEN shows the
 * animal's own head and shoulders on a wooden shield; the rest show a chalk outline and the name in chalk. Looking at a
 * slot shows a tip under the crosshair ("NOT YET TAKEN" / the name + the joke title) and offers "[E] Examine …", which
 * opens the journal on that entry.
 *
 *   const wall = new TrophyWall({ anchor, state, rows: [3, 4], width: 3, rowY: [1.95, 1.1] });
 *   anchor.add(wall.group); interactables.push(wall.interactable);
 *   game.onUpdate(() => wall.update(camera));   wall.onExamine = (entryId) => journal.open(entryId);
 *   state.onChange → wall.rebuild()             // a new trophy is mounted on the spot
 *
 * `anchor`'s local frame: origin on the wall face at floor level, +x along the wall (the viewer's right), +y up, +z out
 * of the wall into the room. Cheap: ONE merged mesh for every mount + shield (vertex colours, one MeshStandardMaterial)
 * and ONE merged mesh for every chalk decal (the baked chalk atlas, generators/paintedPage.ts); no lights, nothing per frame but a ray-plane test.
 * Each mount (its shield and the species' head and shoulders, its coat in its vertex colours) is baked offline, posed on
 * the wall (generators/trophyMounts.ts → data/trophyMounts.json + a hash-named geometry pack), fetched only
 * when a slot is taken.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { CollectionMountPack, CollectionChalk } from '@wildshard/format/collectionDisplay';
import { installCompendium, type CompendiumHost } from '../compendium/install';
import type { CompendiumState } from '../../../shared/game/compendium/state';
import type { TrophySlot } from '../../../shared/game/compendium/types';

export interface TrophyWallOptions {
  /** the admitted product: the baked mounts pack (`custom/trophyMounts`, a named blob) */
  pack: CollectionMountPack;
  loadMounts: (indices: readonly number[]) => Promise<THREE.BufferGeometry[]>;
  chalk: CollectionChalk;
  loadChalk: () => Promise<THREE.Texture>;
  anchor: THREE.Object3D;
  state: CompendiumState;
  /** slots per row, top row first (their sum = the slot count) */
  rows: readonly number[];
  /** wall width the slots spread over (m) and each row's centre height above the anchor */
  width: number;
  rowY: readonly number[];
  /** draw the look-at tip on the HUD (a declared panel) */
  tip?: boolean;
}

interface Placed { slot: TrophySlot; x: number; y: number; w: number; h: number }

/** how far the eye may be from a slot to read it (m) */
const LOOK_RANGE = 4.2;
/** past this (m) the wall is not drawn */
const CULL = 30;
const wallTextures = new ResourceMemo<string, THREE.Texture>();


export class TrophyWall {
  readonly scope: Scope = uiScope('trophyWall');
  readonly group: THREE.Group = new THREE.Group();
  /** one prompt for the whole wall: it moves to the slot you look at ("[E] Examine Old Ironhide"), radius 0 otherwise */
  readonly interactable: { position: THREE.Vector3; radius: number; label: string; onInteract: () => void };
  onExamine?: (entryId: string) => void;
  private placed: Placed[] = [];
  private mounts: THREE.Mesh | null = null;
  private chalk: THREE.Mesh | null = null;
  private readonly mountMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0, envMapIntensity: 0.35 });
  private chalkMat: THREE.MeshStandardMaterial | null = null;
  private looked: Placed | null = null;
  private builds = 0;
  private tip: PanelView | null = null;
  private readonly ray = new THREE.Ray();
  private readonly inv = new THREE.Matrix4();
  private readonly tmp = new THREE.Vector3();
  private readonly hit = new THREE.Vector3();
  private readonly plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
  /** the baked mounts pack's rows and its blob URL; each slot's geometry in the pack by entry id */
  private readonly pack: CollectionMountPack;

  constructor(private opts: TrophyWallOptions) {
    this.pack = opts.pack;
    const slots = opts.state.def.trophies ?? [];
    let k = 0;
    opts.rows.forEach((count, r) => {
      const w = opts.width / count, y = opts.rowY[r] ?? 1.5, h = r === 0 ? 0.95 : 0.8;
      for (let i = 0; i < count; i++) {
        const slot = slots[k++];
        if (slot) this.placed.push({ slot, x: -opts.width / 2 + w * (i + 0.5), y, w, h });
      }
    });
    this.interactable = { position: new THREE.Vector3(0, -1e4, 0), radius: 0, label: 'Examine', onInteract: () => { if (this.looked) this.onExamine?.(this.looked.slot.entry); } };
    if (opts.tip === true) {
      this.tip = declarePanel({ cls: 'ws-cmp-tip' });
      mountUi(this.tip.root, this.scope);
    }
    this.group.name = 'trophy-wall';
    opts.anchor.add(this.group);
    this.rebuild();
    void this.loadChalk();
  }

  private taken(p: Placed): boolean { return this.opts.state.state(p.slot.entry) === 'taken'; }

  /** (re)build the mounts mesh from the taken slots, and the chalk mesh from the rest */
  rebuild(): void {
    void this.mountTaken();
    this.buildChalk();
  }

  /** the taken slots' baked mounts merged into one mesh; the pack is fetched only while a slot is taken, never kept */
  private async mountTaken(): Promise<void> {
    const build = ++this.builds;
    const taken = this.placed.flatMap((p) => { const i = this.taken(p) ? this.pack.slots[p.slot.entry] : undefined; return i === undefined ? [] : [i]; });
    let parts: THREE.BufferGeometry[] = [];
    if (taken.length > 0) {
      try {
        parts = await this.opts.loadMounts(taken);
      } catch (error: unknown) { console.error('[trophy-wall] the baked mounts did not load:', error); return; }
    }
    if (build !== this.builds) return; // a newer rebuild won
    if (this.mounts) { this.group.remove(this.mounts); this.mounts.geometry.dispose(); this.mounts = null; }
    if (parts.length === 0) return;
    this.mounts = new THREE.Mesh(mergeGeometries(parts, false), this.mountMat);
    for (const g of parts) g.dispose();
    this.mounts.name = 'trophy-mounts';
    this.group.add(this.mounts);
  }

  /** the baked chalk atlas, then the chalk decals */
  private async loadChalk(): Promise<void> {
    const map = await this.opts.loadChalk();
    this.chalkMat = new THREE.MeshStandardMaterial({ map, transparent: true, depthWrite: false, roughness: 1, metalness: 0, opacity: 0.62, polygonOffset: true, polygonOffsetFactor: -2 });
    this.buildChalk();
  }

  /** per untaken slot, its outline over its label (its name once seen, else ???): two planes on their atlas cells */
  private buildChalk(): void {
    const mat = this.chalkMat;
    if (!mat) return;
    if (this.chalk) { this.group.remove(this.chalk); this.chalk.geometry.dispose(); this.chalk = null; }
    const layout = this.opts.chalk, [aw, ah] = layout.size, outlines: Readonly<Record<string, readonly number[]>> = layout.outlines, labels: Readonly<Record<string, readonly number[]>> = layout.labels;
    const quad = (rect: readonly number[] | undefined, w: number, h: number, x: number, y: number): THREE.BufferGeometry => {
      if (rect === undefined) throw new Error('[trophy-wall] a slot has no baked chalk');
      const [rx = 0, ry = 0, rw = 0, rh = 0] = rect, g = new THREE.PlaneGeometry(w, h), uv = g.getAttribute('uv');
      for (const k of [0, 1, 2, 3]) uv.setXY(k, (rx + uv.getX(k) * rw) / aw, 1 - (ry + (1 - uv.getY(k)) * rh) / ah); // a plane's four corners
      return g.translate(x, y, 0.012);
    };
    const planes = this.placed.flatMap((p) => {
      if (this.taken(p)) return [];
      const w = Math.min(p.w * 0.96, p.h * 0.8), h = w * 1.25, y = p.y + 0.02 - (h - w) / 2 * 0.9;
      const label = labels[this.opts.state.state(p.slot.entry) === 'unknown' ? '???' : p.slot.entry];
      return [quad(outlines[p.slot.outline], w, h * 0.8, p.x, y + h * 0.1), quad(label, w, h * 0.2, p.x, y - h * 0.4)];
    });
    if (planes.length === 0) return;
    this.chalk = new THREE.Mesh(mergeGeometries(planes, false), mat);
    for (const g of planes) g.dispose();
    this.chalk.name = 'trophy-chalk';
    this.chalk.renderOrder = 1;
    this.group.add(this.chalk);
  }

  /** the slot under the crosshair (a ray from the eye against the wall plane), its tip and its prompt */
  update(camera: THREE.Camera): void {
    camera.getWorldPosition(this.tmp);
    this.inv.copy(this.group.matrixWorld).invert();
    const eye = this.tmp.applyMatrix4(this.inv);
    this.group.visible = eye.lengthSq() < CULL * CULL; // a wall inside a cabin: nothing to draw from outside its clearing
    let found: Placed | null = null;
    // only from the room side, within reading range
    if (eye.z > 0.2 && eye.z < LOOK_RANGE && Math.abs(eye.x) < this.opts.width) {
      this.ray.origin.copy(eye);
      camera.getWorldDirection(this.ray.direction).transformDirection(this.inv);
      if (this.ray.direction.z < -0.1 && this.ray.intersectPlane(this.plane, this.hit)) {
        for (const p of this.placed) if (Math.abs(this.hit.x - p.x) < p.w / 2 && Math.abs(this.hit.y - p.y) < p.h / 2 + 0.05) { found = p; break; }
      }
    }
    if (found !== this.looked) {
      this.looked = found;
      this.paintTip();
    }
    if (found) {
      // the prompt rides just ahead of the eye along the look ray: the pick is by distance, so a slot you look at wins over
      // a pickup lying nearer the wall (the AR-15 on this cabin's floor)
      camera.getWorldPosition(this.interactable.position).addScaledVector(camera.getWorldDirection(this.tmp), 0.3);
      this.interactable.radius = 1;
      const e = this.opts.state.entry(found.slot.entry), named = this.opts.state.state(found.slot.entry) !== 'unknown';
      this.interactable.label = `Examine ${named && e ? e.name : '???'}`;
    } else { this.interactable.radius = 0; this.interactable.position.set(0, -1e4, 0); }
  }

  /** the tip: NOT YET TAKEN + the name, or the name + the joke title */
  private paintTip(): void {
    const tip = this.tip;
    if (!tip) return;
    const p = this.looked;
    tip.flag('', 'show', p !== null);
    if (!p) return;
    const e = this.opts.state.entry(p.slot.entry), st = this.opts.state.state(p.slot.entry);
    const name = st !== 'unknown' && e ? e.name : '???';
    const [top, sub] = st === 'taken' ? [name, p.slot.title] : ['Not yet taken', name];
    tip.fill('', [{ tag: 'span', text: top }, { tag: 'small', text: sub }]);
  }

  /** after a take: re-mount, re-chalk, re-read the tip */
  refresh(): void { this.rebuild(); this.paintTip(); }
}

/** Install the existing compendium and save owner with a product-backed display wall. */
export function installCollectionCompendium(owners: ReadonlyMap<string, CompendiumHost>, rows: { scope: Scope; product: ShardFolder; pack: CollectionMountPack; chalk: CollectionChalk; texture: { url: string; srgb: boolean; repeat: boolean } }): ReturnType<typeof installCompendium> {
  const host = owners.get('compendium');
  if (host === undefined) throw new Error('Missing compendium owners');
  return installCompendium({ ...host, wall: (state, journal) => {
    const def = state.def, place = def.wall, root = place ? host.cabins?.roots[place.cabin] : undefined;
    if (place === undefined || root === undefined || (def.trophies ?? []).length === 0) return null;
    const anchor = new THREE.Object3D(); anchor.position.set(...place.at); anchor.rotation.y = place.yaw;
    root.add(anchor); anchor.updateMatrixWorld(true);
    const wall = new TrophyWall({ pack: rows.pack, chalk: rows.chalk,
      loadMounts: async indices => {
        if (rows.scope.disposed) throw new Error('Collection owner is disposed');
        const bytes = await fetchDeflatedBytes(rows.product.url(rows.pack.url));
        const pack = new GeometryPack(bytes, packedRows(rows.pack.rows), 'trophy-wall');
        return indices.map(index => pack.geometry(index));
      },
      loadChalk: () => {
        const url = rows.product.url(rows.texture.url);
        return wallTextures.load(url, () => loadTexture(url, rows.texture.srgb, 1, undefined, texture => { if (!rows.texture.repeat) texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping; }));
      },
      anchor, state, rows: place.rows, width: place.width, rowY: place.rowY, tip: true });
    wall.onExamine = id => { journal.open(id); }; host.interactables.push(wall.interactable); return wall;
  } });
}
