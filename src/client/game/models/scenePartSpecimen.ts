/** Client-only model-contract specimens built by the same admitted Z2 step constructor. */
import { MeshBasicMaterial, MeshStandardMaterial, Object3D, type BufferGeometry, type Material } from 'three';
import { defineSceneModels, type ModelContext, type SceneModelRow, type ModelDef } from '@wildshard/engine/models/model';
import { loadingSpecimen } from '@wildshard/engine/models/gear';
import { app } from '@wildshard/engine/app/runtime';
import { resourceScope } from '@wildshard/engine/app/resources';
import { ownSceneTree } from '@wildshard/engine/app/sceneOwnership';
import { parseWorldScene, type WorldSceneRecipe } from '@wildshard/format/clientChannels';
import type { WorldScenesSection } from '@wildshard/format/worldScenes';
import type { ShardFolder } from '../../../shared/game/shardfile/shardFolder';
import { createWorldScene } from '../plugin/scene';
import type { SceneDraw } from '@wildshard/format/sceneDraws';
import { drawSceneRows, prepareSceneDrawRows } from '../shardfile/sceneDraws';
import { prepareSceneSpecimens, sceneModelSource } from '../shardfile/sceneSources';
import { admitWorldSceneStepSources, worldSceneStepSources } from '../shardfile/worldSceneStepSources';
import { hasLentLook, lendLooks, lentLook, lentMappedLook } from '../shardfile/lentLooks';
import { runtimeLookMaterials } from '../shardfile/runtimeFolder';

export interface ScenePartSpecimen { readonly part: string; readonly step: string; readonly materialLibrary?: string; readonly definition: SceneModelRow; readonly effects?: readonly { readonly part: string; readonly draws: readonly SceneDraw[] }[] }
interface Prepared { readonly recipe: WorldSceneRecipe; readonly step: WorldScenesSection['steps'][number] }
const prepared = new WeakMap<ShardFolder, Map<string, Promise<Prepared>>>();
function prepare(product: ShardFolder, id: string): Promise<Prepared> {
  let entries = prepared.get(product); if (entries === undefined) { entries = new Map(); prepared.set(product, entries); }
  const previous = entries.get(id); if (previous !== undefined) return previous;
  const pending = (async () => {
    const step = product.section('world/scenes').steps.find(row => row.id === id);
    if (step?.scene === undefined) throw new Error('Specimen requires one declared scene step');
    const recipe = parseWorldScene(await product.json<unknown>(step.scene));
    await prepareSceneSpecimens(product); admitWorldSceneStepSources(product, step, recipe);
    return { step, recipe };
  })();
  entries.set(id, pending); return pending;
}
/** Original metadata/framing is retained. A neutral kit or lit-fire specimen
 * has its own declared step and never changes a resident quest's visibility. */
export function scenePartSpecimen(product: ShardFolder, row: ScenePartSpecimen): ModelDef<Record<string, never>> {
  let source: Prepared | undefined;
  const library = () => row.materialLibrary === undefined ? undefined : sceneModelSource(product, row.materialLibrary);
  const look = (id: string): Material | undefined => library()?.look(id);
  const ready = async (): Promise<void> => {
    await Promise.all((row.effects ?? []).map(effect => prepareSceneDrawRows(product, effect.draws)));
    source = await prepare(product, row.step);
  };
  const [model] = defineSceneModels([row.definition], [[row.definition.builder, () => {
    if (source === undefined) throw new Error('Scene specimen is not prepared');
    const { step, recipe } = source;
    const build = () => {
      const owner = resourceScope().child('scene-specimen'), geometry = new Map<string, BufferGeometry>();
      for (const [name, ref] of Object.entries(step.geometry)) {
        const shape = sceneModelSource(product, ref.library).geometry(ref.model);
        if (shape === null) throw new Error('Missing scene specimen geometry'); geometry.set(name, shape);
      }
      const materials = new Map<string, Material>();
      for (const [name, slot] of Object.entries(step.materials)) {
        const material = product.section('world/scenes').materials.find(value => value.id === slot);
        if (material === undefined) throw new Error('Missing scene specimen material');
        if (material.kind === 'basic') materials.set(name, new MeshBasicMaterial(material.properties));
        else if (material.kind === 'standard') materials.set(name, new MeshStandardMaterial(material.properties));
        else if (material.kind === 'look') {
          if (material.over === undefined) materials.set(name, look(material.look) ?? lentLook(material.look));
          else {
            const painted = sceneModelSource(product, material.over.library).painted(material.over.model);
            if (painted === null) throw new Error('Missing mapped specimen source');
            const sourceBook = library();
            materials.set(name, sourceBook?.look(material.look) === undefined ? lentMappedLook(material.look, painted.map) : sourceBook.mappedLook(material.look, painted.map)); painted.geometry.dispose();
          }
        } else throw new Error('Scene specimen needs an admitted plain or graph material');
      }
      const { ports } = worldSceneStepSources(product, step, geometry, materials, 'declared'), made = createWorldScene(recipe, ports);
      ownSceneTree(made.root, owner, app.assets);
      for (const effect of row.effects ?? []) {
        const parent = made.group(effect.part); if (parent === null) throw new Error('Missing specimen effect group');
        drawSceneRows(product, effect.draws, parent, owner, new Map(effect.draws.map(draw => [draw.material, look(draw.material) ?? lentLook(draw.material)])));
      }
      const result = { root: made.root, part: (id: string) => {
        const binding = step.publish[id]; return binding !== undefined && 'part' in binding ? made.parts.get(binding.part) ?? null : made.parts.get(id) ?? null;
      } };
      const offset = row.definition.subtractY;
      if (offset !== undefined) {
        const binding = step.publish[offset]; if (binding?.kind !== 'number') throw new Error('Specimen offset requires a declared numeric anchor');
        return Object.assign(result, { [offset]: binding.value });
      }
      return result;
    };
    return build();
  }]], ready);
  if (model === undefined) throw new Error('Missing scene specimen model');
  const original = model.build;
  return { ...model, build: (ctx: ModelContext, ...args: Parameters<typeof original> extends [ModelContext, ...infer Rest] ? Rest : never): ReturnType<typeof original> => {
    const effectLooks = row.effects?.flatMap(effect => effect.draws.map(draw => draw.material)) ?? [];
    const missing = effectLooks.filter(id => look(id) === undefined && !hasLentLook(id)).concat(product.section('world/scenes').materials.filter(material => Object.values(source?.step.materials ?? {}).includes(material.id))
      .flatMap(material => material.kind === 'look' && look(material.look) === undefined && !hasLentLook(material.look) ? [material.look] : []));
    const make = () => original(ctx, ...args);
    if (missing.length === 0) return make();
    return loadingSpecimen(row.definition.model.id, [1, 1, 1], async () => {
      if (ctx.renderer === null) throw new Error('Cold scene specimen requires its renderer');
      const owner = resourceScope().child('scene-specimen-looks');
      lendLooks(owner, await runtimeLookMaterials({ scope: owner, renderer: ctx.renderer }, product.shardfile, true, [...new Set(missing)]));
      const result = make(); if (!(result instanceof Object3D)) throw new Error('Scene specimen must build a group'); return result;
    });
  } };
}
