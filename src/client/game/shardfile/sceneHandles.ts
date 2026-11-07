import { BufferGeometry, Group, Material, Mesh, MeshBasicMaterial, MeshStandardMaterial, Object3D, PointLight, Texture, Vector3 } from 'three';
import type { SkyRig } from '@wildshard/engine/world/skyRig';
import type { Placed } from '@wildshard/engine/models/place';
import type { ColliderDesc } from '@wildshard/engine/world/registry';
import { ScenePointRefSchema, type ScenePointRef } from '@wildshard/format/sceneRefs';
import * as v from 'valibot';
import { WorldScenePlacement } from './worldScenePlacement';
import { WorldSceneBatch } from './worldSceneBatch';
import { WorldSceneWeldAssembly } from './worldSceneWeld';
import type { TileContent } from './tileContent';
import type { Scope } from '@wildshard/engine/app/scope';

type NativePart = BufferGeometry | Material | Object3D;
type Handle = NativePart | Texture | Vector3 | number | WorldScenePlacement | WorldSceneBatch | WorldSceneWeldAssembly | readonly ColliderDesc[];

/** Client-only resident names for scene, building and native migration parts.
 * Resources are borrowed: the construction scope retains disposal ownership. */
export class SceneHandles {
  private readonly values = new Map<string, Handle>();
  private readonly materialLists = new Map<string, readonly MeshStandardMaterial[]>();
  private readonly tileContents: TileContent[] = [];
  private readonly waiting = new Map<string, (() => void)[]>();
  constructor(private readonly lighting?: Pick<SkyRig, 'setupMaterial'>,
    private readonly refine?: (id: string, at: { x: number; z: number }, materials: readonly string[], run: () => Promise<void>) => Promise<boolean>) {}
  /** Schedule a living consumer on the control cursor shared with its source
   * maps and frozen scenery. Demand prepares the exact material identities. */
  afterControl(id: string, at: { x: number; z: number }, materials: readonly string[], run: () => Promise<void>): Promise<boolean> {
    if (this.refine === undefined) throw new Error('Scene handles need a control refinement owner');
    return this.refine(id, at, materials, run);
  }
  get sky(): Pick<SkyRig, 'setupMaterial'> {
    if (this.lighting === undefined) throw new Error('Scene handles need world sky');
    return this.lighting;
  }
  has(id: string): boolean { return this.values.has(id) || this.materialLists.has(id); }
  /** Original bake material collections, addressed without reflected owners. */
  publishMaterials(id: string, materials: readonly MeshStandardMaterial[]): void {
    if (this.has(id) || id.length === 0 || id.length > 256) throw new Error('Duplicate or invalid scene material collection');
    this.materialLists.set(id, materials);
  }
  materials(id: string): readonly MeshStandardMaterial[] {
    const materials = this.materialLists.get(id); if (materials === undefined) throw new Error(`Missing scene material collection: ${id}`); return materials;
  }
  /** Host publication refuses every duplicate, including a cross-kind collision. */
  publish(id: string, value: unknown): void {
    if (id.length === 0 || id.length > 256) throw new Error('Invalid world scene handle');
    if (this.has(id)) throw new Error(`Duplicate world scene handle: ${id}`);
    if (!nativeHandle(value)) throw new Error(`Unsupported world scene handle: ${id}`);
    this.values.set(id, value);
    const waiting = this.waiting.get(id); this.waiting.delete(id);
    for (const resolve of waiting ?? []) resolve();
  }
  /** I2: resolves once `id` is published (at once when it already is): a late weld publishes after control. */
  published(id: string): Promise<void> {
    if (this.has(id)) return Promise.resolve();
    return new Promise(resolve => { const waiting = this.waiting.get(id) ?? []; waiting.push(resolve); this.waiting.set(id, waiting); });
  }
  publishColliders(id: string, value: readonly ColliderDesc[]): void { this.publish(id, value); }
  /** Native migration publication is idempotent by resource identity only. */
  lend(resource: NativePart): string {
    if (!this.has(resource.uuid)) this.publish(resource.uuid, resource);
    else if (this.value(resource.uuid) !== resource) throw new Error(`Duplicate world scene handle: ${resource.uuid}`);
    return resource.uuid;
  }
  /** Retire one native publication only while it still names that resource.
   * Evicting an older figure cannot remove its successor or dispose a loan. */
  release(id: string, resource: NativePart | Vector3): boolean {
    if (this.values.get(id) !== resource) return false;
    return this.values.delete(id);
  }
  async place(id: string): Promise<Placed> {
    const value = this.value(id);
    if (!(value instanceof WorldScenePlacement)) throw new Error(`Expected scene placement: ${id}`);
    const placed = await value.load();
    if (!this.has(`${id}.root`)) { this.publish(`${id}.root`, placed.object); this.publishColliders(`${id}.colliders`, placed.colliders); }
    return placed;
  }
  /** Resolve the construction mode before the first entry row publishes a placement root. */
  requiresWhole(id: string): boolean {
    const placement = this.values.get(id);
    if (placement instanceof WorldScenePlacement && placement.requiresWhole()) return true;
    for (const value of this.values.values()) if (value instanceof WorldSceneWeldAssembly && value.usesPlacement(id)) return true;
    return false;
  }
  /**
   * Tile streaming T3: placement `id` by tile instead of whole: its stable container (published as `<id>.root`, empty until
   * tiles attach) and a TileContent the streamer drives; `tiled()` lists every element taken this way, in order. `coarse`
   * (a landmark, T11): beyond the render ring its copies draw as a coarse stand-in, so the skyline survives.
   */
  tile(id: string, options: { readonly coarse?: boolean } = {}): TileContent {
    const value = this.value(id);
    if (!(value instanceof WorldScenePlacement)) throw new Error(`Expected scene placement: ${id}`);
    // placed already (whole, by a stage that needs its copies at once, as a cover field; or tiled by an earlier row): that
    // placement stands, and this one has no tiles of its own
    if (this.has(`${id}.root`)) return { id, tiles: () => new Set<number>(), attach: () => Promise.resolve() };
    if (value.requiresWhole()) throw new Error('Following scene placement requires its original copy');
    // a placement drawn into a set keeps the set as its root (it tiles only its colliders); any other gets a container
    const part = value.drawnInto(), container = part === undefined ? new Group() : null;
    if (container !== null) container.name = id;
    this.publish(`${id}.root`, container ?? this.object(part ?? id));
    // its draws follow the render ring, its colliders (from the same per-tile build) the collider ring (T3, D2 B)
    const content: TileContent = { id, tiles: () => value.tiles(), attach: async (tile, scope) => { await value.attach(tile, scope, container); },
      attachColliders: (tile, scope) => value.attachColliders(tile, scope),
      ...(options.coarse === true ? { coarse: (scope: Scope, rendered: (tile: number) => boolean) => value.coarse(scope, rendered) } : {}) };
    this.tileContents.push(content);
    return content;
  }
  /** The model placement `id`'s copies are (`Placed.model`), placed whole or by tile. */
  placementModel(id: string): string {
    const value = this.value(id);
    if (!(value instanceof WorldScenePlacement)) throw new Error(`Expected scene placement: ${id}`);
    return value.modelId();
  }
  /** T3: a tiled element that is not a placement (a recipe step's merged mesh, `tiledMesh`). */
  addTiled(content: TileContent): void { this.tileContents.push(content); }
  /** Every element placed by tile so far (`tile()`, `addTiled()`), in order. */
  tiled(): readonly TileContent[] { return this.tileContents; }
  /** Whether `id` names a declared frozen graph (a weld assembly) rather than a placement or part. */
  frozen(id: string): boolean { return this.values.get(id) instanceof WorldSceneWeldAssembly; }
  /** Restore a declared frozen graph once, after its living roots have been published. */
  assemble(id: string): Promise<Object3D> {
    const value = this.value(id);
    if (!(value instanceof WorldSceneWeldAssembly)) throw new Error(`Expected frozen scene: ${id}`);
    return value.assemble();
  }
  /** Named placement floors use the admitted contact profile before or after drawing. */
  floorAt(id: string, x: number, z: number): number | undefined {
    const value = this.value(id);
    if (!(value instanceof WorldScenePlacement)) throw new Error(`Expected scene placement: ${id}`);
    return value.floorAt(x, z);
  }
  private value(id: string): Handle {
    const value = this.values.get(id);
    if (value === undefined) throw new Error(`Missing world scene handle: ${id}`);
    return value;
  }
  geometry(id: string): BufferGeometry { const value = this.value(id); if (!(value instanceof BufferGeometry)) throw new Error(`Expected scene geometry: ${id}`); return value; }
  material(id: string): Material { const value = this.value(id); if (!(value instanceof Material)) throw new Error(`Expected scene material: ${id}`); return value; }
  standard(id: string): MeshStandardMaterial { const value = this.material(id); if (!(value instanceof MeshStandardMaterial)) throw new Error(`Expected standard material: ${id}`); return value; }
  basic(id: string): MeshBasicMaterial { const value = this.material(id); if (!(value instanceof MeshBasicMaterial)) throw new Error(`Expected basic material: ${id}`); return value; }
  object(id: string): Object3D { const source = this.value(id), value = source instanceof WorldSceneBatch ? source.finish() : source; if (!(value instanceof Object3D)) throw new Error(`Expected scene object: ${id}`); return value; }
  group(id: string): Group { const value = this.value(id); if (!group3(value)) throw new Error(`Expected scene group: ${id}`); return value; }
  mesh(id: string): Mesh { const source = this.value(id), value = source instanceof WorldSceneBatch ? source.finish() : source; if (!mesh3(value)) throw new Error(`Expected scene mesh: ${id}`); return value; }
  texture(id: string): Texture { const value = this.value(id); if (!(value instanceof Texture)) throw new Error(`Expected scene texture: ${id}`); return value; }
  vector(id: string): Vector3 { const value = this.value(id); if (!(value instanceof Vector3)) throw new Error(`Expected scene vector: ${id}`); return value; }
  number(id: string): number { const value = this.value(id); if (typeof value !== 'number') throw new Error(`Expected scene number: ${id}`); return value; }
  /** Native presentation observations update an already declared scalar. */
  setNumber(id: string, value: number): void {
    this.number(id);
    if (!Number.isFinite(value)) throw new Error('Scene scalar must remain finite');
    this.values.set(id, value);
  }
  light(id: string): PointLight { const value = this.value(id); if (!(value instanceof PointLight)) throw new Error(`Expected scene light: ${id}`); return value; }
  colliders(id: string): readonly ColliderDesc[] { const value = this.value(id); if (!colliderRows(value)) throw new Error(`Expected scene colliders: ${id}`); return value; }
  /** A point is a published vector or an object's world origin; offsets are world-space. */
  point(input: ScenePointRef, out: Vector3): Vector3 {
    const ref = v.parse(ScenePointRefSchema, input);
    const id = 'part' in ref ? ref.part : ref.point, source = this.value(id), value = source instanceof WorldSceneBatch ? source.finish() : source;
    if (value instanceof Vector3) out.copy(value);
    else if (value instanceof Object3D) value.getWorldPosition(out);
    else throw new Error(`Expected scene point: ${id}`);
    if ('offset' in ref) out.add(new Vector3(...ref.offset));
    return out;
  }
}

function group3(value: unknown): value is Group { return value instanceof Group; }
function mesh3(value: unknown): value is Mesh { return value instanceof Mesh; }
function colliderRows(value: Handle): value is readonly ColliderDesc[] { return Array.isArray(value); }
function nativeHandle(value: unknown): value is Handle { return value instanceof BufferGeometry || value instanceof Material || value instanceof Texture || value instanceof Object3D || value instanceof Vector3 || value instanceof WorldScenePlacement || value instanceof WorldSceneBatch || value instanceof WorldSceneWeldAssembly || typeof value === 'number' || Array.isArray(value); }
