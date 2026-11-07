import { expect, test, vi } from 'vitest';
import { BufferAttribute, BufferGeometry, Group, Material, Mesh, Scene, Vector3, type WebGLRenderer } from 'three';
import { Scope } from '../src/shared/engine/app/scope';
import type { Game } from '../src/client/engine/core/Game';
import type { Player } from '../src/client/engine/player/Player';
import type { Physics } from '../src/shared/engine/physics/Physics';
import type { SkyRig } from '../src/client/engine/world/skyRig';
import { WorldRegistry } from '../src/client/engine/world/registry';
import { sharedModelContext } from '../src/client/engine/models/model';
import type { OwnedGeometry } from '../src/client/engine/models/ownedGeometry';
import type { FixedDraws } from '../src/client/game/models/fixedDraws';
import type { ShardContext } from '../src/client/game/plugin/context';
import type { ShardWorld } from '../src/server/game/shard/world';
import type { ShardRuntime } from '../src/shared/game/shard/runtime';
import { createShardProduct, type ShardProduct } from '../src/shared/game/shardfile/shardProduct';
import { entryOwner } from '../src/shared/game/shardfile/entryOwners';
import { SceneDressing } from '../src/client/game/shardfile/sceneDressing';
import * as arena from '../src/client/game/boss/arenaRoomView';
import type { ArenaRoomEncounter } from '../src/client/game/boss/arenaRoom';
import { emptyShardfile } from '../src/shared/host/author';
import { WorldAssembly, type WorldConstructionPorts } from '../src/client/game/shardfile/worldAssembly';
import { legacyDouble } from '@wildshard/engine/test/FakeGame';

const stages = { stages: ['orchard.sign', 'orchard.lamp'].map((id, index) => ({ kind: 'drawn-models', id,
  look: { painterly: { rim: 0.4 } }, models: [{ id: 'model', draw: `draw:${index}` }] })) };
function fixture() {
  const parent = new Scope('page'), native = parent.child('native'), scope = parent.child('construction');
  const events: string[] = [], copies: BufferGeometry[] = [];
  const sky = legacyDouble<SkyRig>({ csm: legacyDouble<SkyRig['csm']>({ lights: [] }), sunDir: new Vector3(0, 1, 0), setupMaterial: () => undefined });
  const gameSurface = { levelScope: native, scene: new Scene(), renderer: legacyDouble<WebGLRenderer>({}), tier: 'desktop' as const }, game = legacyDouble<Game>(gameSurface);
  const world = legacyDouble<ShardWorld>({ game, sky, player: legacyDouble<Player>({position: new Vector3()}),
    registry: new WorldRegistry(), physics: legacyDouble<Physics>({}) });
  const runtimeSurface = { world, viewer: () => new Vector3() }, runtime = legacyDouble<ShardRuntime>(runtimeSurface);
  const json = vi.fn(() => Promise.reject(new Error('Unexpected JSON read'))), file = vi.fn(() => Promise.reject(new Error('Unexpected file read')));
  const product = legacyDouble<ShardProduct>({json, file});
  const contextSurface = {scope, product, game: legacyDouble<ShardContext['game']>({runtime})}, ctx = legacyDouble<ShardContext>(contextSurface);
  let onCopy = (): void => undefined;
  const draws: FixedDraws = {ready: true, load: vi.fn(() => Promise.resolve()), handle: (slot: string) => {
    events.push(`handle:${slot}`);
    return legacyDouble<OwnedGeometry>({copy: () => {
      events.push(`copy:${slot}`);
      const geometry = new BufferGeometry().setAttribute('position', new BufferAttribute(new Float32Array([Number(slot.slice(-1)), 0, 0, 1, 0, 0, 0, 1, 0]), 3)).setIndex([0, 1, 2]);
      copies.push(geometry); onCopy(); return geometry;
    }});
  }};
  const progress = {set: vi.fn(), detail: vi.fn()}, ports: WorldConstructionPorts = {native: ctx, runtime, product, scope, draws, baked: new Map(), progress};
  return {parent, native, scope, sky, game, world, runtime, runtimeSurface, gameSurface, contextSurface, product, json, file, events, copies, draws, progress, ports,
    onCopy(fn: () => void) {onCopy = fn;} };
}
function models(f: ReturnType<typeof fixture>) {
  return stages.stages.map(stage => {
    const bank = entryOwner(f.scope, 'drawn-models', stage.id), group = bank.get('model'), mesh = group?.children[0];
    if (!(mesh instanceof Mesh)) throw new Error('Missing drawn model');
    const geometry: unknown = mesh.geometry, material: unknown = mesh.material;
    if (!(geometry instanceof BufferGeometry) || !(material instanceof Material)) throw new Error('Missing concrete drawn resources');
    const position: unknown = geometry.getAttribute('position');
    if (!(position instanceof BufferAttribute)) throw new Error('Missing concrete position buffer');
    return { names: [...bank.keys()], parent: group?.parent, position: Array.from(position.array), index: Array.from(geometry.getIndex()?.array ?? []),
      castShadow: mesh.castShadow, receiveShadow: mesh.receiveShadow, visible: mesh.visible, materialType: material.type };
  });
}

test('stage-only native construction matches the original ordered stage walk without reads, loads, progress or timers', async () => {
  const original = fixture(), current = fixture();
  try {
    const sliced = vi.fn(() => Promise.resolve());
    const old = WorldAssembly.admit(stages, {scope: original.scope, context: sharedModelContext(original.sky, original.game), registry: null, draws: original.draws, slice: sliced});
    for (const stage of stages.stages) await old.next(stage.id);
    expect(await WorldAssembly.construct(stages, current.ports)).toEqual({});
    expect(current.events).toEqual(original.events);
    expect(current.events).toEqual(['handle:draw:0', 'copy:draw:0', 'handle:draw:1', 'copy:draw:1']);
    expect(models(current)).toEqual(models(original));
    expect(current.json).not.toHaveBeenCalled(); expect(current.file).not.toHaveBeenCalled(); expect(current.draws.load).not.toHaveBeenCalled();
    expect(current.progress.set).not.toHaveBeenCalled(); expect(sliced).not.toHaveBeenCalled();
    const dispose = current.copies.map(geometry => vi.spyOn(geometry, 'dispose'));
    current.scope.dispose(); for (const spy of dispose) expect(spy).toHaveBeenCalledOnce();
  } finally { original.parent.dispose(); current.parent.dispose(); }
});

test.each(['construction', 'native'] as const)('a retired %s owner refuses before looking up any draw', async owner => {
  const f = fixture();
  try {
    f[owner === 'native' ? 'native' : 'scope'].dispose();
    await expect(WorldAssembly.construct(stages, f.ports)).rejects.toThrow('owner left or changed');
    expect(f.events).toEqual([]);
    expect(() => entryOwner(f.scope, 'drawn-models', stages.stages[0]?.id ?? '')).toThrow();
  } finally { f.parent.dispose(); }
});

test.each(['world', 'product', 'native-scope'] as const)('a replaced %s refuses before the next declared stage', async changed => {
  const f = fixture();
  try {
    f.onCopy(() => {
      if (changed === 'world') f.runtimeSurface.world = legacyDouble<ShardWorld>({});
      else if (changed === 'product') f.contextSurface.product = legacyDouble<ShardProduct>({});
      else f.gameSurface.levelScope = f.parent.child('foreign');
    });
    await expect(WorldAssembly.construct(stages, f.ports)).rejects.toThrow(/owners changed|owner left or changed/u);
    expect(f.events).toEqual(['handle:draw:0', 'copy:draw:0']);
    expect(() => entryOwner(f.scope, 'drawn-models', 'orchard.lamp')).toThrow();
  } finally { f.parent.dispose(); }
});

test('stage-only data admission refuses the whole malformed suffix before native allocation', async () => {
  const f = fixture();
  try {
    await expect(WorldAssembly.construct({stages: [...stages.stages, stages.stages[0]]}, f.ports)).rejects.toThrow();
    expect(f.events).toEqual([]); expect(f.progress.set).not.toHaveBeenCalled();
    const getter = vi.fn(() => stages.stages);
    await expect(WorldAssembly.construct({get stages() {return getter();}}, f.ports)).rejects.toThrow('plain JSON');
    expect(getter).not.toHaveBeenCalled();
  } finally { f.parent.dispose(); }
});

test('ancestor sliced retirement refuses while the construction child itself is still open', async () => {
  const f = fixture();
  f.parent.onDispose(() => undefined);
  const retirement = f.parent.disposeSteps();
  try {
    expect(retirement.next().done).toBe(false);
    expect(f.scope.disposed).toBe(false); expect(f.scope.disposing).toBe(true);
    await expect(WorldAssembly.construct(stages, f.ports)).rejects.toThrow('owner left or changed');
    expect(f.events).toEqual([]);
  } finally { for (const step of retirement) void step; }
});


const roomRows={stages:[{kind:'arena-room',mode:'room',id:'orchard.room',file:'combat/room.json',entrance:{part:'garden',anchor:'entrance'}}]};
function roomFixture(){
  const f=fixture(),ctx=f.ports.native;if(ctx===undefined)throw new Error('Missing native context');
  const source=emptyShardfile({slug:'orchard-room',name:'Room',author:'Fixture',revision:1,seed:1});
  const data={room:{id:'orchard.layout'},encounter:{definition:{id:'orchard.boss'},reward:'fruit',program:{id:'orchard.attack'}}};
  const bytes=new TextEncoder().encode(JSON.stringify(data)),reads:string[]=[];
  let afterRead=():void=>undefined;
  const product=createShardProduct({slug:source.identity.slug,revision:1,shardfile:source,sections:new Map(),
    files:new Map([['combat/room.json',{hash:'room',url:'/room'}]]),read:hash=>{reads.push(hash);afterRead();return Promise.resolve(bytes);}});
  // The native room builder is stubbed below: this fixture owns only its
  // minimal projection and the original byte/owner retirement boundary.
  vi.spyOn(product, 'json').mockImplementation(async name => {
    const value: unknown = JSON.parse(new TextDecoder('utf-8', {fatal:true}).decode(await product.file(name)));
    return value;
  });
  Object.assign(f.contextSurface,{product});
  const entrance={x:4,y:2,z:7,r:.8,facing:.6};
  const piece=legacyDouble<NonNullable<ReturnType<SceneDressing['pieces']['get']>>>({anchors:{entrance:[entrance]}});
  const dressing=legacyDouble<SceneDressing>({pieces:new Map([['garden',piece]])});
  const borrowed=vi.spyOn(SceneDressing,'current').mockReturnValue(dressing),group=new Group();
  // Promise resolution inspects this proxy; all actual class reads remain strict.
  const encounter=new Proxy(legacyDouble<ArenaRoomEncounter>({dungeon:legacyDouble<ArenaRoomEncounter['dungeon']>({group})}),{get(target,key,receiver):unknown{return key==='then'?undefined:Reflect.get(target,key,receiver);}});
  const build=vi.spyOn(arena,'buildArenaRoomEncounter').mockResolvedValue(encounter);
  return{...f,ctx,product,data,reads,entrance,encounter,group,build,borrowed,ports:{...f.ports,product},afterRead:(run:()=>void)=>{afterRead=run;}};
}

test('a room stage passes the original fight, draws and facing before publishing the same controller and group',async()=>{
  const f=roomFixture();
  try{
    await WorldAssembly.construct(roomRows,f.ports);
    expect(f.reads).toEqual(['room']);
    expect(f.build).toHaveBeenCalledTimes(1);const call=f.build.mock.calls[0];if(call===undefined)throw new Error('Missing room build');
    expect(call[1]).toBe(f.ctx);expect(call[2]).toEqual(f.data.room);
    expect(call[3]).toEqual(f.data.encounter);
    expect(call[4]).toBe(f.draws);expect(call[5]).toBe(f.entrance);
    expect(entryOwner(f.scope,'arena-room','orchard.room')).toBe(f.encounter);
    expect(entryOwner(f.scope,'object','orchard.room')).toBe(f.group);
    const entered=f.scope.child('room-entry');WorldAssembly.lend(roomRows,f.scope,entered);
    expect(entryOwner(entered,'arena-room','orchard.room')).toBe(f.encounter);
    expect(entryOwner(entered,'object','orchard.room')).toBe(f.group);
    await expect(WorldAssembly.construct(roomRows,f.ports)).rejects.toThrow('already published');
    expect(f.reads).toEqual(['room']);expect(f.build).toHaveBeenCalledTimes(1);
  }finally{f.build.mockRestore();f.borrowed.mockRestore();f.parent.dispose();}
});

test('room read replacement and sliced native retirement refuse before the original builder',async()=>{
  for(const change of ['world','owner'] as const){
    const f=roomFixture();
    try{
      f.afterRead(()=>{if(change==='world')Object.assign(f.runtimeSurface,{world:legacyDouble<ShardWorld>({})});else f.native.dispose();});
      await expect(WorldAssembly.construct(roomRows,f.ports)).rejects.toThrow('owner changed');
      expect(f.build).not.toHaveBeenCalled();expect(()=>entryOwner(f.scope,'arena-room','orchard.room')).toThrow('Missing live entry owner');
    }finally{f.build.mockRestore();f.borrowed.mockRestore();f.parent.dispose();}
  }
});

test('a changed borrowed piece refuses before its later stage publishes', async () => {
  const f = fixture();
  const piece = legacyDouble<NonNullable<ReturnType<SceneDressing['pieces']['get']>>>({ object: new Group() });
  const pieces = new Map([['garden', piece]]), dressing = legacyDouble<SceneDressing>({ pieces });
  const current = vi.spyOn(SceneDressing, 'current').mockReturnValue(dressing);
  f.onCopy(() => { pieces.set('garden', legacyDouble<typeof piece>({ object: new Group() })); });
  const input = { stages: [stages.stages[0], { kind: 'dressing-piece', id: 'borrowed.garden', part: 'garden' }] };
  try {
    await expect(WorldAssembly.construct(input, f.ports)).rejects.toThrow('World construction borrowed objects changed');
    expect(f.events).toEqual(['handle:draw:0', 'copy:draw:0']);
    expect(() => entryOwner(f.scope, 'object', 'borrowed.garden')).toThrow();
  } finally { current.mockRestore(); f.parent.dispose(); }
});
