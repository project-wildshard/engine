import { createHash } from 'node:crypto';
import { MeshStandardMaterial } from 'three';
import * as v from 'valibot';
import type { ShardRows } from '@wildshard/format/rows';
import { parseGlbData } from '@wildshard/format/glbCost';
import { skinLayerDecoded } from '@wildshard/format/skinLayers';
import type { SkinBinding } from '@wildshard/format/skinData';
import { Scope } from '@wildshard/engine/app/scope';
import { AnimalFactory, DEFAULT_CREATURE_RENDER, type AnimalModel } from '@wildshard/engine/entities/AnimalFactory';
import type { SkyRig } from '@wildshard/engine/world/skyRig';
import { Animal } from '../../src/client/engine/entities/AnimalView';
import { createShardfileSim } from '../../src/server/game/plugin/simulation';
import { loadClientSkins, skinSpeciesLook } from '../../src/client/game/shardfile/clientSkins';
import type { Rapier } from '../../src/shared/engine/physics/rapier';
import { creatureVolumeFixture } from './creature-volume-skin';

const hash = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');
const Doc = v.object({ nodes: v.array(v.object({ name: v.optional(v.string()) })), skins: v.array(v.object({ joints: v.array(v.number()) })),
  animations: v.optional(v.array(v.object({ name: v.string() })), []) });

/** CPU-only material setup; all GLB admission, rig and simulation owners are real. */
export async function kitView(bytes: Uint8Array, skeleton: 'biped' | 'quadruped', dims: ShardRows['species'][number]['dims'], rapier: Rapier,
  scale = 1, socket?: string, layers?: SkinBinding['poseLayers']) {
  const { source } = await creatureVolumeFixture(), species = source.rows.species[0], look = source.rows.looks[0];
  if (species === undefined || look === undefined) throw new Error('Missing normal fixture rows');
  species.body = { skeleton, size: 'medium', scale, look: look.id, ...(socket === undefined ? {} : { lock: [socket] }) };
  species.dims = dims;
  const length = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(12, true), doc = v.parse(Doc, JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + length))));
  const joints = doc.skins[0]?.joints.map(index => doc.nodes[index]?.name), clips = doc.animations.map(clip => clip.name);
  const glb = bytes.slice(), file = hash(glb), cost = parseGlbData(glb);
  cost.decoded += skinLayerDecoded(layers ?? {}, joints?.length ?? 0);
  const metadata = new TextEncoder().encode(JSON.stringify({ row: { id: 'fixture.kit', file, family: 'pbr', cost,
    rig: { skeleton: `fixture.${skeleton}`, joints: [joints], sockets: joints, clips } },
    binding: { skin: 'fixture.kit', material: { family: 'pbr', vertexColours: true }, loops: clips.filter(name => name === 'idle' || name === 'walk'), ...(layers === undefined ? {} : { poseLayers: layers }) } }));
  const skin = hash(metadata); look.parameters = { skin };
  source.files = [{ hash: file, kind: 'glb', compressed: glb.length, ...cost, dependencies: [], critical: false },
    { hash: skin, kind: 'json', compressed: metadata.length, decoded: metadata.length * 2, gpu: 0, triangles: 0, draws: 0, dependencies: [file], critical: false }];
  source.library = [skin];
  const assets = new Map([[file, glb], [skin, metadata]]), scope = new Scope('kit-view');
  const sim = createShardfileSim(source, assets, { rapier });
  let view: Animal | undefined;
  const dispose = (): void => { view?.mesh.skeleton.dispose(); view?.mesh.removeFromParent(); sim.dispose(); scope.dispose(); };
  try {
    const actor = sim.host.entities.get('fixture.actor'); if (actor?.hitVolumes === undefined || actor.lockPoints === undefined) throw new Error('Missing actual kit body ports');
    const loaded = (await loadClientSkins(source, assets, () => new MeshStandardMaterial(), scope)).get(look.id);
    if (loaded === undefined) throw new Error('Missing actual loaded GLB');
    const definition = skinSpeciesLook(look, species, loaded), variant = { id: actor.variant, label: 'Kit', weight: 1, rarity: 'common' as const, scale: [1, 1] as [number, number], hp: 100 };
    const material = new MeshStandardMaterial(); scope.onDispose(() => material.dispose());
    const render = { ...DEFAULT_CREATURE_RENDER, waitForModels: false, furRim: false };
    const model: AnimalModel = { kind: actor.kind, variant: actor.variant, style: 'toon', render,
      species: { ...definition, kind: actor.kind, label: 'Kit', variants: [variant] }, variantDef: variant,
      geometry: loaded.geometry, bones: loaded.bones.map(bone => ({ name: bone.name, parent: bone.parent, pos: [...bone.pos] })),
      dims: species.dims, fur: material, hard: material, eye: material, shells: [] };
    const sky = { setupMaterial: (): void => undefined } as unknown as SkyRig;
    const factory = new AnimalFactory(sky, { style: 'toon', render }), rig = factory.instantiate(model);
    for (const owned of rig.materials) scope.onDispose(() => owned.dispose());
    view = new Animal(rig, model, actor.seed, 1, actor.entityId).bindSimulation(actor);
    return { actor, view, rig, loaded, definition, source, assets, sim, dispose };
  } catch (error) { dispose(); throw error; }
}
