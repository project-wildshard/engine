import { sceneWeldBytes } from '@wildshard/format/worldScenePages';
import { Box3, BufferAttribute, BufferGeometry, Group, InstancedMesh, type Material, Matrix4, Mesh, MeshBasicMaterial, MeshStandardMaterial, Object3D, PointLight, Sphere, Texture, Vector3 } from 'three';
import { WeldBatch, WeldView, shadowProxyMaterial } from '@wildshard/engine/models/weld';
import { WeldCull } from '@wildshard/engine/models/cull';
import { installWeldCulling } from '@wildshard/engine/models/place';
import { placeSet } from '@wildshard/engine/models/sets';
import { withOwner } from '@wildshard/engine/app/ownership';
import { workSlice } from '@wildshard/engine/core/workSlice';
import { ownSceneResource } from '@wildshard/engine/app/sceneOwnership';
import type { Scope } from '@wildshard/engine/app/scope';
import type { WorldRegistry } from '@wildshard/engine/world/registry';
import { buildTier, TIER_CONFIG } from '@wildshard/engine/core/tier';
import { parseWorldSceneWeld, sceneFileKey, type SceneFileReference, type WorldSceneWeld, type WorldSceneWeldNode, type WorldSceneDistanceSchema, type WorldSceneWeldMaterialSchema, type WorldSceneWeldSourceSchema } from '@wildshard/format/worldSceneWeld';
import type { SkyRig } from '@wildshard/engine/world/skyRig';
import type { InferOutput } from 'valibot';
import type { PlumbingData } from '@wildshard/format/plumbing';
import { worldSceneModelGraphs, type WorldSceneModels } from '@wildshard/format/worldSceneModels';
import type { ShardProduct } from '../../../shared/game/shardfile/shardProduct';
import { plumbingKnob } from '../shard/declaredPlumbing';
import { createBuildingCloud } from './buildingCloud';
import type { SceneHandles } from './sceneHandles';
import { tiledMesh } from './tiledMesh';
import type { TileContent } from './tileContent';

type Distance = InferOutput<typeof WorldSceneDistanceSchema>;
type WeldMaterial = Omit<InferOutput<typeof WorldSceneWeldMaterialSchema>, 'id'>;

/** A weld material row (or a world-scenes `mapped` row, the same grammar): a fresh material from native defaults, its
 *  properties, and only the declared maps of its source (borrowed, never owned or disposed with it). */
export function weldSceneMaterial(entry: WeldMaterial, source: (id: string) => Material, sky: () => Pick<SkyRig, 'setupMaterial'>): MeshStandardMaterial | MeshBasicMaterial {
  const made = entry.kind === 'standard' ? new MeshStandardMaterial() : new MeshBasicMaterial();
  const { color, emissive, normalScale, ...properties } = entry.properties;
  Object.assign(made, properties);
  if (color !== undefined) { if (typeof color === 'number') made.color.set(color); else made.color.setRGB(...color); }
  if (emissive !== undefined) { if (!(made instanceof MeshStandardMaterial)) throw new Error('Basic material cannot emit'); if (typeof emissive === 'number') made.emissive.set(emissive); else made.emissive.setRGB(...emissive); }
  if (normalScale !== undefined) { if (!(made instanceof MeshStandardMaterial)) throw new Error('Basic material has no normal scale'); made.normalScale.set(...normalScale); }
  if (entry.source !== undefined) for (const name of entry.source.maps) {
    const texture: unknown = Reflect.get(source(entry.source.material), name);
    if (texture !== null && !(texture instanceof Texture)) throw new Error('Frozen material map differs');
    Object.assign(made, { [name]: texture });
  }
  if (entry.blending !== undefined) made.blending = entry.blending;
  if (entry.fog !== undefined) made.fog = entry.fog;
  if (entry.sky) sky().setupMaterial(made);
  return made;
}
export interface FrozenSceneSources {
  readonly geometry: ReadonlyMap<string, BufferGeometry>;
  readonly materials: ReadonlyMap<string, Material>;
  /** Fine-only plain mesh bindings; stable nodes are published before their ring pieces. */
  readonly refine?: ReadonlyMap<string, (mesh: Mesh, scope: Scope) => TileContent>;
  readonly plumbing?: PlumbingData | null | undefined;
  readonly quality?: { readonly tier: 'phone' | 'desktop'; readonly overrides: Readonly<Partial<Record<`${string}.${string}`, number | boolean>>> };
}
/** Preserve the author's native Float32/Float64 storage, including signed zero. */
const floats = (words: readonly number[]): Float32Array => new Float32Array(Uint32Array.from(words).buffer);
const doubles = (words: readonly number[]): Float64Array => new Float64Array(Uint32Array.from(words).buffer);
const keyOf = (ref: { readonly library: string; readonly model: string }): string => JSON.stringify([ref.library, ref.model]);
const mesh3 = (value: unknown): value is Mesh => value instanceof Mesh;
const distance = (row: Distance, sources: FrozenSceneSources): number => typeof row === 'number' ? row
  : plumbingKnob(sources.plumbing, sources.quality?.tier ?? buildTier(), row.knob, 'number', sources.quality?.overrides ?? TIER_CONFIG) * row.multiply + row.add;
/** All bounded quality members are admitted before a selected graph allocates. */
export function worldSceneWeldReferences(row: InferOutput<typeof WorldSceneWeldSourceSchema>): SceneFileReference[] {
  const branches = typeof row.file === 'object' && 'knob' in row.file ? [row.file.false, row.file.true] : [row.file];
  const references = branches.flatMap(file => typeof file === 'string' || 'file' in file ? [file] : [file.phone, file.desktop])
    .map(file => typeof file === 'string' ? { file } : file);
  return [...new Map(references.map(reference => [sceneFileKey(reference), reference])).values()];
}
export function worldSceneWeldFiles(row: InferOutput<typeof WorldSceneWeldSourceSchema>): string[] {
  return [...new Set(worldSceneWeldReferences(row).map(reference => reference.file))];
}
/** Resolve geometry independently of the nominal tier when Debug overrides it. */
export function worldSceneWeldReference(row: InferOutput<typeof WorldSceneWeldSourceSchema>, plumbing?: PlumbingData | null): SceneFileReference {
  const source = typeof row.file === 'object' && 'knob' in row.file
    ? row.file[plumbingKnob(plumbing, buildTier(), row.file.knob, 'boolean', TIER_CONFIG) ? 'true' : 'false'] : row.file;
  const reference = typeof source === 'string' || 'file' in source ? source : source[buildTier()];
  return typeof reference === 'string' ? { file: reference } : reference;
}
export function worldSceneWeldFile(row: InferOutput<typeof WorldSceneWeldSourceSchema>, plumbing?: PlumbingData | null): string {
  return worldSceneWeldReference(row, plumbing).file;
}
/** Admit bounded specimen blobs separately from the small catalogue, before geometry intake. */
export async function admitWorldSceneModelGraphs(product: Pick<ShardProduct, 'hasFile' | 'file'>, catalogue: WorldSceneModels): Promise<ReadonlyMap<string, WorldSceneWeld>> {
  const result = new Map<string, WorldSceneWeld>();
  const seen = new Set<string>();
  const leaves = catalogue.models.flatMap(model => model.choices.flatMap(worldSceneModelGraphs)).filter(leaf => {
    if (!('file' in leaf)) return true;
    if (seen.has(sceneFileKey(leaf))) return false;
    seen.add(sceneFileKey(leaf)); return true;
  });
  // Descriptors are independently verified product files. Read a bounded group,
  // then admit in authored order; even a refused first graph drains its group.
  for (let offset = 0; offset < leaves.length; offset += 4) {
    const batch = leaves.slice(offset, offset + 4);
    const ready = await Promise.allSettled(batch.map(async leaf => {
      if (!('file' in leaf)) return { row: leaf };
      if (!product.hasFile(leaf.file)) throw new Error('Missing frozen specimen blob');
      return { bytes: await product.file(leaf.file), reference: leaf };
    }));
    for (const [index, leaf] of batch.entries()) {
      const loaded = ready[index]; if (loaded === undefined) throw new Error('Missing frozen specimen read');
      if (loaded.status === 'rejected') throw loaded.reason;
      let row: WorldSceneWeld;
      if ('bytes' in loaded.value) {
        const { bytes, reference } = loaded.value;
        if (reference === undefined) throw new Error('Missing frozen specimen byte reference');
        row = sceneWeldBytes(bytes, reference);
      } else row = loaded.value.row;
      if (row.culls.length > 0 || row.placements.length > 0 || row.sets.length > 0 || row.resources.length > 0) throw new Error('Frozen specimens cannot install world services');
      if ('file' in leaf) result.set(sceneFileKey(leaf), row);
    }
  }
  return result;
}
function bounds(geometry: BufferGeometry, row: { readonly sphere: readonly number[]; readonly box?: readonly number[] }): void {
  const sphere = row.sphere;
  geometry.boundingSphere = new Sphere(new Vector3(sphere[0], sphere[1], sphere[2]), sphere[3]);
  if (row.box !== undefined) geometry.boundingBox = new Box3(new Vector3(row.box[0], row.box[1], row.box[2]), new Vector3(row.box[3], row.box[4], row.box[5]));
}
function viewGeometry(batch: WeldBatch, row: Extract<WorldSceneWeldNode, { kind: 'view' }>): BufferGeometry {
  const geometry = new BufferGeometry();
  for (const [name, source] of Object.entries(batch.geometry.attributes)) {
    if (!(source instanceof BufferAttribute)) throw new Error('Frozen weld views require plain attributes');
    geometry.setAttribute(name, new BufferAttribute(source.array.subarray(row.start * source.itemSize, (row.start + row.count) * source.itemSize), source.itemSize, source.normalized));
  }
  bounds(geometry, row); return geometry;
}

/** Client-only frozen draw hydration. No merge, weld, proxy construction or shard callbacks.
 * The caller lends named roots and materials; this scope owns only the restored graph and buffers. */
export function hydrateWorldSceneWeld(input: unknown, handles: SceneHandles, sources: FrozenSceneSources, owner: Scope,
  registry: WorldRegistry | null = null): Object3D {
  const steps = hydrateWorldSceneWeldSteps(input, handles, sources, owner, registry);
  try {
    for (;;) {
      const step = steps.next();
      if (step.done) { if (step.value === undefined) throw new Error('Frozen scene construction did not finish'); return step.value; }
    }
  } finally { steps.return(undefined); }
}

/** The same ordered native construction, with cancellation closing its partial publications. */
function* hydrateWorldSceneWeldSteps(input: unknown, handles: SceneHandles, sources: FrozenSceneSources, owner: Scope,
  registry: WorldRegistry | null): Generator<void, Object3D | undefined> {
  const row = parseWorldSceneWeld(input);
  requireFrozenOwner(owner);
  const root = handles.object(row.root), known = new Set<string>([row.root]);
  const declarations = new Map(row.nodes.map(node => [node.id, node]));
  const materialIds = new Set(row.materials.map(material => material.id)), geometryBounds = new Map<string, string>();
  const material = (id: string): Material => {
    const value = handles.has(id) ? handles.material(id) : sources.materials.get(id);
    if (value === undefined) throw new Error('Missing frozen scene material'); return value;
  };
  for (const entry of row.materials) {
    if (handles.has(entry.id) || declarations.has(entry.id)) throw new Error('Duplicate frozen scene material');
    if (entry.source !== undefined) material(entry.source.material);
  }
  // Refuse the complete graph before publishing or allocating its first node.
  for (const node of row.nodes) {
    if (handles.has(node.id) || !known.has(node.parent) && !handles.has(node.parent)) throw new Error('Frozen scene identity or parent differs');
    if (handles.has(node.parent)) handles.object(node.parent);
    if ('geometry' in node) {
      const key = keyOf(node.geometry), value = JSON.stringify([node.sphere, node.box]);
      if (sources.refine?.has(key) === true && node.kind !== 'mesh') throw new Error('Fine refinement needs a plain frozen mesh');
      if (!sources.geometry.has(key)) throw new Error('Missing frozen scene geometry');
      if (geometryBounds.has(key) && geometryBounds.get(key) !== value) throw new Error('Shared frozen geometry bounds differ');
      geometryBounds.set(key, value);
    }
    if (node.kind === 'batch' && sources.geometry.get(keyOf(node.geometry))?.index !== null) throw new Error('Frozen weld batches require non-indexed geometry');
    if ('material' in node && node.material !== '$shadow' && !materialIds.has(node.material)) material(node.material);
    if (node.kind === 'view') {
      const batch = declarations.get(node.batch);
      if (!known.has(node.batch) || batch?.kind !== 'batch') throw new Error('Frozen scene view needs its earlier batch');
      const geometry = sources.geometry.get(keyOf(batch.geometry)), positions = geometry?.getAttribute('position');
      if (geometry === undefined || geometry.index !== null || positions === undefined || node.start + node.count > positions.count) throw new Error('Frozen scene view range differs');
      for (const source of Object.values(geometry.attributes)) if (!(source instanceof BufferAttribute) || source.count < node.start + node.count) throw new Error('Frozen scene view attribute range differs');
    }
    known.add(node.id);
  }
  for (const cull of row.culls) {
    for (const id of [...cull.roots, ...cull.hosted.flatMap(set => set.meshes)]) if (!known.has(id) && !handles.has(id)) throw new Error('Missing frozen scene cull object');
    if (cull.roots.length * 3 !== cull.origins.length) throw new Error('Frozen scene origins differ');
    for (const set of cull.hosted) for (const id of set.meshes) {
      const node = declarations.get(id);
      if (node?.kind !== 'instances' || set.lists.reduce((sum, run) => sum + run.matrixWords.length / 16, 0) > node.capacity) throw new Error('Frozen scene hosted capacity differs');
    }
  }
  const lifetime = owner.child(`frozen/${row.id}`), geometries = new Map<string, BufferGeometry>();
  let completed = false;
  try {
    for (const entry of row.materials) {
      requireFrozenOwner(owner);
      const made = weldSceneMaterial(entry, material, () => handles.sky);
      handles.publish(entry.id, made); ownSceneResource(made, lifetime);
      lifetime.onDispose(() => { handles.release(entry.id, made); });
      yield;
    }
    for (const node of row.nodes) {
      requireFrozenOwner(owner);
      let object: Object3D;
      if (node.kind === 'group') object = new Group();
      else if (node.kind === 'anchor') object = new Object3D();
      else if (node.kind === 'view') {
        const batch = handles.object(node.batch);
        if (!(batch instanceof WeldBatch)) throw new Error('Frozen scene view batch differs');
        const geometry = viewGeometry(batch, node); ownSceneResource(geometry, lifetime);
        const view = new WeldView(geometry, batch.material, batch); batch.views.push(view); object = view;
      } else if (node.kind === 'light') object = new PointLight(node.color, node.intensity, node.distance, node.decay);
      else {
        const surface = node.material === '$shadow' ? shadowProxyMaterial : material(node.material);
        if (node.kind === 'cloud') {
          const seeds = new BufferGeometry().setAttribute('seed', new BufferAttribute(floats(node.seedWords), 4));
          const geometry = handles.lend(seeds), materialId = handles.lend(surface);
          object = createBuildingCloud(handles, { geometry, material: materialId, seeds: true, name: node.name, at: [0, 0, 0],
            center: [node.sphere[0], node.sphere[1], node.sphere[2]], radius: node.sphere[3], order: node.renderOrder, visible: node.visible });
          handles.release(geometry, seeds); seeds.dispose();
          if (mesh3(object)) ownSceneResource(object.geometry, lifetime);
        } else {
          const key = keyOf(node.geometry), source = sources.geometry.get(key); if (source === undefined) throw new Error('Missing frozen scene geometry');
          let geometry = geometries.get(key);
          if (geometry === undefined) { geometry = source.clone(); bounds(geometry, node); geometries.set(key, geometry); ownSceneResource(geometry, lifetime); }
          if (node.kind === 'instances') {
            const mesh = new InstancedMesh(geometry, surface, node.capacity);
            mesh.instanceMatrix.array.set(floats(node.matrixWords)); mesh.count = node.count;
            mesh.boundingSphere = new Sphere(new Vector3(...node.instanceSphere.slice(0, 3)), node.instanceSphere[3]);
            if (node.instanceBox !== undefined) mesh.boundingBox = new Box3(new Vector3(...node.instanceBox.slice(0, 3)), new Vector3(...node.instanceBox.slice(3, 6)));
            object = mesh; ownSceneResource(mesh, lifetime);
          } else object = node.kind === 'batch' ? new WeldBatch(geometry, surface) : new Mesh(geometry, surface);
        }
      }
      object.name = node.name; object.matrixAutoUpdate = node.matrixAutoUpdate;
      if (node.transformBits !== undefined) { const values = doubles(node.transformBits); object.position.fromArray(values); object.quaternion.fromArray(values, 3); object.scale.fromArray(values, 7); }
      if (node.matrixBits !== undefined) object.matrix.fromArray(doubles(node.matrixBits));
      object.matrixWorldNeedsUpdate = true; object.layers.mask = node.layers; object.visible = node.visible; object.frustumCulled = node.frustumCulled;
      object.castShadow = node.castShadow; object.receiveShadow = node.receiveShadow; object.renderOrder = node.renderOrder;
      if (node.until !== undefined) object.userData['until'] = distance(node.until, sources);
      if (node.castFrom !== undefined) object.userData['castFrom'] = distance(node.castFrom, sources);
      handles.publish(node.id, object); handles.object(node.parent).add(object);
      if (node.kind === 'mesh' && mesh3(object)) {
        const bind = sources.refine?.get(keyOf(node.geometry));
        if (bind !== undefined) handles.addTiled(bind(object, lifetime));
      }
      lifetime.onDispose(() => { object.removeFromParent(); handles.release(node.id, object); });
      yield;
    }
    for (const cull of row.culls) {
      requireFrozenOwner(owner);
      const objects: Object3D[] = [], reach: number[] = [], cast: number[] = [], at: number[] = [];
      cull.roots.forEach((id, origin) => { handles.object(id).traverse(object => {
        for (const [field, caster] of [['until', 0], ['castFrom', 1]] as const) {
          const value: unknown = object.userData[field]; if (typeof value !== 'number') continue;
          objects.push(object); reach.push(value * value); cast.push(caster); at.push(origin);
        }
      }); });
      const value = new WeldCull(objects, Float64Array.from(reach), Uint8Array.from(cast), Uint32Array.from(at), Float64Array.from(cull.origins), Uint32Array.from(cull.units), Float64Array.from(cull.details, entry => distance(entry, sources) ** 2));
      for (const set of cull.hosted) value.host({ meshes: set.meshes.map(id => { const mesh = handles.object(id); if (!(mesh instanceof InstancedMesh)) throw new Error('Frozen scene hosted mesh differs'); return mesh; }),
        lists: set.lists.map(run => ({ unit: run.unit, matrices: floats(run.matrixWords) })) });
      installWeldCulling(registry, lifetime, value);
      yield;
    }
    requireFrozenOwner(owner);
    const result = row.result === undefined ? root : handles.object(row.result);
    completed = true; return result;
  } finally { if (!completed) lifetime.dispose(); }
}

function requireFrozenOwner(owner: Scope): void {
  if (owner.disposed || owner.disposing) throw new Error('Frozen scene owner is disposed or retiring');
}

/** Keep the synchronous specimen API; only the awaited resident path takes painted CPU slices. */
async function hydrateWorldSceneWeldSliced(input: unknown, handles: SceneHandles, sources: FrozenSceneSources, owner: Scope,
  registry: WorldRegistry): Promise<Object3D> {
  const steps = hydrateWorldSceneWeldSteps(input, handles, sources, owner, registry), slice = workSlice(undefined, owner);
  try {
    for (;;) {
      requireFrozenOwner(owner);
      const step = steps.next();
      if (step.done) { if (step.value === undefined) throw new Error('Frozen scene construction did not finish'); return step.value; }
      if (slice.due()) await slice.yield();
    }
  } finally { steps.return(undefined); }
}

/**
 * Tile streaming T3: a world weld's plain meshes by tile (their triangles by cell-local centroid, `tiledMesh`); a mesh
 * wholly in one tile follows that tile. A mesh whose geometry another node shares stays whole (one index cannot draw two
 * nodes' tiles), as do batches and their views, instances (a weld cull owns their counts), clouds and lights.
 */
function tileWeldMeshes(row: WorldSceneWeld, handles: SceneHandles, cell: Object3D | null, refined?: FrozenSceneSources['refine']): void {
  // cell-local: relative to the cell's world group when the weld already hangs under it (that group may be offset or
  // rebased, G630); a weld not yet attached is in cell space already, as a recipe part under its unparented root
  const root = handles.object(row.root);
  root.updateWorldMatrix(true, true);
  let under = false;
  root.traverseAncestors(ancestor => { if (ancestor === cell) under = true; });
  const toCell = under && cell !== null ? cell.matrixWorld.clone().invert() : new Matrix4(), users = new Map<string, number>();
  for (const node of row.nodes) if ('geometry' in node) { const key = keyOf(node.geometry); users.set(key, (users.get(key) ?? 0) + 1); }
  for (const node of row.nodes) {
    if (node.kind !== 'mesh' || users.get(keyOf(node.geometry)) !== 1 || refined?.has(keyOf(node.geometry)) === true) continue;
    const mesh = handles.object(node.id);
    if (!mesh3(mesh)) continue;
    const content = tiledMesh(`${row.id}.${node.id}`, mesh, toCell.clone().multiply(mesh.matrixWorld), { single: true });
    if (content !== null) handles.addTiled(content);
  }
}

/** Deferred resident assembly; the single SceneHandles registry retains the final graph. */
export class WorldSceneWeldAssembly {
  private pending: Promise<Object3D> | undefined;
  private readonly sources: FrozenSceneSources;
  private readonly staging: Map<string, BufferGeometry>;
  constructor(private readonly row: WorldSceneWeld, private readonly handles: SceneHandles, sources: FrozenSceneSources,
    private readonly owner: Scope, private readonly registry: WorldRegistry, private readonly cell: Object3D | null = null) {
    this.staging = new Map(sources.geometry);
    this.sources = { ...sources, geometry: this.staging };
  }
  /** Named-place sets and frozen contacts borrow complete placements, never a later streamed subset. */
  usesPlacement(id: string): boolean {
    return this.row.placements.includes(id) || this.row.sets.some(set => set.members.includes(id));
  }
  assemble(): Promise<Object3D> {
    if (this.owner.disposed) return Promise.reject(new Error('Frozen scene owner is disposed'));
    this.pending ??= this.build(); return this.pending;
  }
  private async build(): Promise<Object3D> {
    let root: Object3D;
    try { root = await hydrateWorldSceneWeldSliced(this.row, this.handles, this.sources, this.owner, this.registry); }
    finally { this.staging.clear(); }
    tileWeldMeshes(this.row, this.handles, this.cell, this.sources.refine);
    for (const id of this.row.placements) await this.handles.place(id);
    if (this.owner.disposed) throw new Error('Frozen scene owner is disposed');
    for (const row of this.row.sets) {
      const members = await Promise.all(row.members.map(id => this.handles.place(id)));
      withOwner(this.owner, () => placeSet({ ...row, registry: this.registry, members }));
    }
    return root;
  }
}
