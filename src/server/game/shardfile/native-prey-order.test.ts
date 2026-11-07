import { expect,test } from 'vitest';
import { AnimalSim } from '@wildshard/engine/entities/AnimalSim';
import { nearestPopulationActor } from './groupRuntime';
import { SIM_CREATURE_RECIPE } from '../../../test/game/creatureRecipe';
import type { SimLevel } from '@wildshard/engine/sim';

const SIM_LEVEL: Pick<SimLevel, 'entities'> = { entities: [SIM_CREATURE_RECIPE] };

test('native prey selection retains horizontal bounds, live roster ties and current membership',()=>{
  const recipe=SIM_LEVEL.entities[0];if(recipe===undefined)throw new Error('Missing native body recipe');
  const body=(id:string,x:number):AnimalSim=>{
    const actor=new AnimalSim(recipe.spec,1,1,id,{heightAt:()=>0,random:()=>.5});
    actor.position.set(x,100,0);return actor;
  };
  const dead=body('dead',1),first=body('first',-3),second=body('second',3),members=[dead,first,second];
  dead.alive=false;
  expect(nearestPopulationActor(members,0,0,3)).toBeNull();
  expect(nearestPopulationActor(members,0,0,4)).toBe(first);
  members.reverse();expect(nearestPopulationActor(members,0,0,4)).toBe(second);
  second.alive=false;expect(nearestPopulationActor(members,0,0,4)).toBe(first);
  first.position.x=8;expect(nearestPopulationActor(members,0,0,4)).toBeNull();
  const arrived=body('arrived',2);members.push(arrived);
  expect(nearestPopulationActor(members,0,0,4)).toBe(arrived);
});
