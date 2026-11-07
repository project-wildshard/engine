import * as THREE from 'three';
import * as v from 'valibot';
import { VertexWearSchema } from '@wildshard/format/vertexWear';
import { BakedWearSchema } from '@wildshard/format/bakedTiles';
import type { ShardProduct } from '../../../shared/game/shardfile/shardProduct';
import { setLentParam, setLentTexture } from '../shardfile/lentLooks';

/** A declared vertex wear file, read: its texture (when it carries one), the rect that samples it, and `wear`, which
 *  hands a built geometry its part's attributes (views over the file's bytes, no copy). */
export interface VertexWear {
  readonly texture: THREE.DataTexture | null;
  readonly rect: readonly [number, number, number, number];
  wear: (geometry: THREE.BufferGeometry, part: number) => void;
}

/** G571: read a vertex wear row's file through the product's verified reader (`format/vertexWear` VertexWearSchema). A
 *  part whose vertex count differs from its geometry refuses: the file was baked for other geometry. Client-only. */
export async function loadVertexWear(product: Pick<ShardProduct, 'file'>, input: unknown): Promise<VertexWear> {
  const row = v.parse(VertexWearSchema, input), bytes = Uint8Array.from(await product.file(row.file)).buffer;
  let texture: THREE.DataTexture | null = null;
  if (row.texture !== null) {
    const { width, height } = row.texture;
    texture = new THREE.DataTexture(new Uint16Array(bytes, 0, width * height * 4), width, height, THREE.RGBAFormat, THREE.HalfFloatType);
    texture.magFilter = THREE.LinearFilter; texture.minFilter = THREE.LinearFilter; texture.colorSpace = THREE.NoColorSpace; texture.needsUpdate = true;
  }
  return { texture, rect: row.rect, wear: (geometry, part) => {
    const [at, count] = row.parts[part] ?? [0, -1];
    if (geometry.getAttribute('position').count !== count) throw new Error('Vertex wear does not match its geometry; rebuild its declared file');
    let offset = at;
    for (const attribute of row.attributes) {
      geometry.setAttribute(attribute.name, new THREE.BufferAttribute(new Uint8Array(bytes, offset, count * attribute.size), attribute.size, true));
      offset += count * attribute.size;
    }
  } };
}

/** G571: a baked tile set's declared wear (format/bakedTiles BakedWearSchema): the tier's file worn by the world's ground
 *  (part 0, when declared) and then by each tile in order, its ground map, rect and fade lent to each declared look.
 *  Client-only. */
export async function wearBakedTiles(product: Pick<ShardProduct, 'file'>, input: unknown, tier: 'phone' | 'desktop',
  ground: THREE.BufferGeometry | null, tiles: readonly THREE.Mesh[]): Promise<void> {
  const wear = v.parse(BakedWearSchema, input), loaded = await loadVertexWear(product, wear.files[tier]), first = wear.ground ? 1 : 0, texture = loaded.texture;
  if (wear.ground) { if (ground === null) throw new Error('Vertex wear needs the world ground'); loaded.wear(ground, 0); }
  tiles.forEach((tile, i) => { loaded.wear(tile.geometry, i + first); });
  if (wear.looks.length > 0 && texture === null) throw new Error('Vertex wear looks need its ground map');
  for (const row of wear.looks) if (texture !== null) {
    setLentParam(row.look, 'fade', [...row.fade[tier]]); setLentParam(row.look, 'groundRect', [...loaded.rect]); setLentTexture(row.look, 'groundMap', texture);
  }
}
