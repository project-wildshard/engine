/**
 * Exported skins in the client (SHARD-PLATFORM SF9c, the playback half). The export half (`@wildshard/sharddev/bake/export`)
 * turns a procedural creature or person into a self-contained GLB (geometry, joint order, weights, inverse binds, sampled
 * clips) plus a rig row (`skins.json`); its textures are separate KTX2 files. Here the client admits those bytes with the
 * shared GLB parser, loads them with three's GLTFLoader, checks them against the row with the engine's `bindRig` and plays
 * the named clips through the engine's `AnimMachine` (one AnimationMixer). The surface is a material the caller compiled
 * from the binding's family entry (SF10a: `familyMaterial`, the loader's `clientMaterials`), never an engine look id.
 *
 *   const skin = await loadSkin(bytes, row, binding, material);   // admitted, bound, posed at the clip's first frame
 *   skin.play('walk'); skin.update(dt);                            // per frame, as the engine's rigs do
 */
import { Float32BufferAttribute, type BufferGeometry, type Material, type Object3D, type SkinnedMesh } from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { bindRig, prepareRigLoader, type ClipName, type RigInstance } from '@wildshard/engine/anim/rig';
import { AnimMachine } from '@wildshard/engine/anim/machine';
import type { Scope } from '@wildshard/engine/app/scope';
import type { AssetCost } from '@wildshard/format/shardfileAssets';
import { parseGlbData, prepareGlbCost } from '@wildshard/format/glbCost';
import { skinLayerDecoded } from '@wildshard/format/skinLayers';
import { parseSkinBindings, type SkinRow, type SkinBinding } from '@wildshard/format/skinData';
import { skinPoseLayers } from './skinLayerPlayback';

/** A loaded exported skin: its scene root, its one skinned mesh, the bound rig and the engine's clip player. */
export interface SkinPlayer {
  readonly root: Object3D;
  readonly mesh: SkinnedMesh;
  readonly rig: RigInstance;
  readonly machine: AnimMachine;
  /** the admitted cost (the parser's, never the row's claim) */
  readonly cost: AssetCost;
  /** the clip now playing, or null before the first `play` */
  readonly clip: ClipName | null;
  /** play one clip alone from its first frame (a looping clip repeats, a one-shot holds its last frame) */
  play: (name: ClipName) => void;
  /** advance the clip by `dt` seconds (the engine's per-frame update) */
  update: (dt: number) => void;
  /** release the geometry, skeleton and mixer (the material belongs to the caller) */
  dispose: () => void;
}

const isSkin = (node: Object3D): node is SkinnedMesh => (node as Partial<SkinnedMesh>).isSkinnedMesh === true;
const materialName = (mesh: SkinnedMesh): string => (Array.isArray(mesh.material) ? mesh.material[0] : mesh.material)?.name ?? '';

/**
 * One skinned mesh from a GLB mesh's primitives (TE-ENG10): three loads each primitive as its own SkinnedMesh on the one
 * skeleton. The primitives merge into the first mesh's geometry, ordered and grouped by slot: group 0 every primitive
 * whose GLB material is not in `parts` (the family material, one draw), then one group per mapped name in `parts` order.
 * Returns the group count; with no `parts` the geometry keeps a single primitive as loaded.
 */
function mergePrimitives(meshes: readonly SkinnedMesh[], parts: readonly string[], id: string): number {
  const first = meshes[0]; if (first === undefined) throw new Error(`skin ${id}: expected one skinned mesh`);
  if (meshes.some((mesh) => mesh.skeleton.bones.length !== first.skeleton.bones.length || mesh.skeleton.bones.some((bone, i) => bone !== first.skeleton.bones[i]))) throw new Error(`skin ${id}: expected one skinned mesh`);
  const slot = (mesh: SkinnedMesh): number => parts.indexOf(materialName(mesh)) + 1;
  for (const name of parts) if (!meshes.some((mesh) => materialName(mesh) === name)) throw new Error(`skin ${id}: no GLB material ${name}`);
  if (meshes.length === 1 && parts.length === 0) return 1;
  const ordered = [...meshes].sort((a, b) => slot(a) - slot(b));
  // the format admits the same channels in different encodings (a primitive's byte joints beside another's shorts):
  // a channel whose encodings differ merges as plain floats (three's getComponent undoes a normalized encoding)
  if (meshes.length > 1) for (const name of Object.keys(first.geometry.attributes)) {
    const attributes = meshes.map((mesh) => mesh.geometry.getAttribute(name));
    const same = attributes.every((attribute) => attribute.array.constructor === attributes[0]?.array.constructor && attribute.normalized === attributes[0].normalized);
    if (same) continue;
    for (const mesh of meshes) {
      const attribute = mesh.geometry.getAttribute(name), floats = new Float32Array(attribute.count * attribute.itemSize);
      for (let i = 0; i < attribute.count; i++) for (let k = 0; k < attribute.itemSize; k++) floats[i * attribute.itemSize + k] = attribute.getComponent(i, k);
      mesh.geometry.setAttribute(name, new Float32BufferAttribute(floats, attribute.itemSize));
    }
  }
  const merged: BufferGeometry | null = meshes.length === 1 ? first.geometry.clone() : mergeGeometries(ordered.map((mesh) => mesh.geometry), false);
  if (merged === null) throw new Error(`skin ${id}: skin primitives differ in their channels`);
  merged.clearGroups();
  let start = 0;
  for (const mesh of ordered) {
    const count = mesh.geometry.index?.count ?? mesh.geometry.getAttribute('position').count, last = merged.groups.at(-1), index = slot(mesh);
    if (last?.materialIndex === index) last.count += count; else merged.addGroup(start, count, index);
    start += count;
  }
  for (const mesh of meshes) { mesh.geometry.dispose(); if (mesh !== first) mesh.removeFromParent(); }
  first.geometry = merged;
  return parts.length + 1;
}

/** Scope teardown needs the owned resources, not a player's private playback tables. */
function skinDisposer(mesh: SkinnedMesh, machine: AnimMachine): () => void {
  let live = true;
  return () => {
    if (!live) return;
    live = false; machine.dispose(); mesh.geometry.dispose(); mesh.skeleton.dispose(); mesh.removeFromParent();
  };
}

/**
 * Admit, load and bind one exported skin. Refuses bytes whose hash-addressed rig differs from the row (skeleton, joint
 * order, clips, sockets) or whose parsed cost exceeds the row's declared cost. `scope` disposes it with its owner.
 */
export async function loadSkin(glb: Uint8Array, row: SkinRow, binding: SkinBinding, material: Material, scope?: Scope, parts: readonly string[] = []): Promise<SkinPlayer> {
  if (binding.skin !== row.id) throw new Error(`skin ${row.id}: binding for ${binding.skin}`);
  parseSkinBindings([binding], [row]);
  await prepareGlbCost();
  const cost = parseGlbData(glb);
  cost.decoded += skinLayerDecoded(binding.poseLayers ?? {}, row.rig.joints[0]?.length ?? 0);
  if (cost.gpu > row.cost.gpu || cost.decoded > row.cost.decoded || cost.triangles > row.cost.triangles || cost.draws > row.cost.draws) throw new Error(`skin ${row.id}: cost above its declaration`);
  const file = await (await prepareRigLoader()).createRigLoader().parseBytesAsync(glb, '');
  const meshes: SkinnedMesh[] = []; file.scene.traverse((node) => { if (isSkin(node)) meshes.push(node); });
  // a GLB mesh's primitives (one per GLB material) load as sibling skinned meshes: merged into the first, grouped by `parts`
  const mesh = meshes[0], node = meshes.length > 1 ? mesh?.parent : mesh;
  const groups = mergePrimitives(meshes, parts, row.id);
  if (mesh === undefined) throw new Error(`skin ${row.id}: expected one skinned mesh`);
  for (const loaded of meshes) for (const m of Array.isArray(loaded.material) ? loaded.material : [loaded.material]) m.dispose();
  // the caller's material on every group (its own per-part materials replace groups 1..n where it draws them)
  mesh.material = groups === 1 ? material : Array.from({ length: groups }, () => material);
  const extras: unknown = (node ?? mesh).userData['castShadow'];
  mesh.castShadow = extras === true; mesh.receiveShadow = true;
  const rig = bindRig(file.scene, file.animations, { skeleton: row.rig.skeleton, clips: row.rig.clips, sockets: row.rig.sockets }, { skeleton: row.rig.skeleton, joints: row.rig.joints });
  const states: Record<string, { clip: ClipName; fade: number }> = {};
  for (const name of row.rig.clips) states[name] = { clip: name, fade: 0 };
  const machine = new AnimMachine({ states, loops: binding.loops }, rig);
  let current: ClipName | null = null, time = 0;
  const dispose = skinDisposer(mesh, machine);
  const layers = new Map(Object.entries(binding.poseLayers ?? {}).filter((entry): entry is [string, NonNullable<typeof entry[1]>] => entry[1] !== undefined).map(([name, data]) => [name, skinPoseLayers(mesh, data)]));
  let activeLayers: ReturnType<typeof skinPoseLayers> | undefined;
  const player: SkinPlayer = {
    root: file.scene, mesh, rig, machine, cost,
    get clip() { return current; },
    play: (name) => {
      activeLayers?.restore();
      const action = machine.action(name);
      for (const other of row.rig.clips) if (other !== name) machine.action(other).stop();
      action.reset(); action.setEffectiveWeight(1); action.play();
      current = name; time = 0; machine.update(0);
      activeLayers = layers.get(name); activeLayers?.apply(time);
    },
    update: (dt) => { if (!Number.isFinite(dt) || dt < 0) throw new Error('Invalid skin step'); activeLayers?.restore(); machine.update(dt); time += dt; activeLayers?.apply(time); },
    dispose,
  };
  scope?.onDispose(dispose);
  return player;
}
