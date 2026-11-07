import { Color, MeshStandardMaterial, Vector2, Texture, type Material } from 'three';
import { loadPBR, pbrMaterial } from '@wildshard/engine/core/assets';
import { buildTier, TIER_CONFIG } from '@wildshard/engine/core/tier';
import { pageScope, resourceScope } from '@wildshard/engine/app/resources';
import { ownSceneResource } from '@wildshard/engine/app/sceneOwnership';
import type { Scope } from '@wildshard/engine/app/scope';
import type { SkyRig } from '@wildshard/engine/world/skyRig';
import type { WorldSceneSurface } from '@wildshard/format/worldSceneSurface';
import type { ShardProduct } from '../../../shared/game/shardfile/shardProduct';
import { productCoverAppearance } from '../looks/coverAppearance';
import { gridPage } from '../../../shared/game/grid/pageMode';
import { lentMappedLook, setLentTexture } from './lentLooks';
import { app } from '@wildshard/engine/app/runtime';

interface Lease { readonly owners: Set<Scope>; readonly scope: Scope }
interface Entry {
  readonly lease: Lease; readonly base: Promise<MeshStandardMaterial>;
  readonly retire: (entry: Entry) => void; pending?: Promise<Material>;
}
const skies = new WeakMap<SkyRig, WeakMap<object, Map<string, Entry>>>();
/** Admit the appearance book and named image before scene allocation. */
export async function admitWorldSceneSurface(row: WorldSceneSurface, product: ShardProduct): Promise<void> {
  if (row.map === undefined) return;
  if (!product.hasFile(row.map.appearance)) throw new Error(`Missing surface appearance: ${row.map.appearance}`);
  const image = (await productCoverAppearance(product, row.map.appearance)).row.textures[row.map.texture];
  if (image === undefined) throw new Error(`Missing surface texture: ${row.map.texture}`);
  if (!product.hasFile(image.url)) throw new Error(`Missing surface image: ${image.url}`);
}
function release(lease: Lease): void { lease.scope.dispose(); }
/** Client-only original surface identity shared by world recipes, living nodes and cold Explorer models.
 * Rows own construction; consumers only borrow the product's named surface. */
export function worldSceneSurfaceMaterial(row: WorldSceneSurface, sky: SkyRig, product: ShardProduct, owner: Scope = resourceScope()): Promise<Material> {
  if (owner.disposed) return Promise.reject(new Error('Scene surface owner is disposed'));
  const entry = surfaceEntry(row, sky, product, owner);
  if (entry.pending === undefined) {
    entry.pending = entry.base.then(base => {
      if (entry.lease.owners.size === 0) throw new Error('Scene surface owners are disposed');
      return finish(row, sky, base);
    });
    void entry.pending.catch(() => { entry.retire(entry); });
  }
  return entry.pending;
}
/** Client-only parallel scan intake. Final materials still publish in declared row order. */
export async function prepareWorldSceneSurfaces(rows: readonly WorldSceneSurface[], sky: SkyRig, product: ShardProduct, owner: Scope): Promise<void> {
  await Promise.all(rows.filter(row => row.scan !== undefined).map(row => surfaceEntry(row, sky, product, owner).base));
}
function surfaceEntry(row: WorldSceneSurface, sky: SkyRig, product: ShardProduct, owner: Scope): Entry {
  if (owner.disposed) throw new Error('Scene surface owner is disposed');
  let products = skies.get(sky);
  if (products === undefined) { products = new WeakMap(); skies.set(sky, products); }
  let cache = products.get(product.shardfile.files);
  if (cache === undefined) { cache = new Map(); products.set(product.shardfile.files, cache); }
  const key = JSON.stringify(row);
  let entry = cache.get(key);
  if (entry === undefined) {
    const lease: Lease = { owners: new Set([owner]), scope: pageScope.child('world-scene-surface') };
    const entries = cache;
    entry = { lease, base: makeBase(row, product, lease), retire: current => {
      if (entries.get(key) === current) entries.delete(key); release(lease);
    } }; cache.set(key, entry);
    const created = entry;
    void entry.base.catch(() => { created.retire(created); });
  } else if (entry.lease.owners.has(owner)) return entry;
  else entry.lease.owners.add(owner);
  const shared = entry;
  const entries = cache;
  owner.onDispose(() => {
    shared.lease.owners.delete(owner);
    if (shared.lease.owners.size > 0) return;
    if (entries.get(key) === shared) entries.delete(key);
    // Final scene captures finish synchronously before the shared resource retires.
    queueMicrotask(() => { release(shared.lease); });
  });
  return entry;
}

async function makeBase(row: WorldSceneSurface, product: ShardProduct, lease: Lease): Promise<MeshStandardMaterial> {
  if (row.map !== undefined) await admitWorldSceneSurface(row, product);
  const { color, emissive, normalScale, ...plain } = row.properties;
  const properties = { ...plain,
    ...(color === undefined ? {} : { color: typeof color === 'number' ? color : new Color(...color) }),
    ...(emissive === undefined ? {} : { emissive: typeof emissive === 'number' ? emissive : new Color(...emissive) }),
    ...(normalScale === undefined ? {} : { normalScale: new Vector2(...normalScale) }) };
  const tier = buildTier(), nativeCap = TIER_CONFIG.maxTexture;
  const cap = Math.min(nativeCap, row.maxTexture?.[tier] ?? nativeCap,
    gridPage() && row.cellTexture !== undefined && nativeCap <= row.cellTexture.atMost ? row.cellTexture.max : nativeCap);
  const base = row.scan === undefined ? new MeshStandardMaterial(properties)
    : pbrMaterial(await loadPBR(row.scan, 1, cap), properties);
  ownSceneResource(base, lease.scope);
  for (const value of new Set(Object.values(base))) if (value instanceof Texture) ownSceneResource(value, lease.scope, app.assets);
  if (lease.owners.size === 0) { release(lease); throw new Error('Scene surface owners are disposed'); }
  if (row.map !== undefined) {
    base.map = await (await productCoverAppearance(product, row.map.appearance)).texture(product, row.map.texture);
    ownSceneResource(base.map, lease.scope, app.assets);
  }
  if (lease.owners.size === 0) throw new Error('Scene surface owners are disposed');
  return base;
}
function finish(row: WorldSceneSurface, sky: SkyRig, base: MeshStandardMaterial): Material {
  const material = row.look === undefined ? base : lentMappedLook(row.look, base);
  if (row.look === undefined) sky.setupMaterial(material);
  else for (const [param, slot] of Object.entries(row.lookTextures)) {
    const texture = base[slot]; if (texture === null) throw new Error(`Missing surface texture: ${row.id}/${slot}`);
    setLentTexture(row.look, param, texture);
  }
  return material;
}
