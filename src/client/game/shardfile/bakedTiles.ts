/**
 * Baked tiles (G532 (4), `format/bakedTiles`): a Blender-built tile set drawn with one look, its offline bake's lightmaps
 * lent to that look, and its prototypes placed instanced (one model per family, `engine/models/place`) with their
 * collider boxes. Client-only presentation; the API takes one row, and the `world.baked` client feature installs the
 * client plan's rows once per resident (HOST-BAR: an island cove with placed families and a dev-map cell's ground).
 *
 *   const baked = await installBakedTiles({ product, parent, sky, registry }, row);   // then once a frame: baked.update()
 *
 * The lightmaps carry only what the clock barely moves (sky occlusion, the sun's bounce); the sun and its shadows stay
 * live, and the bounce follows the live sun (`engine/render/lightmaps`). A required file that fails refuses the build.
 */
import * as THREE from 'three';
import * as v from 'valibot';
import { prepareRigLoader } from '@wildshard/engine/anim/rig';
import { slicer } from '@wildshard/engine/boot/plan';
import { ktx2File, ktx2Texture } from '@wildshard/engine/core/ktx2';
import { TIER } from '@wildshard/engine/core/tier';
import { gpuOnlyTexture } from '@wildshard/engine/core/gpuOnly';
import { defineGeometryModel, modelContext } from '@wildshard/engine/models/model';
import { placeSliced } from '@wildshard/engine/models/place';
import type { CullOptions } from '@wildshard/engine/models/cull';
import { sunBounce } from '@wildshard/engine/render/lightmaps';
import { boxDesc, type ColliderDesc, type WorldRegistry } from '@wildshard/engine/world/registry';
import { withOwner } from '@wildshard/engine/app/ownership';
import type { Scope } from '@wildshard/engine/app/scope';
import type { ClientFeatureRow } from '@wildshard/format/clientPlan';
import type { ShardContext } from '../plugin/context';
import type { SkyRig } from '@wildshard/engine/world/skyRig';
import { BakedPlanSchema, BakedTilesSchema, type BakedPlan, type BakedSource, type BakedTilesRow } from '@wildshard/format/bakedTiles';
import { followToonLook } from '../looks/toonLook';
import { lendLooks, lentLook, setLentParam, setLentTexture } from './lentLooks';
import { runtimeLookMaterials } from './runtimeProduct';
import type { ShardProduct } from '../../../shared/game/shardfile/shardProduct';
import { wearBakedTiles } from '../looks/vertexWear';
import { colliderTileKeys, type TileContent } from './tileContent';
import { tiledMesh } from './tiledMesh';
import { bakedPlacementPoses } from '../../../shared/game/shardfile/bakedPlacementPoses';
import { readContent } from '@wildshard/engine/boot/contentRead';

/** What a row is drawn into: the product its files resolve against, the live world, and the scope its pieces leave with
 *  (absent: the ambient owner, as a resident world's build). */
export interface BakedTilesOwner { readonly product: ShardProduct; readonly parent: THREE.Object3D; readonly sky: SkyRig; readonly registry: WorldRegistry; readonly scope?: Scope;
  /** the world's ground mesh geometry a row's `wear` declares as its part 0 */
  readonly ground?: THREE.BufferGeometry }
/** The drawn set: its group, its tiles in file order, its once-a-frame bounce update, and (registered whole, under its own
 *  scope) the colliders no copy claims, which `bakedTileContents` moves onto the collider ring. */
export interface BakedTiles { readonly group: THREE.Group; readonly tiles: readonly THREE.Mesh[]; readonly update: () => void; readonly unclaimed?: BakedUnclaimed }
/** A set's unclaimed collider boxes, their piece's metadata and the scope that holds their whole-set registration. */
interface BakedUnclaimed { readonly piece: Omit<Parameters<WorldRegistry['add']>[0], 'id' | 'colliders'>; readonly id: string; readonly colliders: readonly ColliderDesc[]; readonly whole: Scope; readonly registry: WorldRegistry }

const owned = <T>(owner: BakedTilesOwner, fn: () => T): T => owner.scope === undefined ? fn() : withOwner(owner.scope, fn);
const isMesh = (o: THREE.Object3D): o is THREE.Mesh => o instanceof THREE.Mesh;

function bytesOf(product: ShardProduct, source: BakedSource): Promise<Uint8Array> {
  if ('file' in source) return product.file(source.file);
  return readContent(source.url, 25_000_000, {fetch: (url, init) => fetch(url, {cache: 'force-cache', ...init})});
}
// the page's bounded parser: one decode slot, a product file's wire copy taken only once its slot opens
async function sceneOf(product: ShardProduct, source: BakedSource): Promise<THREE.Group> {
  return 'url' in source ? (await (await prepareRigLoader()).createRigLoader().loadAsync(source.url)).scene : (await (await prepareRigLoader()).createRigLoader().parseBytesAsync(await product.file(source.file), '')).scene;
}
/** A product image decoded off the main thread, as stored (the lightmaps' flipY = false, NoColorSpace raw texels): an
 *  HTMLImageElement decoded and uploaded inside its first draw (G743: Driftwood's lm-ao + lm-bounce, 85 + 117 ms of one
 *  afterPlay frame at phone 4x). Without createImageBitmap it loads as an image, as before. */
async function productImage(product: ShardProduct, file: string): Promise<THREE.Texture> {
  if (typeof createImageBitmap !== 'function') return new THREE.TextureLoader().loadAsync(product.url(file));
  const bitmap = await createImageBitmap(new Blob([Uint8Array.from(await product.file(file))]), { imageOrientation: 'none', premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
  const texture = new THREE.Texture(bitmap); texture.flipY = false; texture.needsUpdate = true;
  return texture;
}
async function textureOf(product: ShardProduct, source: BakedSource): Promise<THREE.Texture> {
  // a product's KTX2 file transcodes; any other image file decodes as a bitmap
  if ('file' in source) return source.file.endsWith('.ktx2') ? ktx2File(product.url(source.file)) : productImage(product, source.file);
  return (await ktx2Texture(source.url)) ?? new THREE.TextureLoader().loadAsync(source.url);
}
/** A tier's plan: its exact bytes (and, for a public file, the content hash its name carries) before its rows. */
async function planOf(product: ShardProduct, row: NonNullable<BakedTilesRow['instances']>['plan']['phone'], keys: ReadonlySet<string>): Promise<BakedPlan> {
  const bytes = await bytesOf(product, row.source), named = 'url' in row.source ? /[0-9a-f]{64}/u.exec(row.source.url)?.[0] : undefined;
  if (named !== undefined && Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', Uint8Array.from(bytes))), b => b.toString(16).padStart(2, '0')).join('') !== named) throw new Error('Required baked plan content differs');
  if (bytes.length !== row.bytes) throw new Error('Required baked plan content differs');
  const plan = v.parse(BakedPlanSchema, JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)));
  if (plan.used !== row.used || plan.families.some(f => !keys.has(f.key) || f.indices.some(i => i >= plan.used))) throw new Error('Required baked plan layout differs');
  return plan;
}

/** Draw one admitted row under `owner.parent`; resolves once every tile and copy is placed and registered. */
export async function installBakedTiles(owner: BakedTilesOwner, input: BakedTilesRow): Promise<BakedTiles> {
  const row = v.parse(BakedTilesSchema, input), { product, sky } = owner, instances = row.instances;
  const [scene, maps, table, protos, plan] = await Promise.all([
    sceneOf(product, row.glb), Promise.all(row.lightmaps.map(map => textureOf(product, map.source[TIER]))),
    instances === null ? null : bytesOf(product, instances.table), instances === null ? null : sceneOf(product, instances.protos),
    instances === null ? null : planOf(product, instances.plan[TIER], new Set(instances.families.map(f => f.key))),
  ]);
  // the bake's maps, unflipped (KTX2 and GLB keep their encoded orientation), lent to the look's texture params
  for (const [i, map] of row.lightmaps.entries()) {
    const texture = maps[i]; if (texture === undefined) throw new Error('Missing baked lightmap');
    texture.flipY = false; texture.colorSpace = THREE.NoColorSpace; texture.channel = map.channel; texture.anisotropy = map.anisotropy; texture.needsUpdate = true;
    // Immutable shader inputs: keep decoded pixels through upload, then only
    // the original dimensions. Context-loss recovery already reloads GPU-only content.
    gpuOnlyTexture(texture, `baked lightmaps: ${row.id}`);
    setLentTexture(row.look, map.param, texture);
  }
  const material = lentLook(row.look), group = new THREE.Group(), tiles: THREE.Mesh[] = [];
  if (row.sky) sky.setupMaterial(material);
  group.name = row.id; owner.parent.add(group);
  const follow = row.toonDay ? followToonLook(product, row.look) : null;
  scene.updateMatrixWorld(true);
  scene.traverse(o => {
    if (!isMesh(o) || !o.name.startsWith(row.tiles[TIER])) return;
    // the tile keeps its node transform (meshopt's dequantisation lives there), lowered by the row's drop
    const m = new THREE.Mesh(o.geometry, material);
    m.matrixAutoUpdate = false; m.matrix.copy(o.matrixWorld); m.matrix.elements[13] -= row.drop; m.matrixWorld.copy(m.matrix);
    m.name = `${row.meshPrefix}${o.name}`; m.castShadow = true; m.receiveShadow = true;
    if (follow !== null) m.onBeforeRender = follow;
    if (!o.geometry.hasAttribute('normal')) o.geometry.computeVertexNormals(); // flat-lit looks shade by derivatives; the normals bias the shadows
    o.geometry.computeBoundingSphere();
    tiles.push(m); group.add(m);
  });
  if (tiles.length === 0) throw new Error(`Baked tiles ${row.id} has no ${TIER} tiles`);
  if (row.wear !== undefined) await wearBakedTiles(product, row.wear, TIER, owner.ground ?? null, tiles);
  const unclaimed = instances !== null && table !== null && protos !== null && plan !== null ? await placeFamilies(owner, row, instances, new Float32Array(Uint8Array.from(table).buffer), protos, plan, group) : undefined;
  const sun = row.sun, light = (): THREE.DirectionalLight | undefined => sky.csm.lights[0];
  const update = sun === null ? () => undefined : () => { setLentParam(row.look, sun.param, sunBounce(light(), sky.sunDir.y, sun.referenceY, sun.gain)); };
  update();
  return { group, tiles, update, ...(unclaimed === undefined ? {} : { unclaimed }) };
}

/**
 * Each family is one model placed instanced under the group (one InstancedMesh per prototype and level): each copy its
 * table row's matrix and tint. Casters are drawn while the camera or a casting cascade sees them; cover by cells within
 * its reach. A family's collider boxes go on its piece (`<id>-<key>`); boxes no copy claims register as `<id>-unclaimed`.
 */
async function placeFamilies(owner: BakedTilesOwner, row: BakedTilesRow, instances: NonNullable<BakedTilesRow['instances']>, f: Float32Array, protos: THREE.Group, plan: BakedPlan, group: THREE.Group): Promise<BakedUnclaimed | undefined> {
  const geometry = new Map<string, THREE.BufferGeometry>();
  protos.traverse(o => { if (isMesh(o)) geometry.set(o.name, o.geometry); });
  const materials = Object.fromEntries(Object.entries(instances.looks).map(([slot, entry]) => [slot, lentLook(entry.look)]));
  const ctx = modelContext(owner.sky), slice = slicer();
  for (const family of plan.families) {
    const declared = instances.families.find(entry => entry.key === family.key); if (declared === undefined) throw new Error('Missing baked family');
    const model = defineGeometryModel(declared.model, 'proto', { category: declared.model.category, pipeline: declared.model.pipeline }, { geometry, materials });
    const placements = bakedPlacementPoses(f, family.indices, instances.names, row.drop);
    const slot = instances.looks[declared.look]; if (slot === undefined) throw new Error('Missing baked family look');
    const cull: CullOptions = slot.cull[TIER];
    // FC12: a merged family is one mesh per material (its tints baked into its vertex colours); the rest instanced
    await owned(owner, () => placeSliced(model, placements, { ctx, registry: owner.registry, parent: group, cull,
      ...(declared.merge === true ? { draw: 'merged' as const, mergedTint: true, shadowWhole: true } : { draw: 'instanced' as const }),
      piece: { id: `${row.id}-${family.key}`, ...(family.colliders.length > 0 ? { colliders: family.colliders.map(c => boxDesc(c, instances.surface)) } : {}) } }, slice.due));
  }
  const piece = { name: instances.unclaimed, category: 'nature' as const, file: 'src/client/game/shardfile/bakedTiles.ts', surface: instances.surface, solidFloor: false };
  const colliders = plan.unclaimed.map(c => boxDesc(c, instances.surface)), id = `${row.id}-unclaimed`;
  if (owner.scope === undefined) { owned(owner, () => owner.registry.add({ ...piece, id, colliders })); return undefined; }
  // T3: whole under its own scope, until bakedTileContents moves the boxes onto the collider ring
  const whole = owner.scope.child(`baked.${row.id}.unclaimed`);
  withOwner(whole, () => owner.registry.add({ ...piece, id, colliders }));
  return { piece, id, colliders, whole, registry: owner.registry };
}

/** baked sets already tiled (a set is shared by its shard's residents: it is tiled once) */
const tiledSets = new WeakSet<BakedTiles>();
/**
 * Tile streaming T3: a baked set by tile. Each tile mesh draws only its resident tiles' triangles (by cell-local centroid,
 * `tiledMesh`; a mesh wholly in one tile follows that tile; a geometry two meshes share stays whole), and the colliders no
 * copy claims leave their whole-set registration for the collider ring, each box in every tile its footprint reaches.
 * The families' copies and their piece colliders stay whole (one placed model each).
 */
export function bakedTileContents(baked: BakedTiles): TileContent[] {
  if (tiledSets.has(baked)) return [];
  tiledSets.add(baked);
  const users = new Map<THREE.BufferGeometry, number>(), contents: TileContent[] = [];
  for (const mesh of baked.tiles) users.set(mesh.geometry, (users.get(mesh.geometry) ?? 0) + 1);
  for (const mesh of baked.tiles) {
    if (users.get(mesh.geometry) !== 1) continue;
    // its own matrix is cell-local (the GLB node's, lowered by the drop, under an identity group)
    const content = tiledMesh(`${baked.group.name}.${mesh.name}`, mesh, mesh.matrix, { single: true });
    if (content !== null) contents.push(content);
  }
  const unclaimed = baked.unclaimed;
  if (unclaimed !== undefined && unclaimed.colliders.length > 0 && !unclaimed.whole.disposed) {
    const byTile = new Map<number, ColliderDesc[]>();
    for (const shape of unclaimed.colliders) for (const tile of colliderTileKeys(shape)) { const list = byTile.get(tile); if (list === undefined) byTile.set(tile, [shape]); else list.push(shape); }
    const tiles = new Set(byTile.keys());
    unclaimed.whole.dispose();
    contents.push({ id: `${unclaimed.id}.colliders`, tiles: () => tiles, attach: () => Promise.resolve(), attachColliders: (tile, scope) => {
      const colliders = byTile.get(tile);
      if (colliders !== undefined && !scope.disposed) withOwner(scope, () => unclaimed.registry.add({ ...unclaimed.piece, id: `${unclaimed.id}.c${String(tile)}`, colliders }));
      return Promise.resolve();
    } });
  }
  return contents;
}

/** One draw per shard while its first resident lives, whichever path asks first: the `world.baked` feature, or a trusted
 *  runtime's world build (`residentBakedTiles`), which in a grid can build its resident world before any plan phase. Keyed
 *  by slug: a grid may hold more than one admitted product object for the same shard. */
const drawnBy = new Map<string, Promise<ReadonlyMap<string, BakedTiles>>>();
/** Per app (its system registry: a data client and a trusted runtime see different world wrappers over the same one):
 *  every drawn set it shows, and the one bounce system moving them (its owner's scope ends it; the next entering path
 *  registers it again). Two paths, two shards or two scopes on one page never register it twice. */
const shown = new WeakMap<object, Set<ReadonlyMap<string, BakedTiles>>>(), ticking = new WeakSet();
function tick(ctx: ShardContext, drawn: ReadonlyMap<string, BakedTiles>, resident: Scope): void {
  const app = ctx.app;
  let sets = shown.get(app); if (sets === undefined) { sets = new Set(); shown.set(app, sets); }
  if (!sets.has(drawn)) { const live = sets; live.add(drawn); resident.onDispose(() => { live.delete(drawn); }); }
  if (ticking.has(app)) return;
  ticking.add(app); ctx.scope.onDispose(() => { ticking.delete(app); });
  const moving = sets;
  ctx.system({ id: 'client.baked.tiles', phase: 'update', after: ['main.world'], before: ['engine.creatures.update'],
    run: () => { for (const set of moving) for (const baked of set.values()) baked.update(); } });
}
async function enterBakedTiles(ctx: ShardContext, rows: readonly BakedTilesRow[], resident: Scope): Promise<ReadonlyMap<string, BakedTiles>> {
  const slug = ctx.product.slug;
  let pending = drawnBy.get(slug);
  if (pending === undefined) {
    const drawing = draw(ctx, rows, resident); pending = drawing; drawnBy.set(slug, drawing);
    resident.onDispose(() => { if (drawnBy.get(slug) === drawing) drawnBy.delete(slug); });
    drawing.catch(() => { if (drawnBy.get(slug) === drawing) drawnBy.delete(slug); });
  }
  const drawn = await pending;
  tick(ctx, drawn, resident);
  return drawn;
}
/** The `world.baked` client feature: each declared row drawn once per shard resident, its bounce moved once a frame. */
export async function installClientBakedTiles(ctx: ShardContext, feature: ClientFeatureRow, resident: Scope): Promise<void> {
  if (feature.kind !== 'world.baked') throw new Error('Invalid baked tiles feature');
  await enterBakedTiles(ctx, feature.rows, resident);
}
/** A trusted runtime's world build: its product's declared `world.baked` rows, drawn now if no plan phase drew them yet,
 *  by row id for the view code that dresses them further. */
export function residentBakedTiles(ctx: ShardContext, resident: Scope): Promise<ReadonlyMap<string, BakedTiles>> {
  const plan = ctx.product.has('client/plan') ? ctx.product.section('client/plan') : { version: 1, features: [] };
  const rows = plan.features.flatMap(feature => feature.kind === 'world.baked' ? feature.rows : []);
  if (rows.length === 0) return Promise.reject(new Error('No declared baked tiles'));
  return enterBakedTiles(ctx, rows, resident);
}
async function draw(ctx: ShardContext, rows: readonly BakedTilesRow[], resident: Scope): Promise<ReadonlyMap<string, BakedTiles>> {
  const world = ctx.game.runtime?.world; if (world === undefined || world === null) throw new Error('Baked tiles require the world stage');
  // the resident world's own registry, captured now: a deferred step never registers into a later entered world's
  const registry = world.registry;
  await lendBakedLooks(ctx, rows, resident);
  const drawn = new Map<string, BakedTiles>();
  for (const row of rows) {
    const ground = row.wear?.ground === true ? { ground: world.terrain.mesh.geometry } : {};
    const baked = await installBakedTiles({ product: ctx.product, parent: ctx.root, sky: world.sky, registry, scope: resident, ...ground }, row);
    drawn.set(row.id, baked); resident.onDispose(() => { baked.group.removeFromParent(); });
  }
  return drawn;
}
/** The rows' looks compiled with their graphs and lent for the resident. Always lent, never only when missing: a data
 *  client may already have lent the same ids as presentation fallbacks (graphs off), which take no lent textures. */
export async function lendBakedLooks(ctx: Pick<ShardContext, 'game' | 'product'>, rows: readonly BakedTilesRow[], resident: Scope): Promise<void> {
  const looks = [...new Set(rows.flatMap(row => [row.look, ...Object.values(row.instances?.looks ?? {}).map(slot => slot.look)]))];
  lendLooks(resident, await runtimeLookMaterials({ scope: resident, game: ctx.game }, ctx.product.shardfile, true, looks));
}
