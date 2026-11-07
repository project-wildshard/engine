/**
 * The seams' look (SHARD-PLATFORM SF17b look, phase 2: G74 / G90 / G91 / G99 / G101): the materials the platform's
 * generated deck and seams wear. The generator (`@wildshard/engine/sim/strips`) returns ONE triangle mesh per strip, the
 * same triangles the world collides with, plus ordered feature ranges naming what each run of triangles is (the deck, the
 * neutral buffer, the gradient, a retaining wall, a cliff and its talus, a parapet, Driftwood's dike, a culvert, the road
 * wall and its rail). This look never rebuilds that geometry: it copies the vertices once into the home frame and sorts the
 * index ranges by material; `seamSolid` hands every opaque material to the road system's one solid material
 * (`roadSolid.ts`, the old texture as a grain layer) and the curtain to its own mesh, so the whole platform is two draws.
 *
 * - **ground** (deck, neutral buffer, gradient, the quarter-metre overlap, turn-ins): the generator's vertex colours, the
 *   neutral platform grey easing into each shard's own edge colour, under a fine gravel grain.
 * - **stone** (retaining walls, parapets, the culvert, a shore's rip-rap revetment, G149): neutral dressed stone, the same
 *   for every shard (G90).
 * - **rock** (a shard's cliff and its talus apron): the shard's own surface (G90): its `sourceSurface` colour when the
 *   reader resolves one, else the shard's edge colour sampled from the gradient row beside it, under rock strata.
 * - **dike** (G91): the dike's stone revetment, rounded rip-rap boulders.
 * - **curtain** (the road wall at an edge that can't blend, G99 / G101): a faint cyan grid, unlit and additive, no glass.
 * - **rail** (its top bar): the thin glowing cyan rail, unlit, past tone mapping like the void's rail (G89).
 */
import { AdditiveBlending, BufferAttribute, BufferGeometry, Color, DoubleSide, ShaderMaterial, Sphere, Vector3 } from 'three';
import { CONTENT_CAPS } from '@wildshard/engine/core/config';
import { SEAM_BUCKETS, seamMeshSteps, type SeamBucket, type SeamGeometryChannels, type SeamLookState, type SeamPiece, type SeamSurfaces } from '../../../shared/game/grid/seamGeometry';
import { linear, splitByKey, tintedPart, uniformPart, type GrainLayer, type SolidPart } from './roadSolid';

const CYAN = new Color(0x38e6ff);

/** The seams' mesh (`seamMeshSteps`) as one geometry whose index is grouped by material. */
export function* seamLookGeometrySteps(pieces: readonly SeamPiece[], home: { readonly origin: { readonly x: number; readonly z: number } }, surfaces?: SeamSurfaces, pitch: number = CONTENT_CAPS.pitch, channels?: SeamGeometryChannels): Generator<void, { geometry: BufferGeometry; state: SeamLookState }, undefined> {
  const mesh = yield* seamMeshSteps(pieces, home, surfaces, pitch, channels);
  const geometry = new BufferGeometry().setAttribute('position', new BufferAttribute(mesh.position, 3)).setAttribute('color', new BufferAttribute(mesh.colour, 3))
    .setIndex(new BufferAttribute(mesh.index, 1)).setAttribute('normal', new BufferAttribute(mesh.normal, 3)).setAttribute('uv', new BufferAttribute(mesh.uv, 2));
  mesh.groups.forEach((g) => { geometry.addGroup(g.start, g.count, SEAM_BUCKETS.indexOf(g.bucket)); });
  geometry.boundingSphere = new Sphere(new Vector3(...mesh.sphere.centre), mesh.sphere.radius);
  return { geometry, state: mesh.state };
}

/** A deterministic hash in [0, 1) (the look is identical every run). */
function hash(n: number): number { const s = Math.sin(n * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); }
/** Light grain over white, so the vertex colour (the shard's edge colour) keeps its value. */
export function gravel(g: CanvasRenderingContext2D, s: number): void {
  g.fillStyle = '#ececec'; g.fillRect(0, 0, s, s);
  for (let k = 0; k < s * s / 10; k++) {
    const r = hash(k * 1.7), l = Math.round(200 + r * 55), x = hash(k * 3.3) * s, y = hash(k * 5.9) * s;
    g.fillStyle = `rgb(${String(l)},${String(l)},${String(l - 4)})`; g.fillRect(x, y, 1 + (r > 0.8 ? 1 : 0), 1 + (r > 0.9 ? 1 : 0));
  }
}
/** Dressed stone courses: offset blocks with dark mortar (2.4 m per tile: four courses). */
export function stone(g: CanvasRenderingContext2D, s: number): void {
  g.fillStyle = '#5c5a55'; g.fillRect(0, 0, s, s);
  const rows = 4, h = s / rows;
  for (let r = 0; r < rows; r++) {
    let x = r % 2 === 0 ? 0 : -s / 6;
    while (x < s) {
      const w = s / 3 * (0.7 + hash(r * 31 + x) * 0.6), l = Math.round(150 + hash(r * 7 + x * 3) * 40);
      g.fillStyle = `rgb(${String(l)},${String(l - 4)},${String(l - 12)})`; g.fillRect(x + 3, r * h + 3, w - 6, h - 6);
      for (let k = 0; k < 40; k++) { const q = hash(r * 97 + x + k); g.fillStyle = `rgba(0,0,0,${String(0.04 + q * 0.06)})`; g.fillRect(x + 3 + hash(k + x) * (w - 8), r * h + 3 + hash(k * 2 + r) * (h - 8), 3, 2); }
      x += w;
    }
  }
}
/** Rock strata: soft horizontal bands with cracks, near white so the shard's colour leads. */
export function strata(g: CanvasRenderingContext2D, s: number): void {
  for (let y = 0; y < s; y++) { const l = Math.round(170 + 50 * hash(Math.floor(y / 6)) + 25 * Math.sin(y * 0.09)); g.fillStyle = `rgb(${String(l)},${String(l)},${String(l)})`; g.fillRect(0, y, s, 1); }
  g.strokeStyle = 'rgba(40,36,32,0.35)'; g.lineWidth = 2;
  for (let k = 0; k < 18; k++) { let x = hash(k * 13) * s, y = hash(k * 17) * s; g.beginPath(); g.moveTo(x, y); for (let j = 0; j < 5; j++) { x += (hash(k * 5 + j) - 0.5) * 30; y += 12 + hash(k + j * 3) * 20; g.lineTo(x, y); } g.stroke(); }
}
/** The dike's revetment: rounded rip-rap boulders packed in dark joints. */
export function riprap(g: CanvasRenderingContext2D, s: number): void {
  g.fillStyle = '#3b3833'; g.fillRect(0, 0, s, s);
  for (let k = 0; k < 70; k++) {
    const x = hash(k * 2.1) * s, y = hash(k * 4.7) * s, r = s * (0.05 + hash(k * 8.3) * 0.05), l = Math.round(120 + hash(k * 6.1) * 60);
    for (const [ox, oy] of [[0, 0], [s, 0], [-s, 0], [0, s], [0, -s]] as const) {
      const grad = g.createRadialGradient(x + ox - r * 0.3, y + oy - r * 0.3, r * 0.1, x + ox, y + oy, r);
      grad.addColorStop(0, `rgb(${String(l + 30)},${String(l + 26)},${String(l + 18)})`); grad.addColorStop(1, `rgb(${String(l - 40)},${String(l - 42)},${String(l - 46)})`);
      g.fillStyle = grad; g.beginPath(); g.ellipse(x + ox, y + oy, r, r * 0.8, hash(k) * 3, 0, Math.PI * 2); g.fill();
    }
  }
}

const curtainVertex = /* glsl */ `
varying vec3 vWorld;
void main() { vec4 world = modelMatrix * vec4(position, 1.0); vWorld = world.xyz; gl_Position = projectionMatrix * viewMatrix * world; }`;
const curtainFragment = /* glsl */ `
uniform vec3 uLine;
uniform vec2 uOrigin;
varying vec3 vWorld;
void main() {
  // the faint grid on the curtain: 0.5 m squares along the wall, brighter toward its top and fading with distance
  vec2 p = vec2(vWorld.x + vWorld.z + uOrigin.x + uOrigin.y, vWorld.y) / 0.5;
  vec2 w = max(fwidth(p), vec2(1e-4));
  vec2 d = abs(fract(p - 0.5) - 0.5) / w;
  float line = 1.0 - min(min(d.x, d.y), 1.0);
  float fade = exp(-length(vWorld.xz - cameraPosition.xz) / 90.0);
  float rise = 0.35 + 0.65 * clamp(vWorld.y / 1.8, 0.0, 1.0);
  gl_FragColor = vec4(uLine * (0.05 + line * 0.55) * rise * fade, 1.0);
}`;

/** The seam's old material colours that multiplied their maps (now baked into the solid part's vertex colours). */
const STONE = 0xc9c4b8, DIKE = 0xe0dcd2;
const LAYER_OF: Readonly<Record<Exclude<SeamBucket, 'curtain'>, GrainLayer>> = { ground: 'gravel', stone: 'stone', rock: 'strata', dike: 'riprap', rail: 'white' };

/** The private merge already has one ordered group per bucket. Retain that order
 * without regrouping every triangle or boxing its final local indices. */
function splitSeamGroups(geometry: BufferGeometry): Omit<ReturnType<typeof splitByKey>[number], 'source'>[] {
  const index = geometry.getIndex(), position = geometry.getAttribute('position');
  const capacity = position.count;
  // Keep the general sparse path for unusually large caller-built seams. The
  // one reused lookup is bounded by the splitter's existing transient limit.
  if (index === null || !(index.array instanceof Uint32Array) || capacity * 4 > 16_000_000) {
    const buckets = new Int8Array((index?.count ?? 0) / 3).fill(-1);
    for (const group of geometry.groups) buckets.fill(group.materialIndex ?? 0, group.start / 3, (group.start + group.count) / 3);
    return splitByKey(geometry, triangle => buckets[triangle] ?? 0, SEAM_BUCKETS.length);
  }
  const lookup = new Uint32Array(capacity);
  const result: Omit<ReturnType<typeof splitByKey>[number], 'source'>[] = Array.from({ length: SEAM_BUCKETS.length }, () => ({ positions: new Float32Array(0), normals: new Float32Array(0), colours: new Float32Array(0), uvs: new Float32Array(0), indices: new Uint32Array(0) }));
  for (const group of geometry.groups) {
    const source: number[] = [], sparse = new Map<number, number>(), indices = new Uint32Array(group.count);
    for (let corner = 0; corner < group.count; corner++) {
      const vertex = index.array[group.start + corner] ?? 0;
      let local = vertex < capacity ? (lookup[vertex] ?? 0) - 1 : sparse.get(vertex);
      if (local === undefined || local < 0) {
        local = source.length; source.push(vertex);
        if (vertex < capacity) lookup[vertex] = local + 1; else sparse.set(vertex, local);
      }
      indices[corner] = local;
    }
    const pick = (name: string, size: number, fallback: number): Float32Array => {
      const array = geometry.getAttribute(name).array, values = new Float32Array(source.length * size);
      for (let ordinal = 0; ordinal < source.length; ordinal++) for (let channel = 0; channel < size; channel++) values[ordinal * size + channel] = array[(source[ordinal] ?? 0) * size + channel] ?? fallback;
      return values;
    };
    result[group.materialIndex ?? 0] = { positions: pick('position', 3, 0), normals: pick('normal', 3, 0), colours: pick('color', 3, 1), uvs: pick('uv', 2, 0), indices };
    for (const vertex of source) if (vertex < capacity) lookup[vertex] = 0;
  }
  return result;
}

/** `seamSolid` with the curtain still as arrays, so its geometry is built (and admitted, G144) by `roadLookPlatform.ts`; in
 *  steps (`seamLookGeometrySteps`), so the road's sliced install pauses inside it. */
export function* seamSolidSteps(pieces: readonly SeamPiece[], home: { readonly origin: { readonly x: number; readonly z: number } }, surfaces?: SeamSurfaces, pitch: number = CONTENT_CAPS.pitch, channels?: SeamGeometryChannels): Generator<void, { parts: SolidPart[]; curtain: SeamCurtain; state: SeamLookState }> {
  const { geometry, state } = yield* seamLookGeometrySteps(pieces, home, surfaces, pitch, channels);
  yield;
  const split = splitSeamGroups(geometry), parts: SolidPart[] = [];
  yield;
  let curtain: SeamCurtain = { positions: new Float32Array(0), indices: new Uint32Array(0) };
  SEAM_BUCKETS.forEach((bucket, k) => {
    const part = split[k]; if (part === undefined || part.indices.length === 0) return;
    if (bucket === 'curtain') { curtain = { positions: part.positions, indices: part.indices }; return; }
    const layered = uniformPart(part, LAYER_OF[bucket], bucket === 'rail');
    parts.push(bucket === 'stone' ? tintedPart(layered, linear(STONE)) : bucket === 'dike' ? tintedPart(layered, linear(DIKE)) : bucket === 'rail' ? tintedPart(layered, CYAN.clone().multiplyScalar(1.6)) : layered);
  });
  geometry.dispose();
  return { parts, curtain, state };
}

/** The curtain's triangles (positions only, home frame) before they become a geometry. */
export interface SeamCurtain { readonly positions: Float32Array; readonly indices: Uint32Array }
/** The curtain's geometry: its own arrays, no copy (an empty curtain is an empty geometry, still one culled mesh). */
export function curtainGeometry(curtain: SeamCurtain): BufferGeometry {
  const geometry = new BufferGeometry().setAttribute('position', new BufferAttribute(curtain.positions, 3)).setIndex(new BufferAttribute(curtain.indices, 1));
  if (curtain.indices.length > 0) geometry.computeBoundingSphere();
  return geometry;
}
/** Float32 values per curtain vertex (`position`). */
export const CURTAIN_FLOATS = 3;
/** The curtain as the cull count reads it (`roadCull.ts` `CullSource`). */
export function curtainSource(curtain: SeamCurtain): { vertices: number; position: (k: number) => number; indices: ArrayLike<number> } {
  return { vertices: curtain.positions.length / 3, position: (k) => curtain.positions[k] ?? 0, indices: curtain.indices };
}

/** The additive curtain material (G99 / G101), drawn in one pass (additive needs no back-then-front order). */
export function curtainMaterial(home: { readonly origin: { readonly x: number; readonly z: number } }): ShaderMaterial {
  const curtain = new ShaderMaterial({ vertexShader: curtainVertex, fragmentShader: curtainFragment, uniforms: { uLine: { value: CYAN.clone() }, uOrigin: { value: [home.origin.x, home.origin.z] } },
    transparent: true, depthWrite: false, blending: AdditiveBlending, side: DoubleSide, fog: false, lights: false });
  curtain.name = 'grid-seam-curtain'; curtain.forceSinglePass = true;
  return curtain;
}
