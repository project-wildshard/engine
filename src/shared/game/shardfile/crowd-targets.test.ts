import { expect, test } from 'vitest';
import { Vector3 } from 'three';
import { FlockBrain } from '@wildshard/engine/ai/flock';
import { CrowdRoster, CrowdTargets, CrowdWeaponTarget } from './crowdRuntime';

test('an orchard deer crowd supplies prey and authored hit spheres without a renderer', () => {
  const brain = new FlockBrain({ heightAt: () => 0, normalY: () => 1, inBounds: () => true, wetAt: () => false,
    playerCrouched: () => false, grassHeightAt: () => .2, trample: () => undefined, centre: () => undefined },
  { x: 20, z: -30, count: 3, seed: 9, range: 25, runSpeed: 6, walkSpeed: 1.2, grazeStep: .3, bleatCue: 'deer.call' });
  brain.initialize();
  const targets = new CrowdTargets(brain, { preyY: 1.4, hits: [[0, 1.4, .65]] });
  const crowds = [targets], roster = new CrowdRoster([], crowds, 'orchard');
  const prey = targets.prey(0), point = prey.position.clone();
  expect(targets.raycast(point.clone().add(new Vector3(0, 0, -2)), new Vector3(0, 0, 1), 4)).toBeGreaterThanOrEqual(0);
  expect(targets.raycast(point, new Vector3(0, 0, 1), 1)).toBeGreaterThanOrEqual(0);
  expect(targets.positions(0, new Vector3()).y).toBeCloseTo(1.4);
  const identity = roster.identity(prey); expect(identity).toBe('orchard:0:0');
  expect(roster.resolve(identity)).toBe(prey);
  expect(roster.resolve('orchard:1:0')).toBeNull(); expect(roster.resolve('orchard:0:3')).toBeNull();
  expect(new CrowdRoster([], crowds, 'orchard').resolve(identity)?.position).toEqual(prey.position);
  expect(roster.raycast(point.clone().add(new Vector3(0, 0, -2)), new Vector3(0, 0, 1), 4)?.flock).toBe(targets);
  const saved = brain.snapshot();
  prey.applyDamage(); expect(prey.alive).toBe(false); expect(targets.alive).toBe(2);
  brain.restore(saved); expect(prey.alive).toBe(true); expect(targets.alive).toBe(3);
  expect(() => targets.prey(3)).toThrow('Unknown crowd member');
  expect(() => new CrowdTargets(brain, { preyY: 1, hits: [[0, 1, -1]] })).toThrow('Invalid crowd target');
});


test('orchard crowd weapon rows retain nearest selection and their exact pending native member',()=>{
  const create=(x:number):CrowdTargets=>{
    const brain=new FlockBrain({heightAt:()=>0,normalY:()=>1,inBounds:()=>true,wetAt:()=>false,playerCrouched:()=>false,grassHeightAt:()=>0,trample:()=>undefined,centre:()=>undefined},
      {x,z:0,count:1,seed:19,range:25,runSpeed:6,walkSpeed:1.2,grazeStep:.3,bleatCue:'deer.call'});
    brain.initialize();return new CrowdTargets(brain,{preyY:1.4,hits:[[0,1.4,.65]]});
  };
  const first=create(0),second=create(100),roster=new CrowdRoster([],[first,second],'orchard'),target=new CrowdWeaponTarget(roster,{kind:'deer',damage:31});
  const point=first.positions(0,new Vector3()),origin=point.clone().add(new Vector3(0,0,-2)),direction=new Vector3(0,0,1);
  const actor={kind:'tree',position:new Vector3(),alive:true,damageFor:()=>1,applyDamage:()=>true},nearer={animal:actor,point:new Vector3(),distance:1,headshot:false};
  expect(target.raycast(origin,direction,4,nearer)).toBe(nearer);
  const hit=target.raycast(origin,direction,4,null);if(hit===null)throw new Error('Missing deer hit');
  expect(hit.animal.kind).toBe('deer');expect(hit.animal.damageFor(false,2)).toBe(31);expect(hit.point).toEqual(point);expect(hit.headshot).toBe(false);
  roster.raycast(second.positions(0,new Vector3()).add(new Vector3(0,0,-2)),direction,4);
  hit.animal.applyDamage(1,hit.point,direction);expect(first.alive).toBe(0);expect(second.alive).toBe(1);expect(hit.animal.alive).toBe(false);
  hit.animal.applyDamage(1,hit.point,direction);expect(second.alive).toBe(1);expect(target.raycast(origin,direction,4,null)).toBeNull();
  expect(()=>new CrowdWeaponTarget(roster,{kind:'deer',damage:31,hit:()=>undefined})).toThrow();
});
