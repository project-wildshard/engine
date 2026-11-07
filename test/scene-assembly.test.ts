// @vitest-environment happy-dom
import { Group, PerspectiveCamera, Scene, Vector3, type Material } from 'three';
import { expect, test, vi } from 'vitest';
import * as gpu from '../src/client/engine/core/gpuOnly';
import { Scope } from '../src/shared/engine/app/scope';
import { type Piece, WorldRegistry } from '../src/client/engine/world/registry';
import { parseClientPlan } from '@wildshard/format/clientPlan';
import type { ShardContext } from '../src/client/game/plugin/context';
import type { ShardRuntime } from '../src/shared/game/shard/runtime';
import type { ShardWorld } from '../src/server/game/shard/world';
import { CLIENT_FEATURES, admitClientPlan } from '../src/client/game/shardfile/clientPlan';
import { clientSceneHandles } from '../src/client/game/shardfile/clientSceneHandles';
import { entryOwner } from '../src/shared/game/shardfile/entryOwners';
import { bindResidentWorldScope } from '../src/client/game/shardfile/hybridPresentation';
import { preflightIslandBook } from '../src/client/game/shardfile/islandBook';
import { SceneHandles } from '../src/client/game/shardfile/sceneHandles';
import { createShardProduct } from '../src/shared/game/shardfile/shardProduct';
import { WorldAssembly } from '../src/client/game/shardfile/worldAssembly';
import * as runtimeProduct from '../src/client/game/shardfile/runtimeProduct';
import * as sceneHost from '../src/client/game/shardfile/worldScenes';
import * as bakedHost from '../src/client/game/shardfile/bakedTiles';
import { emptyShardfile } from '../src/shared/host/author';
import { legacyDouble } from '@wildshard/engine/test/FakeGame';

const rows = {
  construction: { root: { id: 'world.root', name: 'Fixture world' }, looks: { unbound: [], bound: [] },
    variant: { standalone: 'closed', cell: 'open' }, seed: 1,
    progress: { kind: 'checkpoints', total: 1, start: 'Start', finish: 'Finish', budgetMs: 30 }, checkpoints: [],
    gpu: { label: 'Static world', roots: [{ kind: 'object', id: 'world.root' },
      { kind: 'scene-part', as: 'group', id: 'closed-door', when: { variant: 'closed' } },
      { kind: 'scene-part', as: 'group', id: 'open-door', when: { variant: 'open' } }] } },
  stages: [{ kind: 'entry', id: 'doors', label: 'Doors', rows: [
    { kind: 'attach', as: 'group', id: 'closed-door', when: { variant: 'closed' } },
    { kind: 'attach', as: 'group', id: 'open-door', when: { variant: 'open' } },
  ] }],
};
function feature(input: unknown = rows, entered?: unknown) {
  const row = parseClientPlan({ version: 1, features: [{ kind: 'world.assembly', rows: input, ...(entered === undefined ? {} : { entered }) }] }).features[0];
  if (row?.kind !== 'world.assembly') throw new Error('Missing fixture assembly');
  return row;
}
const floorPiece = { kind: 'piece', id: 'floor', name: 'Floor', file: 'rows.json', category: 'buildings', surface: 'stone', colliders: [], floors: [], floorPolicy: 'first', solidFloor: true };
const pieces = [floorPiece, { ...floorPiece, id: 'guard', solidFloor: false, object: null, active: 'tool-closed' }];
function fixture() {
  const source = emptyShardfile({ slug: 'fixture-assembly', name: 'Test', author: 'Test', revision: 1, seed: 1 });
  const sections = new Map<string, unknown>([['client/plan', { version: 1, features: [feature()] }],
    ['world/scenes', { version: 1, libraries: [], materials: [], steps: [], entry: { blocks: { pieces } } }]]);
  const read = vi.fn<() => Promise<Uint8Array>>(() => Promise.reject(new Error('No library or cell file exists')));
  const product = createShardProduct({ slug: source.identity.slug, revision: 1, shardfile: source, sections, files: new Map(), read });
  const resident = new Scope('resident'), handles = new SceneHandles(), closed = new Group(), open = new Group();
  handles.publish('closed-door', closed); handles.publish('open-door', open);
  const world = legacyDouble<ShardWorld>({ game: legacyDouble<ShardWorld['game']>({ scene: new Scene(), camera: new PerspectiveCamera(), tier: 'desktop', renderer: legacyDouble<ShardWorld['game']['renderer']>({}) }),
    registry: new WorldRegistry(), sky: legacyDouble<ShardWorld['sky']>({}), physics: legacyDouble<ShardWorld['physics']>({}),
    player: legacyDouble<ShardWorld['player']>({ position: new Vector3() }) });
  const runtime = legacyDouble<ShardRuntime>({ world, viewer: () => new Vector3() });
  const enter = (bound = true, cell = false) => {
    const scope = bound ? resident.child('entered') : new Scope('standalone');
    if (bound) bindResidentWorldScope(scope, resident);
    const register = vi.fn((piece: Piece) => { world.registry.add(piece); });
    const ctx = legacyDouble<ShardContext>({ scope, root: new Group(), product, piece: register, cube: cell ? legacyDouble<NonNullable<ShardContext['cube']>>({}) : null,
      progress: { set: vi.fn<ShardContext['progress']['set']>(), detail: vi.fn<ShardContext['progress']['detail']>() }, game: legacyDouble<ShardContext['game']>({ runtime }) });
    return { ctx, scope, register };
  };
  return { product, sections, read, resident, handles, closed, open, enter, world, runtime };
}
function emptyLooks(): Awaited<ReturnType<typeof runtimeProduct.runtimeLookMaterials>> {
  return { toon: legacyDouble<Awaited<ReturnType<typeof runtimeProduct.runtimeLookMaterials>>['toon']>({}),
    materials: new Map<string, Material>(), textures: new Map(), setParam: () => undefined, setTexture: () => undefined,
    compile: () => { throw new Error('No compilation'); }, bindMeshMap: () => { throw new Error('No mesh'); }, tick: () => undefined,
    outline: () => [], graphs: { bind: () => undefined, readout: { compiled: 0, fallback: 0, reasons: [] } }, surfaces: null };
}
function hosts(f: ReturnType<typeof fixture>) {
  const looks = vi.spyOn(runtimeProduct, 'runtimeLookMaterials').mockResolvedValue(emptyLooks());
  const scenes = vi.spyOn(sceneHost, 'installWorldScenes').mockResolvedValue(f.handles);
  const baked = vi.spyOn(bakedHost, 'residentBakedTiles');
  const release = vi.spyOn(gpu, 'gpuOnlyTrees');
  const construct = vi.spyOn(WorldAssembly, 'construct'); // actual stage runner, no constructor replacement
  return { looks, scenes, baked, construct, release, restore() { for (const spy of [looks, scenes, baked, construct, release]) spy.mockRestore(); } };
}

test('scene-only admission needs no book, cells, catalogue file or reflected host settings', () => {
  const f = fixture();
  try {
    expect(() => preflightIslandBook(f.product, feature())).not.toThrow();
    expect(() => admitClientPlan(f.product.section('client/plan'), f.product)).not.toThrow();
    expect(f.read).not.toHaveBeenCalled();
    const assembly = feature();
    for (const additions of [{ library: 'book' }, { catalogue: 'models.json' }, { install: 'module' }]) {
      expect(() => parseClientPlan({ version: 1, features: [{ ...assembly, ...additions }] })).toThrow();
    }
    for (const construction of [{ ...rows.construction, root: undefined },
      { ...rows.construction, cells: { phone: 'cell.bin', desktop: 'cell.bin' } },
      { ...rows.construction, publish: { draws: 'draws', collection: 'collection' } },
      { ...rows.construction, looks: { bound: ['missing'], unbound: [] } }]) {
      expect(() => preflightIslandBook(f.product, feature({ ...rows, construction }))).toThrow();
    }
    const site = feature({ ...rows, stages: [{ kind: 'site', id: 'hut', label: 'Hut', model: 'hut', choice: 'world' }] });
    expect(() => preflightIslandBook(f.product, site)).toThrow('library');
    expect(f.read).not.toHaveBeenCalled();
    expect(CLIENT_FEATURES['world.assembly'].needsWorldLooks).toBe(false);
  } finally { f.resident.dispose(); }
});

test.each([false, true])('actual construction selects the authored ending (cell=%s) and retains one root across reentry', async cell => {
  const f = fixture(), h = hosts(f), first = f.enter(true, cell);
  try {
    f.handles.release(cell ? 'closed-door' : 'open-door', cell ? f.closed : f.open);
    await CLIENT_FEATURES['world.assembly'].install(first.ctx, feature(), f.resident);
    const root = entryOwner(first.scope, 'object', 'world.root');
    expect(h.release.mock.calls[0]?.[0]).toEqual([root, cell ? f.open : f.closed]);
    expect(root.name).toBe('Fixture world'); expect(root.children).toEqual([cell ? f.open : f.closed]);
    expect(entryOwner(f.resident, 'object', 'world.root')).toBe(root);
    expect(h.construct).toHaveBeenCalledTimes(1); expect(h.construct.mock.calls[0]?.[1].scope).toBe(f.resident);
    expect(h.construct.mock.calls[0]?.[1].library).toBeUndefined(); expect(h.construct.mock.calls[0]?.[1].sites).toBeUndefined();
    expect(clientSceneHandles(f.product, f.resident)).toBe(f.handles);
    expect(h.baked).not.toHaveBeenCalled(); expect(f.read).not.toHaveBeenCalled();
    first.scope.dispose(); expect(root.children).toHaveLength(1);
    const next = f.enter(true, cell); await CLIENT_FEATURES['world.assembly'].install(next.ctx, feature(), f.resident);
    expect(entryOwner(next.scope, 'object', 'world.root')).toBe(root); expect(h.construct).toHaveBeenCalledTimes(1);
    expect(h.looks).toHaveBeenCalledTimes(1); expect(h.scenes).toHaveBeenCalledTimes(1);
    const changed = feature({ ...rows, construction: { ...rows.construction, root: { id: 'world.root', name: 'Changed' } } });
    await expect(CLIENT_FEATURES['world.assembly'].install(next.ctx, changed, f.resident)).rejects.toThrow('declaration changed');
    expect(h.looks).toHaveBeenCalledTimes(1);
    next.scope.dispose(); f.resident.dispose(); expect(() => entryOwner(next.scope, 'object', 'world.root')).toThrow();
  } finally { first.scope.dispose(); f.resident.dispose(); h.restore(); }
});

test.each(['retire', 'world', 'scene', 'reader'] as const)('a held material read rejects %s before scene intake or publication', async mode => {
  const f = fixture(), h = hosts(f), entered = f.enter();
  let finish: (value: ReturnType<typeof emptyLooks>) => void = () => { throw new Error('No gate'); };
  const gate = new Promise<ReturnType<typeof emptyLooks>>(resolve => { finish = resolve; });
  let start: () => void = () => { throw new Error('No start'); };
  const begin = new Promise<void>(resolve => { start = resolve; });
  h.looks.mockImplementation(() => { start(); return gate; });
  const pending = CLIENT_FEATURES['world.assembly'].install(entered.ctx, feature(), f.resident);
  // Wait for the actual held read, beyond the registry's real module await.
  await Promise.race([begin, pending]);
  expect(h.looks).toHaveBeenCalledTimes(1);
  const steps = f.resident.disposeSteps();
  if (mode === 'retire') { steps.next(); expect(f.resident.disposing).toBe(true); }
  else if (mode === 'world') Object.assign(f.runtime, { world: { ...f.world } });
  else if (mode === 'scene') f.sections.set('world/scenes', { ...f.product.section('world/scenes') });
  else Object.assign(f.product, { file: () => Promise.reject(new Error('Replaced reader')) });
  finish(emptyLooks());
  try {
    await expect(pending).rejects.toThrow('left or changed');
    expect(h.scenes).not.toHaveBeenCalled(); expect(h.construct).not.toHaveBeenCalled();
    expect(() => entryOwner(f.resident, 'object', 'world.root')).toThrow();
  } finally {
    for (let step = steps.next(); step.done !== true; step = steps.next()) { /* finish only this fixture's owner */ }
    f.resident.dispose(); h.restore();
  }
});

test('unbound entries construct on their own scope without a product-wide prepared root', async () => {
  const f = fixture(), h = hosts(f), first = f.enter(false), next = f.enter(false);
  try {
    await CLIENT_FEATURES['world.assembly'].install(first.ctx, feature(), first.scope);
    const root = entryOwner(first.scope, 'object', 'world.root'); first.scope.dispose();
    await CLIENT_FEATURES['world.assembly'].install(next.ctx, feature(), next.scope);
    expect(entryOwner(next.scope, 'object', 'world.root')).not.toBe(root);
    expect(h.construct.mock.calls.map(call => call[1].scope)).toEqual([first.scope, next.scope]);
    expect(h.baked).not.toHaveBeenCalled();
  } finally { first.scope.dispose(); next.scope.dispose(); f.resident.dispose(); h.restore(); }
});


test('entered pieces use the original receiver and root, keep the guard last, and register once', async () => {
  const f = fixture(), h = hosts(f), entered = f.enter();
  const binding = feature(rows, { root: 'world.root', blocks: ['pieces'] });
  const attached: Piece[] = [];
  f.world.registry.onAdd(piece => { attached.push(piece); if (piece.object !== undefined) f.world.game.scene.add(piece.object); });
  try {
    await CLIENT_FEATURES['world.assembly'].install(entered.ctx, binding, f.resident);
    const root = entryOwner(entered.scope, 'object', 'world.root');
    expect(attached.map(piece => piece.id)).toEqual(['floor', 'guard']);
    expect(attached[0]?.object).toBe(root); expect(root.parent).toBe(f.world.game.scene);
    expect(attached[1]?.object).toBeUndefined(); expect(attached[1]?.active?.()).toBe(true);
    expect(entered.register).toHaveBeenCalledTimes(2);
    await expect(CLIENT_FEATURES['world.assembly'].install(entered.ctx, binding, f.resident)).rejects.toThrow('already entered');
    expect(entered.register).toHaveBeenCalledTimes(2); expect(h.construct).toHaveBeenCalledTimes(1);
    f.resident.dispose(); expect(root.parent).toBeNull();
  } finally { entered.scope.dispose(); f.resident.dispose(); h.restore(); }
});

test('entered binding refuses unknown roots, missing or duplicate blocks and construction rows before reads', () => {
  const f = fixture();
  try {
    for (const entered of [{ root: 'missing', blocks: ['pieces'] }, { root: 'world.root', blocks: ['missing'] }]) {
      expect(() => preflightIslandBook(f.product, feature(rows, entered))).toThrow('piece-only');
    }
    expect(() => feature(rows, { root: 'world.root', blocks: ['pieces', 'pieces'] })).toThrow('unique entered blocks');
    const section = f.product.section('world/scenes');
    f.sections.set('world/scenes', { ...section, entry: { blocks: { pieces: [{ kind: 'attach', as: 'group', id: 'closed-door' }] } } });
    expect(() => preflightIslandBook(f.product, feature(rows, { root: 'world.root', blocks: ['pieces'] }))).toThrow('piece-only');
    expect(f.read).not.toHaveBeenCalled();
  } finally { f.resident.dispose(); }
});
