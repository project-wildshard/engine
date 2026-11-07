import { expect,test } from 'vitest';
import { createSimHost } from '../src/server/engine/sim';
import { loadRapier } from '../src/shared/engine/physics/rapier';
import { lineOfSight } from '../src/shared/engine/physics/query';
import { groups } from '../src/shared/engine/physics/groups';
import { resolvePhysicsQueriesV2,type V2QueryWorld } from '../src/shared/engine/physics/queryBatchV2';
import { QueryRingV2,answerV2QueryBatch } from '../src/server/engine/script/queriesV2';
import { SimBatchV2 } from '../src/server/engine/script/simBatchV2';
import { compileSimV2 } from '../src/sharddev/test/compileSimV2';
import { layoutV2 } from '@wildshard/format/scriptWireV2';
import { prepareV2QueryReplies,validateV2QueryRequest,type V2QueryBinding,type V2QueryOperation,type V2QueryRequest } from '@wildshard/format/scriptQueriesV2';
import { fixtureBytes } from '@wildshard/engine/test/nativeBytes';
import { SIM_LEVEL } from './fixtures/sim-level/level';

async function nativeWorld() {
  const rapier = await loadRapier(Uint8Array.from(fixtureBytes(new URL('../public/assets/physics/rapier.wasm',import.meta.url))));
  const source = SIM_LEVEL.entities[0];if (source === undefined) throw new Error('Missing native species fixture');
  const entities = [];for (const id of ['z-first','a-second','dead','boundary']) entities.push({ ...source,id });
  const host = createSimHost({ ...SIM_LEVEL,quests: [],entities },{ rapier });
  const roster = [...host.entities.values()];const [first,second,dead,boundary] = roster;
  if (first === undefined || second === undefined || dead === undefined || boundary === undefined) throw new Error('Missing native roster');
  first.position.set(0,1000,1);second.position.set(1,-1000,0);dead.position.set(0,0,0);dead.alive = false;boundary.position.set(0,0,2);
  const rows: V2QueryWorld = { physics: host.physics,navmesh: null,bodies: new Map(),sees: ['WORLD'],as: 'PLAYER',rosters: new Map([[7,roster]]) };
  return { host,roster,first,second,dead,boundary,rows };
}
function nearest(changes: Partial<V2QueryRequest> = {}): V2QueryRequest {
  return { binding: 'wildlife',id: 1,op: 10,target: null,atTick: 0,values: [0,0,0,2,7,0,0],...changes };
}
function sight(values: V2QueryRequest['values']): V2QueryRequest { return { ...nearest(),id: 2,op: 11,values }; }

test('nearest borrows actual live actors, horizontal strict radius and original roster ties, without self exclusion or body/RNG changes', async () => {
  const w = await nativeWorld();
  try {
    const rng = w.host.rng.snapshot(), positions = w.roster.map(actor => actor.position.toArray()), secondAt = w.second.position.clone();
    const worlds = new Map([['sim',new Map([['wildlife',w.rows]])]]), resolve = (request = nearest()) => resolvePhysicsQueriesV2([{ module: 'sim',request }],worlds);
    expect(resolve()).toEqual([{ status: 1,kind: 'nearest',actor: { id: 'z-first',point: [0,1000,1],distance: 1 } }]);
    expect(resolve(nearest({ values: [0,0,0,1,7,0,0] }))).toEqual([{ status: 1,kind: 'nearest',actor: null }]);
    expect(resolve(nearest({ values: [0,0,0,0,7,0,0] }))).toEqual([{ status: 1,kind: 'nearest',actor: null }]);
    // Later decision slots must see native liveness changes, with no resampling cache.
    w.first.alive = false;expect(resolve()).toMatchObject([{ actor: { id: 'a-second' } }]);
    w.second.position.set(0,0,0);expect(resolve()).toMatchObject([{ actor: { id: 'a-second',distance: 0 } }]);
    w.second.position.copy(secondAt);expect(w.host.rng.snapshot()).toEqual(rng);expect(w.roster.map(actor => actor.position.toArray())).toEqual(positions);expect(w.host.state.tick).toBe(0);
    expect(resolve(nearest({ values: [0,0,0,2,8,0,0] }))).toEqual([{ status: 3 }]);
    expect(resolvePhysicsQueriesV2([{ module: 'other',request: nearest() }],worlds)).toEqual([{ status: 3 }]);
    const duplicate = { ...w.rows,rosters: new Map([[7,[w.first,w.first]]]) };
    expect(() => resolvePhysicsQueriesV2([{ module: 'sim',request: nearest() }],new Map([['sim',new Map([['wildlife',duplicate]])]]))).toThrow('roster');
  } finally { w.host.dispose(); }
});

test('deferred point sight uses the actual WORLD/sensor/slack law and does not replace native reach/contact', async () => {
  const w = await nativeWorld();
  try {
    const { physics } = w.host, R = physics.R;
    const blocker = physics.world.createCollider(R.ColliderDesc.cuboid(.1,1,1).setTranslation(2,2,0).setCollisionGroups(groups('WORLD')));
    physics.world.createCollider(R.ColliderDesc.cuboid(.1,1,1).setTranslation(1,2,0).setSensor(true).setCollisionGroups(groups('WORLD')));
    physics.step();
    const worlds = new Map([['sim',new Map([['wildlife',w.rows]])]]);
    for (const values of [[0,2,0,4,2,0,.3],[0,2,0,4,2,0,2.2],[0,4,0,4,4,0,.3],[0,2,0,0,2,0,.3]] as const) {
      const [x,y,z,tx,ty,tz,slack] = values;
      expect(resolvePhysicsQueriesV2([{ module: 'sim',request: sight(values) }],worlds)).toEqual([{ status: 1,kind: 'sight',visible: lineOfSight(physics,{ x,y,z },{ x: tx,y: ty,z: tz },slack) }]);
    }
    expect(resolvePhysicsQueriesV2([{ module: 'sim',request: sight([0,2,0,4,2,0,.3]) }],worlds)).toEqual([{ status: 1,kind: 'sight',visible: false }]);
    physics.world.removeCollider(blocker,true);physics.step();
    expect(resolvePhysicsQueriesV2([{ module: 'sim',request: sight([0,2,0,4,2,0,.3]) }],worlds)).toEqual([{ status: 1,kind: 'sight',visible: true }]);
    expect(resolvePhysicsQueriesV2([{ module: 'sim',request: sight([Number.MAX_VALUE,0,0,0,0,0,.3]) }],worlds)).toEqual([{ status: 3 }]);
  } finally { w.host.dispose(); }
});

const layout = layoutV2(1024,1,new Map([[1,1],[2,2],[3,2],[5,1],[11,2],[12,2],[13,0]]));
const operations = new Set<V2QueryOperation>([10,11]);
const binding: V2QueryBinding = { identity: 'wildlife',handle: 1,observed: new Map([[4,'z-first'],[9,'a-second']]),operations };
const rights = new Map([['wildlife',{ pending: 2,operations: new Map<V2QueryOperation,number>([[10,0],[11,0]]) }]]);
function observations(tick: number,state: readonly number[]) {
  return { bindings: [{ identity: 'wildlife',handle: 1,self: 4,player: 0,observed: new Set([4,9]),enabled: true,due: true,divisor: 6 as const,fuel: 10000,previousTick: Math.max(0,tick-6),currentTick: tick,state,parameters: [],fields: [],sample: { atTick: tick,target: 0 } }],players: [],edges: [],events: [],actions: new Set<number>(),eventKinds: new Set<number>() };
}
const program = `import * as ws from './sdk/as/wsV2';export function onBinding():void{
if(ws.state(0)==0&&ws.count(12)==0){ws.query(10,1,0,0,0,0,2,7);ws.query(11,2,0,0,4,0,4,4,0,.3);}
for(let i=0;i<ws.count(12);i++){if(ws.replyBinding(i)!=ws.handle()||ws.replyStatus(i)!=1)continue;
if(ws.replyId(i)==1)ws.setState(0,ws.replyValue(i,0));else ws.setState(1,ws.replyValue(i,0));}}`;

test('real AS requests answer only after bodies; saved stable results remap and commit at the next eligible entry', async () => {
  const w = await nativeWorld();
  try {
    const state = [0,-1], ring = new QueryRingV2(layout,rights), region = layout.regions[2];if (region === undefined) throw new Error('Missing state region');
    const lane = new SimBatchV2(await compileSimV2(program,{ io: 1024,ioBytes: layout.bytes }),{ layout,ordinal: 0,handle: 1,divisor: 6,bindings: [{ identity: 'wildlife',handle: 1 }],fuel: 100000,initFuel: 10000,seed: [1,2],output: [{ offset: layout.io+region.offset,count: 2,width: 8 }] });
    const byHandle = new Map([[1,binding]]), byName = new Map([['wildlife',binding]]), due = new Set(['wildlife']);let queries = ring,calls = 0;
    for (let tick = 0; tick <= 7; tick++) {
      let delivery: ReturnType<QueryRingV2['delivery']> | undefined;
      lane.advance(tick,() => { delivery = queries.delivery(tick,byName,due);return { observations: observations(tick,state),extra: delivery.banks }; },candidate => {
        if (delivery === undefined) throw new Error('Missing query delivery');
        const next = [candidate.view.getFloat64(layout.io+region.offset,true),candidate.view.getFloat64(layout.io+region.offset+8,true)];
        return { accept: queries.prepareFrame(candidate.view,candidate.counts[10] ?? 0,tick,byHandle,delivery.consumed,candidate.excluded),commit: () => { state.splice(0,2,...next); } };
      });
      if (tick === 0) {
        expect(calls).toBe(0);expect(queries.snapshot().entries).toHaveLength(2);
        const saved = queries.snapshot();queries = new QueryRingV2(layout,rights);queries.restore(saved,new Map([['wildlife',new Set(['z-first','a-second'])]]));
      }
      answerV2QueryBatch([{ identity: 'sim',ring: queries }],tick,requests => { calls++;return resolvePhysicsQueriesV2(requests,new Map([['sim',new Map([['wildlife',w.rows]])]])); });
      if (tick === 0) {
        expect(queries.delivery(0,byName,due).consumed).toEqual([]);
        const saved = queries.snapshot(), copy = new QueryRingV2(layout,rights);copy.restore(saved,new Map([['wildlife',new Set(['z-first','a-second'])]]));expect(copy.snapshot()).toEqual(saved);queries = copy;
        const remapped = { ...binding,observed: new Map([[17,'z-first'],[43,'a-second']]) }, banks = queries.delivery(6,new Map([['wildlife',remapped]]),due).banks, inline = banks[0];
        if (inline === undefined) throw new Error('Missing result bank');expect(new DataView(inline.bytes.buffer).getFloat64(24,true)).toBe(17);
        expect(banks[1]?.count).toBe(0);expect(state).toEqual([0,-1]);
        w.first.position.set(99,99,99);expect(queries.snapshot().entries[0]?.reply?.answer).toEqual({ status: 1,kind: 'nearest',actor: { id: 'z-first',point: [0,1000,1],distance: 1 } });
      }
      if (tick === 6) expect(state).toEqual([0,-1]);
    }
    expect(calls).toBe(1);expect(state).toEqual([4,1]);expect(queries.snapshot().entries).toEqual([]);
  } finally { w.host.dispose(); }
});

test('new query arguments and stale result identities refuse before any reply publication', () => {
  for (const request of [nearest({ target: 'z-first' }),nearest({ values: [0,0,0,-1,7,0,0] }),nearest({ values: [0,0,0,1,0,0,0] }),nearest({ values: [0,0,0,1,1.5,0,0] }),nearest({ values: [0,0,0,1,7,1,0] }),sight([0,0,0,1,0,0,-.1])]) expect(() => validateV2QueryRequest(request)).toThrow();
  const answer = { status: 1 as const,kind: 'nearest' as const,actor: { id: 'stale',point: [0,0,0] as const,distance: 0 } };
  expect(() => prepareV2QueryReplies(layout,1,[{ request: nearest(),atTick: 0,answer }],new Map([['wildlife',binding]]))).toThrow('Stale');
  expect(() => prepareV2QueryReplies(layout,1,[{ request: nearest(),atTick: 0,answer: { ...answer,actor: { ...answer.actor,id: 'z-first',distance: 2 } } }],new Map([['wildlife',binding]]))).toThrow('nearest');
  expect(() => prepareV2QueryReplies(layout,1,[{ request: nearest(),atTick: 0,answer }],new Map([['wildlife',{ ...binding,operations: new Set<V2QueryOperation>([11]) }]]))).toThrow('identity');
});
