/**
 * Low-poly model kit — the shared toolbox for Driftwood Isle's faceted, flat-shaded, vertex-coloured
 * models (E8: model fidelity). Every static prop / building / wreck is one merged non-indexed mesh on
 * one shared material, so detail costs triangles, never draw calls.
 *
 *   const kit = new LowPolyKit(SEED ^ 0x1234);
 *   kit.add(new THREE.BoxGeometry(1, 1, 1), '#9c7a52', { matrix: m, jitter: 0.06 });
 *   kit.add(log(a, b, 0.2, 0.16), C.wood);                   // faceted, hand-cut beam between two points
 *   kit.add(rope([p0, p1, p2], 0.035), C.rope);              // 4-sided tube along a polyline
 *   kit.add(rock(1.2, 1, rng), C.stone);                     // displaced icosahedron boulder
 *   const geo = kit.finish({ ao: { ground: heightAt } });    // merge + baked AO (+ ground contact)
 *   const mesh = new THREE.Mesh(geo, lowPolyMaterial(sky));
 *
 * bakeAO(geo, opts) — the part that makes a model stop reading as flat plastic: the merged triangles
 * (and the terrain under them) are rasterised into a coarse occupancy grid, each face marches a handful
 * of hemisphere rays through it, and the occluded fraction darkens the face toward a cool shadow tint.
 * Per face, not per vertex, so it keeps the faceted look. ~5–20 ms for a 10k-tri model, once at build.
 */
import * as THREE from 'three';
import type { Scope } from '../../../shared/engine/app/scope';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { Rng } from '../../../shared/engine/core/rng';
import type { SkyRig as Sky } from './skyRig';
import { patchSway, swayByHeight } from './wind';
import { attachFogUniforms } from './Atmosphere';
import { PATCH_ORDER, patchShader } from '../render/shaderPatches';
import { voxelAO, aoTint, hemisphere } from './voxelAO';
import { wobble } from './geometryKit';
import { dropTriangles, hiddenTriangles, type HiddenOptions } from './hiddenFaces';

export type ColorLike = THREE.Color | string;

const tmpColor = new THREE.Color();
const asColor = (c: ColorLike): THREE.Color => (typeof c === 'string' ? tmpColor.set(c) : c);

export interface AddOpts {
  /** per-face lightness jitter, ± fraction (default 0.06) */
  jitter?: number;
  /** applied to the geometry before it is merged */
  matrix?: THREE.Matrix4;
  /** random per-vertex displacement in metres (hand-cut look; default 0) — applied before the matrix */
  wobble?: number;
  /** sways in the shared wind (M5, wind.ts): weight `w` (~1 = cloth), rising with height from the part's base — or, with
   * `hang`, from its top down (a sail, a banner, weed hanging off a rail). Meshes with swaying parts want
   * a sway-patched `mesh.customDepthMaterial` so their shadows move too. */
  sway?: { w: number; phase?: number; hang?: boolean; /** absolute (post-matrix) y where the weight is 0 → where it reaches w (a sail built from many quads) */ span?: [number, number] };
}

export class LowPolyKit {
  readonly rng: Rng;
  private parts: THREE.BufferGeometry[] = [];

  constructor(seed: number) { this.rng = new Rng(seed); }

  /** add a geometry painted one colour (per-face jitter); the input is consumed */
  add(g: THREE.BufferGeometry, col: ColorLike, opts: AddOpts = {}): void {
    const jitter = opts.jitter ?? 0.06;
    if (g.hasAttribute('uv')) g.deleteAttribute('uv');
    if (g.hasAttribute('normal')) g.deleteAttribute('normal');
    if (g.hasAttribute('color')) g.deleteAttribute('color');
    if (opts.wobble !== undefined && opts.wobble > 0) wobble(g, opts.wobble, this.rng);
    const ni = g.index ? g.toNonIndexed() : g;
    if (ni !== g) g.dispose();
    if (opts.matrix) ni.applyMatrix4(opts.matrix);
    const c = asColor(col), r = c.r, gg = c.g, b = c.b;
    const n = ni.getAttribute('position').count, out = new Float32Array(n * 3);
    for (let i = 0; i < n; i += 3) {
      const k = 1 - jitter + this.rng.next() * jitter * 2;
      for (let j = 0; j < 3; j++) { const o = (i + j) * 3; out[o] = r * k; out[o + 1] = gg * k; out[o + 2] = b * k; }
    }
    ni.setAttribute('color', new THREE.BufferAttribute(out, 3));
    if (opts.sway) this.sway(ni, opts.sway);
    this.parts.push(ni);
  }

  private sway(g: THREE.BufferGeometry, sw: NonNullable<AddOpts['sway']>): void {
    g.computeBoundingBox();
    const bb = g.boundingBox;
    if (!bb) return;
    const phase = sw.phase ?? this.rng.range(0, Math.PI * 2);
    if (sw.span) swayByHeight(g, sw.w, sw.span[0], sw.span[1], phase);
    else if (sw.hang) swayByHeight(g, sw.w, bb.max.y, bb.min.y, phase); else swayByHeight(g, sw.w, bb.min.y, bb.max.y, phase);
  }

  /**
   * add a geometry painted by facing: faces whose (post-matrix) normal points up past `minY` take `top` (moss on a rock,
   * grass on a ledge, sand on a step), the rest `side`; per-face jitter as `add`. The input is consumed.
   */
  addTopped(g: THREE.BufferGeometry, side: ColorLike, top: ColorLike, opts: AddOpts & { minY?: number } = {}): void {
    const jitter = opts.jitter ?? 0.06, minY = opts.minY ?? 0.55;
    if (g.hasAttribute('uv')) g.deleteAttribute('uv');
    if (g.hasAttribute('normal')) g.deleteAttribute('normal');
    if (g.hasAttribute('color')) g.deleteAttribute('color');
    if (opts.wobble !== undefined && opts.wobble > 0) wobble(g, opts.wobble, this.rng);
    const ni = g.index ? g.toNonIndexed() : g;
    if (ni !== g) g.dispose();
    if (opts.matrix) ni.applyMatrix4(opts.matrix);
    const s = asColor(side).clone(), t = asColor(top).clone();
    const pos = ni.getAttribute('position'), n = pos.count, out = new Float32Array(n * 3);
    const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
    for (let i = 0; i < n; i += 3) {
      a.fromBufferAttribute(pos, i); b.fromBufferAttribute(pos, i + 1); c.fromBufferAttribute(pos, i + 2);
      b.sub(a); c.sub(a); b.cross(c).normalize();
      const col = b.y > minY ? t : s, k = 1 - jitter + this.rng.next() * jitter * 2;
      for (let j = 0; j < 3; j++) { const o = (i + j) * 3; out[o] = col.r * k; out[o + 1] = col.g * k; out[o + 2] = col.b * k; }
    }
    ni.setAttribute('color', new THREE.BufferAttribute(out, 3));
    this.parts.push(ni);
  }

  /** add several [geometry, colour] parts (a plant, a statue) under one matrix */
  addParts(parts: [THREE.BufferGeometry, ColorLike][], opts: AddOpts = {}): void {
    for (const [g, c] of parts) this.add(g, c, opts);
  }

  /** add a geometry that already carries a `color` attribute (non-indexed or indexed) */
  addPainted(g: THREE.BufferGeometry, matrix?: THREE.Matrix4): void {
    if (g.hasAttribute('uv')) g.deleteAttribute('uv');
    if (g.hasAttribute('normal')) g.deleteAttribute('normal');
    const ni = g.index ? g.toNonIndexed() : g;
    if (matrix) ni.applyMatrix4(matrix);
    this.parts.push(ni);
  }

  get triangleCount(): number { let n = 0; for (const p of this.parts) n += p.getAttribute('position').count / 3; return n; }

  /** merge everything, flat normals, optional AO bake; the kit is empty afterwards. `hidden` drops the faces no one can
   * see (inside another closed part, or buried: hiddenFaces.ts) after the AO bake, so the kept faces bake as before. */
  finish(opts: { ao?: AOOptions | false; hidden?: HiddenOptions } = {}): THREE.BufferGeometry {
    // read before the still parts take a zero aSway: a swaying part never hides another
    const hidden = opts.hidden === undefined ? null : hiddenTriangles(this.parts, opts.hidden);
    // the parts must share their attributes to merge: if any part sways, the still ones get a zero aSway
    if (this.parts.some((p) => p.hasAttribute('aSway'))) for (const p of this.parts) if (!p.hasAttribute('aSway')) p.setAttribute('aSway', new THREE.BufferAttribute(new Float32Array(p.getAttribute('position').count * 2), 2));
    let geo = mergeGeometries(this.parts, false);
    for (const p of this.parts) p.dispose();
    this.parts = [];
    geo.computeVertexNormals(); // non-indexed → flat per-face normals
    if (opts.ao !== false) bakeAO(geo, opts.ao ?? {});
    if (hidden !== null) {
      const flags = new Uint8Array(hidden.reduce((n, part) => n + part.length, 0));
      let at = 0;
      for (const part of hidden) { flags.set(part, at); at += part.length; }
      geo = dropTriangles(geo, flags);
    }
    geo.computeBoundingSphere();
    geo.computeBoundingBox();
    return geo;
  }
}

// ── primitives ────────────────────────────────────────────────────────────────────────────────────

// the shared engine geometry kit (E357 X5): imported here for the kit's own users

// ── baked ambient occlusion ───────────────────────────────────────────────────────────────────────

export interface AOOptions {
  /** terrain height under (x, z) in the geometry's space — cells below it are solid (ground contact AO) */
  ground?: (x: number, z: number) => number;
  /** a constant floor instead of `ground` (creatures / props built at the origin) */
  floorY?: number;
  /** occupancy cell size in metres (default: fit the bbox into ~72 cells on the longest axis, ≥ 0.12) */
  cell?: number;
  /** ray length in metres (default 6 cells) */
  dist?: number;
  /** 0..1 how dark a fully occluded face goes (default 0.62) */
  strength?: number;
  /** colour a fully occluded face is pulled toward (a cool shadow, default a dusky violet) */
  tint?: ColorLike;
  /** faces pointing down lose this much extra light (sky occlusion by orientation, default 0.18) */
  downDark?: number;
}

// 14 hemisphere directions in a +Z-up tangent frame (cosine-ish spread, fixed so bakes are deterministic)
const HEMI = hemisphere([[0.95, 1], [0.72, 5], [0.38, 8]], 1.7);

/**
 * Darken each face of a non-indexed, vertex-coloured geometry by how enclosed it is (the one `voxelAO`, per face). Works
 * in the geometry's own coordinate space (world for placed props, local for creatures).
 */
export function bakeAO(geo: THREE.BufferGeometry, o: AOOptions = {}): void {
  if (!geo.hasAttribute('color') || geo.index !== null) return;
  geo.computeBoundingBox();
  const bb = geo.boundingBox;
  if (bb === null) return;
  const ext = new THREE.Vector3().subVectors(bb.max, bb.min);
  const cell = o.cell ?? Math.max(0.12, Math.max(ext.x, ext.y, ext.z) / 72);
  const { ground, floorY } = o;
  const dist = o.dist ?? cell * 6;
  const tint = new THREE.Color().copy(asColor(o.tint ?? '#4a4466'));
  if (!geo.hasAttribute('normal')) geo.computeVertexNormals();
  const k = voxelAO(geo, {
    box: bb, cell, pad: 2, spacing: 0.7, maxSamples: 400, indexed: false,
    ...(ground ? { ground: { columns: ground } } : floorY !== undefined ? { ground: { columns: () => floorY } } : {}),
    sample: 'face', offset: 1.05, hemi: HEMI, steps: Math.max(3, Math.round(dist / cell)), stepLen: cell, falloff: 0.5,
    strength: o.strength ?? 0.62, downDark: o.downDark ?? 0.18,
  });
  aoTint(geo.getAttribute('color'), k, tint);
}

// ── material ──────────────────────────────────────────────────────────────────────────────────────

const materials = new WeakMap<Sky, Map<string, THREE.MeshStandardMaterial>>();
const borrowedMaterials = new WeakMap<Sky, Map<string, { readonly material: THREE.Material }[]>>();

/** Bind a borrowed kit material while scope lives. Newest live binding wins;
 * the loan is never patched or disposed. Existing meshes retain their material.
 * Unbind restores the preceding binding for this sky and variant. */
export function bindLowPolyMaterial(sky: Sky, variant: string, material: THREE.Material, scope: Scope): () => void {
  if (scope.disposed || variant.length === 0) throw new Error('Kit material binding requires a live scope and named variant');
  let variants = borrowedMaterials.get(sky);
  if (variants === undefined) { variants = new Map(); borrowedMaterials.set(sky, variants); }
  const bindings = variants, stack = bindings.get(variant) ?? [], entry = { material };
  stack.push(entry); bindings.set(variant, stack);
  const unbind = (): void => {
    const at = stack.indexOf(entry); if (at === -1) return;
    stack.splice(at, 1); if (stack.length === 0) bindings.delete(variant);
  };
  scope.onDispose(unbind); return unbind;
}

const SHADOW_NORMAL = 'vec3 shadowWorldNormal = transformNormalByInverseViewMatrix( transformedNormal, viewMatrix );';

/**
 * E112: turn each face's shadow normal-bias offset toward the light. The kit draws every model two-sided, and a lot of it
 * is single sheets (the hut's hipped roof, the lookout banner, the wreck's torn sail, fringe, vines). three pushes the
 * shadow lookup along the geometric normal (`normalBias`, 0.14 m here); on a sheet wound away from the sun that pushes it
 * through the sheet, so the sunlit face read its own shadow: the whole hut roof sat in shade all day, and the sails and
 * banner came out dark with ragged lit edges and per-triangle streaks. A face turned from the light is unlit by N·L
 * anyway, so flipping its offset changes nothing for closed shapes and frees the sheets. No extra draw calls.
 */
function patchShadowNormal(shader: { uniforms: Record<string, THREE.IUniform>; vertexShader: string }, lightDir: THREE.Vector3): void {
  if (!shader.vertexShader.includes('#include <shadowmap_vertex>') || !THREE.ShaderChunk.shadowmap_vertex.includes(SHADOW_NORMAL)) {
    console.warn('[lowpoly] shadowmap_vertex changed: the E112 shadow-normal flip is off');
    return;
  }
  shader.uniforms['uShadowLightDir'] = { value: lightDir };
  shader.vertexShader = shader.vertexShader
    .replace('#include <common>', '#include <common>\nuniform vec3 uShadowLightDir;')
    .replace('#include <shadowmap_vertex>', THREE.ShaderChunk.shadowmap_vertex.replace(SHADOW_NORMAL,
      `${SHADOW_NORMAL}\n\t\tif ( dot( shadowWorldNormal, uShadowLightDir ) > 0.0 ) shadowWorldNormal = - shadowWorldNormal;`));
}

/**
 * The one flat-shaded vertex-colour material every Driftwood model shares (so they batch into one
 * program and the scene pays one material state). `variant` keys an extra copy (e.g. 'glow' with an
 * emissive), everything else should take the default.
 */
/** Binding-aware kit intake. Borrowed graph materials never enter the classic factory. */
export function lowPolyLookMaterial(sky: Sky, variant = 'default', init?: (m: THREE.MeshStandardMaterial) => void): THREE.Material {
  const borrowed = borrowedMaterials.get(sky)?.get(variant)?.at(-1);
  return borrowed?.material ?? lowPolyMaterial(sky, variant, init);
}

/** Classic cached factory, retaining its established concrete return type. */
export function lowPolyMaterial(sky: Sky, variant = 'default', init?: (m: THREE.MeshStandardMaterial) => void): THREE.MeshStandardMaterial {
  let bySky = materials.get(sky);
  if (!bySky) { bySky = new Map(); materials.set(sky, bySky); }
  let m = bySky.get(variant);
  if (!m) {
    m = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.88, metalness: 0, side: THREE.DoubleSide });
    // every kit model can sway (M5): geometry without aSway reads weight 0 and stays put
    // csm.lightDirection is the one vector the day / night clock copies the sun (or the moon) into, so the uniform follows it
    patchShader(m, 'engine.lowpoly-kit', PATCH_ORDER.material, (sh) => { attachFogUniforms(sh); patchSway(sh); patchShadowNormal(sh, sky.csm.lightDirection); }, { mode: 'replace', key: `lowpoly-${variant}` });
    init?.(m);
    sky.setupMaterial(m);
    bySky.set(variant, m);
  }
  return m;
}
