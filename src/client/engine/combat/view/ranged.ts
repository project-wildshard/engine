import { levelBakedId } from '../../../../shared/engine/level/spec';
import { app } from '../../app/runtime';
import * as THREE from 'three';
import type { Game } from '../../core/Game';
import { mergeOrNull, shadowProxy } from '../../models/weld';
import type { SkyRig as Sky } from '../../world/skyRig';
import type { Player } from '../../player/Player';
import type { Forest } from '../../world/forest/Forest';
import type { EquipmentRow } from '../../../../shared/engine/combat/Equipment';
import type { ImpactSurface } from '../../../../shared/engine/combat/Weapon';
import { worldHit as queryWorldHit, type Hit } from '../../../../shared/engine/physics/query';
import { attachFogUniforms } from '../../world/Atmosphere';
import { makePixels, clamp01, CLASSIC_SETS, MODERN_SETS, viewmodelBakeUrl, type Pixels, type SetName, type Ctx2D } from '../../player/viewmodelTextures';
import { ktx2Texture, prepareCompressedTexture } from '../../core/ktx2';
import { activeLevel } from '../../../../shared/engine/level/selection';
import { PATCH_ORDER, patchShader } from '../../render/shaderPatches';
import { ParticlePool, pointScale } from '../../fx/ParticlePool';
import { ViewmodelSources } from '../../player/viewmodelSources';

export interface RangedWorld { game: Game; sky: Sky; player: Player; forest: Forest }
export interface RangedOptions { row: EquipmentRow; allowUnlocked?: boolean }
export const TRACER_ORDER = 1200;
export const TRACER_RED: THREE.Color = new THREE.Color(1.0, 0.0, 0.0);
interface Vec3 { x: number; y: number; z: number }
/**
 * The first world surface a bolt's step (`radius` > 0: a ball swept a → b) or a shot (`radius` 0: the ray a → b) meets,
 * looking through the invisible chunk-edge walls so nothing stops in mid-air; `distance` is from `a`. Null when the
 * way is clear — and when there is no physics world (before boot, node tests): then nothing in the world is hit.
 */

export function worldHit(a: Vec3, b: Vec3, radius: number): Hit | null {
  const physics = app.physics;
  if (!physics) return null;
  return queryWorldHit(physics, a, b, radius);
}
export const FOV_HIP = 72, FOV_ADS = 58; // ADS zooms 1.3× (tan 36° / 1.3 → 29.1° half-angle); the pose solve re-runs per FOV so the sight stays centred
/** Vertical FOV to give the camera. Three's fov is vertical, so on a portrait phone a fixed 72° collapses the
 *  horizontal view to ~37°; widen it (Hor+ via the geometric mean of the aspect) so 72° hip → ~94° at 9:19.5. */
export function fovForAspect(base: number, aspect: number): number {
  if (aspect >= 1) return base;
  return THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(base) / 2) / Math.sqrt(aspect)));
}
function dataTexture(data: Uint8Array, w: number, h: number, srgb: boolean, repeat = 1): THREE.DataTexture {
  const t = new THREE.DataTexture(data, w, h, THREE.RGBAFormat);
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat, repeat);
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.anisotropy = 8;
  t.needsUpdate = true;
  return t;
}

export interface TexSet { map: THREE.Texture; normalMap: THREE.Texture; armMap: THREE.Texture }

/** a baked set plane sampled as dataTexture samples the drawn one (map sRGB, the rest linear; repeat-wrapped, trilinear, anisotropy 8) */
function viewmodelSampling(t: THREE.CompressedTexture, srgb: boolean): THREE.CompressedTexture {
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.anisotropy = 8;
  t.needsUpdate = true;
  return t;
}


const pixelCache = new Map<SetName, Pixels>();
/** G187 cut 3 (E435): the sets whose baked KTX2 stand-ins the active level's KTX2 table holds, as compressed textures */
const bakedSets = new Map<SetName, TexSet>();
let texturesReady: Promise<void> = Promise.resolve();
const WORKER_TIMEOUT_MS = 20000;

/**
 * G187 cut 3 (E435): on the KTX2 path a level may carry a set's three planes baked offline (scripts/bake-viewmodel-sets.mjs
 * draws them with makePixels itself and encodes them as KTX2) under viewmodelBakeUrl's names; such a set is loaded
 * compressed instead of drawn (a quarter of the RGBA8 DataTextures' GPU bytes, and no worker time). Returns the sets left
 * to draw: every one on the images path, or with no stand-in.
 */
async function adoptBakedSets(sets: readonly SetName[]): Promise<SetName[]> {
  const slug = levelBakedId(activeLevel());
  const planes = ['col', 'nrm', 'arm'] as const;
  await Promise.all(sets.map(async (name) => {
    const [map, normalMap, armMap] = await Promise.all(planes.map((plane) => ktx2Texture(viewmodelBakeUrl(slug, name, plane)).catch(() => null)));
    if (!map || !normalMap || !armMap) return;
    const maps = { map: viewmodelSampling(map, true), normalMap: viewmodelSampling(normalMap, false), armMap: viewmodelSampling(armMap, false) };
    // Consumers still finalize their sampler (makeBoltAtlas changes Repeat to Clamp).
    // The material warm-up owns the final fence and mip retirement.
    await Promise.all(Object.values(maps).map(texture => prepareCompressedTexture(texture, undefined, () => true, false)));
    bakedSets.set(name, maps);
  }));
  return sets.filter((name) => !bakedSets.has(name));
}

/** Draw the requested viewmodel sets in a worker (or adopt their baked KTX2 stand-ins) ahead of the weapons that wear
 *  them: true / false = every set / the modern ones. Returns when every set has arrived or the worker gave up (the same
 *  promise `viewmodelTexturesReady` hands out until the next call), so a caller that builds later can wait for its own. */
export function startViewmodelTextures(requested: boolean | readonly SetName[]): Promise<void> {
  const names = typeof requested === 'boolean' ? (requested ? [...CLASSIC_SETS, ...MODERN_SETS] : [...MODERN_SETS]) : requested;
  const wanted = names.filter((n) => !pixelCache.has(n) && !bakedSets.has(n));
  if (wanted.length === 0) { texturesReady = Promise.resolve(); return texturesReady; }
  texturesReady = (async () => {
  const sets = await adoptBakedSets(wanted);
  if (sets.length === 0) return;
  let worker: Worker;
  try {
    const { default: TexturesWorker } = await import('../../player/viewmodelTextures.worker?worker&inline');
    worker = new TexturesWorker();
  } catch { return; } // no workers: drawn on the main thread
  await new Promise<void>((resolve) => {
    let left = sets.length;
    const scope = app.engineScope.child('viewmodel-worker');
    scope.onDispose(() => { worker.terminate(); });
    const finish = () => { scope.dispose(); resolve(); };
    scope.timeout(WORKER_TIMEOUT_MS, finish); // never hold the boot on it
    worker.onmessage = (e: MessageEvent<{ name: SetName; px?: Pixels; error?: string }>) => {
      if (e.data.px) pixelCache.set(e.data.name, e.data.px);
      else console.warn(`[viewmodel textures] ${e.data.name} drawn on the main thread: ${e.data.error ?? '?'}`);
      if (--left === 0) finish();
    };
    worker.onerror = (e) => { e.preventDefault(); console.warn(`[viewmodel textures] worker failed: ${e.message}`); finish(); };
    worker.postMessage({ sets }, []);
  });
  })();
  return texturesReady;
}
/** Resolves when the worker has delivered every set it was asked for (or gave up); awaited by the weapon step. */
export function viewmodelTexturesReady(): Promise<void> { return texturesReady; }

const mainCanvas2d = (w: number, h: number): Ctx2D => {
  const cvs = document.createElement('canvas'); cvs.width = w; cvs.height = h;
  const ctx = cvs.getContext('2d');
  if (ctx === null) throw new Error('viewmodel textures: no 2d canvas context');
  return ctx;
};
function takePixels(name: SetName): Pixels {
  const px = pixelCache.get(name);
  if (px) { pixelCache.delete(name); return px; } // each set is wrapped once (its buffers become the DataTextures')
  return makePixels(name, mainCanvas2d);
}

// Eight named, immutable seeded sets. Only live consumers retain the pixels; the memo keeps no texture or array alive.
// Keep per-consumer texture transforms/samplers: held weapons, drops and Explorer use different repeats and wrapping.
const proceduralSources = new ViewmodelSources((source, srgb) => {
  const texture = dataTexture(new Uint8Array(0), source.data.width, source.data.height, srgb);
  texture.source = source;
  return texture;
});
function proceduralTextures(name: SetName): { map: THREE.DataTexture; normalMap: THREE.DataTexture; armMap: THREE.DataTexture | null } {
  return proceduralSources.take(name, () => {
    const pixels = takePixels(name);
    return { map: dataTexture(pixels.col, pixels.w, pixels.h, true), normalMap: dataTexture(pixels.nrm, pixels.w, pixels.h, false),
      armMap: pixels.arm === null ? null : dataTexture(pixels.arm, pixels.w, pixels.h, false) };
  });
}
/** A viewmodel texture set (map sRGB; normal + ARM linear; repeat-wrapped, mipmapped, anisotropy 8).
 * Live procedural copies share immutable sources (the Memory saver); sampler/transform objects stay independent.
 * The weak source memo retains no retired pixels. Compressed sets keep their existing ownership. */
export function viewmodelTexSet(name: Exclude<SetName, 'cord'>): TexSet {
  const baked = bakedSets.get(name);
  if (baked) { bakedSets.delete(name); return baked; } // taken once, as the pixels are (a second ask draws on the main thread)
  const textures = proceduralTextures(name);
  if (textures.armMap === null) throw new Error(`viewmodel textures: ${name} has no ARM plane`);
  return { map: textures.map, normalMap: textures.normalMap, armMap: textures.armMap };
}

/** Twisted hemp cord: diagonal stripes for both colour and bump. */
export function makeCord(): { map: THREE.Texture; normalMap: THREE.Texture } {
  const { map, normalMap } = proceduralTextures('cord');
  map.repeat.set(1, 14); normalMap.repeat.set(1, 14);
  return { map, normalMap };
}

/** Bolt atlas: bottom half iron shaft, top-left steel head, top-right feather vane (alpha). */
export function makeBoltAtlas(): TexSet {
  const t = viewmodelTexSet('bolt');
  t.map.wrapS = t.map.wrapT = THREE.ClampToEdgeWrapping; t.map.premultiplyAlpha = false;
  return t;
}

/**
 * three r186 ships a stale `examples/jsm/csm/CSMShader.js`: its replacement `lights_fragment_begin`
 * chunk lacks the `#ifdef STANDARD` block that fills `material.dfg` / `multiScatteringCompensation`,
 * so every CSM-patched material gets zero IBL specular (metals render black). Until Sky.ts patches
 * the chunk globally, materials here re-insert that block ahead of the include.
 */
const DFG_FIX = /* glsl */`
#ifdef STANDARD
{
  float dotNVms_fix = saturate( dot( normal, ( isOrthographic ) ? vec3( 0, 0, 1 ) : normalize( vViewPosition ) ) );
  material.dfg = texture2D( dfgLUT, vec2( material.roughness, dotNVms_fix ) ).rg;
  float EssMs_fix = material.dfg.x + material.dfg.y;
  material.multiScatteringCompensation = 1.0 + material.specularColorBlended * ( 1.0 / EssMs_fix - 1.0 );
}
#endif
#include <lights_fragment_begin>`;
export function fixIBL(mat: THREE.Material, name: string): void {
  patchShader(mat, 'engine.ranged-dfg', PATCH_ORDER.material, (shader) => {
    // this replaces the prototype hook (Atmosphere.ts) that hands every fogged material the shared fog uniforms: attach them
    // here, or a level fog's samplers (a painted fog's fogCloudTex / fogLutV2) stay unbound on unit 0 next to the shadow map's
    // sampler2DShadow — "two textures of different types use the same sampler location", and WebGL drops the draw
    attachFogUniforms(shader);
    shader.fragmentShader = shader.fragmentShader.replace('#include <lights_fragment_begin>', DFG_FIX);
  }, { mode: 'replace', key: `${name}|dfgfix` });
}

export const VIEWMODEL_GROUP = 'viewmodel';
let vmFillers: { white: THREE.DataTexture; arm: THREE.DataTexture; flatNormal: THREE.DataTexture } | null = null;

export function viewmodelMaterial(sky: Sky, name: string, params: THREE.MeshPhysicalMaterialParameters): THREE.MeshPhysicalMaterial {
  vmFillers ??= {
    white: dataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1, true),
    arm: dataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1, false),
    flatNormal: dataTexture(new Uint8Array([128, 128, 255, 255]), 1, 1, false),
  };
  const f = vmFillers;
  const m = new THREE.MeshPhysicalMaterial({ map: f.white, normalMap: f.flatNormal, aoMap: f.arm, roughnessMap: f.arm, metalnessMap: f.arm, vertexColors: true, ...params });
  m.name = name; fixIBL(m, VIEWMODEL_GROUP); sky.setupMaterial(m);
  return m;
}
/** A texture set a viewmodel material row names: the colour and normal planes and, when it has one, the ARM plane. */
export interface ViewmodelSet { readonly map: THREE.Texture; readonly normalMap: THREE.Texture; readonly armMap?: THREE.Texture }
/**
 * One viewmodel material as plain data (a shard's data/ row): three's factors as numbers, the set whose planes fill the
 * map slots (`set`, a key of the caller's sets; the 1×1 fillers without one), `normalScale` and a linear `color` as tuples.
 */
export interface ViewmodelMaterialRow extends Omit<THREE.MeshPhysicalMaterialParameters, 'color' | 'normalScale'> {
  readonly set?: string;
  readonly normalScale?: readonly [number, number];
  readonly color?: readonly [number, number, number];
}
/** `viewmodelMaterial` from a row: the named set's colour and normal planes, its ARM plane in ao / roughness / metalness. */
export function viewmodelRowMaterial(sky: Sky, name: string, row: ViewmodelMaterialRow, sets: Readonly<Record<string, ViewmodelSet>> = {}): THREE.MeshPhysicalMaterial {
  const { set, normalScale, color, ...factors } = row, planes = set === undefined ? undefined : sets[set], arm = planes?.armMap;
  if (set !== undefined && planes === undefined) throw new Error(`viewmodel material ${name}: no texture set ${set}`);
  return viewmodelMaterial(sky, name, { ...factors,
    ...(planes === undefined ? {} : { map: planes.map, normalMap: planes.normalMap }),
    ...(arm === undefined ? {} : { aoMap: arm, roughnessMap: arm, metalnessMap: arm }),
    ...(normalScale === undefined ? {} : { normalScale: new THREE.Vector2(...normalScale) }),
    ...(color === undefined ? {} : { color: new THREE.Color(...color) }) });
}
/** `Mesh` type guard for `Object3D.traverse` callbacks (three sets `isMesh` on every Mesh) */
export function isMesh(o: THREE.Object3D): o is THREE.Mesh { return 'isMesh' in o; }

/** Lighten vertex colour on bevel/edge vertices (normals off-axis) → worn, handled edges. */
export function edgeWear(g: THREE.BufferGeometry, amount = 0.28): void {
  const n = g.getAttribute('normal'), count = n.count;
  const colors = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const ax = Math.abs(n.getX(i)), ay = Math.abs(n.getY(i)), az = Math.abs(n.getZ(i));
    const m = Math.max(ax, ay, az);
    const w = clamp01((0.97 - m) / 0.35); // 1 on 45° bevels, 0 on flat faces
    const c = 1 + w * amount;
    colors[i * 3] = c; colors[i * 3 + 1] = c; colors[i * 3 + 2] = c;
  }
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
}
/** An all-white (×1) vertex-colour attribute where a geometry has none, so it can share a vertex-coloured program. */
export function whiteColors(g: THREE.BufferGeometry): void {
  if (g.hasAttribute('color')) return;
  g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(g.getAttribute('position').count * 3).fill(1), 3));
}

/** Bolt geometry along -Z (tip at -Z). Length 0.36. Single material via atlas UVs. */
const PUFF_COUNT = 6, PUFF_PARTICLES = 14, MAX_PARTICLES = PUFF_COUNT * PUFF_PARTICLES;

export class Puffs {
  private readonly pool: ParticlePool<'aSize' | 'aAlpha' | 'aColor'>;
  readonly points: THREE.Points;
  private maxLife = new Float32Array(MAX_PARTICLES);
  private mat: THREE.ShaderMaterial;
  private uScale: THREE.IUniform<number> = { value: 400 };
  private rnd = () => app.rng.stream('cosmetic').next();

  constructor() {
    this.mat = new THREE.ShaderMaterial({
      uniforms: { uScale: this.uScale },
      vertexShader: `attribute float aSize; attribute float aAlpha; attribute vec3 aColor; varying float vA; varying vec3 vC; uniform float uScale;
        void main(){ vA = aAlpha; vC = aColor; vec4 mv = modelViewMatrix * vec4(position,1.0); gl_PointSize = aSize * uScale / max(0.05,-mv.z); gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `varying float vA; varying vec3 vC; void main(){ vec2 d = gl_PointCoord - 0.5; float r = dot(d,d)*4.0; if (r > 1.0 || vA <= 0.001) discard; float a = (1.0 - r) * (1.0 - r) * vA; gl_FragColor = vec4(vC, a); }`,
      transparent: true, depthWrite: false,
    });
    this.pool = new ParticlePool({
      capacity: MAX_PARTICLES, material: this.mat, renderOrder: 10,
      attributes: { aSize: { itemSize: 1, dynamic: true }, aAlpha: { itemSize: 1, dynamic: true }, aColor: { itemSize: 3, dynamic: false } },
    });
    this.points = this.pool.points;
  }

  private tmpN = new THREE.Vector3();
  emit(point: THREE.Vector3, dir: THREE.Vector3, surface: ImpactSurface): void {
    const n = this.tmpN.copy(dir).negate();
    const cr = surface === 'flesh' ? 0.32 : surface === 'wood' ? 0.58 : 0.42;
    const cg = surface === 'flesh' ? 0.05 : surface === 'wood' ? 0.44 : 0.36;
    const cb = surface === 'flesh' ? 0.04 : surface === 'wood' ? 0.28 : 0.26;
    const { vel, life } = this.pool, { aSize: size, aAlpha: alpha, aColor: col } = this.pool.data;
    for (let k = 0; k < PUFF_PARTICLES; k++) {
      const i = this.pool.claim();
      const sp = surface === 'flesh' ? 1.6 : 1.1;
      this.pool.place(i, point);
      vel[i * 3] = (n.x + (this.rnd() - 0.5) * 1.4) * sp * (0.4 + this.rnd());
      vel[i * 3 + 1] = (n.y + (this.rnd() - 0.5) * 1.4 + 0.4) * sp * (0.4 + this.rnd());
      vel[i * 3 + 2] = (n.z + (this.rnd() - 0.5) * 1.4) * sp * (0.4 + this.rnd());
      this.maxLife[i] = life[i] = 0.35 + this.rnd() * 0.4;
      size[i] = (surface === 'ground' ? 0.05 : 0.025) + this.rnd() * 0.03;
      const v = 0.8 + this.rnd() * 0.4;
      col[i * 3] = cr * v; col[i * 3 + 1] = cg * v; col[i * 3 + 2] = cb * v;
      alpha[i] = 1;
    }
    this.pool.attr.aColor.needsUpdate = true;
  }

  update(dt: number, renderer: { getDrawingBufferSize: (out: THREE.Vector2) => THREE.Vector2 }, camera: THREE.PerspectiveCamera): void {
    this.uScale.value = pointScale(renderer, camera);
    let any = false;
    const { pos, vel, life } = this.pool, { aSize: size, aAlpha: alpha } = this.pool.data;
    for (let i = 0; i < MAX_PARTICLES; i++) {
      const life0 = life[i] ?? 0;
      if (life0 <= 0) continue;
      any = true;
      const left = life0 - dt; life[i] = left;
      const g = left > 0 ? left / (this.maxLife[i] ?? 1) : 0;
      const j = i * 3;
      const vx = (vel[j] ?? 0) * 0.94, vy = ((vel[j + 1] ?? 0) - 3.5 * dt) * 0.94, vz = (vel[j + 2] ?? 0) * 0.94;
      vel[j] = vx; vel[j + 1] = vy; vel[j + 2] = vz;
      pos[j] = (pos[j] ?? 0) + vx * dt; pos[j + 1] = (pos[j + 1] ?? 0) + vy * dt; pos[j + 2] = (pos[j + 2] ?? 0) + vz * dt;
      alpha[i] = g * 0.85;
      size[i] = (size[i] ?? 0) + dt * 0.06;
    }
    if (any) { this.pool.posAttr.needsUpdate = true; this.pool.attr.aAlpha.needsUpdate = true; this.pool.attr.aSize.needsUpdate = true; }
  }
}

// ───────────────────────────── debug tracers ─────────────────────────────

/** Build a bounded world/Explorer weapon display from borrowed model parts.
 * Direct parts retain borrowed materials; optional geometry copies alone may receive white vertex colours.
 * Merged displays own one decorated material clone per source material and retain a position-only shadow proxy.
 * No input geometry, transform or material is mutated; callers retain disposal of borrowed model-library resources. */
export function weaponDisplay(parts: readonly { readonly geo: THREE.BufferGeometry; readonly mat: THREE.Material; readonly pos?: THREE.Vector3; readonly rot?: THREE.Euler; readonly matrix?: THREE.Matrix4 }[],
  options?: { readonly mode: 'parts'; readonly copyGeometry?: boolean; readonly whiteColors?: boolean }
    | { readonly mode: 'merged'; readonly sky: Pick<Sky, 'setupMaterial'>; readonly opaque?: boolean }): THREE.Group {
  const policy = options ?? { mode: 'parts' as const };
  if (parts.length === 0 || parts.length > 128) throw new RangeError('Weapon display parts exceed their bound');
  for (const part of parts) if (part.matrix !== undefined && (part.pos !== undefined || part.rot !== undefined || !part.matrix.elements.every(Number.isFinite))) throw new Error('Invalid weapon display matrix');
  const group = new THREE.Group();
  if (policy.mode === 'parts') {
    if (policy.whiteColors === true && policy.copyGeometry !== true) throw new Error('Display colours require owned geometry');
    for (const part of parts) {
      const geometry = policy.copyGeometry === true ? part.geo.clone() : part.geo;
      if (policy.whiteColors === true) whiteColors(geometry);
      const mesh = new THREE.Mesh(geometry, part.mat); mesh.castShadow = true; mesh.receiveShadow = true;
      if (part.pos !== undefined) mesh.position.copy(part.pos);
      if (part.rot !== undefined) mesh.rotation.copy(part.rot);
      if (part.matrix !== undefined) mesh.applyMatrix4(part.matrix);
      group.add(mesh);
    }
    return group;
  }
  const owned = new Map<THREE.Material, THREE.Material>(), byMaterial = new Map<THREE.Material, THREE.BufferGeometry[]>();
  const matrix = new THREE.Matrix4(), rotation = new THREE.Quaternion(), one = new THREE.Vector3(1, 1, 1);
  for (const { geo, mat, pos, rot, matrix: supplied } of parts) {
    const geometry = supplied !== undefined ? geo.clone().applyMatrix4(supplied) : pos || rot ? geo.clone().applyMatrix4(matrix.compose(pos ?? new THREE.Vector3(), rot ? rotation.setFromEuler(rot) : rotation.identity(), one)) : geo;
    const list = byMaterial.get(mat) ?? []; list.push(geometry); byMaterial.set(mat, list);
  }
  const positions: THREE.BufferGeometry[] = [];
  for (const [material, geometries] of byMaterial) {
    const merged = geometries.length > 1 ? mergeOrNull(geometries) : geometries[0] ?? null;
    for (const geometry of merged === null ? geometries : [merged]) {
      let copy = owned.get(material);
      if (copy === undefined) { copy = material.clone(); copy.name = material.name; if (policy.opaque === true) { copy.transparent = false; copy.depthWrite = true; } fixIBL(copy, VIEWMODEL_GROUP); policy.sky.setupMaterial(copy); owned.set(material, copy); }
      const mesh = new THREE.Mesh(geometry, copy); mesh.castShadow = false; mesh.receiveShadow = true; group.add(mesh);
      const position = new THREE.BufferGeometry(); position.setAttribute('position', geometry.getAttribute('position')); position.setIndex(geometry.getIndex()); positions.push(position);
    }
  }
  const indexed = positions.every(geometry => geometry.getIndex() !== null);
  const caster = shadowProxy(indexed ? positions : positions.map(geometry => geometry.getIndex() === null ? geometry : geometry.toNonIndexed()));
  if (caster !== null) group.add(caster); else for (const mesh of group.children) mesh.castShadow = true;
  return group;
}

const COLLAPSED = new THREE.Matrix4().makeScale(0, 0, 0);
const BIND = new THREE.Matrix4();
/**
 * PF13: a held view's parts that share one material (the crossbow's two string legs, its serving and the nose whipping:
 * 4 draws a frame) drawn as one rigid-skinned draw. Every part keeps its node, so whatever poses, shows or hides it (a
 * playback row, a fade, a skin's paint on the shared material) works as before, but it no longer draws itself (its layers
 * are off). The merged draw holds one copy of each part's geometry skinned to one bone, and the bone takes the part's
 * world matrix at every matrix update (zero while the part or a node above it is hidden: its triangles collapse and draw
 * nothing), so each vertex lands where the part's own draw put it. Only direct children of `root` that are plain
 * single-material meshes merge; the merged draw is appended last, so its update follows theirs. Call before
 * prepareWeaponView, which then treats it as one more part. Returns how many draws it saved.
 */
export function mergeHeldParts(root: THREE.Object3D, keep: readonly THREE.Object3D[] = []): number {
  const byMaterial = new Map<THREE.Material, THREE.Mesh[]>();
  for (const part of root.children) {
    if (!isMesh(part) || Array.isArray(part.material) || part instanceof THREE.SkinnedMesh || keep.includes(part) || part.children.length > 0
      || Object.keys(part.geometry.morphAttributes).length > 0 || part.geometry.drawRange.start !== 0 || part.geometry.drawRange.count !== Infinity) continue;
    const list = byMaterial.get(part.material);
    if (list === undefined) byMaterial.set(part.material, [part]); else list.push(part);
  }
  let saved = 0;
  for (const [material, parts] of byMaterial) {
    const first = parts[0];
    if (first === undefined || parts.length < 2) continue;
    const layout = (g: THREE.BufferGeometry): string => `${Object.keys(g.attributes).sort().join(',')}|${String(g.index === null)}`;
    if (parts.some(part => layout(part.geometry) !== layout(first.geometry))) continue;
    const pieces = parts.map((part, bone) => {
      const g = part.geometry.clone(), n = g.getAttribute('position').count;
      const index = new Uint16Array(n * 4), weight = new Float32Array(n * 4);
      for (let v = 0; v < n; v++) { index[v * 4] = bone; weight[v * 4] = 1; }
      g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(index, 4)); g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(weight, 4));
      g.clearGroups();
      return g;
    });
    const geometry = mergeOrNull(pieces);
    for (const g of pieces) g.dispose();
    if (geometry === null) continue;
    const bones = parts.map(() => new THREE.Bone());
    const merged = new THREE.SkinnedMesh(geometry, material);
    merged.name = `${material.name}:merged`; merged.userData['viewmodelOnly'] = true; merged.frustumCulled = false;
    merged.bind(new THREE.Skeleton(bones, bones.map(() => new THREE.Matrix4())), BIND);
    const shown = (part: THREE.Object3D): boolean => { for (let at: THREE.Object3D | null = part; at !== null && at !== root; at = at.parent) if (!at.visible) return false; return true; };
    const update = merged.updateMatrixWorld.bind(merged);
    merged.updateMatrixWorld = (force?: boolean): void => {
      update(force);
      parts.forEach((part, i) => { bones[i]?.matrixWorld.copy(shown(part) ? part.matrixWorld : COLLAPSED); });
    };
    for (const part of parts) part.layers.disableAll();
    root.add(merged);
    saved += parts.length - 1;
  }
  return saved;
}

/** Prepare an owned held tree for the existing transparent viewmodel queue.
 * Geometry/material identities stay borrowed; only missing vertex colours and
 * the shipping queue/shadow flags are written. Clearer and flash exceptions are
 * explicit borrowed handles, never inferred from names or material appearance. */
export function prepareWeaponView(root: THREE.Object3D, options: {
  readonly clearer?: THREE.Mesh;
  readonly flash?: { readonly meshes: readonly THREE.Mesh[]; readonly material: THREE.Material };
} = {}): void {
  const meshes: THREE.Mesh[] = [];
  root.traverse(part => { if (isMesh(part)) meshes.push(part); });
  const { clearer, flash } = options;
  if (meshes.length > 256 || (flash?.meshes.length ?? 0) > 8
    || clearer !== undefined && !meshes.includes(clearer)
    || flash?.meshes.some(mesh => !meshes.includes(mesh))) throw new Error('Invalid held view roster');
  for (const mesh of meshes) {
    mesh.frustumCulled = false; mesh.castShadow = false; mesh.receiveShadow = mesh !== clearer;
    if (mesh === clearer) continue;
    mesh.renderOrder = flash?.meshes.includes(mesh) === true ? 1001 : 1000;
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    if (materials.some(material => material.vertexColors)) whiteColors(mesh.geometry);
    for (const material of materials) { material.transparent = true; if (material !== flash?.material) material.depthWrite = true; }
  }
}
