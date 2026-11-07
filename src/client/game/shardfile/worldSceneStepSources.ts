import { PointLight, Mesh, type BufferGeometry, Material, type MeshStandardMaterial, type Texture } from 'three';
import type { WorldScenesSection } from '@wildshard/format/worldScenes';
import type { WorldSceneRecipe } from '@wildshard/format/clientChannels';
import type { ShardProduct } from '../../../shared/game/shardfile/shardProduct';
import { applySurfaceLooks } from '../systems/looks/surfaceLooks';
import type { WorldScenePorts } from '../plugin/scene';
import { sceneBakeSource, sceneModelSource, sceneSourceDeclares, sceneModelDefinition, sceneSurfaceInputs } from './sceneSources';

type Step = WorldScenesSection['steps'][number];
const nativeMaterial = (value: unknown): value is Material => value instanceof Material;
/** Admit every original model/bake/object/texture import against explicit source
 * identities. Native owner maps and arbitrary methods are never accepted. */
export function admitWorldSceneStepSources(product: ShardProduct, step: Step, recipe: WorldSceneRecipe): void {
  for (const entry of recipe.imports) {
    const binding = entry.kind === 'model' ? step.models?.[entry.model] : step.baked?.[entry.piece];
    if (binding === undefined || !sceneSourceDeclares(product, binding.library, binding.model, entry.kind)) throw new Error(`Undeclared scene ${entry.kind} import`);
    if (entry.kind === 'baked' && entry.materials !== undefined && !step.collectMaterials?.includes(entry.materials)) throw new Error('Undeclared scene material collection');
  }
  const imported = new Set(recipe.imports.map(row => row.id)), lights = new Set((step.lights ?? []).map(row => row.id));
  for (const node of recipe.scene.nodes) if ((node.kind === 'object' || node.kind === 'anchor') && !imported.has(node.source) && !lights.has(node.source)) throw new Error('Undeclared scene object');
  for (const texture of recipe.scene.textures) {
    if (texture.kind !== 'port') throw new Error('Scene texture requires a declared source');
    const binding = step.textures?.[texture.source];
    if (binding === undefined || !sceneSourceDeclares(product, binding.library, binding.model, 'painted')) throw new Error('Undeclared scene texture');
  }
}
/** Bind the existing private-scene constructor to admitted library identities.
 * Material collections remain explicitly named resources of the constructed step. */
export function worldSceneStepSources(product: ShardProduct, step: Step, geometry: ReadonlyMap<string, BufferGeometry>, materials: ReadonlyMap<string, Material | undefined>, materialMode: 'resident' | 'declared' = 'resident'): {
  readonly ports: WorldScenePorts; readonly collections: ReadonlyMap<string, readonly MeshStandardMaterial[]>;
} {
  const collections = new Map<string, MeshStandardMaterial[]>(), textures = new Map<string, Texture>();
  for (const [id, ref] of Object.entries(step.textures ?? {})) {
    const source = sceneModelSource(product, ref.library).painted(ref.model);
    if (source === null) throw new Error('Missing declared scene texture'); textures.set(id, source.map); source.geometry.dispose();
    if (source.pivots !== undefined) for (const shape of Object.values(source.pivots)) shape.dispose();
  }
  const objects = new Map((step.lights ?? []).map(row => [row.id, new PointLight(row.color, row.intensity, row.distance, row.decay)]));
  const collectors = new Map<string, (material: MeshStandardMaterial) => void>();
  // The recipe lists collectors; createWorldScene calls only these sealed sinks.
  const collect = (id: string): ((material: MeshStandardMaterial) => void) => {
    let values = collections.get(id); if (values === undefined) { values = []; collections.set(id, values); }
    const saved = values; return material => { saved.push(material); };
  };
  for (const id of step.collectMaterials ?? []) collectors.set(id, collect(id));
  return { collections, ports: { geometry, materials, textures, objects, materialCollectors: collectors,
    model: (id, fit) => {
      const ref = step.models?.[id]; if (ref === undefined) throw new Error('Missing declared scene model');
      const model = sceneModelSource(product, ref.library).model(ref.model, fit);
      if (model === null || materialMode === 'resident') return model;
      // A specimen retains its declared looks. Resident world decorators may
      // mutate shared hero materials, so they cannot leak onto the fresh copy.
      const declared = sceneModelDefinition(product, ref.library).rows.hdLooks[ref.model]?.surface ?? [], copies = new Map<Material, Material>();
      const copy = (material: Material): Material => {
        let fresh = copies.get(material); if (fresh !== undefined) return fresh;
        fresh = material.clone(); applySurfaceLooks(fresh, declared, sceneSurfaceInputs(product, ref.library)); copies.set(material, fresh); return fresh;
      };
      model.traverse(node => {
        if (!(node instanceof Mesh)) return;
        const original: unknown = node.material;
        if (nativeMaterial(original)) node.material = copy(original);
        else if (Array.isArray(original) && original.every(nativeMaterial)) node.material = original.map(copy);
        else throw new Error('Declared model requires native materials');
      });
      return model;
    },
    baked: (id, only, each) => { const ref = step.baked?.[id]; if (ref === undefined) throw new Error('Missing declared scene bake'); return sceneBakeSource(product, ref.library).object(ref.model, only, each); },
  } };
}
