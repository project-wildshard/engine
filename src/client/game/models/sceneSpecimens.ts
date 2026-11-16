/** Client-only held/NPC model definitions, resolved through admitted source ids. */
import type { BufferGeometry, Texture, MeshStandardMaterial } from 'three';
import { defineSceneModels, type SceneModelRow, type ModelDef } from '@wildshard/engine/models/model';
import type { PrivateScene } from '@wildshard/format/clientChannels';
import type { SurfaceLook } from '@wildshard/format/surfaceLooks';
import { createHeldPresentation, type HeldMeleeRecipe, type HeldPresentationPorts } from '../plugin/weaponFamily';
import { questNpcSpecimen, type QuestNpcModelRow, type QuestNpcModelSource } from '../plugin/ui';
import type { ClientScenePorts } from '../plugin/scene';
import { applySurfaceLooks } from '../systems/looks/surfaceLooks';
import { sceneModelSource, sceneBakeSource, sceneSurfaceInputs, sceneModelDefinitions } from '../shardfile/sceneSources';
import type { ShardFolder } from '../../../shared/game/shardfile/shardFolder';
import type { ModelFit } from '../plugin/geometry';

interface Ref { readonly library: string; readonly model: string }
/** The old private-scene resource ids now name source libraries, never owners. */
export interface SceneSpecimenResources {
  readonly geometry: readonly { readonly id: string; readonly source: Ref; readonly piece?: string; readonly index?: 'preserve' | 'array' | 'identity' }[];
  readonly objects?: readonly { readonly id: string; readonly source: Ref; readonly fit: ModelFit }[];
  readonly textures?: readonly { readonly id: string; readonly source: Ref; readonly resource?: string; readonly bytes?: number }[];
  readonly decorators?: readonly { readonly id: string; readonly rows: readonly SurfaceLook[] }[];
  readonly repeats?: readonly { readonly id: string; readonly value: readonly [number, number] }[];
}
/** Original SceneModelRow and held recipe; only reflected resources are replaced. */
export interface SceneHeldSpecimen {
  readonly item: string; readonly definition: SceneModelRow;
  readonly recipe: Omit<HeldMeleeRecipe, 'resources' | 'attachments'>;
  readonly resources: SceneSpecimenResources;
  readonly attachments?: readonly { readonly id: string; readonly row: PrivateScene; readonly parent: string; readonly resources: SceneSpecimenResources }[];
}
/** Original SceneModelRow and quest model identity. */
export interface SceneNpcSpecimen {
  readonly npc: string; readonly definition: SceneModelRow;
  readonly model: QuestNpcModelRow; readonly library: string; readonly materialLibrary?: string;
}
function resources(product: ShardFolder, input: SceneSpecimenResources, source: string): ClientScenePorts {
  const geometries = new Map<string, BufferGeometry>(), textures = new Map<string, Texture | Uint8Array>();
  for (const row of input.geometry) {
    const geometry = row.piece === undefined ? sceneModelSource(product, row.source.library).geometry(row.source.model)
      : sceneBakeSource(product, row.source.library).geometry(row.piece, row.source.model, row.index === undefined ? {} : { index: row.index });
    if (geometry === null) throw new Error(`Missing specimen geometry ${row.id}`); geometries.set(row.id, geometry);
  }
  for (const row of input.textures ?? []) {
    if (row.resource !== undefined) {
      const bytes = sceneBakeSource(product, row.source.library).bytes(row.resource);
      if (bytes === null || bytes.byteLength !== row.bytes) throw new Error('Specimen texture byte size differs');
      textures.set(row.id, bytes);
    } else {
      const model = sceneModelSource(product, row.source.library).painted(row.source.model);
      if (model === null) throw new Error('Missing specimen painted source');
      textures.set(row.id, model.map); model.geometry.dispose();
      if (model.pivots !== undefined) for (const geometry of Object.values(model.pivots)) geometry.dispose();
    }
  }
  const objects = new Map((input.objects ?? []).map(row => {
    const model = sceneModelSource(product, row.source.library).model(row.source.model, row.fit);
    if (model === null) throw new Error('Missing specimen object'); return [row.id, model] as const;
  }));
  return { geometry: geometries, objects, textures,
    textureRepeat: new Map((input.repeats ?? []).map(row => [row.id, row.value])),
    decorators: new Map((input.decorators ?? []).map(row => [row.id, (material: MeshStandardMaterial) => { applySurfaceLooks(material, row.rows, sceneSurfaceInputs(product, source)); }])),
  };
}
function heldPresentationParts(product: ShardFolder, source: string, row: SceneHeldSpecimen): { recipe: HeldMeleeRecipe; model: HeldPresentationPorts } {
  return { recipe: { ...row.recipe,
    ...(row.attachments === undefined ? {} : { attachments: row.attachments.map(attachment => ({ id: attachment.id, row: attachment.row, parent: attachment.parent })) }) },
    model: { scene: resources(product, row.resources, source), attachments: new Map(row.attachments?.map(attachment => [attachment.id, resources(product, attachment.resources, source)])) } };
}
/** The live controller and Explorer resolve the same data-only resource book.
 * Callers receive independent geometry copies and the original shared textures. */
export function resolveSceneHeld(product: ShardFolder, item: string): { recipe: HeldMeleeRecipe; model: HeldPresentationPorts } {
  const matches = sceneModelDefinitions(product).flatMap(({ id, source }) => source.held?.filter(row => row.item === item).map(row => ({ source: id, row })) ?? []);
  const match = matches[0];
  if (matches.length !== 1 || match === undefined) throw new Error(`Expected one declared held model ${item}`);
  return heldPresentationParts(product, match.source, match.row);
}
/** Use the live weapon's actual playback and private scene, including its hand. */
export function declaredHeldSpecimen(product: ShardFolder, source: string, row: SceneHeldSpecimen): ModelDef<Record<string, never>> | undefined {
  return defineSceneModels([row.definition], [[row.definition.builder, () => {
    const { recipe, model } = heldPresentationParts(product, source, row);
    return createHeldPresentation(recipe, model);
  }]])[0];
}
function npcModelSource(product: ShardFolder, row: SceneNpcSpecimen): QuestNpcModelSource {
  const library = sceneModelSource(product, row.library);
  return row.model.kind === 'mesh' ? { kind: 'mesh', read: () => {
    const geometry = library.mesh(row.model.id); if (geometry === null) throw new Error(`Missing declared NPC mesh ${row.model.id}`); return geometry;
  } }
    : { kind: 'pivots', read: () => {
      const copied = library.painted(row.model.id); if (copied === null) throw new Error(`Missing declared NPC pivots ${row.model.id}`); return copied;
    },
      material: map => sceneModelSource(product, row.materialLibrary ?? row.library).mappedLook(row.model.material ?? '', map) };
}
/** Live quests borrow the same named model source as their Explorer figure. */
export function resolveSceneNpc(product: ShardFolder, npc: string): { row: QuestNpcModelRow; source: QuestNpcModelSource } {
  const matches = sceneModelDefinitions(product).flatMap(({ source }) => source.npcs?.filter(row => row.npc === npc) ?? []);
  const match = matches[0];
  if (matches.length !== 1 || match === undefined) throw new Error(`Expected one declared NPC model ${npc}`);
  return { row: match.model, source: npcModelSource(product, match) };
}
/** Use the quest NPC's actual figure and library copy in its original rest pose. */
export function declaredNpcSpecimen(product: ShardFolder, row: SceneNpcSpecimen): ModelDef<Record<string, never>> | undefined {
  return defineSceneModels([row.definition], [[row.definition.builder, () => questNpcSpecimen(product.shardfile, row.npc, row.model, npcModelSource(product, row))]])[0];
}
