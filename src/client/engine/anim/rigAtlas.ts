import { BufferGeometry, Group, Mesh, MeshStandardMaterial, type Object3D, type Texture } from 'three';
import type { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function staticMeshes(value: unknown): readonly Record<string, unknown>[] | null {
  if (!record(value) || !Array.isArray(value['meshes']) || !Array.isArray(value['nodes'])
    || Array.isArray(value['animations']) && value['animations'].length > 0
    || Array.isArray(value['skins']) && value['skins'].length > 0) return null;
  const nodes: readonly unknown[] = value['nodes'], meshes: readonly unknown[] = value['meshes'];
  if (nodes.some(node => !record(node) || node['skin'] !== undefined
    || record(node['extensions']) && node['extensions']['EXT_mesh_gpu_instancing'] !== undefined)) return null;
  const result: Record<string, unknown>[] = [];
  for (const mesh of meshes) {
    if (!record(mesh) || !Array.isArray(mesh['primitives'])) return null;
    const primitives: readonly unknown[] = mesh['primitives'];
    if (primitives.some(primitive => !record(primitive) || primitive['targets'] !== undefined
      || primitive['mode'] !== undefined && primitive['mode'] !== 4 && primitive['mode'] !== 5 && primitive['mode'] !== 6
      || record(primitive['extensions']) && primitive['extensions']['KHR_draco_mesh_compression'] !== undefined)) return null;
    result.push(mesh);
  }
  return result;
}

/** Texture-only intake for prepared geometry. The native parser still owns scene
 * order, materials, images, samplers and UV transforms. No mesh is published.
 * Complex rigs retain the ordinary native geometry reader and selection rule. */
export function rigAtlasReader(loader: GLTFLoader): (root: Object3D) => Texture | null {
  const maps = new Map<string, Texture>();
  let meshes: readonly Record<string, unknown>[] | null = null;
  loader.register(parser => ({
    name: 'prepared-model-atlas',
    beforeRoot: () => { const json: unknown = parser.json; meshes = staticMeshes(json); return null; },
    loadMesh: index => {
      const mesh = meshes?.[index];
      if (mesh === undefined || !Array.isArray(mesh['primitives'])) return null;
      const primitives: readonly unknown[] = mesh['primitives'], root = new Group(), pending: Promise<void>[] = [];
      for (const primitive of primitives) {
        const slot = new Group(); root.add(slot);
        if (!record(primitive) || !record(primitive['attributes'])
          || typeof primitive['attributes']['TEXCOORD_0'] !== 'number' || typeof primitive['indices'] !== 'number'
          || typeof primitive['material'] !== 'number') continue;
        // A scalar tag survives Three's node clones without sharing a material
        // object through userData. Original primitive order is fixed before IO.
        const key = slot.uuid; slot.userData['preparedAtlas'] = key;
        pending.push(Promise.resolve(parser.getDependency('material', primitive['material'])).then((material: unknown) => {
          if (material instanceof MeshStandardMaterial && material.map !== null) maps.set(key, material.map);
          return undefined;
        }));
      }
      return Promise.allSettled(pending).then(results => {
        for (const result of results) if (result.status === 'rejected') throw result.reason;
        return root;
      });
    },
  }));
  return root => {
    let map: Texture | null = null;
    root.traverse(node => {
      if (map !== null) return;
      const key: unknown = node.userData['preparedAtlas'];
      if (meshes !== null && typeof key === 'string') map = maps.get(key) ?? null;
      else if (node instanceof Mesh) {
        const stored: unknown = node.material, geometry: unknown = node.geometry;
        const material: unknown = Array.isArray(stored) ? stored[0] : stored;
        if (material instanceof MeshStandardMaterial && material.map !== null && geometry instanceof BufferGeometry
          && geometry.hasAttribute('uv') && geometry.index !== null) map = material.map;
      }
    });
    return map;
  };
}
