/**
 * The material-family registry (SHARD-PLATFORM SF10a, G4 / G32): one entry per family id, turning a validated material
 * entry into a material for the v1 renderer (three.js WebGL), and the precompile jobs that build every live family
 * program before its first draw. A WebGPU renderer would register its own compilers against the same ids; nothing a
 * shard writes changes.
 *
 * Every material made here is tracked until its scope is disposed, so the loading screen's shader step compiles family
 * programs that are not in the scene yet (a creature that spawns later, a prop that streams in): `familyCompileJobs`.
 */
import * as THREE from 'three';
import type { Scope } from '../../../../shared/engine/app/scope';
import type { CompileJob } from '../precompile';
import { engineString } from '../../../../shared/engine/strings';
import { copyShaderPatches } from '../shaderPatches';
import { parseFamilyMaterial, type FamilyMaterialParams } from '@wildshard/format/materialFamilies';
import { compileEmissive, type EmissiveLook } from './emissive';
import { compilePainterly, type PainterlyLook } from './painterly';
import { compilePbr, type TextureResolver } from './pbr';
import { updateGround } from './ground';
import { compileToon, type ToonLook } from './toon';

/** What a compiler may read besides the material's own parameters. */
export interface FamilyContext {
  /** Named light-pool uniforms supplied by the owning presentation. */
  readonly emitterPools?: (id: string) => { readonly value: readonly THREE.Vector4[] };
  /** the toon look its toon materials share (one per shard) */
  readonly toon: ToonLook;
  /** the painterly look its painterly materials share (one per shard; needed only for painterly entries) */
  readonly painterly?: PainterlyLook;
  /** the emissive look its emissive materials share (one per shard; needed only for emissive entries) */
  readonly emissive?: EmissiveLook;
  /** texture references → textures */
  readonly textures: TextureResolver;
  /** owns the materials: they stop being tracked for the shader step when it is disposed */
  readonly scope: Scope;
}

const live = new Map<THREE.Material, FamilyMaterialParams>();

function compile(params: FamilyMaterialParams, ctx: FamilyContext): THREE.Material {
  if (params.family === 'toon') return compileToon(params, ctx.toon);
  if (params.family === 'pbr') return compilePbr(params, ctx.textures, ctx.emitterPools);
  if (params.family === 'painterly') {
    if (ctx.painterly === undefined) throw new Error('material family: a painterly entry needs a painterly look in its family context');
    return compilePainterly(params, ctx.painterly, ctx.textures);
  }
  if (ctx.emissive === undefined) throw new Error('material family: an emissive entry needs an emissive look in its family context');
  return compileEmissive(params, ctx.emissive, ctx.textures);
}

/**
 * A family material from a material entry (validated here, defaults filled), tracked for the shader step until
 * `ctx.scope` is disposed. Several entries with equal parameters still get their own material; share the result to share uniforms.
 */
export function familyMaterial(entry: unknown, ctx: FamilyContext): THREE.Material {
  const params = parseFamilyMaterial(entry);
  const m = compile(params, ctx);
  live.set(m, params);
  ctx.scope.onDispose(() => { live.delete(m); });
  return m;
}

/**
 * Move a live family material to `params` (the same entry with some numbers moved: a state-bound curve, SF59's material
 * twin) through uniforms only: a PBR surface's roughness, metalness and ground layer. Anything else needs a new program.
 */
export function moveFamilyMaterial(m: THREE.Material, params: FamilyMaterialParams): void {
  if (params.family !== 'pbr' || !(m instanceof THREE.MeshStandardMaterial)) throw new Error(`moveFamilyMaterial: a ${params.family} material does not move`);
  m.roughness = params.roughness; m.metalness = params.metalness;
  if (params.ground !== null) updateGround(m, params.ground);
  if (live.has(m)) live.set(m, params);
}

/**
 * A variant of `base` (a family material, or any material) that keeps its family's program: three's `clone()` copies the
 * numbers but drops the shader patches, the program key and `onBeforeRender`, so a cloned toon or painterly material
 * renders plain. The variant runs `base`'s patch chain under its key, shares its look and per-material uniforms (one
 * `familyUniforms` object), keeps its render hook, then takes `configure`'s per-object changes (a colour, a map, a side).
 * A variant of a live family material is live too, for the shader step, until `scope` is disposed. Share one variant per
 * distinct configuration: equal variants are one material, one set of uniforms.
 */
export function familyVariant(base: THREE.Material, scope: Scope, configure: (m: THREE.Material) => void = () => undefined): THREE.Material {
  // three's copy deep-copies userData through JSON: a family's uniforms (textures among them) are shared, not serialised
  const userData = base.userData;
  base.userData = {};
  let m: THREE.Material;
  try { m = base.clone(); } finally { base.userData = userData; }
  m.userData = { ...userData };
  copyShaderPatches(base, m);
  const render = Object.getOwnPropertyDescriptor(base, 'onBeforeRender');
  if (render !== undefined) Object.defineProperty(m, 'onBeforeRender', render);
  configure(m);
  const params = live.get(base);
  if (params !== undefined) { live.set(m, params); scope.onDispose(() => { live.delete(m); }); }
  return m;
}


/** the stand-in geometry a family program is compiled on: position, normal, uv and a colour attribute */
let standInGeometry: THREE.BufferGeometry | null = null;
function standIn(): THREE.BufferGeometry {
  if (standInGeometry) return standInGeometry;
  const g = new THREE.BoxGeometry(1, 1, 1);
  g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(g.getAttribute('position').count * 3).fill(1), 3));
  standInGeometry = g;
  return g;
}

/** the parts of a family material that change its program, beyond the family's shared key (a named prop surface's maps among them, SF55) */
function variantKey(m: THREE.Material): string {
  const s = m as THREE.MeshStandardMaterial;
  return `${m.customProgramCacheKey()}|${m.type}|${s.vertexColors ? 'v' : ''}${s.flatShading ? 'f' : ''}${s.map ? 'm' : ''}${s.normalMap ? 'n' : ''}${s.aoMap ? 'o' : ''}${s.emissiveMap ? 'e' : ''}${s.roughnessMap ? 'r' : ''}|${m.side}|${m.alphaTest > 0 ? 't' : ''}|${m.transparent ? 'a' : ''}|${m.toneMapped ? 'k' : ''}`;
}

/**
 * Shader-step jobs for every live family program not yet compiled: one plain stand-in mesh per distinct program variant
 * (instanced and skinned variants already in the scene are the scene jobs' clones), drawn with `target`'s fog and lights into `rt`. Programs the scene
 * already holds are cache hits. Empty when no family material is live.
 * Optional exclusions remove known region-only materials from exterior variants. Unplaced families stay prepared,
 * as do materials shared with surviving content: later spawns and separate view passes need those programs too.
 */
export function familyCompileJobs(target: THREE.Scene | null, rt: THREE.WebGLRenderTarget | null, per = 6, excludedMaterials?: ReadonlySet<THREE.Material>): CompileJob[] {
  const seen = new Set<string>();
  const meshes: THREE.Mesh[] = [];
  const geometry = standIn();
  for (const m of live.keys()) {
    if (excludedMaterials?.has(m) === true) continue;
    const key = variantKey(m);
    if (seen.has(key)) continue;
    seen.add(key);
    meshes.push(new THREE.Mesh(geometry, m));
  }
  const jobs: CompileJob[] = [];
  for (let i = 0; i < meshes.length; i += per) {
    const root = new THREE.Group();
    for (const mesh of meshes.slice(i, i + per)) root.add(mesh);
    jobs.push({ label: engineString('s_4bdf150dd0ed', [i]), root, target, rt });
  }
  return jobs;
}
