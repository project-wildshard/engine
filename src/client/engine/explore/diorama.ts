/**
 * The Set Explorer's diorama (E315 M7; Jake, on Wreck Cove: "Can we make the Set Explorer render a partial world in a
 * circle or dome around the set? I want a focused review."): an opened set is drawn as a cut-out of the world — its
 * ground, its water, its models and the neighbours inside the cut — on the explorer's studio backdrop, with a deep-blue
 * rim at the cut: a round cake slice, a vertical cylinder round the set, the ground's cut side an earth skirt (Jake picked
 * A · circle over B · dome and the whole world; it is how every set opens).
 *
 *   const d = new Diorama(world);
 *   const vol = d.enter(set.bounds, keep);        // the cut on; the camera frames `vol`
 *   d.update(cssSize);                           // each frame (the rim's line width)
 *   d.exit();                                    // everything as it was
 *
 * How it cuts, only while it is on (it never touches the game's own frames): the renderer's global clipping planes (a
 * 32-sided prism, a floor, and a lid on a stacked shard) cut every built-in and patched material; a custom shader
 * without clipping gets the clipping chunks for the while (patchClipping, its view position read back from gl_Position),
 * and anything wholly outside the cut is moved to a layer the camera doesn't draw (the shard's cullers keep setting
 * `visible`, never `layers`). Cost: the materials in the cut compile a clipping variant on the way in (and the originals
 * again on the way out if three released them) — an explorer-only stall, never in play.
 */
import * as THREE from 'three';
import { app } from '../app/runtime';
import type { World } from '../core/bootstrap';
import { heightAt } from '../../../shared/engine/world/Heightfield';
import { FatLines, LID_RIM, OUTLINE } from './fatLines';
import { PATCH_ORDER, patchShader } from '../render/shaderPatches';

/** the cut: a round base of `radius` round `centre` (its y the set's ground), open upward (or lidded on a stacked shard) */
export interface DioramaVolume {
  readonly centre: THREE.Vector3;
  readonly radius: number;
  /** the floor of the cut, world y: nothing under it is drawn */
  readonly floor: number;
  /** the lid, world y: Infinity (open upward), or just over the set on a stacked shard, where towers stand round it */
  readonly top: number;
}

/**
 * The set's ground and a margin round it (25 %, at least 12 m). `stacked`: a structure-first shard (Nine Dragon), a set
 * down among towers — the circle gets a lid just over the set, so it shows no slice of city standing far over the set
 * (Jake's night market row).
 */
export function dioramaVolume(bounds: THREE.Box3, ground: (x: number, z: number) => number, stacked = false): DioramaVolume {
  const c = bounds.getCenter(new THREE.Vector3()), size = bounds.getSize(new THREE.Vector3());
  const radius = Math.max(12, Math.hypot(size.x, size.z) * 0.5 * 1.25);
  const centre = new THREE.Vector3(c.x, bounds.min.y, c.z);
  let low = bounds.min.y;
  for (let k = 0; k < 24; k++) { const a = (k / 24) * Math.PI * 2; low = Math.min(low, ground(c.x + Math.cos(a) * radius, c.z + Math.sin(a) * radius)); }
  return { centre, radius, floor: low - Math.max(2, radius * 0.16), top: stacked ? bounds.max.y + Math.max(3, size.y * 0.5) : Infinity };
}

/** the planes that keep the inside (a point is drawn when every plane's signed distance to it is ≥ 0) */
export function cutPlanes(v: DioramaVolume): THREE.Plane[] {
  const out: THREE.Plane[] = [];
  const keep = (u: THREE.Vector3, r: number): void => { out.push(new THREE.Plane(u.clone().negate(), u.dot(v.centre) + r)); };
  const u = new THREE.Vector3();
  for (let k = 0; k < 32; k++) { const a = (k / 32) * Math.PI * 2; keep(u.set(Math.cos(a), 0, Math.sin(a)), v.radius); }
  if (Number.isFinite(v.top)) keep(u.set(0, 1, 0), v.top - v.centre.y); // the lid
  out.push(new THREE.Plane(new THREE.Vector3(0, 1, 0), -v.floor)); // the floor
  return out;
}

/** a world sphere wholly outside the cut */
export function outside(s: THREE.Sphere, v: DioramaVolume): boolean {
  const dx = s.center.x - v.centre.x, dz = s.center.z - v.centre.z, h = Math.hypot(dx, dz);
  return h - s.radius > v.radius || s.center.y + s.radius < v.floor || s.center.y - s.radius > v.top;
}

/** a world sphere wholly inside the cut (nothing of it to clip) */
function inside(s: THREE.Sphere, v: DioramaVolume): boolean {
  const h = Math.hypot(s.center.x - v.centre.x, s.center.z - v.centre.z);
  return h + s.radius <= v.radius && s.center.y - s.radius >= v.floor;
}

const LAYER = 30; // what the cut hides is moved here: the camera draws layer 0 only
const isDrawn = (o: THREE.Object3D): o is THREE.Mesh | THREE.Line | THREE.Points =>
  (o as Partial<THREE.Mesh>).isMesh === true || (o as Partial<THREE.Line>).isLine === true || (o as Partial<THREE.Points>).isPoints === true;
const mats = (o: THREE.Mesh | THREE.Line | THREE.Points): THREE.Material[] => (Array.isArray(o.material) ? o.material : [o.material]);
/** a material three can't clip as it is: a custom shader that says nothing about clipping */
const unclippable = (m: THREE.Material): m is THREE.ShaderMaterial => (m as Partial<THREE.ShaderMaterial>).isShaderMaterial === true && !(m as THREE.ShaderMaterial).clipping;

/** its world bounding sphere (instances and batches included) */
function sphereOf(o: THREE.Mesh | THREE.Line | THREE.Points, out: THREE.Sphere): THREE.Sphere | null {
  const im = o as Partial<THREE.InstancedMesh & THREE.BatchedMesh>;
  if (im.isInstancedMesh === true || im.isBatchedMesh === true) {
    const m = o as THREE.InstancedMesh;
    if (m.boundingSphere === null) m.computeBoundingSphere();
    if (m.boundingSphere === null) return null;
    return out.copy(m.boundingSphere).applyMatrix4(o.matrixWorld);
  }
  const g = o.geometry;
  if (g.boundingSphere === null) g.computeBoundingSphere();
  if (g.boundingSphere === null || !Number.isFinite(g.boundingSphere.radius)) return null;
  return out.copy(g.boundingSphere).applyMatrix4(o.matrixWorld);
}

/** the cut in a custom fragment shader: out past any plane (or all of the intersection planes) is discarded */
const DISCARD = `#if NUM_CLIPPING_PLANES > 0
  for ( int cutI = 0; cutI < UNION_CLIPPING_PLANES; cutI ++ ) { vec4 cutP = clippingPlanes[ cutI ]; if ( dot( vClipPosition, cutP.xyz ) > cutP.w ) discard; }
  #if UNION_CLIPPING_PLANES < NUM_CLIPPING_PLANES
    bool cutAll = true;
    for ( int cutI = UNION_CLIPPING_PLANES; cutI < NUM_CLIPPING_PLANES; cutI ++ ) { vec4 cutP = clippingPlanes[ cutI ]; cutAll = ( dot( vClipPosition, cutP.xyz ) > cutP.w ) && cutAll; }
    if ( cutAll ) discard;
  #endif
#endif`;

/**
 * A custom shader cut like the built-ins while the diorama is on: three's clipping chunks around its own code; the
 * view position the chunk needs is read back from its gl_Position. Returns the undo.
 */
function patchClipping(m: THREE.ShaderMaterial): () => void {
  m.clipping = true;
  const undo = patchShader(m, 'engine.diorama-cut', PATCH_ORDER.view, (shader) => {
    const vs = shader.vertexShader, end = vs.lastIndexOf('}');
    shader.vertexShader = `#include <clipping_planes_pars_vertex>\n${vs.slice(0, end)}\n#if NUM_CLIPPING_PLANES > 0\n{ vec4 cutView = inverse( projectionMatrix ) * gl_Position; vClipPosition = - cutView.xyz / cutView.w; }\n#endif\n${vs.slice(end)}`;
    // (three's own clipping_planes_fragment chunk scales diffuseColor under alpha-to-coverage, which a custom shader may not have)
    shader.fragmentShader = `#include <clipping_planes_pars_fragment>\n${shader.fragmentShader.replace(/void\s+main\s*\(\s*\)\s*\{/, (s) => `${s}\n${DISCARD}\n`)}`;
  }, { key: (k) => `${k}|diorama-cut` });
  m.needsUpdate = true;
  // the undo puts the material's own hook and key back exactly as they were (the prototype's if it had none)
  return () => { m.clipping = false; undo(); m.needsUpdate = true; };
}

export class Diorama {
  private readonly group = new THREE.Group();
  private readonly rim = new FatLines(OUTLINE);
  private readonly lid = new FatLines(LID_RIM);
  private skirt: THREE.Mesh | null = null;
  private readonly hidden: { o: THREE.Object3D; mask: number }[] = [];
  private readonly undo: (() => void)[] = [];
  private saved: { planes: THREE.Plane[]; background: THREE.Scene['background'] } | null = null;
  private vol: DioramaVolume | null = null;

  private readonly world: World;
  private readonly backdrop: () => THREE.Texture;
  constructor(world: World, backdrop: () => THREE.Texture) {
    this.world = world;
    this.backdrop = backdrop;
    this.group.add(this.rim.group, this.lid.group);
    this.group.visible = false;
    this.group.name = 'diorama';
    world.game.scene.add(this.group);
  }

  get volume(): DioramaVolume | null { return this.vol; }

  /** cut the world round `bounds`; `keep` (the explorer's own marks) is never hidden */
  enter(bounds: THREE.Box3, keep: readonly THREE.Object3D[]): DioramaVolume {
    this.exit();
    const { game } = this.world;
    const sea = app.world.water.level ?? -Infinity;
    const built = game.level.spawn.y !== undefined; // a structure-first shard (Nine Dragon): its ground is what it built, not heightAt
    const ground = (x: number, z: number): number => (built ? bounds.min.y : Math.max(heightAt(x, z), sea));
    const vol = dioramaVolume(bounds, ground, built);
    this.vol = vol;
    const planes = cutPlanes(vol);
    const { renderer, scene } = game;
    this.saved = { planes: renderer.clippingPlanes, background: scene.background };
    renderer.clippingPlanes = planes;
    scene.background = this.backdrop();
    document.dispatchEvent(new CustomEvent('ws:studio-active', { detail: true }));
    this.world.game.app.events.emit('explore.studio', true); // (a shard's post weather stops, as in the studio)
    // what the cut leaves out, off the camera's layer; a custom shader in it, patched to clip
    const skip = new Set<THREE.Object3D>([this.group, ...keep]);
    const s = new THREE.Sphere(), patched = new Set<THREE.ShaderMaterial>();
    scene.updateMatrixWorld();
    const visit = (o: THREE.Object3D): void => {
      if (skip.has(o)) return;
      if (isDrawn(o)) {
        const sp = sphereOf(o, s);
        const far = sp !== null && (outside(sp, vol) || (!o.frustumCulled && sp.radius > vol.radius * 20)); // (a sky that follows the eye)
        const custom = mats(o).filter(unclippable);
        if (far || (custom.length > 0 && sp === null)) { this.hide(o); }
        else if (custom.length > 0 && sp !== null && !inside(sp, vol)) {
          for (const m of custom) if (!patched.has(m)) { patched.add(m); this.undo.push(patchClipping(m)); }
        }
      }
      for (const c of o.children) visit(c);
    };
    visit(scene);
    this.buildRim(vol, ground);
    this.group.visible = true;
    return vol;
  }

  /** the rim's line width follows the screen (CSS px) */
  update(res: THREE.Vector2): void { if (this.vol) { this.rim.resize(res); this.lid.resize(res); } }

  exit(): void {
    if (!this.vol) return;
    const { renderer, scene } = this.world.game;
    for (const { o, mask } of this.hidden) o.layers.mask = mask;
    this.hidden.length = 0;
    for (const u of this.undo) u();
    this.undo.length = 0;
    if (this.saved) { renderer.clippingPlanes = this.saved.planes; scene.background = this.saved.background; this.saved = null; }
    // (the post weather comes back — unless the Model Explorer's turntable, opened from this set, has it held)
    if (document.querySelector('.ws-x-models.show[data-view="model"]') === null) document.dispatchEvent(new CustomEvent('ws:studio-active', { detail: false }));
    this.world.game.app.events.emit('explore.studio', false);
    if (this.skirt) { this.skirt.removeFromParent(); this.skirt.geometry.dispose(); this.skirt = null; }
    this.group.visible = false;
    this.vol = null;
  }

  private hide(o: THREE.Object3D): void {
    this.hidden.push({ o, mask: o.layers.mask });
    o.layers.set(LAYER);
  }

  /** the ground's cut side (an earth skirt from the rim down to the floor) and the deep-blue rim; a stacked set's lid rim */
  private buildRim(v: DioramaVolume, ground: (x: number, z: number) => number): void {
    const K = 128, pos: number[] = [], col: number[] = [], rim = new Float32Array(K * 6);
    const top = new THREE.Color(0x6b4a2e), bottom = new THREE.Color(0x1d140d);
    const tops: THREE.Vector3[] = [];
    for (let k = 0; k <= K; k++) {
      const a = (k / K) * Math.PI * 2, x = v.centre.x + Math.cos(a) * v.radius * 0.999, z = v.centre.z + Math.sin(a) * v.radius * 0.999;
      tops.push(new THREE.Vector3(x, ground(x, z), z));
    }
    for (let k = 0; k < K; k++) {
      const p = tops[k], q = tops[k + 1];
      if (!p || !q) continue;
      const f = v.floor + 0.02;
      pos.push(p.x, p.y, p.z, p.x, f, p.z, q.x, q.y, q.z, q.x, q.y, q.z, p.x, f, p.z, q.x, f, q.z);
      for (const c of [top, bottom, top, top, bottom, bottom]) col.push(c.r, c.g, c.b);
      rim.set([p.x, p.y + 0.03, p.z, q.x, q.y + 0.03, q.z], k * 6);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.computeVertexNormals();
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95, side: THREE.DoubleSide });
    this.world.sky.setupMaterial(mat);
    this.skirt = new THREE.Mesh(g, mat);
    this.skirt.name = 'diorama-skirt';
    this.group.add(this.skirt);
    this.rim.set(rim);
    if (Number.isFinite(v.top)) { // the lid's rim, faint: where the towers round the set are cut
      const lid = new Float32Array(64 * 6);
      for (let k = 0; k < 64; k++) {
        const a0 = (k / 64) * Math.PI * 2, a1 = ((k + 1) / 64) * Math.PI * 2, r = v.radius * 0.999;
        lid.set([v.centre.x + Math.cos(a0) * r, v.top - 0.02, v.centre.z + Math.sin(a0) * r, v.centre.x + Math.cos(a1) * r, v.top - 0.02, v.centre.z + Math.sin(a1) * r], k * 6);
      }
      this.lid.set(lid);
    } else this.lid.set(new Float32Array(0));
  }
}
