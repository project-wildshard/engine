import { BufferAttribute, ClampToEdgeWrapping, Texture, Vector3, type Material, type Matrix4, type BufferGeometry, type Color } from 'three';
import { ResourceMemo } from '@wildshard/engine/app/cachedAssets';
import { loadTexture } from '@wildshard/engine/core/assets';
import { parseCoverAppearance, type CoverAppearanceRow } from '@wildshard/format/coverAppearance';
import type { ShardFolder } from '../../../shared/game/shardfile/shardFolder';
import { isLent, lentLook, lentLooksOf, lentMappedLook, setLentParam, type LentLooks } from '../shardfile/lentLooks';

export type CoverMaterial = Material & { map: Texture | null; roughness: number };

/** One compiled graph book with row-owned maps, attributes and live view bindings.
 * APIs accept data and resource ids; shards cannot replace construction/update hooks. */
class CoverAppearanceBook {
  readonly row: CoverAppearanceRow;
  private readonly textures = new ResourceMemo<string, Texture>(id => {
    for (const kind of this.row.kinds) if (kind.texture === id) this.materials.invalidate(kind.id);
  });
  private readonly materials = new ResourceMemo<string, Material>();
  private readonly graphs: readonly string[];
  private readonly lends = new Map<string, LentLooks>();
  private readonly viewer = new Vector3();
  private readonly vector = [0, 0, 0];
  constructor(input: unknown) {
    this.row = parseCoverAppearance(input);
    this.graphs = [...new Set(this.row.kinds.map(kind => kind.graph))];
  }
  /** Named immutable product image, shared until its GPU resource retires. */
  texture(product: ShardFolder, id: string): Promise<Texture> {
    const row = this.row.textures[id];
    if (row === undefined) return Promise.reject(new Error(`Missing cover texture: ${id}`));
    return this.textures.load(id, () => loadTexture(product.url(row.url), row.srgb, 1, undefined,
      value => { if (!row.repeat) value.wrapS = value.wrapT = ClampToEdgeWrapping; }));
  }
  /** Complete mapped acquisition before constructing the field, preserving row order. */
  async prepare(product: ShardFolder): Promise<this> {
    await Promise.all(this.row.kinds.flatMap(kind => kind.texture === undefined ? [] : [this.texture(product, kind.texture)]));
    for (const row of this.row.kinds) this.material(row.id);
    return this;
  }
  material(id: string): Material {
    return this.materials.acquire(id, () => this.makeMaterial(id));
  }
  private makeMaterial(id: string): Material {
    const row = this.row.kinds.find(kind => kind.id === id);
    if (row === undefined) throw new Error(`Missing cover kind: ${id}`);
    const texture = row.texture === undefined ? undefined : this.textures.peek(row.texture);
    if (row.texture !== undefined && texture === undefined) throw new Error(`Cover texture is not prepared: ${row.texture}`);
    const material = texture === undefined ? lentLook(row.graph) : lentMappedLook(row.graph, texture);
    if (texture !== undefined && (!mapped(material) || material.map !== texture)) throw new Error(`Cover look is not mapped: ${row.graph}`);
    // QF21: params go to the compile these materials came from; a frame's owner can resolve the id to another lend. The
    // book outlives a visit (one per product), so a material built again after re-entry takes the new visit's lend
    this.lends.set(row.graph, lentLooksOf(row.graph));
    if (row.name !== undefined) material.name = row.name;
    Object.assign(material, row.properties);
    return material;
  }
  mapped(id: string): CoverMaterial {
    const material = this.material(id); if (!mapped(material)) throw new Error(`Cover material lacks a map slot: ${id}`); return material;
  }
  /** Original geometry and constant per-vertex channels; no new instance law. */
  geometry(id: string, geometry: BufferGeometry): BufferGeometry {
    const row = this.row.kinds.find(kind => kind.id === id);
    if (row === undefined) throw new Error(`Missing cover kind: ${id}`);
    for (const [name, value] of Object.entries(row.attributes)) geometry.setAttribute(name,
      new BufferAttribute(new Float32Array(geometry.getAttribute('position').count).fill(value), 1));
    return geometry;
  }
  set(name: string, value: number | readonly number[]): void {
    for (const id of this.graphs) {
      const lend = this.lends.get(id);
      // a lend retired with its visit (Pine's warm re-entry wrote the left visit's: "Material scope unloaded") falls back
      if (lend === undefined || !isLent(lend)) { this.lends.delete(id); setLentParam(id, name, value); } else lend.setParam(id, name, value);
    }
  }
  /** The view is already in world space for streams; fixed fields supply their frame. */
  update(viewer: Vector3, frame?: Matrix4, sun?: Color): void {
    const at = this.viewer.copy(viewer); if (frame !== undefined) at.applyMatrix4(frame);
    const params = this.row.params;
    if (params.viewer !== undefined) this.set(params.viewer, this.xyz(at.x, at.y, at.z));
    if (params.shift !== undefined && frame !== undefined) this.set(params.shift, this.xyz(frame.elements[12], frame.elements[13], frame.elements[14]));
    if (params.sunTint !== undefined && sun !== undefined) this.set(params.sunTint, this.xyz(sun.r, sun.g, sun.b));
  }
  private xyz(x: number, y: number, z: number): readonly number[] { const out = this.vector; out[0] = x; out[1] = y; out[2] = z; return out; }
}
/** Client-only borrowed handle. Construction stays private; consumers cannot supply overrides. */
export type CoverAppearance = Pick<CoverAppearanceBook, 'row' | 'texture' | 'prepare' | 'material' | 'mapped' | 'geometry' | 'set' | 'update'>;
/** Admit a bounded appearance book from rows, with no per-shard construction hooks. */
export function createCoverAppearance(input: unknown): CoverAppearance { return new CoverAppearanceBook(input); }
function mapped(material: Material): material is CoverMaterial {
  const map: unknown = Reflect.get(material, 'map');
  return (map === null || map instanceof Texture) && typeof Reflect.get(material, 'roughness') === 'number';
}
const products = new WeakMap<ShardFolder, Map<string, Promise<CoverAppearance>>>();
/** Borrow the same immutable appearance for cover and other meshes using its images. */
export function folderCoverAppearance(product: ShardFolder, file: string): Promise<CoverAppearance> {
  let files = products.get(product); if (files === undefined) { files = new Map(); products.set(product, files); }
  const previous = files.get(file); if (previous !== undefined) return previous;
  const pending = product.file(file).then(bytes => createCoverAppearance(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes))));
  files.set(file, pending);
  const cache = files; void pending.catch(() => { if (cache.get(file) === pending) cache.delete(file); });
  return pending;
}
