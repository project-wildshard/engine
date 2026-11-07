import { expect, test, vi } from 'vitest';
import * as workSlices from '../src/shared/engine/core/workSlice';
import { BufferAttribute, BufferGeometry, Group, InstancedMesh, Mesh, MeshStandardMaterial, Object3D, PerspectiveCamera, PointLight, Texture } from 'three';
import { Scope } from '../src/shared/engine/app/scope';
import { cullPlaced } from '../src/client/engine/models/place';
import { WeldBatch, WeldView } from '../src/client/engine/models/weld';
import { parsePlumbing } from '@wildshard/format/plumbing';
import { TIER, TIER_CONFIG } from '../src/client/engine/core/tier';
import { SceneHandles } from '../src/client/game/shardfile/sceneHandles';
import { WorldEntry } from '../src/client/game/shardfile/worldEntry';
import { residentTiles, tileRing } from '../src/client/game/shardfile/tileDriver';
import { hydrateWorldSceneWeld, worldSceneWeldFile, admitWorldSceneModelGraphs, WorldSceneWeldAssembly } from '../src/client/game/shardfile/worldSceneWeld';
import { parseWorldSceneWeld } from '@wildshard/format/worldSceneWeld';
import { SkyRig } from '../src/client/engine/world/skyRig';
import { bindWorldSceneModelSources, defineWorldSceneCatalogue } from '../src/client/game/models/worldSceneCatalogue';
import { parseWorldSceneModels, worldSceneModelResources } from '@wildshard/format/worldSceneModels';
import { sharedModelContext } from '../src/client/engine/models/model';
import { Rng } from '../src/shared/engine/core/rng';
import { withOwner } from '../src/shared/engine/app/ownership';
import { installWorldScenes } from '../src/client/game/shardfile/worldScenes';
import { parseWorldScenes } from '@wildshard/format/worldScenes';
import { emptyShardfile } from '../src/shared/host/author';
import { WorldRegistry } from '../src/client/engine/world/registry';
import type { ShardContext } from '../src/client/game/plugin/context';

const matrixWords = (matrix: Float32Array): number[] => Array.from(new Uint32Array(matrix.buffer));
const identity = () => matrixWords(Float32Array.of(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, -0, 0, 1));
const sphere = [0, 0, 0, 2], box = [-1, -1, -1, 1, 1, 1];
const geometry3 = (value: unknown): value is BufferGeometry => value instanceof BufferGeometry;
function fixture() {
  const owner = new Scope('fixture-quay'), handles = new SceneHandles();
  const quay = new Group(), berth = new Group(), door = new Group();
  door.userData['until'] = 6; berth.add(door); quay.add(berth);
  handles.publish('quay', quay); handles.publish('berth', berth);
  const geometry = new BufferGeometry().setAttribute('position', new BufferAttribute(Float32Array.of(-1, 0, 0, 1, 0, 0, 0, 1, 0, -1, 0, 1, 1, 0, 1, 0, 1, 1), 3));
  const material = new MeshStandardMaterial();
  const sources = { geometry: new Map([['["quay-shapes","walls"]', geometry]]), materials: new Map([['wood', material]]) };
  const row = { id: 'quay-shells', root: 'quay', nodes: [
    { kind: 'batch', id: 'walls', parent: 'quay', geometry: { library: 'quay-shapes', model: 'walls' }, material: 'wood', sphere, box, layers: -1 },
    { kind: 'view', id: 'berth-wall', parent: 'berth', batch: 'walls', start: 0, count: 3, sphere, box, matrixAutoUpdate: false, until: 6 },
    { kind: 'instances', id: 'crates', parent: 'quay', geometry: { library: 'quay-shapes', model: 'walls' }, material: 'wood', sphere, box,
      capacity: 1, count: 1, matrixWords: identity(), instanceSphere: sphere },
  ], culls: [{ roots: ['berth'], origins: [0, 0, 0], units: [0], details: [6],
    hosted: [{ meshes: ['crates'], lists: [{ unit: 0, matrixWords: identity() }] }] }] };
  return { owner, handles, quay, berth, door, geometry, material, sources, row };
}

test('independent quay rows preserve shared selection buffers, hosted bands and borrowed lifetimes', () => {
  const f = fixture(), camera = new PerspectiveCamera();
  try {
    expect(hydrateWorldSceneWeld(f.row, f.handles, f.sources, f.owner)).toBe(f.quay);
    const batch = f.handles.object('walls'), view = f.handles.object('berth-wall'), crates = f.handles.object('crates');
    if (!(batch instanceof WeldBatch) || !(view instanceof WeldView) || !(crates instanceof InstancedMesh)) throw new Error('Missing restored draw classes');
    expect(view.geometry.getAttribute('position').array.buffer).toBe(batch.geometry.getAttribute('position').array.buffer);
    expect(view.geometry.getAttribute('position').count).toBe(3); expect(batch.views).toEqual([view]);
    expect(batch.layers.mask).toBe(-1);
    expect(crates.geometry).toBe(batch.geometry); expect(batch.geometry).not.toBe(f.geometry);
    let disposals = 0; batch.geometry.addEventListener('dispose', () => { disposals++; });
    expect(Object.is(crates.instanceMatrix.array[13], -0)).toBe(true);
    camera.position.set(0, 0, 2); camera.updateMatrixWorld(true); cullPlaced(camera);
    expect(f.door.visible).toBe(true); expect(view.visible).toBe(true); expect(crates.count).toBe(1);
    camera.position.set(0, 0, 20); camera.updateMatrixWorld(true); cullPlaced(camera);
    expect(f.door.visible).toBe(false); expect(view.visible).toBe(false); expect(crates.count).toBe(0);
    f.owner.dispose(); expect(disposals).toBe(1);
    expect(f.quay.children).toEqual([f.berth]); expect(f.berth.children).toEqual([f.door]);
    expect(f.handles.has('walls')).toBe(false); expect(f.handles.object('berth')).toBe(f.berth);
    expect(f.material.version).toBe(0);
    camera.position.set(0, 0, 2); camera.updateMatrixWorld(true); cullPlaced(camera);
    expect(f.door.visible).toBe(false);
  } finally { f.owner.dispose(); f.geometry.dispose(); f.material.dispose(); }
});

test('geometry identities remain owner-local and equal bytes do not merge distinct references', () => {
  const f = fixture(), other = fixture(), instance = f.row.nodes[2];
  if (instance === undefined) throw new Error('Missing instance fixture');
  f.sources.geometry.set('["quay-shapes","equal"]', f.geometry);
  const row = { ...f.row, culls: [], nodes: [...f.row.nodes,
    { ...instance, id: 'shared-copy' }, { ...instance, id: 'distinct-copy', geometry: { library: 'quay-shapes', model: 'equal' } }] };
  try {
    hydrateWorldSceneWeld(row, f.handles, f.sources, f.owner);
    hydrateWorldSceneWeld(row, other.handles, f.sources, other.owner);
    const first = f.handles.object('crates'), shared = f.handles.object('shared-copy'), distinct = f.handles.object('distinct-copy'), next = other.handles.object('crates');
    if (!(first instanceof InstancedMesh) || !(shared instanceof InstancedMesh) || !(distinct instanceof InstancedMesh) || !(next instanceof InstancedMesh)) throw new Error('Missing instance copies');
    expect(shared.geometry).toBe(first.geometry); expect(shared.instanceMatrix).not.toBe(first.instanceMatrix);
    expect(distinct.geometry).not.toBe(first.geometry); expect(next.geometry).not.toBe(first.geometry);
    const a: unknown = distinct.geometry, b: unknown = first.geometry;
    if (!geometry3(a) || !geometry3(b)) throw new Error('Missing restored geometry');
    expect(Array.from(a.getAttribute('position').array)).toEqual(Array.from(b.getAttribute('position').array));
    f.owner.dispose(); expect(other.handles.object('crates')).toBe(next);
  } finally { f.owner.dispose(); other.owner.dispose(); f.geometry.dispose(); other.geometry.dispose(); f.material.dispose(); other.material.dispose(); }
});

test('bad ranges, duplicate names and forward parents refuse without publishing a partial graph', () => {
  const f = fixture();
  try {
    const first = f.row.nodes[0], second = f.row.nodes[1];
    if (first === undefined || second === undefined) throw new Error('Missing fixture nodes');
    for (const nodes of [[{ ...second, start: 99 }, first], [first, { ...second, start: 99 }], [first, { ...first }]]) {
      expect(() => hydrateWorldSceneWeld({ ...f.row, nodes }, f.handles, f.sources, f.owner)).toThrow();
      expect(f.quay.children).toEqual([f.berth]); expect(f.handles.has('walls')).toBe(false);
    }
    expect(() => hydrateWorldSceneWeld({ ...f.row, nodes: f.row.nodes.map(node => node.id === 'crates' ? { ...node, sphere: [0, 0, 0, 3] } : node) }, f.handles, f.sources, f.owner)).toThrow('bounds differ');
    expect(() => parseWorldSceneWeld({ ...f.row, callback: () => null })).toThrow();
    f.geometry.setIndex([0, 1, 2]);
    expect(() => hydrateWorldSceneWeld({ ...f.row, nodes: [first], culls: [] }, f.handles, f.sources, f.owner)).toThrow('non-indexed');
    f.owner.dispose(); expect(() => hydrateWorldSceneWeld(f.row, f.handles, f.sources, f.owner)).toThrow();
  } finally { f.owner.dispose(); f.geometry.dispose(); f.material.dispose(); }
});

test('specimen materials construct fresh defaults and borrow only their declared maps', () => {
  const f = fixture(), texture = new Texture(), foreign = new MeshStandardMaterial({ map: texture, roughness: 0.123, metalness: 0.876, transparent: true, opacity: 0.3 });
  const sky: Pick<SkyRig, 'setupMaterial'> = { setupMaterial: () => undefined };
  const handles = new SceneHandles(sky); handles.publish('quay', new Group()); handles.publish('foreign', foreign);
  try {
    hydrateWorldSceneWeld({ id: 'specimen', root: 'quay', materials: [{ id: 'frame', kind: 'standard', source: { material: 'foreign', maps: ['map'] }, properties: { roughness: 0.7 }, sky: true }],
      nodes: [{ kind: 'mesh', id: 'frame-mesh', parent: 'quay', geometry: { library: 'quay-shapes', model: 'walls' }, material: 'frame', sphere }] }, handles, f.sources, f.owner);
    const mesh = handles.object('frame-mesh'); if (!(mesh instanceof Mesh) || !(mesh.material instanceof MeshStandardMaterial)) throw new Error('Missing specimen frame');
    expect(mesh.material).not.toBe(foreign); expect(mesh.material.map).toBe(texture);
    expect(mesh.material.roughness).toBe(0.7); expect(mesh.material.metalness).toBe(0); expect(mesh.material.opacity).toBe(1); expect(mesh.material.transparent).toBe(false);
    f.owner.dispose(); expect(handles.material('foreign')).toBe(foreign); expect(foreign.map).toBe(texture);
  } finally { f.owner.dispose(); f.geometry.dispose(); f.material.dispose(); foreign.dispose(); texture.dispose(); }
});

test('the topology selector follows the boolean override independently of tier', () => {
  const row = { id: 'quay', file: { knob: 'quay.shadows', false: 'plain.json', true: 'proxied.json' } };
  const plumbing = parsePlumbing({ namespace: 'quay', knobs: [{ id: 'quay.shadows', phone: false, desktop: false }], input: [], debug: [] });
  const prior = TIER_CONFIG['quay.shadows'];
  try {
    expect(worldSceneWeldFile(row, plumbing)).toBe('plain.json');
    TIER_CONFIG['quay.shadows'] = true; expect(worldSceneWeldFile(row, plumbing)).toBe('proxied.json');
  } finally { if (prior === undefined) delete TIER_CONFIG['quay.shadows']; else TIER_CONFIG['quay.shadows'] = prior; }
});

test('a complete independent specimen restores native transforms, clouds and lights from its catalogue', () => {
  const f = fixture(), candidate: unknown = Object.create(SkyRig.prototype);
  if (!(candidate instanceof SkyRig)) throw new Error('Missing fixture sky');
  candidate.setupMaterial = () => undefined;
  const ctx = sharedModelContext(candidate), native = new Group();
  native.position.set(1, -0, 3); native.rotation.y = 0.7; native.scale.set(2, 3, 4); native.updateMatrix();
  const transforms = Float64Array.from([...native.position, ...native.quaternion, ...native.scale]);
  const recipe = { id: 'quay-specimen', root: 'specimen', nodes: [
    { kind: 'group', id: 'pivot', parent: 'specimen', transformBits: Array.from(new Uint32Array(transforms.buffer)), matrixBits: Array.from(new Uint32Array(Float64Array.from(native.matrix.elements).buffer)) },
    { kind: 'mesh', id: 'wall', parent: 'pivot', geometry: { library: 'quay-shapes', model: 'walls' }, material: 'wood', sphere },
    { kind: 'cloud', id: 'smoke', parent: 'pivot', material: 'wood', sphere, seedWords: matrixWords(Float32Array.of(0.2, -0, 0.4, 0.8)) },
    { kind: 'light', id: 'lamp', parent: 'pivot', color: 0xffaa55, intensity: 2, distance: 8, decay: 2 },
    { kind: 'anchor', id: 'lamp-anchor', parent: 'pivot' },
  ] };
  const catalogue = parseWorldSceneModels({ product: 'fixture-quay', models: [{ key: 'shed', id: 'fixture-quay/shed', name: 'Shed', file: 'shed.json', category: 'buildings', pipeline: 'code', defaults: {}, assembly: 'scene',
    choices: [{ id: 'only', params: {}, size: [1, 1, 1], colliders: [], draws: [], scene: recipe }] }] });
  try {
    expect(worldSceneModelResources(catalogue).materials).toEqual(['wood', 'wood']);
    bindWorldSceneModelSources(ctx, 'fixture-quay', { catalogue, geometries: f.sources.geometry, materials: f.sources.materials }, f.owner);
    const model = defineWorldSceneCatalogue(catalogue).model('shed');
    const root = withOwner(f.owner, () => model.build(ctx, {}, new Rng(1)));
    if (!(root instanceof Group)) throw new Error('Missing frozen specimen root');
    const pivot = root.children[0]; if (pivot === undefined) throw new Error('Missing native pivot');
    root.updateMatrixWorld(true); expect(pivot.matrix.elements).toEqual(native.matrix.elements); expect(Object.is(pivot.position.y, -0)).toBe(true);
    expect(pivot.children).toHaveLength(4); expect(pivot.children[2]).toBeInstanceOf(PointLight);
    expect(pivot.children[3]?.constructor).toBe(Object3D);
    const smoke = pivot.children[1]; if (!(smoke instanceof Mesh)) throw new Error('Missing frozen cloud');
    const smokeGeometry: unknown = smoke.geometry; if (!geometry3(smokeGeometry)) throw new Error('Missing frozen cloud geometry');
    const seed = smokeGeometry.getAttribute('aSeed'); expect(seed.count).toBe(1); expect(Object.is(seed.getY(0), -0)).toBe(true);
    const another = withOwner(f.owner, () => model.build(ctx, {}, new Rng(1)));
    expect(another).not.toBe(root);
  } finally { f.owner.dispose(); f.geometry.dispose(); f.material.dispose(); }
});

test('named specimen blobs admit once and preserve a sole mesh result', async () => {
  const f = fixture(), candidate: unknown = Object.create(SkyRig.prototype);
  if (!(candidate instanceof SkyRig)) throw new Error('Missing fixture sky'); candidate.setupMaterial = () => undefined;
  const recipe = { id: 'crate', root: 'intake', result: 'crate-mesh', nodes: [{ kind: 'mesh', id: 'crate-mesh', name: 'fixture-quay/crate', parent: 'intake',
    geometry: { library: 'quay-shapes', model: 'walls' }, material: 'wood', sphere }] };
  const reference = { file: 'models/crate.json' };
  const catalogue = parseWorldSceneModels({ product: 'fixture-quay', models: [{ key: 'crate', id: 'fixture-quay/crate', name: 'Crate', file: 'crate.json', category: 'props', pipeline: 'cc0', defaults: {}, assembly: 'scene',
    choices: [{ id: 'only', params: {}, size: [1, 1, 1], colliders: [], draws: [], scene: { phone: reference, desktop: reference } }] }] });
  const reads: string[] = [];
  const product = { hasFile: (name: string) => name === reference.file, file: (name: string) => { reads.push(name); return Promise.resolve(new TextEncoder().encode(JSON.stringify(recipe))); } };
  try {
    const scenes = await admitWorldSceneModelGraphs(product, catalogue); expect(reads).toEqual([reference.file]);
    const ctx = sharedModelContext(candidate);
    bindWorldSceneModelSources(ctx, 'fixture-quay', { catalogue, geometries: f.sources.geometry, materials: f.sources.materials, scenes }, f.owner);
    const result = withOwner(f.owner, () => defineWorldSceneCatalogue(catalogue).model('crate').build(ctx, {}, new Rng(1)));
    expect(result).toBeInstanceOf(Mesh); if (result instanceof Mesh) expect(result.name).toBe('fixture-quay/crate');
    await expect(admitWorldSceneModelGraphs({ ...product, hasFile: () => false }, catalogue)).rejects.toThrow('Missing frozen specimen blob');
    await expect(admitWorldSceneModelGraphs({ ...product, file: () => Promise.resolve(new TextEncoder().encode(JSON.stringify({ ...recipe, resources: [{ id: 'hidden-world-service', kind: 'seeds', words: [0, 0, 0, 0] }] }))) }, catalogue)).rejects.toThrow('cannot install world services');
  } finally { f.owner.dispose(); f.geometry.dispose(); f.material.dispose(); }
});

test('deferred world assembly publishes live seeds before borrowing the living root', async () => {
  const owner = new Scope('fixture-quay-world'), sky: unknown = Object.create(SkyRig.prototype);
  if (!(sky instanceof SkyRig)) throw new Error('Missing fixture sky');
  const graph = { id: 'quay-shells', root: 'living.root', nodes: [], placements: ['quay-piece'],
    resources: [{ id: 'living.seeds', kind: 'seeds', words: matrixWords(Float32Array.of(0.2, -0, 0.4, 0.8)) }] };
  const catalogue = { product: 'fixture-quay', models: [{ key: 'shed', id: 'fixture-quay/shed', name: 'Shed', file: 'shed.json', category: 'buildings', pipeline: 'code', defaults: {},
    choices: [{ id: 'only', params: {}, size: [1, 1, 1], colliders: [], draws: [] }] }] };
  const dormant = { ...graph, root: 'dormant.root', placements: ['quay-dormant'], resources: [{ id: 'dormant.seeds', kind: 'seeds', words: [0, 0, 0, 0] }] };
  const files = new Map<string, unknown>([['world.json', graph], ['other.json', dormant], ['catalogue.json', catalogue]]);
  const registry = new WorldRegistry();
  const context = { scope: owner, app: { registry }, game: { runtime: { world: { sky, registry } } },
    product: { shardfile: emptyShardfile({ slug: 'fixture-quay', name: 'Quay', author: 'Fixture', revision: 1, seed: 1 }),
      hasFile: (name: string) => files.has(name), url: (name: string) => name,
      file: (name: string) => Promise.resolve(new TextEncoder().encode(JSON.stringify(files.get(name)))) } } as ShardContext;
  const rows = parseWorldScenes({ version: 1, catalogue: 'catalogue.json', libraries: [], materials: [], steps: [],
    welds: [{ id: graph.id, file: { phone: TIER === 'phone' ? 'world.json' : 'other.json', desktop: TIER === 'desktop' ? 'world.json' : 'other.json' } }], placements: [{ id: 'quay-piece', model: 'shed', draw: 'single',
      drawnInto: { part: 'living.root', boxes: [0, 0, 0, 1, 1, 1] }, poses: [{ x: 0, y: 0, z: 0, yxz: { yaw: 0, scale: 1 } }], colliders: [] },
    { id: 'quay-dormant', model: 'shed', draw: 'single', drawnInto: { part: 'dormant.root', boxes: [0, 0, 0, 1, 1, 1] },
      poses: [{ x: 0, y: 0, z: 0, yxz: { yaw: 0, scale: 1 } }], colliders: [] }] });
  try {
    const orphan = parseWorldScenes({ ...rows, placements: [...rows.placements, { ...rows.placements[0], id: 'undeclared-borrower' }] });
    await expect(installWorldScenes({ ...context, product: { ...context.product } }, orphan)).rejects.toThrow('Scene placement needs a published part');
    const handles = await installWorldScenes(context, rows), root = new Group();
    expect(Object.is(handles.geometry('living.seeds').getAttribute('seed').getY(0), -0)).toBe(true);
    expect(context.app.registry.pieces).toHaveLength(0);
    expect(handles.has('dormant.seeds')).toBe(false); expect(handles.has('dormant.root')).toBe(false);
    handles.publish('living.root', root);
    // Nine declares its member placements before restoring the frozen fabric
    // that needs those same complete placements for its named-place sets.
    const entry = WorldEntry.admit({ blocks: { members: [{ kind: 'place', id: 'quay-piece' }] } }, { root, scenes: handles, tier: 'phone', scope: owner });
    await entry.run('members');
    expect(await handles.assemble(graph.id)).toBe(root);
    expect(await handles.assemble(graph.id)).toBe(root);
    await residentTiles(owner, handles.tiled(), { x: 0, z: 0 }, [], tileRing);
    expect(context.app.registry.pieces).toHaveLength(1);
    owner.dispose(); expect(handles.object('living.root')).toBe(root);
  } finally { owner.dispose(); }
});

test('placements drawn into a frozen node register on it, and its named-place sets take those placements', async () => {
  const owner = new Scope('fixture-fabric-world'), sky: unknown = Object.create(SkyRig.prototype);
  if (!(sky instanceof SkyRig)) throw new Error('Missing fixture sky');
  const graph = { id: 'fabric', root: 'living.root', resources: [], placements: ['stool@wall'],
    nodes: [{ id: 'fabric.root', parent: 'living.root', name: 'fabric', kind: 'group' }, { id: 'fabric.wall', parent: 'fabric.root', name: 'kit:wall', kind: 'group' }],
    sets: [{ id: 'fixture/square', name: 'The square', file: 'square.json', place: 'fixture/square', members: ['stool@wall'] }] };
  const catalogue = { product: 'fixture-fabric', models: [{ key: 'stool', id: 'fixture-fabric/stool', name: 'Stool', file: 'stool.json', category: 'props', pipeline: 'code', defaults: {},
    choices: [{ id: 'only', params: {}, size: [1, 1, 1], colliders: [], draws: [] }] }] };
  const files = new Map<string, unknown>([['fabric.json', graph], ['catalogue.json', catalogue]]);
  const registry = new WorldRegistry();
  const context = { scope: owner, app: { registry }, game: { runtime: { world: { sky, registry } } },
    product: { shardfile: emptyShardfile({ slug: 'fixture-fabric', name: 'Fabric', author: 'Fixture', revision: 1, seed: 1 }),
      hasFile: (name: string) => files.has(name), url: (name: string) => name,
      file: (name: string) => Promise.resolve(new TextEncoder().encode(JSON.stringify(files.get(name)))) } } as ShardContext;
  const rows = parseWorldScenes({ version: 1, catalogue: 'catalogue.json', libraries: [], materials: [], steps: [], welds: [{ id: graph.id, file: 'fabric.json' }],
    placements: [{ id: 'stool@wall', model: 'stool', draw: 'merged', drawnInto: { part: 'fabric.wall', boxes: [0, 0, 0, 1, 1, 1, 2, 0, 0, 3, 1, 1] },
      poses: [{ x: 0.5, y: 0, z: 0.5, yxz: { yaw: 0, scale: 1 } }, { x: 2.5, y: 0, z: 0.5, yxz: { yaw: 0, scale: 1 } }], piece: { id: 'stool@wall' } }] });
  try {
    const handles = await installWorldScenes(context, rows), root = new Group();
    handles.publish('living.root', root);
    await handles.assemble(graph.id);
    const wall = handles.object('fabric.wall');
    expect(wall.parent?.parent).toBe(root);
    expect(registry.pieces.map(piece => piece.id)).toEqual(['stool@wall']);
    expect(registry.sets.map(set => set.id)).toEqual(['fixture/square']);
  } finally { owner.dispose(); }
});

test('one-shot world assembly snapshots borrowed staging and keeps only its live clones', async () => {
  const f = fixture();
  const assembly = new WorldSceneWeldAssembly(parseWorldSceneWeld({ ...f.row, culls: [] }), f.handles, f.sources, f.owner, new WorldRegistry());
  f.sources.geometry.clear();
  try {
    const pending = assembly.assemble();
    expect(await pending).toBe(f.quay);
    expect(assembly.assemble()).toBe(pending);
    expect(f.sources.geometry.size).toBe(0);
    const live = f.handles.object('walls');
    if (!(live instanceof WeldBatch)) throw new Error('Missing live batch');
    expect(live.geometry).not.toBe(f.geometry);
    expect(Array.from(live.geometry.getAttribute('position').array)).toEqual(Array.from(f.geometry.getAttribute('position').array));
    expect(f.sources.materials.get('wood')).toBe(f.material);
  } finally { f.owner.dispose(); f.geometry.dispose(); f.material.dispose(); }
});


test('resident frozen construction yields without resolving or changing native graph order', async () => {
  const f = fixture();
  let release = (): void => undefined;
  const first = new Promise<void>(resolve => { release = resolve; });
  let pauses = 0;
  const clock = vi.spyOn(workSlices, 'workSlice').mockReturnValue({ due: () => true,
    yield: () => { pauses++; return pauses === 1 ? first : Promise.resolve(); }, check: () => undefined });
  try {
    const row = parseWorldSceneWeld(f.row), assembly = new WorldSceneWeldAssembly(row, f.handles, f.sources, f.owner, new WorldRegistry());
    let completed = false;
    const pending = assembly.assemble().then(root => { completed = true; return root; });
    expect(f.handles.has('walls')).toBe(true);
    expect(f.handles.has('berth-wall')).toBe(false); expect(completed).toBe(false);
    release();
    expect(await pending).toBe(f.quay);
    const walls = f.handles.object('walls'), view = f.handles.object('berth-wall'), crates = f.handles.object('crates');
    if (!(walls instanceof WeldBatch) || !(view instanceof WeldView) || !(crates instanceof InstancedMesh)) throw new Error('Missing restored draw classes');
    expect(view.geometry.getAttribute('position').array.buffer).toBe(walls.geometry.getAttribute('position').array.buffer);
    expect(crates.geometry).toBe(walls.geometry);
    expect(Object.is(crates.instanceMatrix.array[13], -0)).toBe(true);
    expect(f.quay.children).toEqual([f.berth, walls, crates]);
    expect(pauses).toBe(row.nodes.length + row.culls.length);
    expect(assembly.assemble()).toBe(assembly.assemble());
  } finally { release(); clock.mockRestore(); f.owner.dispose(); f.geometry.dispose(); f.material.dispose(); }
});

test('retirement at a frozen construction slice removes partial handles and owned copies', async () => {
  const f = fixture();
  let release = (): void => undefined;
  const first = new Promise<void>(resolve => { release = resolve; });
  const clock = vi.spyOn(workSlices, 'workSlice').mockReturnValue({ due: () => true, yield: () => first, check: () => undefined });
  try {
    const assembly = new WorldSceneWeldAssembly(parseWorldSceneWeld(f.row), f.handles, f.sources, f.owner, new WorldRegistry());
    const pending = assembly.assemble(), refused = expect(pending).rejects.toThrow('owner is disposed or retiring');
    const walls = f.handles.object('walls'); if (!(walls instanceof WeldBatch)) throw new Error('Missing partial frozen draw');
    const dispose = vi.spyOn(walls.geometry, 'dispose');
    f.owner.dispose(); release(); await refused;
    expect(dispose).toHaveBeenCalledTimes(1);
    expect(f.handles.has('walls')).toBe(false); expect(f.handles.has('berth-wall')).toBe(false); expect(f.handles.has('crates')).toBe(false);
    expect(f.quay.children).toEqual([f.berth]);
    expect(f.handles.object('berth')).toBe(f.berth);
  } finally { release(); clock.mockRestore(); f.owner.dispose(); f.geometry.dispose(); f.material.dispose(); }
});


function namedGraphCatalogue(names: readonly string[]) {
  return parseWorldSceneModels({ product: 'fixture-quay', models: [{ key: 'crate', id: 'fixture-quay/crate', name: 'Crate', file: 'crate.json',
    category: 'props', pipeline: 'cc0', defaults: {}, assembly: 'scene', choices: names.map((file, index) => ({ id: String(index), params: {},
      size: [1, 1, 1], colliders: [], draws: [], scene: { phone: { file }, desktop: { file } } })) }] });
}

test('named graph reads overlap in bounded groups and publish unique files in authored order', async () => {
  const names = ['a.json', 'b.json', 'c.json', 'd.json', 'e.json'];
  const waiting = new Map<string, (bytes: Uint8Array) => void>(), reads: string[] = [];
  const pending = admitWorldSceneModelGraphs({ hasFile: () => true, file: name => {
    reads.push(name); return new Promise<Uint8Array>(resolve => { waiting.set(name, resolve); });
  } }, namedGraphCatalogue(names));
  const release = (name: string): void => {
    const resolve = waiting.get(name); if (resolve === undefined) throw new Error('Missing graph read');
    resolve(new TextEncoder().encode(JSON.stringify({ id: name, root: 'specimen', nodes: [] })));
  };
  expect(reads).toEqual(names.slice(0, 4));
  for (const name of names.slice(0, 4).reverse()) release(name);
  await vi.waitFor(() => { expect(reads).toEqual(names); });
  release('e.json');
  expect([...(await pending).keys()]).toEqual(names);
});

test('a refused named graph drains its started reads before the next group can start', async () => {
  const names = ['a.json', 'b.json', 'c.json', 'd.json', 'e.json'];
  const waiting = new Map<string, (bytes: Uint8Array) => void>(), reads: string[] = [];
  const pending = admitWorldSceneModelGraphs({ hasFile: () => true, file: name => {
    reads.push(name); return new Promise<Uint8Array>(resolve => { waiting.set(name, resolve); });
  } }, namedGraphCatalogue(names));
  const settled = vi.fn(); void pending.then(settled, settled);
  const release = (name: string, services: boolean): void => {
    const resolve = waiting.get(name); if (resolve === undefined) throw new Error('Missing graph read');
    resolve(new TextEncoder().encode(JSON.stringify({ id: name, root: 'specimen', nodes: [],
      ...(services ? { resources: [{ id: 'hidden-service', kind: 'seeds', words: [0, 0, 0, 0] }] } : {}) })));
  };
  expect(reads).toEqual(names.slice(0, 4)); release('a.json', true);
  await new Promise<void>(resolve => { setTimeout(resolve, 0); });
  expect(settled).not.toHaveBeenCalled();
  for (const name of names.slice(1, 4)) release(name, false);
  await expect(pending).rejects.toThrow('cannot install world services');
  expect(reads).toEqual(names.slice(0, 4));
});
