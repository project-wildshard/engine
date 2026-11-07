import { expect,test,vi } from 'vitest';
import * as v from 'valibot';
import { CharacterMotor } from '../src/shared/engine/physics/CharacterMotor';
import { SkinnedMesh } from 'three';
import { SpawnScript,installNativeSpawnScript } from '../src/server/game/population/spawnScript';
import { installPopulationRoster } from '../src/server/game/population/roster';
import { bakeSpecies } from '../src/sharddev/bake/species';
import { BOAR } from '../src/client/game/systems/species/boar';
import { createSimHost } from '../src/server/engine/sim';
import { loadRapier } from '../src/shared/engine/physics/rapier';
import { fixtureBytes } from '@wildshard/engine/test/nativeBytes';
import { SIM_LEVEL } from './fixtures/sim-level/level';
import { flatPopulationEnvironment } from './fixtures/population-environment';
import { readSpeciesPrograms } from '@wildshard/format/speciesPrograms';
import { parseSpawnScript } from '@wildshard/format/spawnScripts';
import { SpawnInputV2Schema } from '@wildshard/format/spawnScriptV2';
import { SCRIPT_V2_REVISIONS } from '@wildshard/format/scriptAdmissionV2';
import { layoutV2 } from '@wildshard/format/scriptWireV2';
import { compileScript } from '../src/sharddev/bake/compileScript';
import { compileSimV2 } from '../src/sharddev/test/compileSimV2';
import { sha256 } from '../src/shared/game/plugin/moduleHash';
import { legacyDouble } from '@wildshard/engine/test/FakeGame';
import type { Animal } from '../src/client/engine/entities/AnimalView';
import type { AnimalManager } from '../src/server/engine/entities/AnimalManager';
import type { V2QueryWorld } from '../src/shared/engine/physics/queryBatchV2';

const capacities = [...new Map([[1,1],[2,2],[3,2],[5,1],[6,1],[7,1],[9,32],[10,32],[11,2],[12,2],[13,4],[21,1],[22,1]])].map(([kind,capacity]) => ({ kind,capacity }));
const layout = layoutV2(2048,1,new Map(capacities.map(row => [row.kind,row.capacity])));
let compiled: ReturnType<typeof programs> | undefined;
async function programs() {
  const old = await compileScript(`export function ws_abi():i32{return 1;}export function ws_io():i32{return 16384;}
export function ws_init(lo:i32,hi:i32):void{}export function ws_handle():i32{return 0;}`,{ abi: 1 });
  const modern = await compileSimV2(`import * as ws from './sdk/as/wsV2';export function onBinding():void{
    const n=ws.state(0)+1;ws.setState(0,n);
    for(let i=0;i<ws.count(12);i++)if(ws.replyBinding(i)==ws.handle()&&ws.replyStatus(i)==1){ws.setState(1,ws.replyValue(i,4));ws.actorCommand(13,0,1,ws.replyValue(i,0),0);}
    ws.query(10,u32(n),0,0,0,0,10,7,0,0);
  }`,{ io: 2048,ioBytes: layout.bytes });
  return parseSpawnScript({ step: 'watch',roster: 'fixture.roster',seed: 3,maximum: 2,controlState: 'sidestep',bytes: btoa(String.fromCodePoint(...old)),
    slots: [{ id: 'first',handle: 1,authority: 'observe' },{ id: 'second',handle: 2,authority: 'observe' }],species: [{ id: 'boar',kind: 'boar',variant: 'boar' }],
    sites: [{ id: 'first',slot: 'first',point: [3,4],face: 'player' },{ id: 'second',slot: 'second',point: [1,0],face: 'player' }],spawns: [{ id: 'first',species: 'boar',site: 'first' },{ id: 'second',species: 'boar',site: 'second' }],
    fields: [],flags: [],cues: [],channels: ['nearest'],moves: [],script: { id: 'watch',abi: '1.0',side: 'sim',module: `blobs/wasm/${sha256(old)}.wasm`,source: 'behaviour/query.as',binding: { shard: true },pages: 1,onFail: 'hold',tick: 10,on: ['tick'],reads: [],commands: ['channel'],stateVersion: 1,
      state: [{ name: 'calls',type: 'i32',default: 0,scope: 'binding',min: 0,max: 100 },{ name: 'distance',type: 'f64',default: -1,scope: 'binding',min: -1,max: 100 }],params: {},actors: { first: 'first',second: 'second' },channels: { nearest: 'nearest' } },
    v2: { version: 1,artifact: { abi: 2,minor: SCRIPT_V2_REVISIONS.minor,compilerRevision: SCRIPT_V2_REVISIONS.compiler,admissionRevision: SCRIPT_V2_REVISIONS.admission,hash: sha256(modern),lane: 'sim',pages: 1,ioBytes: layout.bytes },bytes: btoa(String.fromCodePoint(...modern)),io: 2048,capacities,divisor: 6,fuel: 100000,initFuel: 10000,self: 'first',columns: [],queries: { pending: 1,operations: [{ op: 10,scalars: 0 }] } } });
}
async function fixture() {
  compiled ??= programs();const rows = await compiled;
  const rapier = await loadRapier(Uint8Array.from(fixtureBytes(new URL('../public/assets/physics/rapier.wasm',import.meta.url))));
  const host = createSimHost({ ...SIM_LEVEL,quests: [],entities: [] },{ rapier });
  const sample = SIM_LEVEL.entities[0];if (sample === undefined) throw new Error('Missing native recipe');
  flatPopulationEnvironment(host);
  const population = readSpeciesPrograms({ page: [],native: [bakeSpecies(BOAR,'fixture.boar')],hunt: { limit: 32,player: 'host',fight: {},bands: { states: [],legacyKinds: [] },hit: { namespace: 'fixture',tags: [] } } });
  const roster = installPopulationRoster(host,{ population,nav: null,spawnY: 0,bake: { actors: [],parked: [{ ...sample,kind: 'boar',variant: 'boar' }],herds: [] } },{
    version: 1,environment: 'fixture.habitat',step: 'fixture.roster',seed: 13,bodyCount: 0,limit: 32,scripted: 'sidestep',encounter: 'test',poseKinds: [],spawn: { x: 0,z: 0 },fauna: [],identities: [],ordinary: {},reserves: [],homes: [] });
  const first = roster.spawn('boar',3,4,0,'boar'),second = roster.spawn('boar',1,0,0,'boar');
  const actors = [first,second],world: V2QueryWorld = { physics: host.physics,navmesh: null,bodies: new Map(),sees: ['WORLD'],as: 'PLAYER',rosters: new Map([[7,actors]]) },queries = { worlds: new Map([[1,world]]) };
  const animals = legacyDouble<AnimalManager>({ animals: actors.map(actor => { const motor = actor.motor;if (motor !== null && !(motor instanceof CharacterMotor)) throw new Error('Expected original native motor');return legacyDouble<Animal>(Object.assign(actor,{ motor,mesh: new SkinnedMesh() })); }) });
  const pageQueries = { worlds: new Map([[1,{ ...world,rosters: new Map([[7,animals.animals]]) }]]) };
  return { rows,host,first,second,actors,world,queries,pageQueries,animals,owners: { scope: host.scope } };
}
function input(runner: SpawnScript) { return v.parse(v.object({ v2Input: SpawnInputV2Schema }),JSON.parse(runner.snapshot())).v2Input; }

test('PAGE production runner resolves actual ordered actors after bodies and stores replies in its original envelope', async () => {
  const f = await fixture();try {
    const runner = SpawnScript.page(f.animals,f.rows,f.host.physics,f.owners,undefined,undefined,f.pageQueries);runner.adopt('first',f.first.entityId);runner.adopt('second',f.second.entityId);
    runner.frame({ x: 0,y: 0,z: 0 },0,{});const rng = f.host.rng.snapshot(),body = { scripted: f.first.scripted,herd: f.first.herd };
    for (let tick = 1; tick <= 6; tick++) runner.advanceFrame(1/60);
    const pending = runner.snapshot();expect(input(runner).queries?.entries[0]?.reply).toBeNull();expect(runner.channel(1)).toBe(0);
    f.first.position.set(20,0,0);f.second.position.set(4,0,0);SpawnScript.answerQueries([runner]);
    expect(input(runner).queries?.entries[0]?.reply?.answer).toEqual({ status: 1,kind: 'nearest',actor: { id: f.second.entityId,point: [4,0,0],distance: 4 } });
    const ready = runner.snapshot(),instantiate = vi.spyOn(WebAssembly,'Instance');
    try { runner.prepareRestore(ready)();expect(runner.snapshot()).toBe(ready);expect(instantiate).not.toHaveBeenCalled(); } finally { instantiate.mockRestore(); }
    for (let tick = 7; tick <= 13; tick++) { runner.advanceFrame(1/60);SpawnScript.answerQueries([runner]); }
    expect(runner.channel(1)).toBe(2);expect(runner.host.state(1)).toEqual({ calls: 2,distance: 4 });expect(f.host.rng.snapshot()).toEqual(rng);
    expect(f.first.scripted).toBe(body.scripted);expect(f.first.herd).toBe(body.herd);
    runner.prepareRestore(pending)();expect(runner.snapshot()).toBe(pending);expect(input(runner).queries?.entries[0]?.reply).toBeNull();
  } finally { f.host.dispose(); }
});

test('native installation uses one original afterBodies callback and no second save adapter', async () => {
  const f = await fixture();try {
    const runner = installNativeSpawnScript(f.host,{ night: 0 },f.rows,f.owners,undefined,f.queries);runner.adopt('first',f.first.entityId);runner.adopt('second',f.second.entityId);
    f.host.onStep('fixture.after-bodies',() => { f.first.position.set(20,0,0);f.second.position.set(4,0,0); },undefined,'afterBodies');
    const adapters = [...f.host.adapters.keys()],remove = SpawnScript.installQueries(f.host,[runner]);
    expect([...f.host.adapters.keys()]).toEqual(adapters);expect(() => SpawnScript.installQueries(f.host,[runner])).toThrow('registration');
    for (let tick = 1; tick <= 13; tick++) f.host.advance(1/60);
    expect(runner.channel(1)).toBe(2);expect(runner.host.state(1)).toEqual({ calls: 2,distance: 4 });expect(runner.body('first')).toBe(f.first);
    const saved = runner.snapshot();runner.prepareRestore(saved)();expect(runner.snapshot()).toBe(saved);remove();expect(f.host.hasStep('script.v2.queries')).toBe(false);
  } finally { f.host.dispose(); }
});

test('admission rejects missing rights, duplicate operations and incomplete fixed-memory banks', async () => {
  compiled ??= programs();const rows = await compiled;if (rows.v2 === undefined) throw new Error('No modern fixture');
  for (const queries of [{ pending: 0,operations: [{ op: 10,scalars: 0 }] },{ pending: 1,operations: [{ op: 10,scalars: 0 },{ op: 10,scalars: 0 }] },{ pending: 3,operations: [{ op: 10,scalars: 0 }] },{ pending: 1,operations: [{ op: 8,scalars: 3 }] }]) {
    expect(() => parseSpawnScript({ ...rows,v2: { ...rows.v2,queries } })).toThrow();
  }
  const f = await fixture();try {
    expect(() => SpawnScript.page(f.animals,f.rows,f.host.physics,f.owners)).toThrow('query world');
    expect(() => SpawnScript.page(f.animals,f.rows,null,f.owners,undefined,undefined,f.queries)).toThrow('query world');
    const instantiate = vi.spyOn(WebAssembly,'Instance');
    try { expect(() => SpawnScript.page(f.animals,f.rows,f.host.physics,f.owners,undefined,undefined,{ worlds: new Map([[2,f.world]]) })).toThrow('binding');expect(instantiate).not.toHaveBeenCalled(); } finally { instantiate.mockRestore(); }
    const runner = SpawnScript.page(f.animals,f.rows,f.host.physics,f.owners,undefined,undefined,f.pageQueries);
    expect(() => SpawnScript.installQueries(f.host,[runner])).toThrow('owner');
    expect(() => SpawnScript.answerQueries([runner,runner])).toThrow('Duplicate');
    f.host.dispose();expect(() => SpawnScript.answerQueries([runner])).toThrow('Retired');
  } finally { f.host.dispose(); }
});


test('an original v1 continuation imports with an empty query ring and no guest or query replay', async () => {
  const f = await fixture();try {
    const { v2,...original } = f.rows,slots = original.slots.map(slot => ({ id: slot.id,handle: slot.handle }));
    const old = SpawnScript.page(f.animals,{ ...original,slots },f.host.physics);
    for (let tick = 1; tick <= 5; tick++) old.advance(1/60,{ x: 0,y: 0,z: 0 },0,2,[]);
    const saved = old.snapshot(),modern = SpawnScript.page(f.animals,{ ...original,slots,v2 },f.host.physics,f.owners,undefined,undefined,f.pageQueries);
    const instantiate = vi.spyOn(WebAssembly,'Instance');
    try { modern.prepareRestore(saved)();expect(instantiate).not.toHaveBeenCalled(); } finally { instantiate.mockRestore(); }
    expect(input(modern).queries?.entries).toEqual([]);expect(input(modern).queries?.highWater).toEqual([{ binding: '1',id: 0 }]);
    const resumed = modern.snapshot();modern.prepareRestore(resumed)();expect(modern.snapshot()).toBe(resumed);
  } finally { f.host.dispose(); }
});

test('idle query phases leave borrowed native rosters unread', async () => {
  const f = await fixture();try {
    const runner = SpawnScript.page(f.animals,f.rows,f.host.physics,f.owners,undefined,undefined,f.pageQueries);
    const roster = f.pageQueries.worlds.get(1)?.rosters.get(7);
    if (roster === undefined) throw new Error('Missing borrowed roster');
    const iterate = vi.spyOn(roster,Symbol.iterator);
    SpawnScript.answerQueries([runner]);
    expect(iterate).not.toHaveBeenCalled();expect(input(runner).queries?.entries).toEqual([]);
  } finally { f.host.dispose(); }
});

test('a foreign requested roster suffix leaves the complete module reply batch unpublished', async () => {
  const f = await fixture();try {
    const valid = SpawnScript.page(f.animals,f.rows,f.host.physics,f.owners,undefined,undefined,f.pageQueries);
    const foreign = SpawnScript.page(f.animals,{ ...f.rows,step: 'foreign' },f.host.physics,f.owners,undefined,undefined,f.queries);
    for (const runner of [valid,foreign]) {
      runner.adopt('first',f.first.entityId);runner.adopt('second',f.second.entityId);
      for (let tick = 1; tick <= 6; tick++) runner.advanceFrame(1/60);
    }
    const before = [valid.snapshot(),foreign.snapshot()];
    expect(() => SpawnScript.answerQueries([valid,foreign])).toThrow('Foreign query roster actor');
    expect([valid.snapshot(),foreign.snapshot()]).toEqual(before);
    expect(input(valid).queries?.entries[0]?.reply).toBeNull();
  } finally { f.host.dispose(); }
});
