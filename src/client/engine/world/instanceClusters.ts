/**
 * Scatter clusters (meta SHARD-SOURCE AP33a and AP33b). A props tile's `EXT_mesh_gpu_instancing` node parses to one
 * InstancedMesh holding every copy in the 62.5 m tile, so three culls the whole tile as one sphere and draws every copy
 * however far. Here each such mesh is cut into clusters, one per `CLUSTER_CELL` square its copies stand in, each with its
 * own bounds (three's frustum test then drops the clusters off screen), and a cluster past the tier's `far` draws only a
 * stable prefix of its copies (`fraction`), so nothing flickers as the eye moves.
 *
 *   const clusters = clusterInstances(mesh);     // replaces `mesh` under its parent; the total copy count is unchanged
 *   clusterCount(full, distance, CLUSTER_LOD[TIER])  // what a cluster draws at that distance
 */
import { InstancedBufferAttribute, InstancedMesh, Matrix4, PerspectiveCamera, Vector3, type Camera, type Object3D } from 'three';
import { TIER, type Tier } from '../core/tier';

/** Metres: four clusters a side in a 62.5 m props tile. */
export const CLUSTER_CELL: number = 62.5 / 4;
/** A mesh with fewer copies stays whole: a cluster's draw would cost more than it culls. */
export const CLUSTER_MIN_COPIES = 16;

/** Per tier: past `far` metres (eye to the cluster's centre) a cluster draws `fraction` of its copies. The phone's are half. */
export const CLUSTER_LOD: Readonly<Record<Tier, { readonly far: number; readonly fraction: number }>> = {
  desktop: { far: 90, fraction: 0.5 },
  phone: { far: 45, fraction: 0.25 },
};

/** How many of a cluster's `full` copies draw with the eye `distance` metres from its centre: all near, a prefix far. */
export function clusterCount(full: number, distance: number, lod: { readonly far: number; readonly fraction: number }): number {
  if (distance <= lod.far || full === 0) return full;
  return Math.max(1, Math.ceil(full * lod.fraction));
}

const seat = new Matrix4(), at = new Vector3(), centre = new Vector3();
/** Without narrowing to InstancedMesh's `any` type parameters. */
const isInstanced = (object: Object3D): object is InstancedMesh => object instanceof InstancedMesh;

/**
 * Cut one instanced mesh into clusters under its parent, in its place (same frame, material, geometry, shadows and
 * layers). Copies keep their order within a cluster, so a prefix is stable. Returns the clusters, or `[mesh]` unchanged
 * when it is too small to cut, has no parent, or is never culled (a card). The original's instance buffers are disposed.
 */
export function clusterInstances(mesh: InstancedMesh, cell: number = CLUSTER_CELL, lod: () => { readonly far: number; readonly fraction: number } = () => CLUSTER_LOD[TIER]): InstancedMesh[] {
  const parent = mesh.parent;
  if (parent === null || !mesh.frustumCulled || mesh.count < CLUSTER_MIN_COPIES || mesh.morphTexture !== null) return [mesh];
  const groups = new Map<string, number[]>();
  for (let i = 0; i < mesh.count; i++) {
    mesh.getMatrixAt(i, seat); at.setFromMatrixPosition(seat);
    const key = `${Math.floor(at.x / cell)},${Math.floor(at.z / cell)}`;
    const list = groups.get(key); if (list === undefined) groups.set(key, [i]); else list.push(i);
  }
  if (groups.size < 2) return [mesh];
  const colours = mesh.instanceColor, clusters: InstancedMesh[] = [];
  for (const members of groups.values()) {
    const cluster = new InstancedMesh(mesh.geometry, mesh.material, members.length);
    members.forEach((from, to) => {
      mesh.getMatrixAt(from, seat); cluster.setMatrixAt(to, seat);
    });
    if (colours !== null) {
      const out = new Float32Array(members.length * 3), source = colours.array;
      members.forEach((from, to) => { out[to * 3] = source[from * 3] ?? 1; out[to * 3 + 1] = source[from * 3 + 1] ?? 1; out[to * 3 + 2] = source[from * 3 + 2] ?? 1; });
      cluster.instanceColor = new InstancedBufferAttribute(out, 3);
    }
    cluster.name = mesh.name; cluster.castShadow = mesh.castShadow; cluster.receiveShadow = mesh.receiveShadow;
    cluster.layers.mask = mesh.layers.mask; cluster.renderOrder = mesh.renderOrder; cluster.visible = mesh.visible;
    cluster.userData = { ...mesh.userData, clusterOf: mesh.name, clusterCopies: members.length };
    cluster.position.copy(mesh.position); cluster.quaternion.copy(mesh.quaternion); cluster.scale.copy(mesh.scale);
    cluster.matrixAutoUpdate = mesh.matrixAutoUpdate; cluster.matrix.copy(mesh.matrix);
    cluster.computeBoundingSphere();
    const full = members.length;
    // AP33b: the main view picks the prefix; a shadow pass (an orthographic light camera) keeps what the view drew
    cluster.onBeforeRender = (_renderer, _scene, camera: Camera) => {
      if (!(camera instanceof PerspectiveCamera) || cluster.boundingSphere === null) return;
      centre.copy(cluster.boundingSphere.center).applyMatrix4(cluster.matrixWorld);
      cluster.count = clusterCount(full, centre.distanceTo(at.setFromMatrixPosition(camera.matrixWorld)), lod());
    };
    clusters.push(cluster);
  }
  const index = parent.children.indexOf(mesh);
  parent.remove(mesh);
  for (const cluster of clusters) parent.add(cluster);
  // keep the original's slot in the child order (the clusters follow its siblings in place of it)
  parent.children.splice(parent.children.length - clusters.length, clusters.length);
  parent.children.splice(index, 0, ...clusters);
  mesh.dispose();
  return clusters;
}

/** Cut every instanced mesh under `root` (a props tile). Returns each replaced mesh with its clusters. */
export function clusterTile(root: Object3D, lod?: () => { readonly far: number; readonly fraction: number }): { readonly from: InstancedMesh; readonly to: readonly InstancedMesh[] }[] {
  const found: InstancedMesh[] = [];
  root.traverse((object) => { if (isInstanced(object)) found.push(object); });
  const out: { from: InstancedMesh; to: readonly InstancedMesh[] }[] = [];
  for (const mesh of found) {
    const to = clusterInstances(mesh, CLUSTER_CELL, lod);
    if (to.length !== 1 || to[0] !== mesh) out.push({ from: mesh, to });
  }
  return out;
}
