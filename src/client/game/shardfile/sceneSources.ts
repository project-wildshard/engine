/** Client-only data sources shared by world scenes, held models and Explorer
 * specimens. Descriptors retain the existing library and baked-kind formats. */
import { parse } from 'valibot';
import { SceneModelSourceSchema, SceneBakeSourceSchema } from '@wildshard/format/sceneSources';
import { loadRigAtlas } from '@wildshard/engine/anim/rig';
import { sceneScalar, sceneVectors } from './sceneInputs';
import type { Scope } from '@wildshard/engine/app/scope';
import type { LentLooks } from './lentLooks';
import { isJsonData } from '@wildshard/format/json';
import { createModelLibrary, type ModelLibraryRows, type ModelLibrary, type ModelSpecimenRow } from '../plugin/geometry';
import type { SceneHeldSpecimen, SceneNpcSpecimen } from '../models/sceneSpecimens';
import type { ScenePartSpecimen } from '../models/scenePartSpecimen';
import { applySurfaceLooks, type SurfaceInputs } from '../systems/looks/surfaceLooks';
import type { SurfaceLook } from '@wildshard/format/surfaceLooks';
import { bakedMeshWorld, type BakedMeshKindRow, type BakedMeshWorld, type BakedByteResource, type WorldPieceRow, type BakedColliderInput, type BakedPieceRows } from './bakedKinds';
import { fetchDeflatedBytes } from '@wildshard/engine/core/deflate';
import type { ShardFolder } from '../../../shared/game/shardfile/shardFolder';
import { sceneRigFiles } from './sceneRigFiles';
import { sceneBakeFiles } from './sceneBakeFiles';

type Library = ModelLibrary<string, string>;
type Kind = BakedMeshKindRow & { readonly surface?: readonly SurfaceLook[]; readonly look?: string };
type Bake = BakedMeshWorld<string, Kind>;
/** Existing model descriptor plus literal shader-input identities. */
export interface SceneModelSource {
  readonly rows: ModelLibraryRows<string, string>;
  readonly inputs?: { readonly dusk?: string; readonly lights?: string };
  readonly specimens?: readonly ModelSpecimenRow[];
  readonly held?: readonly SceneHeldSpecimen[];
  readonly npcs?: readonly SceneNpcSpecimen[];
  readonly scenes?: readonly ScenePartSpecimen[];
}
/** Existing bake descriptors; the only additions are declared material ids and
 * surface rows previously selected by a native material callback. */
export interface SceneBakeSource {
  readonly rows: Readonly<Record<string, BakedPieceRows<Kind>>>;
  readonly urls: Readonly<Record<string, string>>;
  readonly attributes?: Readonly<Record<string, string>>;
  readonly resources?: readonly BakedByteResource[];
  readonly placements?: { readonly rows: readonly WorldPieceRow[]; readonly colliders?: readonly { readonly id: string; readonly colliders: readonly BakedColliderInput[] }[] };
  readonly materialLibrary?: string;
  readonly inputs?: SceneModelSource['inputs'];
}
const libraries = new Map<string, Library>(), bakes = new Map<string, Bake>();
const modelRows = new Map<string, SceneModelSource>(), bakeRows = new Map<string, SceneBakeSource>();
const pending = new WeakMap<ShardFolder, Promise<void>>();
const key = (slug: string, id: string): string => JSON.stringify([slug, id]);
function inputs(slug: string, rows: SceneModelSource['inputs']): SurfaceInputs {
  return { ...(rows?.dusk === undefined ? {} : { dusk: sceneScalar(slug, rows.dusk) }),
    ...(rows?.lights === undefined ? {} : { lights: sceneVectors(slug, rows.lights, 4) }) };
}
function need<T>(values: ReadonlyMap<string, T>, slug: string, id: string): T {
  const value = values.get(key(slug, id)); if (value === undefined) throw new Error(`Scene source is not prepared: ${id}`); return value;
}
/** Named verified descriptors are prepared before a native view or data scene
 * can use them; no shard module or owner callback is loaded here. */
export function prepareSceneSources(product: ShardFolder): Promise<void> {
  const previous = pending.get(product); if (previous !== undefined) return previous;
  const prepare = (async () => {
    if (!product.has('world/scenes')) throw new Error('Scene sources require world/scenes');
    const rows = product.section('world/scenes');
    const models = rows.libraries.filter(row => row.kind === 'models');
    // Read independent declarations together, then publish in original order.
    // Every started batch settles before validation can reject its caller.
    for (let offset = 0; offset < models.length; offset += 4) {
      const batch = models.slice(offset, offset + 4);
      const ready = await Promise.allSettled(batch.map(async row => {
        const declared = await product.json<SceneModelSource>(row.file); return declared;
      }));
      for (const [index, row] of batch.entries()) {
        const result = ready[index]; if (result === undefined) throw new Error('Missing model declaration read');
        if (result.status === 'rejected') throw result.reason;
        const declared = result.value;
        if (!isJsonData(declared) || declared.rows.meshes.length > 256 || declared.rows.hd.length > 256) throw new Error('Invalid declared model source');
        parse(SceneModelSourceSchema, declared);
        const source = { ...declared, rows: sceneRigFiles(declared.rows, product) };
        const name = key(product.slug, row.id);
        modelRows.set(name, source);
        if (!libraries.has(name)) {
          const library = createModelLibrary(source.rows, 'scene source', inputs(product.slug, source.inputs), undefined, loadRigAtlas);
          // The existing rows distinguish facet meshes from pooled primitives;
          // a declared geometry reference selects its original reader by kind.
          libraries.set(name, { ...library, geometry: (id, options) => source.rows.meshes.includes(id) ? library.mesh(id) : library.geometry(id, options) });
        }
      }
    }
    // Bakes may borrow model materials, so their publication stays after models.
    const baked = rows.libraries.filter(row => row.kind === 'baked');
    for (let offset = 0; offset < baked.length; offset += 4) {
      const batch = baked.slice(offset, offset + 4);
      const ready = await Promise.allSettled(batch.map(async row => {
        const declared = await product.json<SceneBakeSource>(row.file); return declared;
      }));
      for (const [index, row] of batch.entries()) {
        const result = ready[index]; if (result === undefined) throw new Error('Missing bake declaration read');
        if (result.status === 'rejected') throw result.reason;
        const declared = result.value;
        if (!isJsonData(declared) || Object.keys(declared.rows).length > 128) throw new Error('Invalid declared bake source');
        parse(SceneBakeSourceSchema, declared);
        const source = sceneBakeFiles(declared, product);
        const name = key(product.slug, row.id), surfaces = inputs(product.slug, source.inputs);
        bakeRows.set(name, source);
        if (!bakes.has(name)) bakes.set(name, bakedMeshWorld(source.rows, source.urls, 'scene source', {
          ...(source.attributes === undefined ? {} : { attributes: source.attributes }),
          ...(source.resources === undefined ? {} : { resources: source.resources, readBytes: fetchDeflatedBytes }),
          ...(source.placements === undefined ? {} : { placements: source.placements }),
          material: kind => kind.look === undefined ? undefined : need(libraries, product.slug, source.materialLibrary ?? '').material(kind.look),
          decorate: (material, kind) => { if (kind.surface !== undefined) applySurfaceLooks(material, kind.surface, surfaces); },
        }));
      }
    }
  })();
  pending.set(product, prepare);
  void prepare.catch(() => { if (pending.get(product) === prepare) pending.delete(product); });
  return prepare;
}
/** Full data clients lend their actual compiled look book to the same model
 * libraries used by world scenes, held models and NPCs. No source recompiles. */
export async function bindSceneSourceLooks(product: ShardFolder, scope: Scope, looks: LentLooks): Promise<void> {
  const live = (): void => { if (scope.disposed) throw new Error('Scene source looks require a living resident'); };
  live();
  await prepareSceneSources(product);
  live();
  for (const row of product.section('world/scenes').libraries)
    if (row.kind === 'models') sceneModelSource(product, row.id).bindLooks(scope, looks);
}
/** Resolve an admitted data source for the scene host. */
export function sceneModelSource(product: ShardFolder, id: string): Library { return need(libraries, product.slug, id); }
/** Resolve an admitted bake for the scene host. */
export function sceneBakeSource(product: ShardFolder, id: string): Bake { return need(bakes, product.slug, id); }
/** Existing library/model definitions shared with catalogue consumers. */
export function sceneModelDefinition(product: ShardFolder, id: string): SceneModelSource { return need(modelRows, product.slug, id); }
/** Source identities in authored order, never inferred from a shard name. */
export function sceneModelDefinitions(product: ShardFolder): readonly { readonly id: string; readonly source: SceneModelSource }[] {
  return product.section('world/scenes').libraries.flatMap(row => row.kind === 'models' ? [{ id: row.id, source: sceneModelDefinition(product, row.id) }] : []);
}
/** The same source caches the live world prepares, including original rig timing. */
export async function prepareSceneSpecimens(product: ShardFolder): Promise<void> {
  await prepareSceneSources(product);
  await Promise.all(product.section('world/scenes').libraries.map(async row => {
    if (row.kind === 'models') { const library = sceneModelSource(product, row.id); await Promise.all([library.preload(), library.preloadRigs()]); }
    else if (row.kind === 'baked') await sceneBakeSource(product, row.id).load();
  }));
}
/** Material inputs resolve by the same ids as the prepared source definition. */
export function sceneSurfaceInputs(product: ShardFolder, id: string): SurfaceInputs { return inputs(product.slug, sceneModelDefinition(product, id).inputs); }
/** Admission reads declarations only, before a source allocates geometry. */
export function sceneSourceDeclares(product: ShardFolder, library: string, model: string, kind: 'geometry' | 'model' | 'painted' | 'baked'): boolean {
  if (kind === 'baked') return Object.hasOwn(need(bakeRows, product.slug, library).rows, model);
  const rows = need(modelRows, product.slug, library).rows;
  return kind === 'model' ? rows.hd.includes(model) : kind === 'painted' ? rows.paintedModels?.some(row => row.name === model) === true
    : rows.meshes.includes(model) || rows.geometryPools?.some(row => row.parts.includes(model)) === true;
}
