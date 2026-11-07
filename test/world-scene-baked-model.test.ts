import { shaderCodeSources } from '../scripts/parity/shader-code.mjs';
import { expect, test, vi } from 'vitest';
import { BufferAttribute, BufferGeometry, Group, Mesh, MeshStandardMaterial, Texture } from 'three';
import { Scope } from '../src/shared/engine/app/scope';
import { app } from '../src/client/engine/app/runtime';
import { sharedModelContext } from '../src/client/engine/models/model';
import { Rng } from '../src/shared/engine/core/rng';
import { TIER, TIER_CONFIG, applyLevelTier, initializeTier } from '../src/client/engine/core/tier';
import { withTier } from '../src/client/engine/explore/tiers';
import { parsePlumbing } from '@wildshard/format/plumbing';
import { ownSceneTree, sceneResourceOwner } from '../src/client/engine/app/sceneOwnership';
import { WorldSceneBatch } from '../src/client/game/shardfile/worldSceneBatch';
import { WorldSceneBatchSchema } from '@wildshard/format/worldSceneBatch';
import { SHADOW_LAYER } from '../src/client/engine/core/shadowLayer';
import { defineWorldSceneCatalogue, bindWorldSceneModelSources } from '../src/client/game/models/worldSceneCatalogue';
import { parseWorldSceneModels } from '@wildshard/format/worldSceneModels';
import { parseWorldScenePlacement } from '@wildshard/format/worldScenePlacement';
import { WorldSceneSurfaceSchema } from '@wildshard/format/worldSceneSurface';
import * as v from 'valibot';
import * as assets from '../src/client/engine/core/assets';
import { withOwner } from '../src/shared/engine/app/ownership';
import { worldSceneSurfaceMaterial } from '../src/client/game/shardfile/worldSceneSurface';
import { SkyRig } from '../src/client/engine/world/skyRig';
import type { ShardProduct } from '../src/shared/game/shardfile/shardProduct';
import { emptyShardfile } from '../src/shared/host/author';
import { WorldRegistry } from '../src/client/engine/world/registry';
import * as colliderReader from '../src/client/engine/models/colliders';
import { WorldScenePlacement } from '../src/client/game/shardfile/worldScenePlacement';
import { installWorldScenes } from '../src/client/game/shardfile/worldScenes';
import { parseWorldScenes } from '@wildshard/format/worldScenes';
import type { ShardContext } from '../src/client/game/plugin/context';
import { listModel } from '../src/client/engine/models/live';
import { place } from '../src/client/engine/models/place';

function fixtureSky(setupMaterial = vi.fn<SkyRig['setupMaterial']>()): SkyRig {
  const sky: unknown = Object.create(SkyRig.prototype);
  if (!(sky instanceof SkyRig)) throw new Error('Missing fixture sky');
  sky.setupMaterial = setupMaterial; return sky;
}

test.each(['roster', 'placement'])('%s catalogue lifetimes retire variants and tier copies without freeing world sources', async kind => {
  const owner = new Scope('specimen-fixture'), ctx = sharedModelContext(fixtureSky()), registry = new WorldRegistry();
  const geometry = new BufferGeometry().setAttribute('position', new BufferAttribute(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), 3));
  const material = new MeshStandardMaterial(), sourceDisposed = vi.spyOn(geometry, 'dispose'), materialDisposed = vi.spyOn(material, 'dispose');
  const input = { product: 'fixture-quay', models: [{ key: 'marker', id: 'fixture-quay/scoped-marker', name: 'Marker', category: 'props', pipeline: 'code', file: 'marker.json', defaults: { style: 0 }, assembly: 'objects',
    variants: [{ id: 'other', label: 'Other', params: { style: 1 } }], choices: [0, 1].map(style => ({ id: `style-${String(style)}`, params: { style }, size: [1, 1, 1], colliders: [],
      draws: [{ id: 'face', library: 'shapes', model: 'face', material: 'paint' }] })) }] };
  const catalogue = parseWorldSceneModels(input);
  bindWorldSceneModelSources(ctx, 'fixture-quay', { catalogue, geometries: new Map([['["shapes","face"]', geometry]]), materials: new Map([['paint', material]]) }, owner);
  try {
    const model = defineWorldSceneCatalogue(catalogue).model('marker');
    withOwner(owner, () => {
      if (kind === 'roster') listModel(model, { ctx, registry });
      else place(model, [{ x: 0, y: 0, z: 0 }], { ctx, registry, draw: 'single' });
    });
    const entry = registry.models()[0]; if (entry === undefined) throw new Error('Missing scoped model');
    const first = entry.object(), mesh = first.children[0]?.children[0]; if (!(mesh instanceof Mesh)) throw new Error('Missing first specimen');
    const released = vi.spyOn(mesh.geometry, 'dispose'), studio = new Group(); studio.add(first);
    entry.rebuild?.('other'); expect(released).toHaveBeenCalledOnce(); expect(first.parent).toBe(studio);
    const next = first.children[0]?.children[0]; if (!(next instanceof Mesh)) throw new Error('Missing variant specimen');
    const nextReleased = vi.spyOn(next.geometry, 'dispose');
    const tier = entry.buildAt?.('phone'), tierMesh = tier?.children[0]; if (!(tierMesh instanceof Mesh)) throw new Error('Missing tier specimen');
    const tierReleased = vi.spyOn(tierMesh.geometry, 'dispose');
    await entry.ready?.(); entry.release?.();
    expect(first.children).toHaveLength(0); expect(first.parent).toBeNull();
    expect(nextReleased).toHaveBeenCalledOnce(); expect(tierReleased).toHaveBeenCalledOnce();
    expect(sourceDisposed).not.toHaveBeenCalled(); expect(materialDisposed).not.toHaveBeenCalled();
    expect(entry.object().children).toHaveLength(1); entry.release?.();
    expect(owner.census.geometries).toBe(kind === 'roster' ? 0 : 1);
  } finally { owner.dispose(); registry.retire(); geometry.dispose(); material.dispose(); }
});

test.each(['regional', 'standalone'].flatMap(mode => ['disposed', 'retiring', 'registry'].map(retirement => ({ mode, retirement }))))(
  '$mode queued specimens outlive a retired tile but refuse $retirement worlds', ({ mode, retirement }) => {
  const world = new Scope('catalogue-world'), tile = world.child('catalogue-tile'), registry = new WorldRegistry();
  const priorRegistry = app.registryValue, priorLevel = app.levelScope;
  if (mode === 'regional') registry.scope = world;
  else { app.registryValue = registry; app.levelScope = world; }
  const geometry = new BufferGeometry().setAttribute('position', new BufferAttribute(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), 3));
  const material = new MeshStandardMaterial(), ctx = sharedModelContext(fixtureSky());
  const catalogue = parseWorldSceneModels({ product: 'fixture-quay', models: [{ key: 'marker', id: 'fixture-quay/queued-marker', name: 'Marker',
    category: 'props', pipeline: 'code', file: 'marker.json', defaults: {}, assembly: 'objects', choices: [{ id: 'one', params: {}, size: [1, 1, 1],
      colliders: [], draws: [{ id: 'face', library: 'shapes', model: 'face', material: 'paint' }] }] }] });
  bindWorldSceneModelSources(ctx, catalogue.product, { catalogue, geometries: new Map([['["shapes","face"]', geometry]]), materials: new Map([['paint', material]]) }, world);
  try {
    withOwner(tile, () => place(defineWorldSceneCatalogue(catalogue).model('marker'), [{ x: 0, y: 0, z: 0 }], { ctx, registry, draw: 'single' }));
    // Explore already queued this entry when the tile ring advances.
    const queued = registry.models()[0]; if (queued === undefined) throw new Error('Missing queued model');
    tile.dispose(); expect(registry.models()).toHaveLength(0);
    const specimen = queued.object(), mesh = specimen.children[0]?.children[0];
    if (!(mesh instanceof Mesh)) throw new Error('Missing queued specimen');
    const drawn: unknown = mesh.geometry; if (!(drawn instanceof BufferGeometry)) throw new Error('Missing queued geometry');
    expect(sceneResourceOwner(drawn)?.belongsTo(world)).toBe(true); expect(mesh.material).toBe(material);
    const released = vi.spyOn(drawn, 'dispose'); queued.release?.(); expect(released).toHaveBeenCalledOnce();
    expect(queued.object().children).toHaveLength(1);
    const clone = vi.spyOn(geometry, 'clone');
    let steps: ReturnType<Scope['disposeSteps']> | undefined;
    if (retirement === 'registry') registry.retire();
    else if (retirement === 'disposed') world.dispose();
    else { world.onDisposeSteps(function* holdRetirement() { yield; }); steps = world.disposeSteps(); steps.next(); expect(world.disposing).toBe(true); }
    expect(() => queued.object()).toThrow('Model specimen owner is not live'); expect(clone).not.toHaveBeenCalled();
    if (steps !== undefined) Array.from(steps);
  } finally { world.dispose(); registry.retire(); geometry.dispose(); material.dispose(); app.registryValue = priorRegistry; app.levelScope = priorLevel; }
});

test('fictional scan rows share original PBR material identity and release it once', async () => {
  const map = new Texture(), normalMap = new Texture(), armMap = new Texture(), owner = new Scope('fixture-quay-surfaces');
  const load = vi.spyOn(assets, 'loadPBR').mockResolvedValue({ map, normalMap, armMap });
  const setupMaterial = vi.fn<SkyRig['setupMaterial']>(), sky = fixtureSky(setupMaterial);
  const product = { shardfile: emptyShardfile({ slug: 'fixture-quay', name: 'Quay', author: 'Fixture', revision: 1, seed: 1 }) } as ShardProduct;
  const row = v.parse(WorldSceneSurfaceSchema, { id: 'stone', kind: 'surface', scan: 'quay_stone',
    properties: { color: [0.2, 0.3, 0.4], metalness: 0, normalScale: [0.8, 1.3] } });
  try {
    const first = withOwner(owner, () => worldSceneSurfaceMaterial(row, sky, product));
    const second = withOwner(owner, () => worldSceneSurfaceMaterial(row, sky, product));
    expect(second).toBe(first);
    const material = await first; if (!(material instanceof MeshStandardMaterial)) throw new Error('Missing original PBR material');
    expect(material.color.toArray()).toEqual([0.2, 0.3, 0.4]); expect(material.normalScale.toArray()).toEqual([0.8, 1.3]);
    expect(material.map).toBe(map); expect(material.normalMap).toBe(normalMap);
    expect(material.roughnessMap).toBe(armMap); expect(material.aoMap).toBe(armMap); expect(material.metalnessMap).toBe(armMap);
    expect(material.metalness).toBe(0); expect(load).toHaveBeenCalledOnce(); expect(setupMaterial).toHaveBeenCalledOnce();
    const disposed = vi.fn<() => void>(); material.addEventListener('dispose', disposed); owner.dispose(); await Promise.resolve(); expect(disposed).toHaveBeenCalledOnce();
  } finally { load.mockRestore(); owner.dispose(); map.dispose(); normalMap.dispose(); armMap.dispose(); }
});

test('surface leases survive the first owner and evict after the last owner', async () => {
  const texture = new Texture(), textureDisposed = vi.spyOn(texture, 'dispose'), first = new Scope('first'), second = new Scope('second'), later = new Scope('later');
  let finish: ((value: assets.PBRSet) => void) | undefined;
  const load = vi.spyOn(assets, 'loadPBR').mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  const sky = fixtureSky();
  const product = { shardfile: emptyShardfile({ slug: 'fixture-quay', name: 'Quay', author: 'Fixture', revision: 1, seed: 1 }) } as ShardProduct;
  const row = v.parse(WorldSceneSurfaceSchema, { id: 'stone', kind: 'surface', scan: 'quay_stone', properties: {} });
  const root = new Group(), shape = new BufferGeometry(); ownSceneTree(root, second, { isAcquired: () => false });
  try {
    const pending = worldSceneSurfaceMaterial(row, sky, product, first);
    expect(worldSceneSurfaceMaterial(row, sky, product, second)).toBe(pending);
    first.dispose();
    if (finish === undefined) throw new Error('Missing fixture scan request');
    finish({ map: texture, normalMap: texture, armMap: texture });
    const material = await pending, disposed = vi.fn<() => void>(); material.addEventListener('dispose', disposed);
    root.add(new Mesh(shape, material));
    expect(worldSceneSurfaceMaterial(row, sky, product, second)).toBe(pending);
    expect(disposed).not.toHaveBeenCalled(); expect(textureDisposed).not.toHaveBeenCalled();
    second.dispose(); await Promise.resolve(); expect(disposed).toHaveBeenCalledOnce(); expect(textureDisposed).toHaveBeenCalledOnce();
    load.mockResolvedValue({ map: texture, normalMap: texture, armMap: texture });
    const replacement = worldSceneSurfaceMaterial(row, sky, product, later);
    expect(replacement).not.toBe(pending); expect(await replacement).not.toBe(material); expect(load).toHaveBeenCalledTimes(2);
    const revised = { ...product, shardfile: { ...product.shardfile, files: [...product.shardfile.files] } };
    const revision = worldSceneSurfaceMaterial(row, sky, revised, later);
    expect(revision).not.toBe(replacement); expect(await revision).not.toBe(await replacement); expect(load).toHaveBeenCalledTimes(3);
  } finally { load.mockRestore(); first.dispose(); second.dispose(); later.dispose(); texture.dispose(); shape.dispose(); }
});

test('surface appearance references refuse before geometry allocation', async () => {
  const owner = new Scope('bad-surface'), reads: string[] = [];
  const source = emptyShardfile({ slug: 'fixture-quay', name: 'Quay', author: 'Fixture', revision: 1, seed: 1 });
  const book = { textures: { grain: { url: 'images/grain.png', srgb: true, repeat: true } }, kinds: [] };
  const files = new Map([['look/appearance.json', new TextEncoder().encode(JSON.stringify(book))], ['models/invalid.glb', new Uint8Array()]]);
  const product = { shardfile: source, hasFile: (name: string) => files.has(name), file: (name: string) => {
    reads.push(name); return Promise.resolve(files.get(name) ?? new Uint8Array());
  } } as ShardProduct;
  const context = { scope: owner, product } as ShardContext;
  const input = (appearance: string, texture: string) => parseWorldScenes({ version: 1,
    libraries: [{ id: 'bake', kind: 'owned', models: [{ id: 'wall', file: 'models/invalid.glb' }] }],
    materials: [{ id: 'paint', kind: 'surface', properties: {}, map: { appearance, texture } }], steps: [] });
  try {
    await expect(installWorldScenes(context, input('look/missing.json', 'grain'))).rejects.toThrow('Missing surface appearance');
    await expect(installWorldScenes(context, input('look/appearance.json', 'missing'))).rejects.toThrow('Missing surface texture');
    await expect(installWorldScenes(context, input('look/appearance.json', 'grain'))).rejects.toThrow('Missing surface image');
    expect(reads).toEqual(['look/appearance.json']);
  } finally { owner.dispose(); }
});

test('scene surfaces prepare matching scans together before plain materials', async () => {
  const setup = vi.fn<SkyRig['setupMaterial']>(), owner = new Scope('quay-scan-wave'), sky = fixtureSky(setup), texture = new Texture();
  const waiting: ((value: assets.PBRSet) => void)[] = [];
  const load = vi.spyOn(assets, 'loadPBR').mockImplementation(() => new Promise(resolve => {
    waiting.push(resolve);
    if (waiting.length === 2) for (const finish of waiting) finish({ map: texture, normalMap: texture, armMap: texture });
  }));
  const product = { shardfile: emptyShardfile({ slug: 'fixture-quay', name: 'Quay', author: 'Fixture', revision: 1, seed: 1 }) } as ShardProduct;
  const context = { scope: owner, product, game: { runtime: { world: { sky } } } } as ShardContext;
  try {
    const handles = await installWorldScenes(context, parseWorldScenes({ version: 1, libraries: [], steps: [],
      materials: [{ id: 'chalk', kind: 'surface', properties: { color: 0xffffff } },
        ...['roof', 'beam'].map(id => ({ id, kind: 'surface', scan: 'quay_wood', properties: {} }))] }));
    const roof = handles.standard('materials.roof'), beam = handles.standard('materials.beam');
    expect(load).toHaveBeenCalledTimes(2); expect(roof).not.toBe(beam);
    expect(roof.map).toBe(texture); expect(beam.map).toBe(texture);
    const chalk = handles.standard('materials.chalk');
    const materialId = (material: MeshStandardMaterial): number => {
      const value: unknown = Reflect.get(material, 'id');
      if (typeof value !== 'number') throw new Error('Missing native material order'); return value;
    };
    expect(materialId(roof)).toBeLessThan(materialId(chalk)); expect(materialId(beam)).toBeLessThan(materialId(chalk));
    const prepared = setup.mock.calls.map(([material]) => material);
    expect(prepared).toEqual([chalk, roof, beam]);
  } finally { load.mockRestore(); owner.dispose(); texture.dispose(); }
});

test('fictional baked building retains ordered draws, depth layers and tier bands', async () => {
  const input = { product: 'fixture-quay', models: [{ key: 'shelter', id: 'fixture-quay/shelter', name: 'Shelter', category: 'buildings',
    pipeline: 'code', file: 'world/shelter.json', defaults: {}, assembly: 'objects', choices: [{ id: 'only', params: {}, size: [2, 3, 4],
      colliders: [], draws: [
        { id: 'wall', library: 'bake', model: 'wall', material: 'stone', receiveShadow: true },
        { id: 'latch', library: 'bake', model: 'wall', material: 'stone', until: { phone: 12, desktop: 30 }, castShadow: { phone: false, desktop: true } },
        { id: 'caster', library: 'bake', model: 'wall', material: 'stone', depthOnly: true, until: { phone: 24, desktop: 60 } },
      ] }] }] };
  const catalogue = parseWorldSceneModels(input), owner = new Scope('fixture-quay');
  const sky = fixtureSky(), host = { renderer: null }, ctx = sharedModelContext(sky, host), registry = new WorldRegistry();
  const geometry = new BufferGeometry().setAttribute('position', new BufferAttribute(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), 3));
  geometry.setAttribute('aMoss', new BufferAttribute(new Float32Array([0.1, 0.4, 0.8]), 1));
  const material = new MeshStandardMaterial();
  bindWorldSceneModelSources(ctx, catalogue.product, { catalogue, materials: new Map([['stone', material]]),
    geometries: new Map([[JSON.stringify(['bake', 'wall']), geometry]]) }, owner);
  const model = defineWorldSceneCatalogue(catalogue).model('shelter'), made = model.build(ctx, {}, new Rng(1));
  if (!(made instanceof Group)) throw new Error('Expected original object assembly');
  expect(made.children).toHaveLength(3);
  const [wall, latch, proxy] = made.children;
  if (!(wall instanceof Mesh) || !(latch instanceof Mesh) || !(proxy instanceof Mesh)) throw new Error('Missing declared draw');
  expect(wall.receiveShadow).toBe(true); expect(wall.material).toBe(material);
  expect(latch.userData['until']).toBe(TIER === 'phone' ? 12 : 30); expect(latch.castShadow).toBe(TIER !== 'phone');
  expect(proxy.layers.mask).toBe(1 << SHADOW_LAYER); expect(proxy.castShadow).toBe(true);
  const drawnGeometry: unknown = wall.geometry; if (!(drawnGeometry instanceof BufferGeometry)) throw new Error('Missing owned draw geometry');
  const drawnPosition: unknown = drawnGeometry.getAttribute('position'), originalPosition: unknown = geometry.getAttribute('position');
  if (!(drawnPosition instanceof BufferAttribute) || !(originalPosition instanceof BufferAttribute)) throw new Error('Missing native position channel');
  expect(drawnGeometry).not.toBe(geometry); expect(drawnPosition.array).toEqual(originalPosition.array);
  const drawnMoss: unknown = drawnGeometry.getAttribute('aMoss'), originalMoss: unknown = geometry.getAttribute('aMoss');
  if (!(drawnMoss instanceof BufferAttribute) || !(originalMoss instanceof BufferAttribute)) throw new Error('Missing native custom channel');
  expect(drawnMoss.array).toEqual(originalMoss.array);
  const game = {}, context = { scope: owner, app: { registry }, game } as ShardContext;
  Object.assign(game, { runtime: { world: { sky, game: host, registry } } });
  const placement = parseWorldScenePlacement({ id: 'shelter', model: 'shelter', draw: 'single',
    poses: [{ x: 3, y: 1, z: 4, yxz: { yaw: 0, yawAtan2: [2, 3], scale: 1 } }], piece: { id: 'jetty', solidFloor: true, floorPolicy: 'highest',
      floors: [{ x: 3, z: 4, hw: 2, hd: 3, y: 5 }, { x: 3, z: 4, hw: 2, hd: 3, y: 7 }] } });
  const handle = new WorldScenePlacement(context, placement, defineWorldSceneCatalogue(catalogue), owner, new Map(), []);
  const placed = await handle.load(); expect(await handle.load()).toBe(placed);
  expect(registry.floorAt(3, 4)).toBe(7); expect(registry.floorAt(40, 40)).toBeUndefined();
  expect(registry.pieces.find(piece => piece.id === 'jetty')?.solidFloor).toBe(true);
  expect(placed.object.position.toArray()).toEqual([3, 1, 4]);
  // tile streaming T3: by tile, each tile's copies under that tile's scope in one container; its end takes them and their piece
  const pose = (x: number) => ({ x, y: 0, z: 4, yxz: { yaw: 0, scale: 1 } });
  const tiled = new WorldScenePlacement(context, parseWorldScenePlacement({ id: 'row', model: 'shelter', draw: 'single', poses: [pose(3), pose(100), pose(110)],
    piece: { id: 'row', floors: [{ x: 3, z: 4, hw: 1, hd: 1, y: 2 }] } }), defineWorldSceneCatalogue(catalogue), owner, new Map(), []);
  expect([...tiled.tiles()].sort((a, b) => a - b)).toEqual([36, 37]);
  const container = new Group(), tileScope = owner.child('tile-37');
  const two = await tiled.attach(37, tileScope, container);
  expect(container.children).toHaveLength(1); expect(two?.object.parent).toBe(container);
  expect(registry.pieces.some(piece => piece.id === 'row.t37')).toBe(true);
  expect(await tiled.attach(9, owner.child('tile-9'), container)).toBeNull();
  tileScope.dispose();
  expect(container.children).toHaveLength(0); expect(registry.pieces.some(piece => piece.id === 'row.t37')).toBe(false);
  expect(() => parseWorldSceneModels({ ...input, models: [{ ...input.models[0], assembly: 'parts' }] })).toThrow();
  expect(() => parseWorldSceneModels({ ...input, models: [{ ...input.models[0], choices: [{ ...input.models[0]?.choices[0], lods: [{ from: 10, draws: [] }] }] }] })).toThrow();
  for (const child of made.children) if (child instanceof Mesh) { const drawn: unknown = child.geometry; if (drawn instanceof BufferGeometry) drawn.dispose(); }
  geometry.dispose(); material.dispose(); owner.dispose(); registry.retire();
});

test('scene floors and native turn operands are bounded data', () => {
  const input = { id: 'jetty', model: 'shelter', draw: 'single', poses: [{ x: 3, y: 1, z: 4, yxz: { yaw: 0, yawAtan2: [2, 3], scale: 1 } }],
    piece: { id: 'jetty', solidFloor: true, floors: [{ x: 3, z: 4, hw: 2, hd: 3, y: 5 }], floorPolicy: 'highest' } };
  const row = parseWorldScenePlacement(input);
  expect(row.piece?.floors?.[0]?.y).toBe(5);
  expect(() => parseWorldScenePlacement({ ...input, piece: { ...input.piece, floors: [{ x: 0, z: 0, hw: -1, hd: 2, y: 0 }] } })).toThrow();
  expect(() => parseWorldScenePlacement({ ...input, poses: [{ ...input.poses[0], yxz: { yaw: 0, yawAtan2: [1], scale: 1 } }] })).toThrow();
  expect(() => v.parse(WorldSceneSurfaceSchema, { id: 'stone', kind: 'surface', properties: { normalScale: [1] } })).toThrow();
  expect(() => v.parse(WorldSceneSurfaceSchema, { id: 'stone', kind: 'surface', properties: {}, load: () => undefined })).toThrow();
});

test('draw knob references retain normal tiers and declared level overrides', () => {
  const saved = { ...TIER_CONFIG }, savedTier = TIER, owner = new Scope('quay-knobs');
  const sky = fixtureSky(), ctx = sharedModelContext(sky), shape = new BufferGeometry(), material = new MeshStandardMaterial();
  shape.setAttribute('position', new BufferAttribute(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), 3));
  const catalogue = parseWorldSceneModels({ product: 'fixture-quay', models: [{ key: 'gate', id: 'fixture-quay/gate', name: 'Gate',
    category: 'buildings', pipeline: 'code', file: 'world/gate.json', defaults: {}, assembly: 'objects', choices: [{ id: 'only', params: {},
      size: [1, 1, 1], colliders: [], draws: [{ id: 'gate', library: 'bake', model: 'gate', material: 'iron',
        until: { knob: 'quay.range', multiply: 2, add: 4 }, castShadow: { knob: 'quay.shadows' } }] }] }] });
  bindWorldSceneModelSources(ctx, catalogue.product, { catalogue, materials: new Map([['iron', material]]),
    geometries: new Map([[JSON.stringify(['bake', 'gate']), shape]]), plumbing: parsePlumbing({ namespace: 'quay', input: [], debug: [],
      knobs: [{ id: 'quay.range', phone: 12, desktop: 30 }, { id: 'quay.shadows', phone: false, desktop: true }] }) }, owner);
  const model = defineWorldSceneCatalogue(catalogue).model('gate');
  const check = (until: number, casts: boolean): void => {
    const root = model.build(ctx, {}, new Rng(1)); if (!(root instanceof Group)) throw new Error('Missing fixture gate');
    const mesh = root.children[0]; if (!(mesh instanceof Mesh)) throw new Error('Missing fixture draw');
    expect(mesh.userData['until']).toBe(until); expect(mesh.castShadow).toBe(casts);
    const geometry: unknown = mesh.geometry; if (!(geometry instanceof BufferGeometry)) throw new Error('Missing fixture geometry'); geometry.dispose();
  };
  try {
    initializeTier('phone'); check(28, false);
    applyLevelTier({ 'quay.range': 52.5, 'quay.shadows': true }); check(109, true);
    withTier('desktop', () => { check(64, true); }); check(109, true);
    applyLevelTier(undefined); check(28, false);
  } finally { owner.dispose(); shape.dispose(); material.dispose(); initializeTier(savedTier); Object.assign(TIER_CONFIG, saved); }
});

test('scene capture disposes a finished batch once under same or different ambient owners', () => {
  for (const relation of ['same', 'nested', 'independent'] as const) {
    const owner = new Scope(`batch-${relation}`), ambient = relation === 'same' ? owner : new Scope('ambient', relation === 'nested' ? owner : undefined);
    const material = new MeshStandardMaterial(), parent = new Group(), shape = new BufferGeometry();
    shape.setAttribute('position', new BufferAttribute(Float32Array.of(0, 0, 0, 1, 0, 0, 0, 1, 0), 3));
    const batch = new WorldSceneBatch(v.parse(WorldSceneBatchSchema, { id: 'quay', material: 'iron', capacity: { instances: 2, vertices: 6, indices: 6 },
      geometry: [{ library: 'quay', model: 'post' }], fixed: [{ lod0: 0, lod1: 0, near: 0, far: 10, sphere: [0, 0, 0, 1], matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] }] }),
    material, [shape], owner, new WorldRegistry());
    const group = withOwner(ambient, () => batch.finish()), mesh = group.children[0];
    if (!(mesh instanceof Mesh)) throw new Error('Missing instanced slot');
    const dispose = vi.spyOn(mesh, 'dispose'); parent.add(group);
    ownSceneTree(parent, ambient, { isAcquired: () => false });
    expect(sceneResourceOwner(mesh)).toBe(owner);
    if (ambient !== owner) { ambient.dispose(); expect(dispose).not.toHaveBeenCalled(); }
    expect(() => owner.dispose()).not.toThrow(); expect(dispose).toHaveBeenCalledOnce();
    expect(group.parent).toBeNull(); ambient.dispose(); material.dispose(); shape.dispose();
  }
});


test('native shader parity ignores only an unused diagnostic material label', () => {
  const stone = '#define SHADER_NAME stone_a\nvoid main() { gl_Position = vec4(1.0); }';
  const other = stone.replace('stone_a', 'stone_b');
  expect(shaderCodeSources([stone])).toEqual(shaderCodeSources([other]));
  expect(shaderCodeSources([stone])).not.toEqual(shaderCodeSources([other.replace('1.0', '2.0')]));
  expect(shaderCodeSources([`${stone}\nSHADER_NAME`])).not.toEqual(shaderCodeSources([`${other}\nSHADER_NAME`]));
});


test('tiled placement admits authored contacts once, never decodes the whole table per draw', async () => {
  const owner = new Scope('tiled-contacts'), sky = fixtureSky(), registry = new WorldRegistry(), game = {};
  const context = { scope: owner, app: { registry }, game } as ShardContext;
  Object.assign(game, { runtime: { world: { sky, game, registry } } });
  const catalogue = defineWorldSceneCatalogue({ product: 'fixture-quay', models: [{ key: 'marker', id: 'fixture-quay/marker', name: 'Marker',
    category: 'props', pipeline: 'code', file: 'marker.json', defaults: {}, choices: [{ id: 'only', params: {}, size: [1, 1, 1],
      draws: [], colliders: [{ kind: 'ball', x: 0, y: 0, z: 0, radius: 99 }] }] }] });
  const pose = (x: number) => ({ x, y: 0, z: 4, yxz: { yaw: 0, scale: 1 } });
  const row = parseWorldScenePlacement({ id: 'contacts', model: 'marker', draw: 'single', poses: [pose(3), pose(100)],
    colliders: [{ kind: 'hull', x: 3, y: 0, z: 4, points: [0, 0, 0, 1, 0, 0, 0, 1, 0], surface: 'rock' },
      { kind: 'trimesh', x: 100, y: 0, z: 4, vertices: [0, 0, 0, 1, 0, 0, 0, 1, 0], indices: [0, 1, 2] }], piece: { id: 'contacts' } });
  const expected = colliderReader.readColliderRows(row.colliders ?? [], { kinds: ['hull', 'trimesh'], surfaces: ['rock'] });
  const read = vi.spyOn(colliderReader, 'readColliderRows'), handles = new WorldScenePlacement(context, row, catalogue, owner, new Map(), []);
  const admitted = () => read.mock.calls.filter(([input]) => input === row.colliders).length;
  try {
    expect([...handles.tiles()]).toEqual([36, 37]); expect(admitted()).toBe(1);
    const container = new Group(), left = owner.child('left'), right = owner.child('right');
    const a = await handles.attach(36, left, container), b = await handles.attach(37, right, container);
    expect(a?.colliders).toEqual([]); expect(b?.colliders).toEqual([]); // authored rows suppress the model's ball
    await handles.attachColliders(36, left); await handles.attachColliders(37, right);
    const contacts = () => registry.pieces.filter(piece => piece.id.startsWith('contacts.c')).flatMap(piece => piece.colliders);
    expect(contacts()).toEqual(expected); expect(JSON.stringify(contacts())).toBe(JSON.stringify(expected));
    expect(admitted()).toBe(1);
    left.dispose(); right.dispose(); expect(contacts()).toEqual([]); expect(container.children).toHaveLength(0);
    const again = owner.child('again'); await handles.attach(36, again, container); await handles.attachColliders(36, again);
    expect(contacts()).toEqual(expected.slice(0, 1)); expect(admitted()).toBe(1);
    again.dispose();
    const whole = new WorldScenePlacement(context, row, catalogue, owner, new Map(), []);
    expect((await whole.load()).colliders).toEqual(expected); expect(admitted()).toBe(2);
  } finally { owner.dispose(); registry.retire(); }
});

test('a direct tiled build refuses an invalid authored contact before placing any copy', async () => {
  const owner = new Scope('bad-tiled-contact'), sky = fixtureSky(), registry = new WorldRegistry(), game = {};
  const context = { scope: owner, app: { registry }, game } as ShardContext;
  Object.assign(game, { runtime: { world: { sky, game, registry } } });
  const model = vi.fn(() => { throw new Error('Must refuse before requesting a model'); });
  const row = parseWorldScenePlacement({ id: 'bad', model: 'marker', draw: 'single',
    poses: [{ x: 3, y: 0, z: 4, yxz: { yaw: 0, scale: 1 } }], colliders: [{ kind: 'box', x: 0 }] });
  try {
    const handles = new WorldScenePlacement(context, row, { model }, owner, new Map(), []);
    await expect(handles.attach(36, owner.child('tile'), new Group())).rejects.toThrow();
    expect(model).not.toHaveBeenCalled(); expect(registry.pieces).toEqual([]);
  } finally { owner.dispose(); registry.retire(); }
});
