import {expect,test} from 'vitest';
import {PhysicsRouteCursor} from '../src/shared/host/headlessJourney';

test('the native walk follows each segment in order and reverses without a shortcut',()=>{
  const cursor=new PhysicsRouteCursor([{x:0,z:0},{x:5,z:0},{x:5,z:5}]);
  expect(cursor.command([0,0,0],0)).toMatchObject({moveX:1,moveZ:0});
  expect(cursor.command([5,0,0],1)).toMatchObject({moveX:0,moveZ:1});
  expect(cursor.command([5,0,5],2)).toMatchObject({moveX:0,moveZ:-1});
  expect(cursor.command([5,0,0],3)).toMatchObject({moveX:-1,moveZ:0});
  expect(cursor.command([0,0,0],4)).toMatchObject({moveX:1,moveZ:0});
  expect(cursor.traversals).toBe(2);expect(cursor.stuck).toEqual([]);
});

test('a blocked waypoint is recorded after the original progress window, never skipped or teleported',()=>{
  const cursor=new PhysicsRouteCursor([{x:5,z:0},{x:10,z:0}]);
  for(let tick=0;tick<=240;tick++)expect(cursor.command([0,2,0],tick)).toMatchObject({moveX:1,moveZ:0});
  expect(cursor.visited).toBe(0);expect(cursor.stuck).toEqual([{tick:120,waypoint:0,x:0,y:2,z:0}]);
  expect(cursor.command([5,2,0],241)).toMatchObject({moveX:1,moveZ:0});expect(cursor.visited).toBe(1);
});

test('jump commands are presses, with the second press near the first apex',()=>{
  const cursor=new PhysicsRouteCursor([{x:1,z:0,jump:2},{x:6,z:0}]);
  expect(cursor.command([0,0,0],0).jump).toBe(true);
  expect(cursor.command([0,1,0],1).jump).toBeUndefined();
  expect(cursor.command([0,1,0],7).jump).toBe(true);
  expect(cursor.command([0,1,0],8).jump).toBeUndefined();
  expect(cursor.command([1,0,0],9).jump).toBeUndefined();
});

test('malformed route and committed feet refuse before issuing movement',()=>{
  expect(()=>new PhysicsRouteCursor([])).toThrow('two finite');
  expect(()=>new PhysicsRouteCursor([{x:0,z:0},{x:Infinity,z:0}])).toThrow('two finite');
  const cursor=new PhysicsRouteCursor([{x:0,z:0},{x:5,z:0}]);
  expect(()=>cursor.command([Number.NaN,0,0],0)).toThrow('walk feet');
  expect(cursor.visited).toBe(0);expect(cursor.stuck).toEqual([]);
});


test('one-way route ends at its final waypoint without inventing a reverse walk',()=>{
  const cursor=new PhysicsRouteCursor([{x:0,z:0},{x:5,z:0}],{once:true});
  cursor.command([0,0,0],0);cursor.command([5,0,0],1);
  expect(cursor.complete).toBe(true);expect(cursor.visited).toBe(2);
  expect(cursor.command([5,0,0],2)).toMatchObject({moveX:0,moveZ:0});
});

test('only declared escape legs advance a held edge and still report any bounds escape separately',()=>{
  const edge=new PhysicsRouteCursor([{x:5,z:0},{x:10,z:0}],{once:true,edge:true});
  for(let tick=0;tick<150;tick++)edge.command([0,0,0],tick);
  expect(edge.complete).toBe(true);expect(edge.stuck).toEqual([]);
  const ordinary=new PhysicsRouteCursor([{x:5,z:0},{x:10,z:0}],{once:true});
  for(let tick=0;tick<150;tick++)ordinary.command([0,0,0],tick);
  expect(ordinary.complete).toBe(false);expect(ordinary.visited).toBe(0);expect(ordinary.stuck).toHaveLength(1);
});
