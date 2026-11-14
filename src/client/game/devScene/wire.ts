/**
 * SHARD-SOURCE AP5 (AUTHORING-PARITY M1): the dev scene wire. `wildshard watch` (sharddev `src/sharddev/watch/`) runs the
 * author's three.js scene, lowers it to parts, and serves them on the dev server; a DEVSERVER page reads them here. The
 * shape mirrors sharddev's `scene/description.ts`: every colour is linear, every matrix column-major in world metres.
 *
 *   GET /__wildshard_scene/events             server-sent events, one `DevSceneState` per revision (the first on connect)
 *   GET /__wildshard_scene/part/<name>        one `DevPart` (JSON)
 *   GET /__wildshard_scene/geometry/<key>     one geometry (`decodeGeometry`), immutable by key
 *   GET /__wildshard_scene/texture/<key>      one RGBA8 raster, row 0 at v = 0, immutable by key
 *
 * A production build has none of this: the page imports it only behind `DEVSERVER` (engine `scripts/check-devserver.mjs`
 * refuses a production bundle holding `DEV_SCENE_PATH`).
 */
export const DEV_SCENE_WIRE = 1;
export const DEV_SCENE_PATH = '/__wildshard_scene/';

export type Rgb = readonly [number, number, number];
export type Vec3 = readonly [number, number, number];

export interface DevSceneState {
  readonly wire: number;
  readonly revision: number;
  /** every part and its content hash; a part missing here is gone */
  readonly parts: readonly { readonly name: string; readonly hash: string }[];
  /** the last compile's refusal, shown by the page; the parts stay as they were */
  readonly error: string | null;
}

export interface DevMaterial {
  readonly key: string;
  readonly name: string;
  readonly kind: 'standard' | 'basic' | 'sprite';
  readonly colour: Rgb;
  readonly roughness: number;
  readonly metalness: number;
  readonly emissive: Rgb;
  readonly emissiveIntensity: number;
  readonly map: string | null;
  readonly repeat: readonly [number, number];
  readonly offset: readonly [number, number];
  readonly alphaTest: number;
  readonly side: 'front' | 'back' | 'double';
  readonly vertexColours: boolean;
  readonly transparent: boolean;
  readonly opacity: number;
  readonly blending: 'normal' | 'additive';
  readonly depthWrite: boolean;
  readonly fog: boolean;
}

export interface DevTexture { readonly key: string; readonly width: number; readonly height: number; readonly colourSpace: 'srgb' | 'linear' }

export interface DevDraw {
  readonly geometry: string;
  readonly material: string;
  readonly matrix: readonly number[];
  readonly instances: { readonly count: number; readonly matrices: readonly number[]; readonly colours: readonly number[] | null } | null;
  readonly castShadow: boolean;
  readonly receiveShadow: boolean;
}

export interface DevPart {
  readonly name: string;
  readonly hash: string;
  readonly materials: readonly DevMaterial[];
  readonly textures: readonly DevTexture[];
  readonly geometries: readonly string[];
  readonly draws: readonly DevDraw[];
  readonly sprites: readonly { readonly material: string; readonly position: Vec3; readonly scale: readonly [number, number]; readonly center: readonly [number, number] }[];
  /** point lights only: the shard's sun, sky and fog come from its shardfile's look */
  readonly lights: readonly { readonly colour: Rgb; readonly intensity: number; readonly distance: number; readonly decay: number; readonly position: Vec3 }[];
  readonly colliders: readonly { readonly centre: Vec3; readonly half: Vec3; readonly rotation: readonly [number, number, number, number] }[];
  readonly water: readonly { readonly tint: Rgb; readonly triangles: readonly number[] }[];
}

export interface DevGeometry {
  readonly position: Float32Array;
  readonly normal: Float32Array;
  readonly uv: Float32Array | null;
  readonly colour: Float32Array | null;
  readonly index: Uint32Array | null;
}

/** Five little-endian u32 element counts (position, normal, uv, colour, index), then each array in that order. */
export function decodeGeometry(bytes: ArrayBuffer): DevGeometry {
  const header = new DataView(bytes, 0, 20), counts = [0, 1, 2, 3, 4].map(i => header.getUint32(i * 4, true));
  let offset = 20;
  const take = (count: number): Float32Array => { const out = new Float32Array(bytes.slice(offset, offset + count * 4)); offset += count * 4; return out; };
  const [positions = 0, normals = 0, uvs = 0, colours = 0, indices = 0] = counts;
  const position = take(positions), normal = take(normals), uv = uvs > 0 ? take(uvs) : null, colour = colours > 0 ? take(colours) : null;
  const index = indices > 0 ? new Uint32Array(bytes.slice(offset, offset + indices * 4)) : null;
  if (offset + indices * 4 !== bytes.byteLength) throw new Error(`dev scene: geometry is ${bytes.byteLength} bytes, its header says ${offset + indices * 4}`);
  return { position, normal, uv, colour, index };
}
