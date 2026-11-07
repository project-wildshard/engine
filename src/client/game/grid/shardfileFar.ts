import { Mesh, type BufferGeometry, type Object3D } from 'three';
import { prepareRigLoader } from '@wildshard/engine/anim/rig';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { NEAR_COLOUR, NEAR_LIGHT, nearPlaceholderCost, type NearPlaceholder } from '@wildshard/format/nearPlaceholder';
import type { Shardfile } from '@wildshard/format/shardSchema';
import type { FarPrepared } from './farView';
import { decodeFarImpostor } from './farImpostorView';

function isMesh(node: Object3D): node is Mesh { return node instanceof Mesh; }
/** three's merge returns null for parts whose attributes differ (its typing omits it). */
const merge: (parts: BufferGeometry[]) => BufferGeometry | null = mergeGeometries;

/** What a shardfile's far proxy reads (O26: read from its sections, not a whole admitted product): its far row, its props'
 * far GLB and its first fog key's colour (the haze). */
export interface ShardfileFarRows {
  readonly far: Shardfile['far']; readonly farRef: string | null;
  readonly fog: Shardfile['look']['keys'][number]['fog']['colour'] | null;
}
/** What a shardfile's near view reads (G608: from its sections, not a whole admitted product): its near row, its first fog
 * key's colour (the haze) and the file inventory its near cost is checked against. */
export interface ShardfileNearRows {
  readonly near: NearPlaceholder; readonly fog: ShardfileFarRows['fog'];
  readonly inventory: Parameters<typeof nearPlaceholderCost>[1];
}
/** Authored mesh worlds ship their one-draw proxy inside their product, without a second baked-folder copy. */
export async function loadShardfileFar(rows: ShardfileFarRows, read: (ref: string) => Promise<Uint8Array>): Promise<{ prepared: FarPrepared; bytes: number }> {
  const { far, farRef: ref } = rows;
  if (far === null || ref === null || !far.files.includes(ref)) throw new Error('Authored world has no declared far GLB');
  const gltf = await (await prepareRigLoader()).createRigLoader().parseAsync((await read(ref)).slice().buffer, '');
  gltf.scene.updateMatrixWorld(true);
  const meshes: Mesh[] = [];
  gltf.scene.traverse(node => {
    if (!isMesh(node)) return;
    meshes.push(node);
    for (const material of Array.isArray(node.material) ? node.material : [node.material]) material.dispose();
  });
  const mesh = meshes[0];
  if (meshes.length !== 1 || mesh === undefined) {
    for (const node of meshes) node.geometry.dispose();
    throw new Error('Authored far GLB must contain one mesh');
  }
  const geometry = mesh.geometry;
  geometry.applyMatrix4(mesh.matrixWorld);
  // G539: its baked impostor, when the build gave it one
  const impostor = far.impostor === undefined ? null : await decodeFarImpostor(far.impostor, await read(far.impostor.file));
  return { prepared: { geometry, positionalMask: true, look: shardfileHaze(rows.fog), impostor }, bytes: far.decoded + far.gpu };
}

/** A shardfile's own placeholder look: pbr, its air its first fog key's colour. */
function shardfileHaze(fog: ShardfileFarRows['fog']): FarPrepared['look'] {
  return { family: 'pbr', haze: { colour: fog ?? [1, 1, 1] } };
}

/**
 * G348: any shardfile's own near placeholder (its admitted `near` row, which `wildshard build` bakes for every terrain
 * shardfile, an unknown uploaded one included): its content GLBs' meshes merged into the near view's one draw, masked by
 * position (an authored GLB's UVs carry no region contract), charged its admitted content residency. It never owns its
 * cell: a shardfile's own L1 / L0 tiles are its real world (the template's buildings live in its props, which the bake
 * cannot see), so they keep refining over it. A terrain-only row (L1 height tiles) is not drawn yet and rejects, so the
 * far proxy stays. Rejects when the shardfile declares no near content.
 */
export async function loadShardfileNear(rows: ShardfileNearRows, read: (ref: string) => Promise<Uint8Array>): Promise<{ prepared: FarPrepared; bytes: number; owns: boolean }> {
  const near = rows.near;
  if (near.content.length === 0) throw new Error('Shardfile declares no near content');
  const cost = nearPlaceholderCost(near, rows.inventory), loader = (await prepareRigLoader()).createRigLoader(), parts: BufferGeometry[] = [], lights: BufferGeometry[] = [], colours: BufferGeometry[] = [];
  try {
    for (const ref of near.content) {
      const gltf = await loader.parseAsync((await read(ref)).slice().buffer, '');
      gltf.scene.updateMatrixWorld(true);
      gltf.scene.traverse(node => {
        if (!isMesh(node)) return;
        for (const material of Array.isArray(node.material) ? node.material : [node.material]) material.dispose();
        // NM13: the light layer stays apart from the lit draw (drawn additively, unlit)
        (node.name === NEAR_LIGHT ? lights : node.name === NEAR_COLOUR ? colours : parts).push(node.geometry.applyMatrix4(node.matrixWorld));
      });
    }
  } catch (error) { for (const part of [...parts, ...lights, ...colours]) part.dispose(); throw error; }
  const [first] = parts;
  if (first === undefined) throw new Error('Near content has no mesh');
  const geometry = parts.length === 1 ? first : merge(parts);
  if (parts.length > 1) for (const part of parts) part.dispose();
  if (geometry === null) throw new Error('Near content has no mergeable mesh');
  const light = lights.length === 0 ? null : lights.length === 1 ? lights[0] ?? null : merge(lights);
  if (lights.length > 1) for (const part of lights) part.dispose();
  const colour = colours.length === 0 ? null : colours.length === 1 ? colours[0] ?? null : merge(colours);
  if (colours.length > 1) for (const part of colours) part.dispose();
  return { prepared: { geometry, positionalMask: true, look: shardfileHaze(rows.fog), ...(light === null ? {} : { light }), ...(colour === null ? {} : { colour }) }, bytes: cost.content.resident, owns: false };
}
