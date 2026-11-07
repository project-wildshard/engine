/**
 * The road system's one solid material (SHARD-PLATFORM SF17b per-view budget, G101: "strategic about not wasting resources
 * triangles or draws on the road system"). Everything opaque that wore its own material — the seams' ground, stone, rock,
 * dike and rail, the kerbs and roundabout islands, the streetlight poles and heads, the void's rail and posts — is one mesh
 * with one material, so the whole lot is one draw per view (and `roadCull.ts` draws only the bins in view).
 *
 * The look is unchanged: each triangle carries what its old material gave it. Vertex colours carry the old material colour
 * (stone, dike, kerbs, posts) or the generator's colours (ground, rock); a per-vertex `grain` attribute picks the old
 * texture as a layer of one texture array (gravel, stone courses, rock strata, rip-rap, plain white) at the old world-planar
 * uv, and flags the old unlit materials (the cyan rails, the lamp heads), which skip lighting exactly as `MeshBasicMaterial`
 * did. Parts never share a vertex across materials, so a triangle's layer is constant.
 */
import { BufferAttribute, BufferGeometry, Color, DataArrayTexture, LinearFilter, LinearMipmapLinearFilter, MeshLambertMaterial, RepeatWrapping, SRGBColorSpace, type Texture } from 'three';
import { PATCH_ORDER, patchShader } from '@wildshard/engine/render/shaderPatches';

/** The texture array's layers, in order. */
export const GRAIN_LAYERS = ['gravel', 'stone', 'strata', 'riprap', 'white'] as const;
export type GrainLayer = (typeof GRAIN_LAYERS)[number];
export const grainLayer = (name: GrainLayer): number => GRAIN_LAYERS.indexOf(name);

/** A run of solid triangles: positions, normals, linear colours, uvs (texture units), and per vertex its layer + unlit flag. */
export interface SolidPart {
  readonly positions: ArrayLike<number>; readonly normals: ArrayLike<number>; readonly colours: ArrayLike<number>;
  readonly uvs: ArrayLike<number>; readonly grain: ArrayLike<number>; readonly indices: ArrayLike<number>;
}

/** A part with one layer and lighting for every vertex (the kerb, pole and post meshes). */
export function uniformPart(part: Omit<SolidPart, 'grain'>, layer: GrainLayer, unlit = false): SolidPart {
  const count = part.positions.length / 3, grain = new Float32Array(count * 2);
  for (let k = 0; k < count; k++) { grain[k * 2] = grainLayer(layer); grain[k * 2 + 1] = unlit ? 1 : 0; }
  return { ...part, grain };
}

/** Every vertex of a part recoloured (a material colour that used to multiply the map). */
export function tintedPart(part: SolidPart, colour: Color): SolidPart {
  const colours = new Float32Array(part.positions.length);
  for (let k = 0; k < colours.length; k += 3) { colours[k] = colour.r; colours[k + 1] = colour.g; colours[k + 2] = colour.b; }
  return { ...part, colours };
}

/** Vertices copied between pauses: the platform deck's whole merge ran ~18 ms in one Simulator task. */
const SOLID_VERTICES_PER_STEP = 8192;
/** Merge parts into one geometry (`position`, `normal`, `color`, `grainUv` = u, v, layer, unlit), pausing after every few
 *  thousand copied vertices. Pure (no GPU). */
export function* solidGeometrySteps(parts: readonly SolidPart[]): Generator<void, BufferGeometry> {
  let vertices = 0, indices = 0, copied = 0;
  for (const p of parts) { vertices += p.positions.length / 3; indices += p.indices.length; }
  const position = new Float32Array(vertices * 3), normal = new Float32Array(vertices * 3), colour = new Float32Array(vertices * 3), grain = new Float32Array(vertices * 4), index = new Uint32Array(indices);
  let v = 0, i = 0;
  for (const p of parts) {
    const n = p.positions.length / 3;
    for (let k = 0; k < n * 3; k++) { position[v * 3 + k] = p.positions[k] ?? 0; normal[v * 3 + k] = p.normals[k] ?? 0; colour[v * 3 + k] = p.colours[k] ?? 1; }
    for (let k = 0; k < n; k++) {
      grain[(v + k) * 4] = p.uvs[k * 2] ?? 0; grain[(v + k) * 4 + 1] = p.uvs[k * 2 + 1] ?? 0;
      grain[(v + k) * 4 + 2] = p.grain[k * 2] ?? 0; grain[(v + k) * 4 + 3] = p.grain[k * 2 + 1] ?? 0;
    }
    for (let k = 0; k < p.indices.length; k++) index[i + k] = (p.indices[k] ?? 0) + v;
    v += n; i += p.indices.length;
    copied += n; if (copied >= SOLID_VERTICES_PER_STEP) { copied = 0; yield; }
  }
  const geometry = new BufferGeometry().setAttribute('position', new BufferAttribute(position, 3)).setAttribute('normal', new BufferAttribute(normal, 3))
    .setAttribute('color', new BufferAttribute(colour, 3)).setAttribute('grainUv', new BufferAttribute(grain, 4)).setIndex(new BufferAttribute(index, 1));
  geometry.computeBoundingSphere();
  return geometry;
}

const splitMap = Map;
const splitMapGet: unknown = Reflect.get(Map.prototype, 'get'), splitMapSet: unknown = Reflect.get(Map.prototype, 'set');
const splitMapIterator: unknown = Reflect.get(Map.prototype, Symbol.iterator), splitIndexGet: unknown = Reflect.get(BufferAttribute.prototype, 'getX');
interface SplitVertices { map: Map<number, number>; dense?: Uint32Array; valid: number; source: number[]; indices: number[] }

/** The parts of a geometry's triangles, one per key, each with its own vertices (shared vertices are copied per key). */
export function splitByKey(geometry: BufferGeometry, keyOf: (triangle: number) => number, keys: number): { positions: Float32Array; normals: Float32Array; colours: Float32Array; uvs: Float32Array; indices: Uint32Array; source: Uint32Array }[] {
  const index = geometry.getIndex(), attr = (name: string): BufferAttribute | undefined => { const a = geometry.hasAttribute(name) ? geometry.getAttribute(name) : undefined; return a instanceof BufferAttribute ? a : undefined; };
  if (index === null) throw new Error('splitByKey needs an indexed geometry');
  const pos = attr('position'), nor = attr('normal'), col = attr('color'), uv = attr('uv');
  const out: SplitVertices[] = Array.from({ length: keys }, () => ({ map: new Map<number, number>(), valid: 0, source: [], indices: [] }));
  const vertices: unknown = pos === undefined ? undefined : Object.getOwnPropertyDescriptor(pos, 'count')?.value;
  const elements: unknown = Object.getOwnPropertyDescriptor(index, 'count')?.value;
  const capacity = typeof vertices === 'number' && Number.isSafeInteger(vertices) && vertices > 0 ? vertices : 0;
  // Switch only after enough actual vertices were used. Sparse channels keep
  // their small map; all dense tables together stay inside a 16 MB transient.
  const dense = capacity > 0 && typeof elements === 'number' && capacity <= elements * 4 && capacity * out.length * 4 <= 16_000_000
    && Object.getPrototypeOf(index) === BufferAttribute.prototype && !Object.hasOwn(index, 'getX')
    && Object.getOwnPropertyDescriptor(BufferAttribute.prototype, 'getX')?.value === splitIndexGet
    && Map === splitMap && Object.getOwnPropertyDescriptor(Map.prototype, 'get')?.value === splitMapGet
    && Object.getOwnPropertyDescriptor(Map.prototype, 'set')?.value === splitMapSet
    && Object.getOwnPropertyDescriptor(Map.prototype, Symbol.iterator)?.value === splitMapIterator;
  const threshold = 64;
  for (let t = 0; t < index.count / 3; t++) {
    const part = out[keyOf(t)]; if (part === undefined) continue;
    for (let c = 0; c < 3; c++) {
      const n = index.getX(t * 3 + c), ordinary = dense && Number.isInteger(n) && n >= 0 && n < capacity;
      let local: number | undefined;
      if (ordinary && part.dense !== undefined) { const stored = part.dense[n] ?? 0; local = stored === 0 ? undefined : stored - 1; }
      else local = part.map.get(n);
      if (local === undefined) {
        local = part.source.length; part.source.push(n);
        if (ordinary && part.dense !== undefined) part.dense[n] = local + 1;
        else {
          part.map.set(n, local);
          if (ordinary && ++part.valid >= threshold) {
            const lookup = new Uint32Array(capacity), sparse = new Map<number, number>();
            for (const [vertex, ordinal] of part.map) {
              if (Number.isInteger(vertex) && vertex >= 0 && vertex < capacity) lookup[vertex] = ordinal + 1;
              else sparse.set(vertex, ordinal);
            }
            part.dense = lookup; part.map = sparse;
          }
        }
      }
      part.indices.push(local);
    }
  }
  return out.map(({ source, indices }) => {
    const pick = (a: BufferAttribute | undefined, size: number, fallback: number): Float32Array => {
      const o = new Float32Array(source.length * size);
      source.forEach((n, k) => { for (let s = 0; s < size; s++) o[k * size + s] = a === undefined ? fallback : a.array[n * size + s] ?? fallback; });
      return o;
    };
    return { positions: pick(pos, 3, 0), normals: pick(nor, 3, 0), colours: pick(col, 3, 1), uvs: pick(uv, 2, 0), indices: Uint32Array.from(indices), source: Uint32Array.from(source) };
  });
}

/** Paint the layers (256² each, `GRAIN_LAYERS` order) into one sRGB texture array that tiles like the old canvas maps. */
export function grainArray(paint: Readonly<Record<Exclude<GrainLayer, 'white'>, (g: CanvasRenderingContext2D, size: number) => void>>, size = 256): DataArrayTexture {
  const data = new Uint8Array(size * size * 4 * GRAIN_LAYERS.length).fill(255);
  const el = document.createElement('canvas'); el.width = size; el.height = size;
  const g = el.getContext('2d', { willReadFrequently: true }); if (g === null) throw new Error('No 2D canvas for the road grain');
  GRAIN_LAYERS.forEach((name, layer) => {
    if (name === 'white') return;
    g.clearRect(0, 0, size, size); paint[name](g, size);
    const pixels = g.getImageData(0, 0, size, size).data, row = size * 4;
    // the old CanvasTextures were flipY: canvas row 0 at v = 1
    for (let y = 0; y < size; y++) data.set(pixels.subarray(y * row, (y + 1) * row), layer * size * row + (size - 1 - y) * row);
  });
  const texture = new DataArrayTexture(data, size, size, GRAIN_LAYERS.length);
  texture.colorSpace = SRGBColorSpace; texture.wrapS = RepeatWrapping; texture.wrapT = RepeatWrapping;
  texture.minFilter = LinearMipmapLinearFilter; texture.magFilter = LinearFilter; texture.generateMipmaps = true; texture.anisotropy = 8; texture.needsUpdate = true;
  return texture;
}

/** The one solid material: Lambert, vertex colours, the grain layer at its uv, and the unlit flag. */
export function solidMaterial(grain: DataArrayTexture): MeshLambertMaterial {
  const material = new MeshLambertMaterial({ vertexColors: true });
  material.name = 'grid-road-solid';
  patchShader(material, 'sf17b-road-solid', 100, (shader): void => {
    shader.uniforms['uGrain'] = { value: grain };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec4 grainUv;\nvarying vec3 vGrainUv;\nvarying float vGrainUnlit;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvGrainUv = grainUv.xyz;\nvGrainUnlit = grainUv.w;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform highp sampler2DArray uGrain;\nvarying vec3 vGrainUv;\nvarying float vGrainUnlit;')
      .replace('#include <map_fragment>', '#include <map_fragment>\ndiffuseColor *= texture(uGrain, vec3(vGrainUv.xy, floor(vGrainUv.z + 0.5)));')
      .replace('#include <opaque_fragment>', 'outgoingLight = mix(outgoingLight, diffuseColor.rgb, vGrainUnlit);\n#include <opaque_fragment>');
  }, { key: 'sf17b-road-solid' });
  return material;
}

/**
 * G227: a two-colour atlas (every texel `from`, `to` or a canvas blend of the two, the road signs' green and white) held as
 * RG8 linear-light coverage: per texel how far its red and its green channel sit from `from` to `to`, in linear light. The
 * colour is affine in that coverage, so the GPU's mips and trilinear / anisotropic filtering of it equal the linear-light
 * filtering an sRGB RGBA8 texture of the same pixels got (decode, then filter), at half the bytes. Blue's coverage is
 * `blueFromRed` of red's plus the rest of green's. A `sentinel` uv row (v above `sentinel.v`) paints one flat colour
 * without a texel.
 */
export interface CoverageColours {
  readonly from: string; readonly to: string; readonly blueFromRed: number;
  readonly sentinel: { readonly v: number; readonly colour: string };
}
/** sRGB-encoded [0, 1] to linear light (the GPU's sRGB decode). */
function srgbToLinear(c: number): number { return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }
/** A '#rrggbb' colour's linear-light channels. */
function linearRgb(hex: string): readonly [number, number, number] {
  const n = Number.parseInt(hex.slice(1), 16), c = (k: number): number => srgbToLinear(((n >> k) & 255) / 255);
  return [c(16), c(8), c(0)];
}
/** Per 8-bit value of `channel` (0 red, 1 green), its linear-light coverage from `from` to `to` as a byte. */
export function coverageTable(colours: CoverageColours, channel: 0 | 1): Uint8Array {
  const g = linearRgb(colours.from)[channel], w = linearRgb(colours.to)[channel], out = new Uint8Array(256);
  for (let v = 0; v < 256; v++) out[v] = Math.round(Math.min(1, Math.max(0, (srgbToLinear(v / 255) - g) / (w - g))) * 255);
  return out;
}
/** A GLSL vec3 of three numbers. */
function vec3(c: readonly [number, number, number]): string { return `vec3(${c.map((v) => v.toFixed(9)).join(', ')})`; }
/** Lambert with a coverage `map`: the map's coverage turned back into the linear colour (`from` + (`to` − `from`) × t per
 *  channel), the sentinel row flat. The edit chains after the inherited hooks (the scene's fog). */
export function coverageMaterial(map: Texture, colours: CoverageColours, id: string): MeshLambertMaterial {
  const material = new MeshLambertMaterial({ map });
  patchShader(material, id, PATCH_ORDER.material, (shader): void => {
    shader.fragmentShader = shader.fragmentShader.replace('#include <map_fragment>', `#ifdef USE_MAP
  if ( vMapUv.y > ${colours.sentinel.v.toFixed(3)} ) diffuseColor.rgb *= ${vec3(linearRgb(colours.sentinel.colour))};
  else {
    vec2 coverage = texture2D( map, vMapUv ).rg;
    diffuseColor.rgb *= mix( ${vec3(linearRgb(colours.from))}, ${vec3(linearRgb(colours.to))}, vec3( coverage, mix( coverage.y, coverage.x, ${colours.blueFromRed.toFixed(3)} ) ) );
  }
#endif`);
  }, { key: (before) => `${before}|${id}`, pureKey: true });
  return material;
}

/** Linear colour of a hex (three converts sRGB hex to the linear working space). */
export const linear = (hex: number): Color => new Color(hex);

/** Float32 values per solid vertex: `position`, `normal`, `color` (3 each) and `grainUv` (4). */
export const SOLID_FLOATS = 13;
/** The grain array's layer size (texels), as `grainArray` paints it by default. */
export const GRAIN_SIZE = 256;

/** Texels in a full mip chain of a `width` × `height` image (WebGL2 allocates every level down to 1 × 1). */
export function mipTexels(width: number, height: number): number {
  let texels = 0;
  for (let w = width, h = height; ; w = Math.max(1, w >> 1), h = Math.max(1, h >> 1)) { texels += w * h; if (w === 1 && h === 1) break; }
  return texels;
}
/** G144: the same texture once `gpuOnlyTexture` let its source go on upload: a canvas shrinks to one RGBA pixel, a data
 *  array empties; the GPU copy is unchanged. `texelBytes` is the GPU format's bytes per texel (4 for RGBA8, 1 for an R8
 *  canvas upload such as the sign atlas). */
export function gpuOnlyTextureBytes(width: number, height: number, layers = 1, source: 'canvas' | 'data' = 'canvas', texelBytes = 4): { readonly jsBytes: number; readonly gpuBytes: number } {
  return { jsBytes: source === 'canvas' ? 4 : 0, gpuBytes: mipTexels(width, height) * texelBytes * layers };
}

/** A solid part as `solidGeometrySteps` will store it (Float32 positions, its one grain layer and unlit flag), for the cull count. */
export function solidSource(part: SolidPart): { vertices: number; position: (k: number) => number; indices: ArrayLike<number>; layer: number; unlit: number } {
  return { vertices: part.positions.length / 3, position: (k) => Math.fround(part.positions[k] ?? 0), indices: part.indices, layer: Math.fround(part.grain[0] ?? 0), unlit: Math.fround(part.grain[1] ?? 0) };
}
