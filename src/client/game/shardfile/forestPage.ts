import { sceneLivingBytes } from '@wildshard/format/worldScenePages';
/** Client-only forest fields, living buildings and their native resource lifetime. */
import type { FieldModelsContext } from '../shard/manifest';
import { AdditiveBlending, BufferAttribute, BufferGeometry, Color, DoubleSide, Group, Matrix4, MeshStandardMaterial, Object3D, Points, PointsMaterial, Quaternion, Vector3 } from 'three';
import * as v from 'valibot';
import type { Scope } from '@wildshard/engine/app/scope';
import { macrotask, slicer } from '@wildshard/engine/boot/plan';
import { buildTier, TIER, TIER_CONFIG } from '@wildshard/engine/core/tier';
import { Grass } from '@wildshard/engine/world/Grass';
import { setSight } from '@wildshard/engine/world/interact/Interactables';
import { LightPool } from '@wildshard/engine/fx/LightPool';
import { floorAtRects } from '@wildshard/engine/physics/box';
import { defineModel, sharedModelContext, type ModelDef, type Placement } from '@wildshard/engine/models/model';
import { placeSliced } from '@wildshard/engine/models/place';
import { productTreePool, treeSetModel, TreeSetFactory, type TreeSetParams } from '../models/treeSet';
import { farStandIn } from './farStandIn';
import { ForestPageSchema, LivingPageSitesSchema, type ForestPageRows } from '@wildshard/format/forestPage';
import { ForestGround } from '../looks/forestGround';
import { productCoverAppearance } from '../looks/coverAppearance';
import { emptyBuildingLifeRows } from '@wildshard/format/buildings';
import { Particles } from '../systems/looks/particles';
import { trample, TRAMPLE_GLSL } from '../systems/looks/trample';
import { plumbingKnob } from '../shard/declaredPlumbing';
import { LivingBuildings } from './livingBuildings';
import { installWorldScenes } from './worldScenes';
import { hydrateWorldSceneWeld } from './worldSceneWeld';
import { residentWorldScope } from './hybridPresentation';
import { runtimeLookMaterials } from './runtimeProduct';
import { timeClientPreparation } from './preparationTiming';
import { lendLooks, setLentParam } from './lentLooks';
import type { SceneHandles } from './sceneHandles';
import type { ShardContext } from '../plugin/context';
import { followResidentTiles, noteTileBytes, productTileRing, residentTiles } from './tileDriver';
import { StreamingCamera } from './streamingView';
import { bucketByTile, followTile, ring, tileKey } from './tileContent';
import { tileOf, type CellTile } from '../../../shared/game/shardfile/tileOrder';
import { withOwner } from '@wildshard/engine/app/ownership';
import { wirePage } from './wirePage';
import { buildingDoorFlag } from '../../../shared/game/shardfile/buildingDoor';

export interface LivingPage {
  readonly resources: SceneHandles; readonly life: LivingBuildings; readonly group: Group;
  readonly buildings: v.InferOutput<typeof LivingPageSitesSchema>['buildings'];
  readonly roofs: v.InferOutput<typeof LivingPageSitesSchema>['roofs']; readonly roots: readonly Object3D[];
  /** I2: settles once a late shell weld (built after control) has registered the buildings' doors; null when they are */
  readonly lateDoors: Promise<void> | null;
}
export interface ForestPage {
  readonly rows: ForestPageRows; readonly resources: SceneHandles; readonly cabins: LivingPage;
  readonly grass: Grass; readonly under: ForestGround; readonly particles: Particles;
  readonly streams: { group: Group; water: Object3D; spray: Object3D };
  readonly update: (dt: number, time: number) => void;
  readonly roofAt: (x: number, z: number) => boolean; readonly finish: () => Promise<void>;
  /** Light or bank one declared lantern: its glow point and its pooled lamp site. */
  readonly setLantern: (id: string, lit: boolean) => void;
}
const pages = new WeakMap<Scope, Map<string, ForestPage>>();
/** Borrow actual native scene/life owners by declared page identity. */
export function forestPage(scope: Scope, id: string): ForestPage {
  const page = pages.get(scope)?.get(id); if (scope.disposed || page === undefined) throw new Error('Missing entered forest page'); return page;
}
/** Graph admission is separate so custom water views can bind before geometry. */
export async function prepareForestPageLooks(ctx: ShardContext, input: unknown): Promise<void> {
  const rows = v.parse(ForestPageSchema, input);
  lendLooks(ctx.scope, await runtimeLookMaterials(ctx, ctx.product.shardfile, true, rows.graphs));
}
export async function prepareForestPage(ctx: ShardContext, input: unknown): Promise<ForestPage> {
  const rows = v.parse(ForestPageSchema, input), runtime = ctx.game.runtime, world = runtime?.world, step = runtime?.step;
  if (runtime === undefined || world === undefined || world === null || step === undefined || step === null) throw new Error('Forest page requires staged native services');
  if (pages.get(ctx.scope)?.has(rows.id) === true) throw new Error('Duplicate forest page');
  const { game, sky, forest, player, registry } = world;
  ctx.app.registerTrample(trample, ctx.scope);
  const scenes = ctx.product.section('world/scenes'), livingHint = rows.buildings.late;
  const sceneRows = livingHint === undefined ? scenes : { ...scenes, lateMaterials: [...scenes.lateMaterials ?? [],
    ...livingHint.materials.filter(id => !scenes.lateMaterials?.some(hint => hint.id === id)).map(id => ({ id, at: livingHint.at }))] };
  const resources = await timeClientPreparation(ctx.product.slug, 'forest.scenes', () => installWorldScenes(ctx, sceneRows, residentWorldScope(ctx)));
  const streams = { group: resources.group(rows.streams.group), water: resources.mesh(rows.streams.water), spray: resources.mesh(rows.streams.spray) }; game.scene.add(streams.group);
  const carpet = await step('grass', async () => {
    const grass = ctx.scope.run(() => new Grass(sky, forest, { trample: { field: trample, glsl: TRAMPLE_GLSL } }).build()); await macrotask();
    const under = await ForestGround.prepare(ctx, rows.ground, forest, sky), particles = ctx.scope.run(() => new Particles(sky, forest).build());
    game.scene.add(grass.group, under.group, particles.group); return { grass, under, particles };
  });
  runtime.overhead.push(carpet.grass.group, carpet.under.group, carpet.particles.group);
  const cabins = await step('cabins', async () => {
    const row = rows.buildings, tier = buildTier(), knob = (id: string): boolean => plumbingKnob(ctx.product.shardfile.plumbing, tier, id, 'boolean', TIER_CONFIG);
    const shadow = knob(row.shadow), shared = knob(row.shared), variant = row.variants.find(entry => entry.tier === tier && entry.shadow === shadow && entry.shared === shared);
    if (variant === undefined) throw new Error('Missing declared living topology');
    const topology = sceneLivingBytes(await ctx.product.file(variant.file), variant), group = new Group(); resources.publish(row.root, group);
    const geometry = new Map(topology.geometry.map(entry => [entry.key, resources.geometry(entry.id)]));
    const life = ctx.scope.run(() => new LivingBuildings(resources, row.life)), owner = residentWorldScope(ctx);
    const sites = v.parse(LivingPageSitesSchema, await ctx.product.json(row.sites));
    const roots: Object3D[] = [];
    game.scene.add(group);
    const requireOwner = (): void => {
      if (owner.disposed || owner.disposing || ctx.scope.disposed || ctx.scope.disposing) throw new Error('Living page owner is retired');
    };
    const hydrate = (): void => {
      requireOwner();
      const materials = new Map(ctx.product.section('world/scenes').materials.filter(entry => resources.has(row.material + entry.id)).map(entry => [entry.id, resources.material(row.material + entry.id)]));
      withOwner(owner, () => {
        if (shared) for (let i = 0; i < row.light.count; i++) { const light = row.light, pool = LightPool.for(game.scene), made = pool.acquire(light.color, light.intensity, light.distance, light.decay); pool.yields(made); topology.life.shared.push(resources.lend(made)); }
        hydrateWorldSceneWeld(topology.graph, resources, { geometry, materials, plumbing: ctx.product.shardfile.plumbing }, owner); life.add(topology.life);
      });
      roots.push(...sites.buildings.filter(entry => entry.standalone).map(entry => resources.object(entry.root)));
      runtime.interactables.push(...life.interactables);
    };
    // I2: the shells may be a late weld (built after control, out of the spawn view): their assembly, the buildings' saves
    // and doors follow it then
    const shells = async (): Promise<void> => {
      requireOwner();
      await resources.assemble(row.shells);
      requireOwner();
      withOwner(owner, () => {
        life.persist(ctx.app.saves, owner, { id: ctx.manifest.slug, shard: ctx.manifest.slug, group: row.save }); life.registerDoors(registry, player.position);
      });
      life.serve(id => wirePage.gates.has(buildingDoorFlag(id)));
      for (const prompt of life.interactables) setSight(prompt, { slack: row.sightSlack });
    };
    // The assembly publishes without borrowing its living roots. Queue those
    // roots only after publication, so no refinement job waits on a later job
    // on the same cursor. Stable life, floors and save ownership stay native.
    let lateDoors: Promise<void> | null;
    if (row.late === undefined) {
      hydrate();
      lateDoors = resources.has(row.shells) ? null : resources.published(row.shells).then(shells);
      if (lateDoors === null) await shells();
    } else {
      const late = row.late;
      lateDoors = resources.published(row.shells).then(async () => {
        await resources.afterControl(`living:${row.id}`, { x: late.at[0], z: late.at[1] }, late.materials, async () => { hydrate(); await shells(); });
        return undefined;
      });
    }
    const page: LivingPage = { resources, life, group, ...sites, roots, lateDoors };
    return page;
  });
  const lanterns = await forestLanterns(ctx, rows, cabins); game.scene.add(lanterns.points);
  const eye = new Vector3(), sun = [1, 1, 1], row = rows.buildings;
  let finished = false;
  const page: ForestPage = { rows, resources, cabins, ...carpet, streams,
    finish: async () => { if (finished) throw new Error('Forest page already finished'); finished = true;
      await step('props', async () => {
        // tile streaming P5: a landmark placement goes by tile (its draws on the render ring, its colliders on the collider
        // ring, a coarse stand-in beyond the ring: T11, the skyline); the props (rocks, stumps, the log) go by tile too, their
        // colliders on the collider ring (T8)
        for (const mark of rows.landmarks) if (mark.tier === undefined || mark.tier === TIER) {
          if ('place' in mark) resources.tile(mark.place, { coarse: true }); else resources.object(mark.object);
          await macrotask();
        }
        for (const id of rows.props) resources.tile(id);
        // the page's tiled world (landmarks, and recipe meshes spanning tiles) follows the player by tile, as an assembled world's
        const owner = residentWorldScope(ctx), shard = ctx.product.shardfile;
        // G748: beyond the render ring the trees and props stop drawing; the page's own near view stands in for them
        if (rows.farStandIn === true && !resources.tiled().some(content => content.id === `${ctx.product.slug}.far-stand-in`)) {
          const standIn = farStandIn(ctx); if (standIn !== null) resources.addTiled(standIn);
        }
        noteTileBytes(owner, shard.tiles); await residentTiles(owner, resources.tiled(), shard.spawn, shard.entryways, productTileRing(shard)); // NT1: the product's ring
        const camera = new StreamingCamera(ctx.root, () => game.camera);
        const follow = followResidentTiles(owner, () => player.position, undefined, () => camera.read());
        if (follow !== null) ctx.system({ id: `client.forest.tiles.${rows.id}`, phase: 'update', run: () => { follow(); } }); }); },
    roofAt: (x, z) => floorAtRects(row.floors, x, z, 'first') !== undefined, setLantern: lanterns.set,
    update: (dt, time) => { const viewer = runtime.viewer();
      const trees = world.forest.factory, treeParam = (id: string, name: string, value: readonly number[]): void => {
        if (!(trees instanceof TreeSetFactory && trees.setLookParam(id, name, value))) setLentParam(id, name, value); };
      for (const binding of rows.treeLooks) { const fade = trees.fade[binding.band].value; treeParam(binding.look, binding.fade, [fade.x, fade.y]); treeParam(binding.look, binding.viewer, [viewer.x, viewer.y, viewer.z]); }
      carpet.grass.update(dt, viewer); carpet.under.update(dt, viewer); carpet.particles.update(dt, viewer, game.camera);
      // PF5: the night lights' level is a clock curve evaluated per read: once a frame
      const lamps = sky.lamps;
      sky.viewCamera.getWorldPosition(eye); cabins.life.tick(dt, time, eye, lamps); lanterns.present(time, eye, lamps); sun[0] = sky.sunColor.r; sun[1] = sky.sunColor.g; sun[2] = sky.sunColor.b;
      setLentParam(row.hearth, row.sunParam, sun); setLentParam(row.hearth, row.lampsParam, lamps); setLentParam(row.hearth, row.shadeParam, 1 - row.nightShade * sky.night); } };
  const book = pages.get(ctx.scope) ?? new Map<string, ForestPage>(); book.set(rows.id, page); pages.set(ctx.scope, book); ctx.scope.onDispose(() => { book.delete(rows.id); });
  Object.assign(runtime.objects, { cabins, streams, ...carpet }); return page;
}

/** Native drawing context for a shard's counted model definitions. */
export function forestFieldModels(ctx: ShardContext, id: string): FieldModelsContext<ForestGround> {
  const page = forestPage(ctx.scope, id), world = ctx.game.runtime?.world;
  if (world === undefined || world === null) throw new Error('Forest drawing requires its native world');
  return { sky: world.sky, renderer: world.game.renderer, forest: world.forest, under: page.under, registry: world.registry };
}

/** The page's lanterns: one additive glow point each (banked by day, full at night, a slow flicker, not drawn past
 *  `range` of the nearest lit one) and a pooled lamp site each in the living buildings. */
async function forestLanterns(ctx: ShardContext, rows: ForestPageRows, cabins: LivingPage): Promise<{ points: Points; set: (id: string, lit: boolean) => void; present: (time: number, eye: Vector3, lamps: number) => void }> {
  const row = rows.lanterns, glow = await (await productCoverAppearance(ctx.product, rows.ground.appearance)).texture(ctx.product, row.texture);
  const geometry = new BufferGeometry(), lit = row.rows.map(() => true); geometry.setAttribute('position', new BufferAttribute(Float32Array.from(row.rows.flatMap(entry => entry.at)), 3));
  const material = new PointsMaterial({ map: glow, color: row.color, size: row.size, sizeAttenuation: true, transparent: true, blending: AdditiveBlending, depthWrite: false, fog: false });
  const points = new Points(geometry, material); points.name = 'lantern-glow'; points.renderOrder = row.order;
  ctx.scope.onDispose(() => { points.removeFromParent(); geometry.dispose(); material.dispose(); });
  const life = emptyBuildingLifeRows(), light = row.light;
  for (const entry of row.rows) {
    const anchor = new Object3D(); anchor.position.fromArray(entry.at); points.add(anchor); const handle = cabins.resources.lend(anchor);
    life.sites.push({ id: entry.id, root: handle, anchors: [{ anchor: handle, ...light, seed: entry.at[0] * 0.37, kind: 'lamp', rank: 0 }] });
  }
  cabins.life.add(life);
  const [depth1, rate1, depth2, rate2] = row.flicker, at = new Vector3();
  return { points,
    set: (id, on) => { const i = row.rows.findIndex(entry => entry.id === id), entry = row.rows[i]; if (entry === undefined) throw new Error(`Missing lantern: ${id}`);
      lit[i] = on; cabins.life.setLit(id, on); geometry.getAttribute('position').setY(i, on ? entry.at[1] : -1e4); geometry.getAttribute('position').needsUpdate = true; },
    present: (time, eye, lamps) => {
      material.opacity = (row.day + (1 - row.day) * lamps) * (1 + depth1 * Math.sin(time * rate1) + depth2 * Math.sin(time * rate2));
      let near = Infinity; row.rows.forEach((entry, i) => { if (lit[i] === true) near = Math.min(near, at.fromArray(entry.at).distanceToSquared(eye)); });
      points.visible = near < row.range * row.range; } };
}
const HOST_FILE = 'src/client/game/shardfile/forestPage.ts';
/** One floor kind as a model: the field's own geometry and cover material, walked through; the Explorer's specimen
 *  wears the kind's texture in a plain lit material tinted like its first copy (the cover shader fades by distance). */
function groundModel(kind: ForestPageRows['ground']['kinds'][number], under: ForestGround): ModelDef<Record<string, never>> {
  const draw = under.kinds[kind.id]; if (draw === undefined) throw new Error('Missing forest cover kind');
  return defineModel<Record<string, never>>({ id: kind.model, name: kind.name, category: 'nature', pipeline: 'code', file: HOST_FILE, defaults: {},
    build: () => [{ geometry: draw.geometry, material: draw.material, castShadow: draw.castShadow, receiveShadow: true }],
    specimen: (ctx) => [{ geometry: draw.geometry, castShadow: true, receiveShadow: true, material: ctx.once(`${kind.model}:specimen`, () => {
      const src = draw.material, first = under.layout[kind.id]?.[0];
      const m = new MeshStandardMaterial({ map: src.map, alphaTest: src.alphaTest, side: DoubleSide, roughness: src.roughness, metalness: 0 });
      m.name = `${src.name}-specimen`; if (first !== undefined) m.color.setRGB(first.r, first.g, first.b); ctx.sky.setupMaterial(m); return m;
    }) }] });
}
/** Draw the page's declared tree set and floor kinds as models, in slices of `sliceMs` letting frames through. A forest
 *  whose factory is not the declared set (a build without its files) draws itself and collides as its own capsules. */
export async function placeForestPageModels(ctx: ShardContext, id: string): Promise<void> {
  const page = forestPage(ctx.scope, id), due = slicer(page.rows.sliceMs).due, h = forestFieldModels(ctx, id), { forest, registry } = h, under = page.under;
  const models = sharedModelContext(h.sky, h), trees = treeSetModel(productTreePool(ctx.product, ctx.product.section('world/trees')));
  const variants = trees.model.variants; if (variants === undefined) throw new Error('Forest model requires its variants');
  // tile streaming P3/P4: the trees and the floor cover keep to the tiles around the viewer (the trees' follower moves the ring);
  // a whole-cell level (`ring: 'cell'`, DL17) keeps every tile, so nothing streams in play (sp-o1, as Nalati's ground)
  const radius = productTileRing(ctx.product.shardfile)(), residency = { resident: (_x: number, _z: number): boolean => true };
  if (forest !== null && forest.trees.length > 0) {
    if (forest.drawer !== 'model' || forest.factory.variants.length !== variants.length) {
      const own = forest.drawer === 'model'; forest.drawItself();
      if (own) registry.add({ id: 'forest', name: 'Forest', category: 'nature', file: 'src/client/engine/world/forest/Forest.ts', surface: 'wood', colliders: forest.colliderDescs() });
    } else {
      trees.use(models, forest.factory);
      const q = new Quaternion(), up = new Vector3(0, 1, 0), at = new Vector3(), sc = new Vector3();
      const pls = forest.trees.map((t): Placement<TreeSetParams> => { const variant = variants[t.variant]?.id; if (variant === undefined) throw new Error('Forest tree variant out of range');
        return { x: t.x, y: t.y, z: t.z, variant, color: t.tint, params: { height: t.height, r: t.r, scale: t.scale },
          matrix: new Matrix4().compose(at.set(t.x, t.y, t.z), q.setFromAxisAngle(up, t.rot), sc.set(t.scale, t.scale, t.scale)) }; });
      // P3: only the 3 x 3's trunks collide (one piece per tile, its scope ending as the viewer leaves); every tree draws at
      // its own LOD (G848, below)
      await placeSliced({ ...trees.model, colliders: () => [] }, pls, { ctx: models, draw: forest.path, registry, piece: { id: trees.model.id }, sortObjects: false,
        cull: { view: forest, test: forest.keeps, from: 'origin', flat: true }, parent: forest.group }, due);
      {
        // one capsule per tree, in the trees' order: bucket the trees, index the capsules
        const trunks = forest.colliderDescs(), byTile = bucketByTile(forest.trees, tree => tree), colliding = new Map<number, Scope>();
        let centre: CellTile | null = null;
        // G848 P1: every tree draws at its own LOD. Past the ring that is only its lo cards or its impostor (the phone's hi
        // band, 80 m, ends inside the 5 x 5 ring's nearest edge, 94 m), as LEGACY's forest drew; the far stand-in's cones
        // filled that band instead. The ring keeps the floor cover and the trunk colliders.
        const everyTree = (): boolean => true;
        const collide = (wanted: ReadonlySet<number>): void => {
          for (const [key, scope] of colliding) if (!wanted.has(key)) { colliding.delete(key); scope.dispose(); }
          for (const key of wanted) {
            const rows = byTile.get(key); if (rows === undefined || colliding.has(key) || ctx.scope.disposed) continue;
            const scope = ctx.scope.child(`forest.trunks.t${String(key)}`); colliding.set(key, scope);
            withOwner(scope, () => registry.add({ id: `${trees.model.id}.trunks.t${String(key)}`, name: 'Forest', category: 'nature', file: 'src/client/engine/world/forest/Forest.ts',
              surface: 'wood', colliders: rows.flatMap(i => trunks[i] ?? []) }));
          }
        };
        forest.setResidency(viewer => {
          const next = followTile(centre, viewer.x, viewer.z);
          if (centre === null || next.i !== centre.i || next.j !== centre.j) {
            centre = next; const keys = ring(next, radius);
            residency.resident = (x, z) => keys.has(tileKey(tileOf(x, z)));
            collide(ring(next, Math.min(radius, 1)));
          }
          return everyTree;
        });
        ctx.scope.onDispose(() => { forest.setResidency(null); });
      }
    }
  }
  const cells = under.cells(), cull = { view: under.view, cells: { size: cells.size, pad: cells.pad }, far: cells.far };
  for (const kind of page.rows.ground.kinds) {
    const items = under.layout[kind.id] ?? []; if (items.length === 0) continue;
    const model = groundModel(kind, under);
    // P4: the cover keeps to the trees' ring (after its own cell and range tests)
    const kept = { test: (i: number): boolean => { const it = items[i]; return it === undefined || residency.resident(it.x, it.z); } };
    await placeSliced(model, items.map((it) => ({ x: it.x, y: it.y, z: it.z, matrix: it.matrix === undefined ? groundPlacementMatrix(it) : new Matrix4().fromArray(it.matrix), color: new Color(it.r, it.g, it.b) })),
      { ctx: models, draw: 'instanced', registry, piece: { id: model.id }, cull: { ...cull, ...kept }, parent: under.group }, due);
  }
}

const UP = new Vector3(0, 1, 0), groundNormal = new Vector3(), groundPoint = new Vector3(), groundSize = new Vector3(), groundTilt = new Quaternion();
/** A forest-floor placement's instance matrix from its facts (iPhone downloads I2: the layout ships no per-instance matrix):
 *  a yaw of `rot` about up, then a tilt of up onto the ground normal, at the point, at a uniform `scale`. */
export function groundPlacementMatrix(it: { readonly x: number; readonly y: number; readonly z: number; readonly nx: number; readonly ny: number; readonly nz: number; readonly rot: number; readonly scale: number }): Matrix4 {
  groundTilt.setFromUnitVectors(UP, groundNormal.set(it.nx, it.ny, it.nz));
  const turn = new Quaternion().setFromAxisAngle(UP, it.rot).premultiply(groundTilt);
  return new Matrix4().compose(groundPoint.set(it.x, it.y, it.z), turn, groundSize.set(it.scale, it.scale, it.scale));
}
