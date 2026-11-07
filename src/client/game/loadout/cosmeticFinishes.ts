import * as THREE from 'three';
import * as v from 'valibot';
import { CosmeticFinishesSchema, type CosmeticFinishBind, type CosmeticFinishesRows } from '@wildshard/format/heldFinishes';
import { EffectService, selectEffectGrants } from '@wildshard/engine/combat/effects/EffectService';
import type { EffectTarget } from '@wildshard/engine/combat/effects/types';
import { wearSkin } from '@wildshard/engine/models/gear';
import { clearSkin, type MaterialSkinDef } from '@wildshard/engine/player/Skins';
import { CosmeticsLocker, type CosmeticState } from '../cosmetics/locker';

type Skin = CosmeticFinishesRows['skins'][number];
type Paint = CosmeticFinishesRows['paints'][number];
type Choice = Paint['choices'][number];
type Repaint = NonNullable<Choice['repaint']>;

/** Row-owned cosmetic grants, with the existing shard persistence and bare-slot auto-wear law. */
export class CosmeticFinishLocker extends CosmeticsLocker<string, Skin> {
  readonly effects: EffectService;
  readonly effectTarget: EffectTarget = { attributes: {} };
  readonly finishes: CosmeticFinishesRows;
  constructor(namespace: string, input: unknown, save: { read: (namespace?: string) => CosmeticState; write: (state: CosmeticState, namespace?: string) => boolean }) {
    const rows = v.parse(CosmeticFinishesSchema, input);
    super(namespace, rows.skins, { save, autoWear: true, slot: row => row.slot });
    this.finishes = rows;
    this.effects = new EffectService(rows.skins.map(row => ({ id: row.effect, kind: 'permanent', tags: ['effect.cosmetic'], stacking: 'none', modifiers: [], grants: [row.grant], group: `skin.${row.slot}` })));
    this.changed = () => { this.syncEffects(); };
    this.syncEffects();
  }
  private syncEffects(): void {
    this.effects.sync(this.effectTarget, selectEffectGrants(this.finishes.skins.map(row => ({ id: row.effect, key: row.id })), new Set(Object.values(this.worn).filter((id): id is string => id !== undefined))));
  }
}

/** Client-only finish bindings to platform objects, observed as snapshots; all selection is in admitted rows. */
export interface CosmeticFinishTargets {
  readonly objects: ReadonlyMap<string, readonly THREE.Object3D[]>;
  readonly facts: ReadonlySet<string>;
}

/** What one bound frame reads: the live kit's held parts, the ridden and bonded mounts, and whether an encounter's power applies. */
export interface CosmeticFinishSources {
  readonly kit: { blade: (slot: string) => { readonly model: THREE.Object3D }; bow: (slot: string) => { readonly arrows: { readonly mesh: THREE.Object3D } } };
  /** restyle the bound held bow to a declared style (a no-op when it already wears it) */
  readonly restyle: (slot: string, style: string) => void;
  readonly mounts: readonly THREE.Object3D[];
  readonly applied: (owner: CosmeticFinishBind['facts'][number]['owner'], id: string) => boolean;
}
/** One frame of the declared bindings (`bind`): its targets painted from the current kit, mounts and facts, then the bound
 *  bow restyled to its selected finish. Nothing is cached between frames (an upgraded weapon is read anew). */
export function paintBoundFinishes(painter: CosmeticFinishPainter, bind: CosmeticFinishBind, sources: CosmeticFinishSources): void {
  const objects = new Map<string, readonly THREE.Object3D[]>(bind.held.map(row => [row.target, [row.part === 'arrows' ? sources.kit.bow(row.slot).arrows.mesh : sources.kit.blade(row.slot).model]]));
  if (bind.mounts !== undefined) objects.set(bind.mounts.target, sources.mounts);
  painter.update({ objects, facts: new Set(bind.facts.filter(row => sources.applied(row.owner, row.id)).map(row => row.fact)) });
  const restyle = bind.restyle, chosen = restyle === undefined ? undefined : painter.selectedFinishes.get(restyle.target);
  if (restyle !== undefined && chosen !== undefined && restyle.styles.includes(chosen)) sources.restyle(restyle.slot, chosen);
}

/** Client-only reversible material, vertex-colour and atlas projection for the loadout finish catalogue. */
export class CosmeticFinishPainter {
  readonly selectedFinishes: Map<string, string> = new Map<string, string>();
  private readonly applied = new Map<THREE.Object3D, { choice: Choice; restore: () => void }>();
  constructor(private readonly locker: CosmeticFinishLocker) {}
  update(targets: CosmeticFinishTargets): void {
    this.selectedFinishes.clear();
    const wanted = new Map<THREE.Object3D, { choice: Choice; material: Paint['material'] }>();
    for (const row of this.locker.finishes.paints) {
      const choice = row.choices.find(value => (value.skin === undefined || this.locker.wearing(row.slot)?.id === value.skin) && (value.fact === undefined || targets.facts.has(value.fact)));
      if (choice === undefined) continue;
      if (choice.finish !== undefined) this.selectedFinishes.set(row.target, choice.finish);
      for (const object of targets.objects.get(row.target) ?? []) wanted.set(object, { choice, material: row.material });
    }
    for (const [object, state] of this.applied) if (wanted.get(object)?.choice !== state.choice) { state.restore(); this.applied.delete(object); }
    for (const [object, row] of wanted) if (!this.applied.has(object)) this.applied.set(object, { choice: row.choice, restore: paintObject(object, row.choice, row.material) });
  }
  /** Restore original shared geometry and each material independently when its entered owner leaves. */
  dispose(): void { for (const value of this.applied.values()) value.restore(); this.applied.clear(); }
}

function paintObject(root: THREE.Object3D, row: Choice, kind: Paint['material']): () => void {
  const undo: (() => void)[] = [], seen = new Set<THREE.Material>();
  const mats: Record<string, MaterialSkinDef['mats'][string]> = {};
  root.traverse(object=>{
    if(!meshObject(object))return;
    for(const material of Array.isArray(object.material)?object.material:[object.material]){
      if(kind==='standard'&&material instanceof THREE.MeshStandardMaterial||kind==='lambert'&&material instanceof THREE.MeshLambertMaterial)mats[material.name]={};
    }
  });
  const id=JSON.stringify({row,kind});
  const dressed=Object.keys(mats).length>0;
  if(dressed)wearSkin(root,{skin:id},[{id,mats,material:kind}]);
  root.traverse(object => {
    if (!meshObject(object)) return;
    const materials: readonly THREE.Material[] = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of materials) {
      if (!(material instanceof THREE.MeshLambertMaterial || material instanceof THREE.MeshStandardMaterial)
        || kind === 'standard' && !(material instanceof THREE.MeshStandardMaterial) || kind === 'lambert' && !(material instanceof THREE.MeshLambertMaterial) || seen.has(material)) continue;
      seen.add(material);
      const color = material.color.clone(), emissive = material.emissive.clone(), intensity = material.emissiveIntensity, map = material.map;
      undo.push(() => { material.color.copy(color); material.emissive.copy(emissive); material.emissiveIntensity = intensity; material.map = map; material.needsUpdate = true; });
      if (row.color !== undefined) material.color.setRGB(...row.color);
      if (row.emissive !== undefined) material.emissive.setRGB(...row.emissive);
      if (row.emissiveIntensity !== undefined) material.emissiveIntensity = row.emissiveIntensity;
      if (row.repaint !== undefined && map !== null) { material.map = repaintAtlas(map, row.repaint, object.geometry); material.needsUpdate = true; }
    }
    if (row.repaint !== undefined && materials.every(material => !('map' in material) || material.map === null)) {
      const original = object.geometry, geometry = original.clone();
      const head = object instanceof THREE.SkinnedMesh ? object.skeleton.bones.findIndex(bone => bone.name === row.repaint?.bone) : -1;
      if (repaintVertices(geometry, head, row.repaint)) {
        object.geometry = geometry; undo.push(() => { object.geometry = original; geometry.dispose(); });
      } else geometry.dispose();
    }
  });
  return () => { for (const restore of undo) restore();if(dressed)clearSkin(root); };
}

function repaintVertices(g: THREE.BufferGeometry, head: number, row: Repaint): boolean {
  const col = g.getAttribute('color'), pos = g.getAttribute('position'), nrm = g.getAttribute('normal');
  const si = g.getAttribute('skinIndex'), sw = g.getAttribute('skinWeight');
  if (!(col instanceof THREE.BufferAttribute)) return false;
  let n = 0;
  const c = new THREE.Color(), blue = new THREE.Color(...row.blue), white = new THREE.Color(...row.white), mask = row.vertex;
  for (let i = 0; i < col.count; i++) {
    const r = col.getX(i), gr = col.getY(i);
    if (r > mask.redMin && r > gr * mask.redGreenRatio) {
      const k = Math.min(1, Math.max(0, (r / mask.ramp[0] - mask.ramp[1]) / mask.ramp[2]));
      c.copy(blue).lerp(white, k * k * (3 - 2 * k)); col.setXYZ(i, c.r, c.g, c.b); n++; continue;
    }
    if (head >= 0 && si instanceof THREE.BufferAttribute && sw instanceof THREE.BufferAttribute && nrm instanceof THREE.BufferAttribute && pos instanceof THREE.BufferAttribute
      && si.getX(i) === head && sw.getX(i) > mask.weight && Math.abs(pos.getX(i)) < mask.halfWidth && nrm.getY(i) > mask.normalY) { col.setXYZ(i, ...row.blaze); n++; }
  }
  col.needsUpdate = true;
  return n > 0;
}
const LUT_N = 4096;
const toSrgb = new Uint8ClampedArray(LUT_N + 1).map((_, i) => { const c = i / LUT_N; return Math.round(255 * (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055)); });
const hueOf = (r: number, g: number, b: number): number => {
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  if (d <= 1e-6) return 0;
  const h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return ((h * 60) + 360) % 360;
};

const skyCache = new WeakMap<THREE.Texture, Map<Repaint, THREE.Texture>>();

function readAtlas(map: THREE.Texture): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D; data: ImageData } | null {
  const img = map.image as CanvasImageSource & { width: number; height: number } | null;
  if (!img || typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = img.width; canvas.height = img.height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(img, 0, 0);
  return { canvas, ctx, data: ctx.getImageData(0, 0, img.width, img.height) };
}

function repaintAtlas(map: THREE.Texture, row: Repaint, geometry: THREE.BufferGeometry): THREE.Texture {
  const hit = skyCache.get(map)?.get(row);
  if (hit) return hit;
  const a = readAtlas(map);
  if (!a) return map;
  const W = a.canvas.width, H = a.canvas.height;
  const zone = regionMask(geometry, W, H, map.flipY, row.zone);
  const px = a.data.data;
  const c = new THREE.Color(), blue = new THREE.Color(...row.blue), white = new THREE.Color(...row.white), arow = row.atlas;
  for (let o = 0; o < px.length; o += 4) {
    const R = (px[o] ?? 0) / 255, G = (px[o + 1] ?? 0) / 255, B = (px[o + 2] ?? 0) / 255;
    const mx = Math.max(R, G, B), mn = Math.min(R, G, B), sat = mx > 0 ? 1 - mn / mx : 0;
    const inZone = zone !== null && (zone[o >> 2] ?? 0) > 0;
    let w: number, k: number;
    if (inZone && sat < arow.ornamentSaturation && mx > arow.ornamentValue) { w = arow.ornamentWeight; k = 1; }
    else {
      if (mx - mn < arow.delta) continue;
      let dh = hueOf(R, G, B); if (dh > 180) dh -= 360;
      w = inZone
        ? (1 - THREE.MathUtils.smoothstep(dh, arow.hue[0], arow.hue[1])) * THREE.MathUtils.smoothstep(dh, arow.hue[2], arow.hue[3]) * THREE.MathUtils.smoothstep(sat, ...arow.saturation) * THREE.MathUtils.smoothstep(mx, ...arow.value)
        : (1 - THREE.MathUtils.smoothstep(Math.abs(dh - arow.outerHue[0]), arow.outerHue[1], arow.outerHue[2])) * THREE.MathUtils.smoothstep(sat, ...arow.outerSaturation) * THREE.MathUtils.smoothstep(mx, ...arow.outerValue);
      if (w <= 0) continue;
      k = inZone ? Math.min(1, Math.max(0, (mx - arow.ramp[0]) / arow.ramp[1])) : Math.min(1, Math.max(0, (mx - arow.outerRamp[0]) / arow.outerRamp[1]));
    }
    c.copy(blue).lerp(white, k * k * (3 - 2 * k));
    const tr = toSrgb[Math.round(Math.min(1, c.r) * LUT_N)] ?? 0, tg = toSrgb[Math.round(Math.min(1, c.g) * LUT_N)] ?? 0, tb = toSrgb[Math.round(Math.min(1, c.b) * LUT_N)] ?? 0;
    px[o] = (px[o] ?? 0) + (tr - (px[o] ?? 0)) * w; px[o + 1] = (px[o + 1] ?? 0) + (tg - (px[o + 1] ?? 0)) * w; px[o + 2] = (px[o + 2] ?? 0) + (tb - (px[o + 2] ?? 0)) * w;
  }
  a.ctx.putImageData(a.data, 0, 0);
  const tex = new THREE.CanvasTexture(a.canvas);
  tex.flipY = map.flipY; tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = map.anisotropy;
  tex.wrapS = map.wrapS; tex.wrapT = map.wrapT; tex.name = `${map.name}:finish`;
  let entries = skyCache.get(map); if (entries === undefined) { entries = new Map(); skyCache.set(map, entries); } entries.set(row, tex);
  return tex;
}

function regionMask(g: THREE.BufferGeometry, W: number, H: number, flipY: boolean, zone: Repaint['zone']): Uint8ClampedArray | null {
  const pos = g.getAttribute('position'), uv = g.getAttribute('uv');
  if (!(pos instanceof THREE.BufferAttribute || pos instanceof THREE.InterleavedBufferAttribute) || !(uv instanceof THREE.BufferAttribute || uv instanceof THREE.InterleavedBufferAttribute)) return null;
  if (!g.boundingBox) g.computeBoundingBox();
  const bb = g.boundingBox;
  if (!bb) return null;
  const sy = bb.max.y - bb.min.y, sz = bb.max.z - bb.min.z;
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  ctx.fillStyle = '#fff'; ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5;
  const idx = g.getIndex(), n = idx ? idx.count : pos.count;
  const at = (i: number): number => (idx ? idx.getX(i) : i);
  const U = (i: number): number => uv.getX(i) * W, V = (i: number): number => (flipY ? 1 - uv.getY(i) : uv.getY(i)) * H;
  for (let t = 0; t + 2 < n; t += 3) {
    const a = at(t), b = at(t + 1), c = at(t + 2);
    const fy = ((pos.getY(a) + pos.getY(b) + pos.getY(c)) / 3 - bb.min.y) / sy, fz = ((pos.getZ(a) + pos.getZ(b) + pos.getZ(c)) / 3 - bb.min.z) / sz;
    if (fy < zone.y[0] || fy > zone.y[1] || fz < zone.z[0] || fz > zone.z[1]) continue;
    ctx.beginPath(); ctx.moveTo(U(a), V(a)); ctx.lineTo(U(b), V(b)); ctx.lineTo(U(c), V(c)); ctx.closePath(); ctx.fill(); ctx.stroke();
  }
  const d = ctx.getImageData(0, 0, W, H).data, out = new Uint8ClampedArray(W * H);
  for (let i = 0; i < out.length; i++) out[i] = d[i * 4] ?? 0;
  return out;
}

function meshObject(object: THREE.Object3D): object is THREE.Mesh { return object instanceof THREE.Mesh; }
