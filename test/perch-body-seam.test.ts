import {readFileSync} from 'node:fs';
import {expect, test, vi} from 'vitest';
import {Vector3} from 'three';
import {parsePerchHunter} from '@wildshard/format/brains';
import {Rng} from '@wildshard/format/seededRng';
import {loadRapier} from '../src/shared/engine/physics/rapier';
import {createSimHost} from '../src/server/engine/sim';
import {PerchHunterBrain} from '../src/server/engine/ai/perchHunter';
import {strikeFromData} from '../src/shared/engine/ai/strikeRows';
import {createNativeSpeciesContext} from '../src/server/game/plugin/brain';
import {createNativeCreatureRoster} from '../src/server/game/shardfile/homeKeeper';
import {bindPerchBody, preparePerchBody} from '../src/server/game/population/perchBody';
import {stepPerchBodyRoot} from '../src/shared/game/population/perchRoot';
import {ReturnProgram} from '../src/shared/game/population/returnProgram';
import {perchFixture} from './fixtures/plain-perch';
import {fixtureNativeRoster} from './fixtures/native-roster';
import {SIM_LEVEL} from './fixtures/sim-level/level';

async function fixture() {
  const rapier=await loadRapier(readFileSync('public/assets/physics/rapier.wasm'));
  const host=createSimHost({...SIM_LEVEL,entities:[]},{rapier}), shard=perchFixture(), rng=new Rng(9);
  const sample=SIM_LEVEL.entities[0], body=shard.creatures.perchBodies?.[0], bite=shard.rows.strikes[0];
  if(sample===undefined||body===undefined||bite===undefined)throw new Error('Missing actual seam fixture');
  const {hunt,services}=fixtureNativeRoster(host,rng);
  const intake=createNativeCreatureRoster(host,{specs:[sample.spec],variants:new Map(),rng,services,hunted:'every',spawnY:0});
  const herd=hunt.addHerd(sample.spec.kind,0,7);
  const actor=intake.arrive(intake.body('fixture.actor',sample.spec.kind,sample.spec.variant,herd,{x:0,z:7},Math.PI,[1,1]));
  const world={perches:body.sites.map(site=>new Vector3(...site.at)),perchBases:body.sites.map(site=>new Vector3(...site.base))};
  const {observation}=createNativeSpeciesContext({host,hunt,rng,world,heightAt:(x,z)=>host.groundHeightAt(x,z),waterLevel:-1},actor,null);
  const guest=ReturnProgram.native(host,body.program), spec=parsePerchHunter(shard.creatures.brains[0]);
  return {host,actor,body,observation,guest,spec,
    bite:strikeFromData({...bite,weight:{kind:'constant',value:bite.weight},motion:{speed:bite.speed}}),rng};
}

test('preparing the native observation/body seam draws no entropy or projection',async()=>{
  const actual=await fixture(), before=actual.actor.snapshot(), stream=actual.rng.snapshot();
  const project=vi.spyOn(ReturnProgram.prototype,'project');
  try{
    const body=preparePerchBody(actual.actor,actual.observation,actual.bite,actual.guest,actual.body.policy);
    const ports=body.observe(actual.observation);
    expect(ports.player).toBe(actual.observation.player);
    expect(ports.pickPerch).toBeTypeOf('function');expect(ports.setPerch).toBeTypeOf('function');
    expect(actual.actor.snapshot()).toEqual(before);expect(actual.rng.snapshot()).toEqual(stream);
    expect(project).not.toHaveBeenCalled();
  }finally{project.mockRestore();actual.host.dispose();}
});

test('an independently owned native controller matches the legacy perch body and RNG',async()=>{
  const legacy=await fixture(), plain=await fixture();
  try{
    const leftPolicy=new PerchHunterBrain(legacy.actor,legacy.spec),rightPolicy=new PerchHunterBrain(plain.actor,plain.spec);
    const old=bindPerchBody(legacy.actor,legacy.observation,{archetype:'perch-hunter',policy:leftPolicy},legacy.bite,legacy.guest,legacy.body.policy);
    const opened=preparePerchBody(plain.actor,plain.observation,plain.bite,plain.guest,plain.body.policy);
    for(let tick=0;tick<360;tick++){
      if(tick%3===0){
        legacy.observation.dt=plain.observation.dt=3/60;
        old.think(legacy.observation);
        rightPolicy.think(opened.observe(plain.observation));opened.brain.think(plain.observation);
      }
      legacy.observation.dt=plain.observation.dt=1/60;
      stepPerchBodyRoot(legacy.actor,1/60,legacy.body.policy.root);stepPerchBodyRoot(plain.actor,1/60,plain.body.policy.root);
      old.act(legacy.observation);opened.brain.act(plain.observation);
      legacy.host.step();plain.host.step();
    }
    expect(plain.actor.mem['init']).toBe(1);
    expect(plain.actor.snapshot()).toEqual(legacy.actor.snapshot());
    expect(plain.rng.snapshot()).toEqual(legacy.rng.snapshot());expect(plain.host.rng.snapshot()).toEqual(legacy.host.rng.snapshot());
    expect(opened.brain.snapshot()).toEqual(old.snapshot());expect(rightPolicy.snapshot()).toEqual(leftPolicy.snapshot());
  }finally{legacy.host.dispose();plain.host.dispose();}
});

test('the body seam owns once-only bite contact without deciding the native controller',async()=>{
  const actual=await fixture();
  try{
    const opened=preparePerchBody(actual.actor,actual.observation,actual.bite,actual.guest,actual.body.policy);
    actual.actor.place(0,1,Math.PI);Object.assign(actual.actor.mem,{st:2,bite:1,hit:0});actual.actor.startAttack(1);
    const player=actual.host.nearestPlayer(actual.actor.position), before=player.health.attributes.health;
    for(let tick=0;tick<50;tick++){actual.host.step();opened.brain.act(actual.observation);}
    expect(actual.actor.mem['init']).toBeUndefined();expect(actual.actor.mem['hit']).toBe(1);
    expect(before-player.health.attributes.health).toBe(actual.bite.damage);
  }finally{actual.host.dispose();}
});

test('the actual body root drops, lands and climbs without a rig callback',async()=>{
  const actual=await fixture();
  try{
    actual.actor.yOffset=2;Object.assign(actual.actor.mem,{drop:1,vy:0});
    for(let tick=0;tick<120;tick++)stepPerchBodyRoot(actual.actor,1/60,actual.body.policy.root);
    expect(actual.actor.yOffset).toBe(0);expect(actual.actor.mem['drop']).toBe(0);
    Object.assign(actual.actor.mem,{climb:1,perchH:2,bx:0,bz:0,px:1,pz:2});
    for(let tick=0;tick<120;tick++)stepPerchBodyRoot(actual.actor,1/60,actual.body.policy.root);
    expect(actual.actor.yOffset).toBe(2);expect(actual.actor.mem['climb']).toBe(0);
    expect([actual.actor.position.x,actual.actor.position.z]).toEqual([1,2]);
  }finally{actual.host.dispose();}
});
