import { expect,test } from 'vitest';
import { Vector3 } from 'three';
import { fixtureBytes } from '@wildshard/engine/test/nativeBytes';
import { loadRapier } from './rapier';
import { Physics } from './Physics';
import { groups } from './groups';
import { resolvePhysicsQueriesV2,type V2QueryWorld } from './queryBatchV2';
import type { V2QueryRequest } from '@wildshard/format/scriptQueriesV2';

async function world(top = 0) {
  const R = await loadRapier(Uint8Array.from(fixtureBytes(new URL('../../../../public/assets/physics/rapier.wasm',import.meta.url)))), physics = new Physics(R);
  const floor = physics.world.createCollider(R.ColliderDesc.cuboid(10,.5,10).setTranslation(0,top-.5,0).setCollisionGroups(groups('WORLD')));
  const upper = physics.world.createCollider(R.ColliderDesc.cuboid(.5,.5,.5).setTranslation(0,top+14,0).setCollisionGroups(groups('WORLD')));
  const lower = physics.world.createCollider(R.ColliderDesc.cuboid(.5,.5,.5).setTranslation(0,top+12,0).setCollisionGroups(groups('WORLD')));
  physics.world.createCollider(R.ColliderDesc.cuboid(.2,.2,.2).setTranslation(1,top+13,0).setCollisionGroups(groups('WORLD')));
  physics.step();
  const rows: V2QueryWorld = { physics,navmesh: null,bodies: new Map([['floor',[floor]],['compound',[upper,lower]]]),sees: ['WORLD'],as: 'PLAYER' };
  return { physics,floor,rows };
}
function request(changes: Partial<V2QueryRequest> = {}): V2QueryRequest { return { binding: 'actor',id: 1,op: 8,target: 'compound',atTick: 0,values: [0,20,0,0,-1,0,30],...changes }; }
test('real native rays exclude every compound collider and keep worlds and stable hit identities separate', async () => {
  const a = await world(), b = await world(10);
  try {
    const worlds = new Map([['a',new Map([['actor',a.rows]])],['b',new Map([['actor',b.rows]])]]);
    const answers = resolvePhysicsQueriesV2([{ module: 'a',request: request() },{ module: 'b',request: request({ values: [0,30,0,0,-1,0,40] }) },{ module: 'a',request: request({ target: null }) }],worlds);
    expect(answers[0]).toMatchObject({ status: 1,kind: 'ray',hit: { point: [0,0,0],distance: 20,body: 'floor' } });
    expect(answers[1]).toMatchObject({ status: 1,kind: 'ray',hit: { point: [0,10,0],distance: 20,body: 'floor' } });
    expect(answers[2]).toMatchObject({ status: 1,kind: 'ray',hit: { distance: 5.5,body: 'compound' } });
    const foreign = { ...a.rows,bodies: new Map([['wrong-world',[b.floor]]]) };
    expect(resolvePhysicsQueriesV2([{ module: 'a',request: request({ target: 'wrong-world' }) }],new Map([['a',new Map([['actor',foreign]])]]))).toEqual([{ status: 2 }]);
  } finally { a.physics.dispose();b.physics.dispose(); }
});
test('overlaps dedupe compound hits, omit unobserved bodies and retain the same exclusion scope', async () => {
  const a = await world();
  try {
    const worlds = new Map([['a',new Map([['actor',a.rows]])]]), overlap = request({ op: 9,target: null,values: [0,13,0,2,0,0,0] });
    expect(resolvePhysicsQueriesV2([{ module: 'a',request: overlap }],worlds)).toEqual([{ status: 1,kind: 'overlap',bodies: ['compound'] }]);
    expect(resolvePhysicsQueriesV2([{ module: 'a',request: { ...overlap,target: 'compound' } }],worlds)).toEqual([{ status: 1,kind: 'overlap',bodies: [] }]);
    expect(resolvePhysicsQueriesV2([{ module: 'a',request: request({ values: [Number.MAX_VALUE,20,0,0,-1,0,30] }) }],worlds)).toEqual([{ status: 3 }]);
    expect(resolvePhysicsQueriesV2([{ module: 'a',request: request({ op: 9,target: null,values: [0,13,0,Number.MIN_VALUE,0,0,0] }) }],worlds)).toEqual([{ status: 3 }]);
  } finally { a.physics.dispose(); }
});
test('navigation forwards native coordinates/radius only to the explicitly lent mesh and never falls back to a page', async () => {
  const a = await world(), seen: number[][] = [];
  try {
    const rows: V2QueryWorld = { ...a.rows,navmesh: {
      closestWalkable: (point,radius) => { seen.push([point.x,point.y,point.z,Number(radius)]);return new Vector3(point.x,7,point.z); },
      findPath: (from,to,radius) => { seen.push([from.x,from.y,from.z,to.x,to.y,to.z,radius]);return [new Vector3(from.x,from.y,from.z),new Vector3(to.x,to.y,to.z)]; },
    } };
    const worlds = new Map([['a',new Map([['actor',rows]])]]);
    const walk = request({ op: 4,target: null,values: [1,2,3,.5,0,0,0] }), path = request({ op: 5,target: null,values: [1,2,3,4,5,6,.75] });
    expect(resolvePhysicsQueriesV2([{ module: 'a',request: walk },{ module: 'a',request: path }],worlds)).toEqual([{ status: 1,kind: 'walkable',point: [1,7,3] },{ status: 1,kind: 'path',points: [[1,2,3],[4,5,6]] }]);
    expect(seen).toEqual([[1,2,3,.5],[1,2,3,4,5,6,.75]]);
    expect(resolvePhysicsQueriesV2([{ module: 'a',request: walk }],new Map([['a',new Map([['actor',a.rows]])]]))).toEqual([{ status: 2 }]);
    expect(resolvePhysicsQueriesV2([{ module: 'missing',request: walk }],worlds)).toEqual([{ status: 3 }]);
  } finally { a.physics.dispose(); }
});
