import { BufferGeometry, Material, Mesh, MeshStandardMaterial, type Object3D, Texture } from 'three';
import { loadRigFile } from '@wildshard/engine/anim/rig';
import { ownSceneResource, sceneResourceOwner } from '@wildshard/engine/app/sceneOwnership';
import { gpuOnlyTexture } from '@wildshard/engine/core/gpuOnly';
import type { Scope } from '@wildshard/engine/app/scope';
import { app } from '@wildshard/engine/app/runtime';
import type { SkyRig } from '@wildshard/engine/world/skyRig';
import type { WorldScenesSection } from '@wildshard/format/worldScenes';

import type { SceneHandles } from './sceneHandles';
import type { ShardProduct } from '../../../shared/game/shardfile/shardProduct';

type Source = Extract<WorldScenesSection['materials'][number], { kind: 'source' }>;
const loaded = new WeakMap<Scope, Map<string, Promise<{ readonly materials: readonly Material[]; readonly root: Object3D }>>>();
const geometryValue = (value: unknown): value is BufferGeometry => value instanceof BufferGeometry;
const materialValue = (value: unknown): value is Material => value instanceof Material;
const textureValue = (value: unknown): value is Texture => value instanceof Texture;
/** not disposed and not retiring (itself or an ancestor): every await re-reads it */
const live = (owner: Scope): boolean => !owner.disposed && !owner.disposing;

/** Client-only original PBR intake. Aliases retain the asset manager's tier and texture routing; an alias that names a
 * product file (no leading '/') loads through the product's own URL for it (GR8, as a product-named figure skin does).
 * An optional named source root retains its original geometry and shares the exact prepared materials. */
export async function worldSceneSourceMaterial(row: Source, sky: SkyRig, product: Pick<ShardProduct, 'url'>, owner: Scope, handles?: SceneHandles): Promise<Material> {
  if (!live(owner)) throw new Error('Scene material owner is disposed');
  let files = loaded.get(owner);
  if (files === undefined) { files = new Map(); loaded.set(owner, files); owner.onDispose(() => { loaded.delete(owner); }); }
  const aliases = Object.fromEntries(Object.entries(row.aliases).map(([from, to]) => [from, to.startsWith('/') ? to : product.url(to)]));
  const key = JSON.stringify([row.url, aliases, row.anisotropy, row.anisotropyMaps, row.envMapIntensity, row.publishObject !== undefined && handles !== undefined, row.gpuOnlyMaps === true]);
  let pending = files.get(key);
  if (pending === undefined) {
    pending = loadRigFile(row.url, aliases).then(file => {
      const materials: Material[] = [], geometries = new Set<BufferGeometry>();
      file.scene.traverse(node => {
        if (!(node instanceof Mesh)) return;
        const geometry: unknown = node.geometry, value: unknown = node.material;
        if (geometryValue(geometry)) geometries.add(geometry);
        const candidates: readonly unknown[] = Array.isArray(value) ? value : [value];
        for (const material of candidates) if (materialValue(material)) materials.push(material);
      });
      // an owner that retired while the file loaded takes it back through the same accounting (a closed owner releases it
      // at once), untouched: no sky setup, tuning, GPU-only arming or publication
      const refused = !live(owner);
      for (const geometry of geometries) {
        if (!refused && row.publishObject !== undefined && handles !== undefined) ownSceneResource(geometry, owner); else geometry.dispose();
      }
      const textures = new Set<NonNullable<MeshStandardMaterial['map']>>();
      for (const material of new Set(materials)) {
        if (!refused) {
          if (material instanceof MeshStandardMaterial) {
            for (const name of row.anisotropyMaps) { const texture = material[name]; if (texture !== null) texture.anisotropy = row.anisotropy; }
            material.envMapIntensity = row.envMapIntensity;
          }
          sky.setupMaterial(material);
        }
        const values: readonly unknown[] = Object.values(material);
        for (const value of values) if (textureValue(value)) textures.add(value);
        ownSceneResource(material, owner);
      }
      for (const texture of textures) ownSceneResource(texture, owner, app.assets);
      if (refused) throw new Error('Scene material owner is disposed');
      // the source's own PBR maps leave the CPU once uploaded, each texture armed once (gpuOnlyTexture wraps its one upload
      // hook); a texture the asset cache or another owner lends stays whole
      if (row.gpuOnlyMaps === true) {
        const maps = new Set<NonNullable<MeshStandardMaterial['map']>>();
        for (const material of new Set(materials)) if (material instanceof MeshStandardMaterial) {
          for (const texture of [material.map, material.normalMap, material.roughnessMap, material.metalnessMap, material.aoMap, material.emissiveMap]) {
            if (texture !== null && !app.assets.isAcquired(texture) && sceneResourceOwner(texture) === owner) maps.add(texture);
          }
        }
        for (const texture of maps) gpuOnlyTexture(texture, `scene source maps (GPU only): ${row.url}`);
      }
      if (!live(owner)) throw new Error('Scene material owner is disposed');
      return { materials, root: file.scene };
    });
    files.set(key, pending);
    const cache = files;
    void pending.catch(() => { if (cache.get(key) === pending) cache.delete(key); });
  }
  const { materials, root } = await pending;
  if (!live(owner)) throw new Error('Scene material owner is disposed');
  if (row.publishObject !== undefined && handles !== undefined) {
    const id = row.publishObject;
    if (!handles.has(id)) { handles.publish(id, root); owner.onDispose(() => { handles.release(id, root); }); }
    else if (handles.object(id) !== root) throw new Error('Source object publication differs');
  }
  const material = materials[row.part];
  if (material === undefined) throw new Error(`Missing source material part: ${row.url}/${String(row.part)}`);
  return material;
}
