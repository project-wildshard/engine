import { sceneWeldBytes } from '@wildshard/format/worldScenePages';
import { TileDriver, tileRing } from './tileDriver';
import { StreamingCamera } from './streamingView';
import { ring, ringRadius, type TileContent } from './tileContent';
import { tileOf } from '../../../shared/game/shardfile/tileOrder';
import { residentTileEntry } from './tileEntry';
import { tileBufferedDraws } from './tileBufferedDraws';
import type { SceneBuffers } from '@wildshard/format/sceneBuffers';
import { WorldSceneReads } from './worldSceneReads';
import { WorldScenePlacementPages } from './worldScenePlacementPages';
import { prepareSceneSources, sceneModelSource, sceneBakeSource, sceneSourceDeclares } from './sceneSources';
import { drawSceneRows, prepareSceneDrawRows } from './sceneDraws';
import { admitWorldSceneStepSources, worldSceneStepSources } from './worldSceneStepSources';
import { TIER } from '@wildshard/engine/core/tier';
import { SceneHandles } from './sceneHandles';
import { assertSceneProfile } from './sceneProfile';
import { BufferAttribute, BufferGeometry, InstancedBufferAttribute, InstancedMesh, type Material, Group, Mesh, MeshBasicMaterial, MeshStandardMaterial, type Object3D, Sphere, Vector3 } from 'three';
import { sharedModelContext } from '@wildshard/engine/models/model';
import { bindWorldSceneModelSources, defineWorldSceneCatalogue } from '../models/worldSceneCatalogue';
import { defineSpecimenCatalogue,prepareSpecimenCatalogue } from '../models/specimenCatalogue';
import { admitWorldSceneSurface, prepareWorldSceneSurfaces, worldSceneSurfaceMaterial } from './worldSceneSurface';
import { worldSceneSourceMaterial } from './worldSceneMaterials';
import { WorldScenePlacement } from './worldScenePlacement';
import { readWholeLibrary } from './wholeLibrary';
import { SlabLibrary } from './slabLibrary';
import { wholeRefinementCover } from './wholeRefinementCover';
import { lendWorldSceneTextures } from './worldSceneTextures';
import { lendWorldSceneUniforms } from './worldSceneUniforms';
import { WorldSceneBatch } from './worldSceneBatch';
import { WorldSceneWeldAssembly, worldSceneWeldReference, worldSceneWeldReferences, worldSceneWeldFiles, admitWorldSceneModelGraphs, weldSceneMaterial } from './worldSceneWeld';
import { sceneFileKey, type WorldSceneWeld } from '@wildshard/format/worldSceneWeld';
import { parseWorldScenePlacement, type WorldScenePlacementRow } from '@wildshard/format/worldScenePlacement';
import { poseOf, placeCollider, readColliderRows } from '@wildshard/engine/models/colliders';
import { readWorldSceneGeometries, readWorldSceneGeometry, type WorldSceneGeometry } from './worldSceneGeometry';
import { lowPolyLookMaterial } from '@wildshard/engine/world/lowpolyKit';
import { withOwner } from '@wildshard/engine/app/ownership';
import { buildYield, workSlice } from '@wildshard/engine/core/workSlice';
import { presenting } from '@wildshard/engine/core/framePacing';
import type { Scope } from '@wildshard/engine/app/scope';
import { ControlRefinement } from './controlRefinement';
import type { ColliderDesc } from '@wildshard/engine/world/registry';
import { parseWorldSceneModels, worldSceneModelResources, worldSceneModelGraphs } from '@wildshard/format/worldSceneModels';
import { parseWorldScenes, worldScenesForTier, type WorldScenesSection } from '@wildshard/format/worldScenes';
import { parseWorldScene, type WorldSceneRecipe } from '@wildshard/format/clientChannels';
import type { ShardContext } from '../plugin/context';
import type { ModelLibrary } from '../plugin/geometry';
import { tierFile, worldScenePool } from './scenePools';
import { createWorldScene, bindWorldSceneParts } from '../plugin/scene';
import { hasLentLook, lentLook, lentMappedLook, lendLooks, sceneMaterial } from './lentLooks';
import { runtimeLookMaterials } from './runtimeProduct';
import { loadingUnits } from '@wildshard/engine/boot/waits';
import { timeClientPreparation } from './preparationTiming';
import { tiledMesh } from './tiledMesh';
import { constructionCheckpoint } from './constructionCheckpoint';
/** whether a renderer multi-draws (a world-scene batch draws one BatchedMesh then); none (a test host): no */
const multiDrawOf = (renderer: unknown): boolean => {
  const extensions: unknown = typeof renderer === 'object' && renderer !== null ? Reflect.get(renderer, 'extensions') : null;
  const has: unknown = typeof extensions === 'object' && extensions !== null ? Reflect.get(extensions, 'has') : null;
  return typeof has === 'function' && Reflect.apply(has, extensions, ['WEBGL_multi_draw']) === true;
};

function instances3(value: unknown): value is InstancedMesh { return value instanceof InstancedMesh; }
function mesh3(value: unknown): value is Mesh { return value instanceof Mesh; }
function requireSceneOwner(owner: Scope): void {
  if (owner.disposed || owner.disposing) throw new Error('World scene owner is retired');
}
interface Library {
  readonly geometry: (id: string) => BufferGeometry | null;
  readonly models?: Pick<ModelLibrary<string, string>, 'painted'>;
}
/** Material preparations ahead of their original ordered publication cursor. */
const MODEL_READ_AHEAD = 4;
const decoder = new TextDecoder('utf-8', { fatal: true });
const residents = new WeakMap<Scope, WeakMap<ShardContext['product'], Promise<SceneHandles>>>();

/** Client-only scene host. Takes declared rows and an engine lifetime, never shard constructors or callbacks.
 * Results build once per resident/product and remain valid across entered play scopes. */
export function installWorldScenes(ctx: ShardContext, input: WorldScenesSection, resident: Scope = ctx.scope): Promise<SceneHandles> {
  if (resident.disposed || resident.disposing) return Promise.reject(new Error('World scene resident is disposed or retiring'));
  let products = residents.get(resident);
  if (products === undefined) { products = new WeakMap(); residents.set(resident, products); }
  const product = ctx.product;
  const previous = products.get(product); if (previous !== undefined) return previous;
  let section: WorldScenesSection;
  try { section = worldScenesForTier(parseWorldScenes(input), TIER); } catch (error) { return Promise.reject(error instanceof Error ? error : new Error('World scene admission failed', { cause: error })); }
  const pending = build(ctx, section, resident);
  products.set(product, pending);
  const cache = products;
  void pending.catch(() => { if (cache.get(product) === pending) cache.delete(product); });
  resident.onDispose(() => { cache.delete(product); });
  return pending;
}

async function build(ctx: ShardContext, section: WorldScenesSection, resident: Scope): Promise<SceneHandles> {
  assertSceneProfile(ctx.product.shardfile, (section.welds ?? []).map(row => sceneFileKey(worldSceneWeldReference(row, ctx.product.shardfile.plumbing))));
  // Unpositioned metadata is critical; placement references already carry the
  // producer's order (spawn tile/ring first when the product streams by tiles).
  const files = [
    ...(section.catalogue === undefined ? [] : [section.catalogue]),
    ...(section.welds ?? []).flatMap(worldSceneWeldFiles),
    ...section.steps.flatMap(step => [...(step.variants === undefined ? step.scene === undefined ? [] : [step.scene] : [step.variants.standalone, step.variants.cell]),
      ...step.instanceAttributes.flatMap(row => row.packet === undefined ? [] : [row.packet.file])]),
    ...(section.placements ?? []).flatMap(row => 'file' in row ? [row.file] : []),
  ];
  const reads = new WorldSceneReads(ctx, resident, files);
  try { return await buildPrepared(ctx, section, resident, reads); }
  finally { await reads.close(); }
}

async function buildPrepared(ctx: ShardContext, section: WorldScenesSection, resident: Scope, reads: WorldSceneReads): Promise<SceneHandles> {
  const placementPages = new WorldScenePlacementPages(reads,
    (section.placements ?? []).flatMap(row => 'file' in row && row.member !== undefined ? [row.file] : []));
  const registry = () => ctx.game.runtime?.world?.registry ?? ctx.app.registry;
  const product = ctx.product, recipes = new Map<string, WorldSceneRecipe>(), packets = new Map<string, Uint8Array>(), libraryRows = new Map(section.libraries.map(row => [row.id, row]));
  const geometryNames = new Map<string, ReadonlySet<string>>(), paintedNames = new Map<string, ReadonlySet<string>>();
  for (const library of section.libraries) {
    if (library.kind === 'owned' || library.kind === 'whole') geometryNames.set(library.id, new Set(library.models.map(model => model.id)));
    else if (library.kind === 'pool') {
      geometryNames.set(library.id, new Set(library.files.flatMap(file => file.parts)));
      paintedNames.set(library.id, new Set(library.painted.map(model => model.id)));
    }
  }
  const specimenInput = async (): Promise<ReadonlyMap<string, Uint8Array>> => {
    const files = await prepareSpecimenCatalogue(product, section.specimens ?? [], resident); return files;
  };
  const sceneInput = async (): Promise<void> => {
    if (section.libraries.some(row => row.kind === 'models' || row.kind === 'baked')) await prepareSceneSources(product);
  };
  // Independent verified declarations overlap, but both settle before a refusal
  // can end this admission's input lease. Preserve specimen-first error order.
  const [specimenResult, sourceResult] = await Promise.allSettled([specimenInput(), sceneInput()]);
  if (specimenResult.status === 'rejected') throw specimenResult.reason;
  if (sourceResult.status === 'rejected') throw sourceResult.reason;
  const specimenFiles = specimenResult.value; reads.validate();
  const recipesProgress = loadingUnits('Scene recipes', section.steps.length);
  let recipesDone = 0;
  recipesProgress(0);
  const slots = new Set(section.materials.map(row => row.id));
  const requireFile = (name: string): void => { if (!product.hasFile(name)) throw new Error(`Missing world scene blob: ${name}`); };
  const reference = (ref: { readonly library: string; readonly model: string }, mapped = false): void => {
    const library = libraryRows.get(ref.library);
    if (library?.kind === 'models') { if (!sceneSourceDeclares(product, ref.library, ref.model, mapped ? 'painted' : 'geometry')) throw new Error('Missing declared scene source'); return; }
    if (library === undefined || library.kind === 'baked' || !(mapped ? library.kind === 'pool' && paintedNames.get(ref.library)?.has(ref.model) === true
      : geometryNames.get(ref.library)?.has(ref.model) === true)) throw new Error(`Missing world scene model: ${ref.library}/${ref.model}`);
  };
  // Admission precedes geometry/material allocation, including both cube variants. A slab file is a declared GLB by its
  // content hash (the bake's blob name is not in the row)
  const declaredGlbs = new Set(product.shardfile.files.flatMap(file => file.kind === 'glb' ? [file.hash] : []));
  for (const row of section.libraries) if (row.kind === 'slabs') for (const tile of row.tiles) for (const file of tile.files) {
    if (!declaredGlbs.has(file.file)) throw new Error(`Missing world scene slab: ${file.file}`);
  }
  for (const row of section.libraries) for (const file of row.kind === 'whole' || row.kind === 'slabs' ? [] : row.kind === 'models' || row.kind === 'baked' ? [row.file] : row.kind === 'owned' ? row.models.flatMap(model => [tierFile(model.file), ...model.segments ?? []]) : [...row.files.map(entry => tierFile(entry.file)), ...row.painted.map(entry => entry.file)]) requireFile(file);
  for (const row of section.materials) if (row.kind === 'look' || row.kind === 'surface') {
    if (row.look !== undefined && product.shardfile.look.materials[row.look] === undefined) throw new Error(`Missing world scene look: ${row.look}`);
    if (row.kind === 'look' && row.over !== undefined) reference(row.over, true);
  }
  for (const row of section.materials) if (row.kind === 'surface') await admitWorldSceneSurface(row, product);
  for (const row of section.lent ?? []) {
    for (const look of row.looks) if (product.shardfile.look.materials[look] === undefined) throw new Error(`Missing lent texture look: ${look}`);
    if (row.kind === 'volume') for (const variant of [row.files.standalone, row.files.cell]) requireFile(variant[TIER].file);
    if (row.kind === 'product') { requireFile(row.file[TIER]); if ((row.looks.length > 0) !== (row.param !== undefined) || row.looks.length === 0 && row.publish === undefined) throw new Error('A product texture is lent with a param or published'); }
  }
  let catalogue: ReturnType<typeof parseWorldSceneModels> | undefined;
  let modelScenes: ReadonlyMap<string, WorldSceneWeld> = new Map();
  if (section.catalogue !== undefined) {
    requireFile(section.catalogue);
    catalogue = parseWorldSceneModels(JSON.parse(decoder.decode(await reads.file(section.catalogue))));
    if (!Object.is(catalogue.product, product.shardfile.identity.slug)) throw new Error('Scene catalogue product identity differs');
    // a draw (and a LOD draw's attribute donor) reads an owned or whole model, or a part of a pool's files
    const source = (ref: { readonly library: string; readonly model: string }): boolean => { const library = libraryRows.get(ref.library);
      return library?.kind === 'owned' || library?.kind === 'whole' || library?.kind === 'pool' && geometryNames.get(ref.library)?.has(ref.model) === true; };
    for (const model of catalogue.models) for (const choice of model.choices) for (const level of choice.lods) for (const part of level.draws) {
      if (part.attributes !== undefined && !source(part.attributes)) throw new Error('Scene catalogue needs owned geometry and declared material slots');
    }
    for (const model of catalogue.models) for (const choice of model.choices) for (const draw of [...choice.draws, ...choice.lods.flatMap(level => level.draws)]) {
      reference(draw);
      if (!source(draw) || !slots.has(draw.material)) throw new Error('Scene catalogue needs owned geometry and declared material slots');
    }
    // Demand-only specimen bodies may stay cold, but their complete declared
    // inventory must still exist before any live world is constructed.
    for (const model of catalogue.models) for (const choice of model.choices)
      for (const row of worldSceneModelGraphs(choice)) if ('file' in row) requireFile(row.file);
  }
  const immediate = new Set(section.steps.flatMap(step => Object.values(step.materials)));
  if (section.materials.some(row => row.kind === 'source' && row.load === 'placement' && immediate.has(row.id))) throw new Error('Deferred source material requires a named model placement');
  const published = new Set<string>(), sourceObjects = new Map<string, string>();
  for (const row of section.materials) if (row.kind === 'source' && row.publishObject !== undefined) {
    const key = JSON.stringify([row.url, row.aliases, row.anisotropy, row.anisotropyMaps, row.envMapIntensity]);
    if (sourceObjects.has(row.publishObject) && sourceObjects.get(row.publishObject) !== key || slots.has(row.publishObject.slice('materials.'.length)) && row.publishObject.startsWith('materials.')) throw new Error('Source object publication differs');
    sourceObjects.set(row.publishObject, key); published.add(row.publishObject);
  }
  for (const row of section.libraries) if (row.kind === 'pool' && row.publish !== undefined) for (const part of row.files.flatMap(file => file.parts)) {
    const id = `${row.publish}.${part}`; if (published.has(id)) throw new Error(`Duplicate world scene publication: ${id}`); published.add(id);
  }
  const welds: WorldSceneWeld[] = [], deferredPlacements = new Set<string>(), latePlacements = new Set<string>(), lateWelds = new Map<string, readonly [number, number]>();
  assertSceneProfile(product.shardfile, (section.welds ?? []).map(row => sceneFileKey(worldSceneWeldReference(row, product.shardfile.plumbing))));
  for (const declared of section.welds ?? []) {
    const selected = sceneFileKey(worldSceneWeldReference(declared, product.shardfile.plumbing));
    let row: WorldSceneWeld | undefined;
    for (const graphReference of worldSceneWeldReferences(declared)) {
      requireFile(graphReference.file);
      const candidate = sceneWeldBytes(await reads.file(graphReference.file), graphReference);
      if (candidate.id !== declared.id) throw new Error('Frozen scene blob identity differs');
      for (const id of candidate.placements) {
        deferredPlacements.add(id);
        if (declared.late !== undefined) latePlacements.add(id);
      }
      if (sceneFileKey(graphReference) === selected) row = candidate;
    }
    if (row === undefined) throw new Error('Missing selected frozen scene');
    if (declared.late !== undefined) lateWelds.set(row.id, declared.late.at);
    for (const resource of row.resources) {
      if (resource.kind === 'geometry') reference(resource.source);
      if (published.has(resource.id)) throw new Error('Duplicate frozen scene resource'); published.add(resource.id);
    }
    for (const node of row.nodes) {
      if ('geometry' in node) reference(node.geometry);
      if ('material' in node && node.material !== '$shadow' && !slots.has(node.material)) throw new Error('Missing frozen scene material slot');
      if (published.has(node.id)) throw new Error('Duplicate frozen scene part identity');
      published.add(node.id);
    }
    if (published.has(row.id)) throw new Error('Duplicate frozen scene identity');
    published.add(row.id); welds.push(row);
  }
  const batches = new Map((section.batches ?? []).map(row => [row.id, row])), reservations = new Map<string, number>();
  for (const row of batches.values()) {
    if (!slots.has(row.material)) throw new Error('Missing scene batch material');
    for (const source of row.geometry) { reference(source); if (libraryRows.get(source.library)?.kind !== 'owned') throw new Error('Scene batch requires owned geometry'); }
    published.add(row.id); reservations.set(row.id, row.fixed.length);
  }
  const placements: WorldScenePlacementRow[] = [], declaredModels = new Map((catalogue?.models ?? []).map(model => [model.key, model]));
  const specimenKeys = new Set((section.specimens ?? []).map(model => model.key));
  const admissionSlice = workSlice(undefined, resident);
  await timeClientPreparation(product.slug, 'scene.placement-admission', async () => {
    const declarations = section.placements ?? [];
    for (const declared of declarations) {
      const bytes = 'file' in declared ? await reads.file(declared.file) : undefined;
      if (resident.disposed || resident.disposing) throw new Error('Scene placement owner is disposed');
      let row: WorldScenePlacementRow;
      if ('file' in declared && declared.member !== undefined) {
        if (bytes === undefined) throw new Error('Missing placement page bytes');
        const page = await placementPages.read(declared.file, bytes);
        reads.validate();
        const member = page.rows[declared.member];
        if (member === undefined || member.tier !== declared.tier) throw new Error('Scene placement page member differs');
        row = member;
      } else row = 'file' in declared ? parseWorldScenePlacement(JSON.parse(decoder.decode(bytes))) : declared;
      if (row.id !== declared.id) throw new Error('Scene placement blob identity differs');
      placements.push(row);
      const model = declaredModels.get(row.model);
      if (model === undefined && !specimenKeys.has(row.model)) throw new Error(`Missing scene placement model: ${row.model}`);
      if (row.batch !== undefined) {
        const batch = batches.get(row.batch);
        if (batch === undefined || row.draw !== 'batched' || model === undefined || model.choices.some(choice => [choice.draws, ...choice.lods.map(level => level.draws)].some(draws => draws.length !== 1 || draws.some(draw => draw.material !== batch.material)))) throw new Error('Scene placement cannot share the declared batch');
        const count = (reservations.get(row.batch) ?? 0) + row.poses.length;
        if (count > batch.capacity.instances) throw new Error('Scene batch instance capacity exceeded');
        reservations.set(row.batch, count);
      }
      for (const id of [row.id, `${row.id}.root`, `${row.id}.colliders`]) {
        if (published.has(id)) throw new Error(`Duplicate world scene publication: ${id}`);
        published.add(id);
      }
      requireSceneOwner(resident);
      if (admissionSlice.due()) await admissionSlice.yield();
    }
  });
  placementPages.clear();
  if (catalogue !== undefined) {
    // A frozen world node already draws merged placements. Its independent
    // Explorer specimen is not a second live draw. Direct placements still
    // admit every alternative before geometry or material allocation.
    const direct = new Set(placements.filter(row => row.drawnInto === undefined).map(row => row.model));
    const eager = { ...catalogue, models: catalogue.models.filter(model => model.load !== 'demand' || direct.has(model.key)) };
    reads.queue(eager.models.flatMap(model => model.choices.flatMap(worldSceneModelGraphs)).flatMap(row => 'file' in row ? [row.file] : []));
    modelScenes = await admitWorldSceneModelGraphs({ hasFile: product.hasFile, file: name => reads.file(name) }, eager);
    const resources = worldSceneModelResources(catalogue, [...modelScenes.values()]);
    for (const draw of resources.geometry) {
      reference(draw);
      const library = libraryRows.get(draw.library);
      if (library?.kind !== 'owned' && library?.kind !== 'whole' && library?.kind !== 'pool') throw new Error('Frozen specimens need owned geometry');
    }
    for (const slot of resources.materials) if (!slots.has(slot)) throw new Error('Missing frozen specimen material slot');
  }
  for (const step of section.steps) {
    await prepareSceneDrawRows(product, step.draws ?? []);
    for (const row of step.draws ?? []) if (!slots.has(row.material)) throw new Error(`Missing scene draw slot: ${row.material}`);
    const files = step.variants === undefined ? [step.scene] : [step.variants.standalone, step.variants.cell];
    for (const file of files) {
      if (file === undefined) throw new Error('Missing world scene recipe');
      requireFile(file);
      if (!recipes.has(file)) recipes.set(file, parseWorldScene(JSON.parse(decoder.decode(await reads.file(file)))));
      const recipe = recipes.get(file);
      if (recipe === undefined) throw new Error('Missing admitted scene recipe');
      admitWorldSceneStepSources(product, step, recipe);
      const nodes = new Map(recipe.scene.nodes.map(node => [node.id, node]));
      const attributes = new Set<string>();
      for (const row of step.instanceAttributes) {
        const part = nodes.get(row.part), key = `${row.part}.${row.target === 'instanceColor' || row.target === 'instanceMatrix' ? `#${row.target}` : row.name}`;
        if (row.packet !== undefined && !packets.has(row.packet.file)) { requireFile(row.packet.file); packets.set(row.packet.file, await reads.file(row.packet.file)); }
        const bytes = row.packet === undefined ? undefined : packets.get(row.packet.file);
        // a packet holds exactly the mesh's instances; replaced matrices are never also authored in the recipe
        if (part?.kind !== 'mesh' || part.instances === undefined || attributes.has(key) || row.target === 'instanceMatrix' && part.matrices !== undefined
          || (row.packet === undefined ? row.values?.length !== part.instances * row.width
            : bytes === undefined || row.packet.count !== part.instances || row.packet.byteOffset + row.packet.count * row.width * 4 > bytes.byteLength)) throw new Error('Invalid scene instance attributes');
        attributes.add(key);
      }
      if (nodes.get(recipe.scene.root)?.kind !== 'group') throw new Error('World scene needs a group root');
      for (const node of recipe.scene.nodes) if (node.kind === 'mesh' && step.geometry[node.geometry] === undefined) throw new Error(`Missing scene geometry port: ${node.geometry}`);
      for (const material of recipe.scene.materials) if (material.kind === 'port' && step.materials[material.source] === undefined) throw new Error(`Missing scene material port: ${material.source}`);
      for (const row of [...step.registry, ...step.bounds, ...step.instanceAttributes]) if (!nodes.has(row.part)) throw new Error(`Missing scene part: ${row.part}`);
      for (const binding of Object.values(step.publish)) if ('part' in binding && binding.kind !== 'standard-material' && !(binding.kind === 'colliders' ? step.registry.some(row => row.id === binding.part) : nodes.has(binding.part))) throw new Error(`Missing scene publication: ${binding.part}`);
    }
    if (step.registry.length > 0 && step.repeat?.some(row => row.rotation !== undefined && (row.rotation[0] !== 0 || row.rotation[2] !== 0)) === true) throw new Error('Collider repeat poses rotate about Y only');
    for (const ref of Object.values(step.geometry)) reference(ref);
    for (const slot of Object.values(step.materials)) if (!slots.has(slot)) throw new Error(`Missing world scene material: ${slot}`);
    for (const instance of step.repeat ?? [{ id: '' }]) for (const key of [ 'root', ...Object.keys(step.publish), ...step.collectMaterials ?? []]) {
      const id = [step.id, instance.id, key].filter(Boolean).join('.');
      if (published.has(id)) throw new Error(`Duplicate world scene publication: ${id}`); published.add(id);
    }
    requireSceneOwner(resident);
    if (admissionSlice.due()) await admissionSlice.yield();
    recipesProgress(++recipesDone, step.id);
  }
  for (const row of placements) if (row.drawnInto !== undefined && (!published.has(row.drawnInto.part) && !deferredPlacements.has(row.id) || row.drawnInto.boxes.length !== row.poses.length * 6)) throw new Error('Scene placement needs a published part and one box per copy');
  // Eager and directly drawn specimen graphs are admitted above. Demand-only
  // documents and their buffers belong to the actual Explorer choice.
  const placedModelKeys = new Set(placements.map(row => row.model));
  const residentModels = catalogue === undefined ? undefined : { ...catalogue, models: catalogue.models.filter(model => model.assembly !== 'scene' && (model.load !== 'demand' || placedModelKeys.has(model.key))) };
  const coldOnly = (ref: { readonly library: string }): boolean => { const row = libraryRows.get(ref.library); return row?.kind === 'whole' && (row.load === 'explorer' || row.load === 'refine'); };
  const modelGeometry = residentModels === undefined ? [] : worldSceneModelResources(residentModels).geometry.filter(ref => !coldOnly(ref));
  const activeSteps = section.steps.filter(step => step.load !== 'explorer' && (step.cube === undefined || step.cube === (ctx.cube === null ? 'standalone' : 'cell')));
  // Collision predicates may only read an already published scalar from the
  // selected scene graph. Reject absent, wrong-kind and future refs before any
  // geometry, physics piece or active callback can be installed.
  const activeNumbers = new Set<string>();
  for (const step of activeSteps) for (const instance of step.repeat ?? [{ id: '' }]) {
    const prefix = [step.id, instance.id].filter(Boolean).join('.');
    for (const [id, row] of Object.entries(step.publish)) if (row.kind === 'number') activeNumbers.add(`${prefix}.${id}`);
    for (const row of step.registry) if (row.active !== undefined && !activeNumbers.has(row.active)) throw new Error(`Scene collision requires a published scalar: ${row.active}`);
  }
  const residentReferences = new Set([...modelGeometry, ...activeSteps.flatMap(step => Object.values(step.geometry)),
    ...[...batches.values()].flatMap(row => row.geometry),
    // I2: a late weld's own drawn geometry is read after control; its published resources (other draws borrow them) stay
    ...welds.flatMap(row => row.resources.flatMap(resource => resource.kind === 'geometry' ? [resource.source] : [])
      .concat(lateWelds.has(row.id) ? [] : row.nodes.flatMap(node => 'geometry' in node ? [node.geometry] : [])))].map(ref => JSON.stringify([ref.library, ref.model])));
  const refined = (ref: { readonly library: string }): boolean => { const row = libraryRows.get(ref.library); return row?.kind === 'whole' && row.load === 'refine'; };
  if (activeSteps.some(step => Object.values(step.geometry).some(refined)) || [...batches.values()].some(row => row.geometry.some(refined))
    || welds.some(row => row.resources.some(resource => resource.kind === 'geometry' && refined(resource.source)))) throw new Error('Fine refinement requires a plain weld mesh consumer');
  await reads.close();
  reads.validate();
  const owner = resident.child('world-scenes'), libraries = new Map<string, Library>(), materials = new Map<string, Material>(), finish: (() => void)[] = [];
  const refinementOrigin = residentTileEntry(resident) ?? product.shardfile.spawn;
  let refinement: ControlRefinement | undefined;
  // Ordinary/headless declarations need no control clock. Acquire it only at
  // the first actual after-control consumer, retaining that host's real fence.
  const refinementQueue = (): ControlRefinement => {
    if (refinement === undefined) {
      const world = ctx.game.runtime?.world, camera = (world === undefined || world === null) ? undefined : new StreamingCamera(ctx.root, () => world.game.camera);
      refinement = new ControlRefinement(owner, world?.game.levelScope, () => ctx.game.runtime?.world?.player.position ?? refinementOrigin,
        () => buildYield(owner), camera === undefined ? undefined : () => camera.read());
    }
    return refinement;
  };
  const handles = new SceneHandles(ctx.game.runtime?.world?.sky, (id, at, needed, run) => refinementQueue().add(id, at, async () => {
    for (const slot of needed) await prepareMaterial(slot);
    requireSceneOwner(owner); await run();
  }));
  const materialReads = new Map<string, Promise<void>>();
  function prepareMaterial(id: string): Promise<void> {
    if (materials.has(id)) return Promise.resolve();
    const prior = materialReads.get(id); if (prior !== undefined) return prior;
    const row = section.materials.find(material => material.id === id), sky = ctx.game.runtime?.world?.sky;
    if (row === undefined || (row.kind !== 'source' && row.kind !== 'surface') || sky === undefined) return Promise.reject(new Error('Missing late scene material'));
    const pending = (async () => {
      requireSceneOwner(owner);
      const material = row.kind === 'source' ? await worldSceneSourceMaterial(row, sky, product, owner, handles) : await worldSceneSurfaceMaterial(row, sky, product, owner);
      requireSceneOwner(owner);
      const current = materials.get(id);
      if (current !== undefined && current !== material) throw new Error('Late scene material identity changed');
      if (current === undefined) { materials.set(id, material); handles.publish(`materials.${id}`, material); }
    })();
    materialReads.set(id, pending); return pending;
  }
  const refining = new Map<string, SlabLibrary>();
  const coarse = section.libraries.some(row => row.kind === 'whole' && row.load === 'refine') ? wholeRefinementCover(ctx, owner, refinementOrigin) : undefined;
  if (coarse !== undefined) handles.addTiled(coarse.content);
  const bufferedContents: TileContent[] = [];
  if (section.cosmeticDraws !== undefined) {
    const random = ctx.app.rng.stream('cosmetic');
    for (let draw = 0; draw < section.cosmeticDraws; draw++) random.next();
  }
  // One bounded read/decode window spans all needed owned libraries. No
  // unrelated Explorer-only model enters this resident's preparation.
  const ownedModels = section.libraries.flatMap(row => row.kind === 'owned' ? row.models
    .filter(model => residentReferences.has(JSON.stringify([row.id, model.id])))
    .map(model => {
      const source = { file: typeof model.file === 'string' ? model.file : model.file[TIER], attributes: model.attributes };
      return model.segments === undefined ? source : Object.assign(source, { segments: model.segments });
    }) : []);
  // Metadata-only scenes need no render service. Borrow the real asset owner
  // only at the first required owned-model cursor, as the original reader did.
  let geometryIntake: ReturnType<typeof readWorldSceneGeometries> | undefined;
  try {
    await timeClientPreparation(product.slug, 'scene.library-intake', async () => {
      const libraryProgress = loadingUnits('Model libraries', section.libraries.length);
      libraryProgress(0);
      for (const [libraryIndex, row] of section.libraries.entries()) {
        await timeClientPreparation(product.slug, `scene.library:${row.kind}:${row.id}`, async () => {
          if (row.kind === 'slabs') return; // NF11: read by the refine library it covers (`of`)
          if (row.kind === 'models') {
            const models = sceneModelSource(product, row.id); await models.preload(() => constructionCheckpoint(owner) ?? Promise.resolve());
            libraries.set(row.id, { geometry: id => models.geometry(id), models });
          } else if (row.kind === 'baked') { await sceneBakeSource(product, row.id).load();
          } else if (row.kind === 'whole') {
            const used = new Set(row.models.flatMap(model => residentReferences.has(JSON.stringify([row.id, model.id])) ? [model.id] : []));
            if (row.load === 'explorer' || used.size === 0) { libraryProgress(libraryIndex + 1, `${row.id} · deferred`); return; }
            if (row.load === 'refine') {
              if (coarse === undefined) throw new Error('Fine refinement requires coarse coverage');
              // Fine geometry is baked. Missing slabs refuse instead of
              // reconstructing a union during play.
              const slabs = section.libraries.find(entry => entry.kind === 'slabs' && entry.of === row.id);
              if (slabs?.kind !== 'slabs') throw new Error(`Fine refinement requires baked slabs: ${row.id}`);
              const whole = new SlabLibrary(owner, product, row, slabs, refinementQueue(), coarse.ensure, async parts => {
                const game = ctx.game.runtime?.world?.game;
                if (game === undefined || game === null) return;
                const live = (): boolean => !owner.disposed && !owner.disposing && parts.every(({ scope }) => !scope.disposed && !scope.disposing);
                // The native warmer draws connected hidden roots. Borrow each
                // key's actual world frame, without exposing a partial anchor;
                // one hidden root holds the publication's every part (NB3).
                const root = new Group(); root.visible = false; root.matrixAutoUpdate = false;
                root.matrix.copy(game.rootScene.matrixWorld).invert();
                const staged = parts.map(({ part, anchor, scope }) => {
                  anchor.updateWorldMatrix(true, false);
                  const stage = new Group(); stage.matrixAutoUpdate = false; stage.matrix.copy(anchor.matrixWorld);
                  stage.add(part); root.add(stage);
                  const forget = scope.capture('disposers', () => { stage.removeFromParent(); });
                  return { part, stage, forget };
                });
                game.rootScene.add(root);
                try { await game.warmSceneRoots([root], live, undefined, { drawGeometry: true }); }
                finally { for (const { part, stage, forget } of staged) { forget(); part.removeFromParent(); stage.removeFromParent(); } root.removeFromParent(); }
              });
              refining.set(row.id, whole);
              libraries.set(row.id, { geometry: id => whole.geometry(id) }); return;
            }
            const whole = await readWholeLibrary(owner, product, row, used, () => constructionCheckpoint(owner) ?? Promise.resolve(), ctx.app.assets);
            finish.push(whole.done); libraries.set(row.id, { geometry: whole.geometry });
          } else if (row.kind === 'owned') {
            const models = new Map<string, WorldSceneGeometry>();
            const modelSlice = workSlice(undefined, owner);
            const neededModels = row.models.filter(model => residentReferences.has(JSON.stringify([row.id, model.id])));
            const modelProgress = loadingUnits('Home models', neededModels.length);
            modelProgress(0, row.id);
            // The four-model window crosses library boundaries and refills
            // before this cursor's budget pause. Adoption stays in row order.
            for (const [modelIndex, model] of neededModels.entries()) {
              geometryIntake ??= readWorldSceneGeometries(owner, product, ownedModels, ctx.app.assets, { revisit: true });
              const result = await geometryIntake.next();
              if (result.done) throw new Error(`Missing scene model read: ${model.id}`);
              const geometry = result.value;
              finish.push(geometry.done); models.set(model.id, geometry);
              modelProgress(modelIndex + 1, model.id);
              requireSceneOwner(owner);
              // A completed read/decode can span drawn frames. Its old local
              // clock does not measure this adoption's remaining live budget.
              if (presenting() || typeof document !== 'undefined') {
                const pause = constructionCheckpoint(owner); if (pause !== undefined) await pause;
              } else if (modelSlice.due()) await modelSlice.yield();
            }
            libraries.set(row.id, { geometry: id => models.get(id)?.copy() ?? null });
          } else {
            requireSceneOwner(owner);
            const models = worldScenePool(product, row);
            await models.preload(() => constructionCheckpoint(owner) ?? Promise.resolve());
            requireSceneOwner(owner);
            if (row.publish !== undefined) for (const part of row.files.flatMap(file => file.parts)) {
              const geometry = models.geometry(part); if (geometry === null) throw new Error(`Missing scene pool part: ${part}`);
              owner.onDispose(() => { geometry.dispose(); }); handles.publish(`${row.publish}.${part}`, geometry);
            }
            libraries.set(row.id, { geometry: id => models.geometry(id), models });
          }
          libraryProgress(libraryIndex + 1, row.id);
          const pause = constructionCheckpoint(owner); if (pause !== undefined) await pause;
        });
      }
    });
    const missing = section.materials.flatMap(row => (row.kind === 'look' || row.kind === 'surface') && row.look !== undefined
      && !(row.kind === 'look' && row.over === undefined && sceneMaterial(resident, product.slug, row.look) !== undefined) && !hasLentLook(row.look) ? [row.look] : [])
      .concat((section.lent ?? []).flatMap(row => row.looks.filter(look => !hasLentLook(look))));
    if (missing.length > 0) lendLooks(owner, await runtimeLookMaterials({ scope: owner, game: ctx.game }, product.shardfile, true, [...new Set(missing)]));
    await lendWorldSceneTextures(section.lent ?? [], owner, product, handles, section.lent?.some(row => row.kind === 'product') === true ? ctx.game.runtime?.world?.game.renderer : undefined,
      ctx.cube === null ? 'standalone' : 'cell');
    lendWorldSceneUniforms(section.uniforms ?? [], owner, handles);
    const weldSlots = (row: WorldSceneWeld): string[] => row.nodes.flatMap(node => 'material' in node && node.material !== '$shadow' ? [node.material] : [])
      .concat(row.materials.flatMap(material => material.source === undefined ? [] : [material.source.material]));
    const lateSlots = new Set(welds.filter(row => lateWelds.has(row.id)).flatMap(weldSlots));
    const earlySlots = new Set([...batches.values()].map(row => row.material)
      .concat(activeSteps.flatMap(step => Object.values(step.materials))));
    for (const row of section.materials) if (row.kind === 'mapped' && row.material.source !== undefined) earlySlots.add(row.material.source.material);
    for (const weld of welds) if (!lateWelds.has(weld.id)) for (const slot of weldSlots(weld)) earlySlots.add(slot);
    // A placed model can share a surface with late scenery. Keep its original
    // material intake unless that placement belongs to a declared late weld.
    // All declared alternatives are validated above. An unselected late
    // alternative is not an independent before-control material consumer.
    const placedKeys = new Set(placements.filter(row => !latePlacements.has(row.id)).map(row => row.model));
    const placedModels = catalogue === undefined ? undefined : { ...catalogue, models: catalogue.models.filter(model => placedKeys.has(model.key)) };
    const placedGraphs = new Set(placedModels?.models.flatMap(model => model.choices.flatMap(worldSceneModelGraphs)).flatMap(row => 'file' in row ? [row.file] : []));
    const placedSlots = new Set(placedModels === undefined ? [] : worldSceneModelResources(placedModels,
      [...modelScenes].flatMap(([file, graph]) => placedGraphs.has(file) ? [graph] : [])).materials);
    const hinted = new Set(section.lateMaterials?.map(row => row.id));
    const deferred = (row: (typeof section.materials)[number]): boolean => !earlySlots.has(row.id)
      && (hinted.has(row.id) && !placedSlots.has(row.id)
        || row.kind === 'source' && row.load === 'placement' && row.publishObject === undefined
        || row.kind === 'surface' && row.load === 'placement' && lateSlots.has(row.id) && !placedSlots.has(row.id));
    const surfaces = section.materials.filter((row): row is Extract<typeof row, { kind: 'surface' }> => row.kind === 'surface' && !deferred(row));
    if (surfaces.length > 0) {
      const sky = ctx.game.runtime?.world?.sky; if (sky === undefined) throw new Error('Scene surface needs world sky');
      await timeClientPreparation(product.slug, 'scene.surface-intake', () => prepareWorldSceneSurfaces(surfaces, sky, product, owner));
    }
    await timeClientPreparation(product.slug, 'scene.material-intake', async () => {
      const materialProgress = loadingUnits('Materials and textures', section.materials.length);
      materialProgress(0);
      // Cold specimens have captured intake. Played consumers keep their maps;
      // late welds prepare their otherwise unused source/surface rows below.
      // G782: a surface or source material's textures load up to MODEL_READ_AHEAD rows ahead and are taken in order, so their
      // waits overlap (Pine's material intake idled on one row's textures at a time); every other kind, each take, publish
      // and checkpoint stays in order. Started loads are drained before a failure leaves.
      const started = new Map<number, Promise<Material>>();
      const startAhead = (from: number): void => {
        const sky = ctx.game.runtime?.world?.sky;
        for (let next = from; next < Math.min(section.materials.length, from + MODEL_READ_AHEAD); next++) {
          const row = section.materials[next];
          if (sky === undefined || row === undefined || started.has(next) || deferred(row) || (row.kind !== 'surface' && row.kind !== 'source')) continue;
          const pending = row.kind === 'surface' ? worldSceneSurfaceMaterial(row, sky, product, owner) : worldSceneSourceMaterial(row, sky, product, owner, handles);
          void pending.catch(() => undefined); started.set(next, pending);
        }
      };
      try {
        for (const [materialIndex, row] of section.materials.entries()) {
          if (deferred(row)) { materialProgress(materialIndex + 1, `${row.id} · deferred`); continue; }
          startAhead(materialIndex);
          const model = row.kind === 'look' && row.over !== undefined ? libraries.get(row.over.library)?.models?.painted(row.over.model) : undefined;
          if (row.kind === 'look' && row.over !== undefined && (model === undefined || model === null)) throw new Error('Scene material overlay requires a mapped library model');
          let material: Material;
          const early = started.get(materialIndex);
          if (row.kind === 'surface') {
            const sky = ctx.game.runtime?.world?.sky; if (sky === undefined) throw new Error('Scene surface needs world sky');
            material = await (early ?? worldSceneSurfaceMaterial(row, sky, product, owner)); started.delete(materialIndex);
          } else if (row.kind === 'source') {
            const sky = ctx.game.runtime?.world?.sky; if (sky === undefined) throw new Error('Source scene materials need a world sky');
            material = await (early ?? worldSceneSourceMaterial(row, sky, product, owner, handles)); started.delete(materialIndex);
          } else if (row.kind === 'standard') material = new MeshStandardMaterial(row.properties);
          else if (row.kind === 'basic') material = new MeshBasicMaterial(row.properties);
          else if (row.kind === 'mapped') material = weldSceneMaterial(row.material, id => { const source = materials.get(id); if (source === undefined) throw new Error('Missing mapped scene material source'); return source; }, () => {
            const sky = ctx.game.runtime?.world?.sky; if (sky === undefined) throw new Error('Sky-aware scene materials need a world sky'); return sky; });
          else if (row.kind === 'lowpoly') {
            const sky = ctx.game.runtime?.world?.sky; if (sky === undefined) throw new Error('Scene family material needs a world sky');
            material = lowPolyLookMaterial(sky, row.variant, value => { Object.assign(value, row.properties); });
          } else material = model === undefined || model === null ? sceneMaterial(resident, product.slug, row.look) ?? lentLook(row.look) : lentMappedLook(row.look, model.map);
          if (row.kind === 'standard' && row.sky === true) {
            const sky = ctx.game.runtime?.world?.sky; if (sky === undefined) throw new Error('Sky-aware scene materials need a world sky');
            sky.setupMaterial(material);
          }
          materials.set(row.id, material); handles.publish(`materials.${row.id}`, material);
          if (row.kind === 'standard' || row.kind === 'basic' || row.kind === 'mapped') owner.onDispose(() => { material.dispose(); });
          materialProgress(materialIndex + 1, row.id);
          const pause = constructionCheckpoint(owner); if (pause !== undefined) await pause;
        }
      } finally { await Promise.allSettled(started.values()); }
    });
    for (const hint of section.lateMaterials ?? []) if (!materials.has(hint.id)) {
      void refinementQueue().add(`material:${hint.id}`, { x: hint.at[0], z: hint.at[1] }, () => prepareMaterial(hint.id));
    }
    const sky = ctx.game.runtime?.world?.sky, game = ctx.game.runtime?.world?.game;
    // each library copy (a whole library clones and places its model per call) and each tiled part is a slice's worth:
    // in one task they were ~117 ms of a 133 ms Nine Dragon world-step frame at phone 4x (~55 ms of clones)
    const copies = workSlice(undefined, owner);
    const publishResources = (row: WorldSceneWeld, geometryOf: (library: string, model: string) => BufferGeometry | null | undefined): void => {
      for (const resource of row.resources) {
        const shape = resource.kind === 'seeds' ? new BufferGeometry().setAttribute('seed', new BufferAttribute(new Float32Array(Uint32Array.from(resource.words).buffer), 4))
          : geometryOf(resource.source.library, resource.source.model);
        if (shape === undefined || shape === null) throw new Error('Missing frozen scene resource');
        handles.publish(resource.id, shape); owner.onDispose(() => { shape.dispose(); handles.release(resource.id, shape); });
      }
    };
    const publishAssembly = async (row: WorldSceneWeld, geometryOf: (library: string, model: string) => BufferGeometry | null | undefined): Promise<void> => {
      const geometry = new Map<string, BufferGeometry>();
      const refine = new Map<string, (mesh: Mesh, scope: Scope) => TileContent>();
      for (const node of row.nodes) if ('geometry' in node) {
        const key = JSON.stringify([node.geometry.library, node.geometry.model]);
        if (geometry.has(key)) continue;
        const shape = geometryOf(node.geometry.library, node.geometry.model);
        if (shape === undefined || shape === null) throw new Error('Missing frozen scene geometry');
        // Decoder-only staging is adopted by the assembly, never uploaded.
        geometry.set(key, shape);
        const library = refining.get(node.geometry.library);
        if (library !== undefined) {
          if (node.kind !== 'mesh') throw new Error('Fine refinement needs a plain frozen mesh');
          const model = node.geometry.model;
          refine.set(key, (mesh, scope) => library.bind(model, mesh, scope));
        }
        await copies.check();
      }
      handles.publish(row.id, new WorldSceneWeldAssembly(row, handles, { geometry, materials, refine, plumbing: product.shardfile.plumbing }, owner, registry(), ctx.root));
    };
    const residentGeometry = (library: string, model: string): BufferGeometry | null | undefined => libraries.get(library)?.geometry(model);
    for (const row of welds) { publishResources(row, residentGeometry); if (!lateWelds.has(row.id)) await publishAssembly(row, residentGeometry); }
    if (lateWelds.size > 0) {
      // I2: a weld its producer keeps out of the spawn view is built after the player has control, nearest first: its
      // drawn models are read then (not before control) and its assembly publishes as the resident welds' did.
      const from = residentTileEntry(resident) ?? product.shardfile.spawn, owned = new Map(section.libraries.flatMap(row => row.kind === 'owned' ? [[row.id, row] as const] : []));
      const away = (row: WorldSceneWeld): number => { const at = lateWelds.get(row.id) ?? [0, 0]; return Math.hypot(at[0] - from.x, at[1] - from.z); };
      const late = welds.filter(row => lateWelds.has(row.id)).sort((a, b) => away(a) - away(b));
      const pending = late.map(row => refinementQueue().add(`weld:${row.id}`, { x: lateWelds.get(row.id)?.[0] ?? 0, z: lateWelds.get(row.id)?.[1] ?? 0 }, async () => {
          const shapes = new Map<string, WorldSceneGeometry>();
          try {
          for (const id of new Set(weldSlots(row))) {
            if (materials.has(id)) continue;
            const declared = section.materials.find(material => material.id === id);
            if (declared === undefined || !deferred(declared) || sky === undefined) throw new Error('Missing late scene material');
            await prepareMaterial(id);
          }
          for (const ref of row.nodes.flatMap(node => 'geometry' in node ? [node.geometry] : [])) {
            const key = JSON.stringify([ref.library, ref.model]); if (shapes.has(key)) continue;
            const model = owned.get(ref.library)?.models.find(candidate => candidate.id === ref.model);
            if (model === undefined) throw new Error('A late weld reads only owned library models');
            const file = typeof model.file === 'string' ? model.file : model.file[TIER];
            shapes.set(key, await readWorldSceneGeometry(owner, product, { file, attributes: model.attributes, ...(model.segments === undefined ? {} : { segments: model.segments }) }, ctx.app.assets));
            await buildYield(owner);
          }
          await publishAssembly(row, (library, model) => shapes.get(JSON.stringify([library, model]))?.copy() ?? null);
          } finally { for (const shape of shapes.values()) shape.done(); }
      }));
      void Promise.all(pending);
    }
    if (batches.size > 0 && sky === undefined) throw new Error('Scene batches need a world sky');
    for (const row of batches.values()) {
      const material = materials.get(row.material); if (material === undefined) throw new Error('Missing admitted scene batch material');
      const preparedGeometry = row.geometry.map(source => {
        const geometry = libraries.get(source.library)?.geometry(source.model);
        if (geometry === undefined || geometry === null) throw new Error('Missing admitted scene batch geometry');
        owner.onDispose(() => { geometry.dispose(); }); return geometry;
      });
      const batch = new WorldSceneBatch(row, material, preparedGeometry, owner, registry(), multiDrawOf(game?.renderer));
      handles.publish(row.id, batch);
      if (sky !== undefined && game !== undefined) withOwner(owner, () => { game.onUpdate(() => { batch.update(sky.viewCamera); }); });
      const pause = constructionCheckpoint(owner); if (pause !== undefined) await pause;
    }
    if (sky !== undefined && catalogue !== undefined) {
      const geometries = new Map<string, BufferGeometry>();
      for (const draw of modelGeometry) {
        const key = JSON.stringify([draw.library, draw.model]);
        if (geometries.has(key)) continue;
        const geometry = libraries.get(draw.library)?.geometry(draw.model);
        if (geometry === undefined || geometry === null) throw new Error('Missing model catalogue source');
        geometries.set(key, geometry); owner.onDispose(() => { geometry.dispose(); }); await copies.check();
      }
      bindWorldSceneModelSources(sharedModelContext(sky), product.shardfile.identity.slug, { catalogue, geometries, materials, plumbing: product.shardfile.plumbing, scenes: modelScenes }, owner);
      // G3: a placement names a site model, or one of the section's code-built specimens (the specimen catalogue host)
      const sites = defineWorldSceneCatalogue(catalogue), specimens = section.specimens === undefined ? null : defineSpecimenCatalogue<Record<string, Record<string, unknown>>>(section.specimens,undefined,{},specimenFiles);
      const definitions = { model: (key: string) => specimens !== null && section.specimens?.some(model => model.key === key) === true ? specimens.model(key) : sites.model(key),
        // NT6: a site model's horizontal reach from its origin (its widest choice's diagonal: any origin inside its box)
        reach: (key: string) => Math.max(0, ...(catalogue?.models.find(model => model.key === key)?.choices.map(choice => Math.hypot(choice.size[0], choice.size[2])) ?? [])) };
      for (const row of placements) {
        const model = catalogue.models.find(entry => entry.key === row.model);
        const needed = new Set(model?.choices.flatMap(choice => choice.draws.concat(choice.lods.flatMap(level => level.draws)).map(draw => draw.material)));
        const sources = section.materials.filter((source): source is Extract<typeof source, { kind: 'source' }> => source.kind === 'source' && source.load === 'placement' && needed.has(source.id));
        // Coarse landmarks keep their exact last-LOD appearance. High-detail
        // source maps wait for the control cursor unless a real fine tile
        // asks first; that tile keeps the original awaited material fence.
        const coarseSlots = new Set(model?.choices.flatMap(choice => (choice.lods.at(-1)?.draws ?? choice.draws).map(draw => draw.material)));
        handles.publish(row.id, new WorldScenePlacement(ctx, row, definitions, owner, materials, sources, handles, {
          slots: coarseSlots, origin: refinementOrigin,
          later: (at, run) => { void refinementQueue().add(`placement-materials:${row.id}`, at, run); },
        }));
      }
    }
    const sceneProgress = loadingUnits('Home scenes', activeSteps.reduce((sum, step) => sum + (step.repeat?.length ?? 1), 0));
    let scenesDone = 0;
    sceneProgress(0);
    for (const step of activeSteps) for (const instance of step.repeat ?? [{ id: '' }]) {
      const file = step.variants === undefined ? step.scene : ctx.cube === null ? step.variants.standalone : step.variants.cell;
      const recipe = file === undefined ? undefined : recipes.get(file); if (recipe === undefined) throw new Error('Missing admitted scene recipe');
      const geometry = new Map<string, BufferGeometry>();
      for (const [port, ref] of Object.entries(step.geometry)) {
        const source = libraries.get(ref.library)?.geometry(ref.model); if (source === undefined || source === null) throw new Error(`Missing scene geometry: ${port}`);
        geometry.set(port, source); owner.onDispose(() => { source.dispose(); }); await copies.check();
      }
      const sources = worldSceneStepSources(product, step, geometry, new Map(Object.entries(step.materials).map(([port, slot]) => [port, materials.get(slot)])));
      const made = createWorldScene(recipe, sources.ports);
      owner.onDispose(() => { made.dispose(); });
      const buffered: { root: Group; rows: SceneBuffers }[] = [];
      drawSceneRows(product, step.draws ?? [], made.root, owner, materials, (root, rows) => { buffered.push({ root, rows }); }, ctx.app.assets);
      if (instance.position !== undefined) made.root.position.set(...instance.position);
      if (instance.rotation !== undefined) made.root.rotation.set(...instance.rotation);
      for (const row of step.bounds) {
        const part = made.parts.get(row.part); if (!mesh3(part)) throw new Error('Scene bounds require a mesh');
        part.geometry.boundingSphere = new Sphere(new Vector3(...row.sphere.center), row.sphere.radius);
      }
      for (const row of step.instanceAttributes) {
        const part = made.parts.get(row.part);
        const bytes = row.packet === undefined ? undefined : packets.get(row.packet.file);
        const floats = row.packet === undefined ? Float32Array.from(row.values ?? []) : bytes === undefined ? new Float32Array(0)
          : new Float32Array(bytes.buffer.slice(bytes.byteOffset + row.packet.byteOffset, bytes.byteOffset + row.packet.byteOffset + row.packet.count * row.width * 4));
        if (!instances3(part) || floats.length !== part.count * row.width) throw new Error('Scene instance attribute count differs');
        const values = new InstancedBufferAttribute(floats, row.width);
        if (row.target === 'instanceMatrix') { part.instanceMatrix = values; part.computeBoundingSphere(); part.computeBoundingBox(); }
        else if (row.target === 'instanceColor') part.instanceColor = values; else part.geometry.setAttribute(row.name, values);
      }
      const prefix = [step.id, instance.id].filter(Boolean).join('.');
      handles.publish(`${prefix}.root`, made.root);
      // T3: by tile, a merged part spanning tiles draws only the resident tiles' triangles (still one draw)
      made.root.updateMatrixWorld(true);
      for (const [index, draw] of buffered.entries()) {
        const content = tileBufferedDraws(`${prefix}.buffered.${String(index)}`, draw.root, draw.rows);
        if (content !== null) bufferedContents.push(content);
      }
      for (const [name, part] of made.parts) if (mesh3(part)) { const content = tiledMesh(`${prefix}.${name}`, part, part.matrixWorld); if (content !== null) handles.addTiled(content); await copies.check(); }
      for (const [id, values] of sources.collections) handles.publishMaterials(`${prefix}.${id}`, values);
      const registered = new Map<string, { root: Object3D; colliders: ColliderDesc[] }>();
      const position = instance.position ?? [0, 0, 0], rotation = instance.rotation ?? [0, 0, 0];
      const pose = poseOf({ x: position[0], y: position[1], z: position[2], yaw: rotation[1] });
      for (const row of step.registry) {
        const object = made.parts.get(row.part); if (object === undefined) throw new Error('Missing scene registry part');
        const native = readColliderRows(row.colliders, { kinds: ['box', 'treads', 'hull'], surfaces: ['sand', 'wetSand', 'grass', 'rock', 'planks', 'stone', 'water', 'wood', 'metal', 'flesh', 'shell', 'ground', 'edge', 'felt', 'earth'] });
        registered.set(row.id, { root: object, colliders: pose.upright && pose.x === 0 && pose.y === 0 && pose.z === 0 ? native : native.map(shape => placeCollider(shape, pose)) });
      }
      const kinds = Object.fromEntries(Object.entries(step.publish).map(([key, row]) => [key, row.kind]));
      for (const [key, value] of Object.entries(bindWorldSceneParts({ ...made, baked: registered }, kinds, step.publish))) {
        if (Array.isArray(value)) handles.publishColliders(`${prefix}.${key}`, value);
        else handles.publish(`${prefix}.${key}`, value);
      }
      for (const row of step.registry) {
        const prepared = registered.get(row.id); if (prepared === undefined) throw new Error('Missing scene registry part');
        const scalar = row.active;
        const active = scalar === undefined ? undefined : () => handles.number(scalar) !== 0;
        const destination = registry();
        withOwner(owner, () => destination.add({ id: instance.id === '' ? row.id : `${row.id}.${instance.id}`, name: row.name, file: row.file, category: row.category, object: prepared.root, colliders: prepared.colliders, ...(row.surface === undefined ? {} : { surface: row.surface }), solidFloor: row.solidFloor, ...(active === undefined ? {} : { active }), ...(row.mode === undefined ? {} : { mode: row.mode }) }));
        const pause = constructionCheckpoint(owner); if (pause !== undefined) await pause;
      }
      if (section.libraries.some(row => row.kind === 'models' || row.kind === 'baked')) ctx.root.add(made.root);
      sceneProgress(++scenesDone, prefix);
      const pause = constructionCheckpoint(owner); if (pause !== undefined) await pause;
    }
    if (bufferedContents.length > 0) {
      const world = ctx.game.runtime?.world;
      if (world === undefined || world === null) throw new Error('Buffered scene tiles require a world');
      // Buffered fields do not require a world.assembly or forest.page feature.
      // Their separate child driver keeps those hosts from attaching them twice.
      const tiles = owner.child('buffered-tiles');
      const at = residentTileEntry(resident) ?? product.shardfile.spawn;
      const bounds = new Map(product.shardfile.tiles.filter(tile => tile.lod === 0).map(tile => [tile.z * 8 + tile.x, tile.drawBounds ?? tile.bounds] as const));
      const camera = new StreamingCamera(ctx.root, () => world.game.camera);
      const radius = (): number => ringRadius(product.shardfile, tileRing), driver = new TileDriver(tiles, bufferedContents, radius, () => buildYield(tiles), bounds);
      driver.setStreamingView(() => camera.read());
      // Warm only the requested render ring, including every edge-overlap chunk.
      // Spawn and unrelated entryways do not belong to this crossing's intake.
      await driver.require(ring(tileOf(at.x, at.z), radius()));
      await driver.coarse(at.x, at.z);
      ctx.system({ id: 'client.world.buffered-tiles', phase: 'update', run: () => { driver.step(world.player.position.x, world.player.position.z); } });
    }
    // Every live/deferred consumer now owns a copy; retire decoder templates.
    libraries.clear(); packets.clear(); for (const done of finish) done();
    return handles;
  } catch (error) { await geometryIntake?.return(); owner.dispose(); throw error; }
  finally { await geometryIntake?.return(); }
}
