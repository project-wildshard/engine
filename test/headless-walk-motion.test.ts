// oxlint-disable-next-line import/no-nodejs-modules -- Use the shipped native motor in the walk parity proof.
import {readFileSync} from 'node:fs';
import {expect,test,vi} from 'vitest';
import {SIM_CREATURE_RECIPE} from '../src/test/game/creatureRecipe';
import {loadRapier} from '../src/shared/engine/physics/rapier';
import {createShardfileSim} from '../src/server/game/plugin/simulation';
import {emptyShardfile} from '../src/shared/host/author';
import {walkVelocity,walkingSpeed} from '../src/shared/engine/player/walk';
import {runHeadlessJourney} from '../src/shared/host/headlessJourney';
import { leadCommands, leadPlayer } from '@wildshard/engine/sim/leadPlayer';

test('the shared page acceleration preserves its arithmetic through turns and stopping',()=>{
  let original=0,shared=0;
  for(const target of [4.3,-4.3,0,2.2])for(let tick=0;tick<60;tick++){
    const acceleration=tick<30?14:3,dt=1/60;
    original+=(target-original)*Math.min(1,acceleration*dt);
    shared=walkVelocity(shared,target,acceleration,dt);
    expect(Object.is(shared,original)).toBe(true);
  }
});

test('every native walk accelerates at the page\'s walking speed',async()=>{
  const rapier=await loadRapier(readFileSync('public/assets/physics/rapier.wasm'));
  const sim=createShardfileSim(emptyShardfile({slug:'walk-motion',name:'Walk motion',author:'Test',revision:1,seed:1}),new Map(),{rapier});
  try{
    const {host}=sim;
    for(let tick=0;tick<120;tick++)host.step();
    const before=leadPlayer(host).position.clone();
    host.step(leadCommands(host, {moveX:1,moveZ:0,yaw:-Math.PI/2}));
    expect(leadPlayer(host).velocity.x).toBe(walkVelocity(0,walkingSpeed(false,false,0,1,1),14,1/60));
    const accelerated=leadPlayer(host).position.x-before.x;
    expect(accelerated).toBeGreaterThan(0);expect(accelerated).toBeLessThan(4.3/60);
  }finally{sim.dispose();}
});

test('a failed route releases its temporary page motion before a later driver binds',async()=>{
  const rapier=await loadRapier(readFileSync('public/assets/physics/rapier.wasm'));
  const sim=createShardfileSim(emptyShardfile({slug:'walk-release',name:'Walk release',author:'Test',revision:1,seed:1}),new Map(),{rapier});
  try{
    expect(()=>runHeadlessJourney(sim.host,()=>{throw new Error('Native step refused');},{ticks:1,start:{x:0,z:0,yaw:0},points:[{x:0,z:0},{x:10,z:0}]})).toThrow('Native step refused');
    const release=leadPlayer(sim.host).useWalkingControl({speed:4.3,crouching:false});
    release();
  }finally{sim.dispose();}
});

test('route walking preserves the existing native driver and delegated motion authority',async()=>{
  const rapier=await loadRapier(readFileSync('public/assets/physics/rapier.wasm'));
  const sim=createShardfileSim(emptyShardfile({slug:'walk-driver',name:'Walk driver',author:'Test',revision:1,seed:1}),new Map(),{rapier});
  try{
    const {host}=sim;let delegated=false,inputs=0,steps=0;
    const driver={input:()=>{inputs++;return delegated;},step:()=>{steps++;}};
    const remove=leadPlayer(host).useDriver(driver),walked=leadPlayer(host).velocity;
    const release=leadPlayer(host).useWalkingControl({speed:4.3,crouching:false});
    expect(()=>leadPlayer(host).useDriver(driver)).toThrow('Player driver belongs');
    expect(()=>leadPlayer(host).useWalkingControl({speed:4.3,crouching:false})).toThrow('Walking control belongs');
    host.step(leadCommands(host, {moveX:1,moveZ:0,yaw:0}));expect(inputs).toBe(1);expect(steps).toBe(0);expect(walked.x).toBeGreaterThan(0);
    const velocity=walked.x;delegated=true;
    host.step(leadCommands(host, {moveX:1,moveZ:0,yaw:0}));expect(inputs).toBe(2);expect(steps).toBe(1);expect(walked.x).toBe(velocity);
    release();remove();
    const retry=leadPlayer(host).useWalkingControl({speed:4.3,crouching:false});retry();
  }finally{sim.dispose();}
});

test('only the explicit physics ruler holds actors, including births, then restores their flags',async()=>{
  const rapier=await loadRapier(readFileSync('public/assets/physics/rapier.wasm'));
  const sim=createShardfileSim(emptyShardfile({slug:'walk-actors',name:'Walk actors',author:'Test',revision:1,seed:1}),new Map(),{rapier});
  try{
    const {host}=sim,first=host.spawn({...SIM_CREATURE_RECIPE,id:'first',at:{x:10,y:0,z:10}}),held=host.spawn({...SIM_CREATURE_RECIPE,id:'held',at:{x:15,y:0,z:15}});
    held.harnessHold=true;const firstStep=vi.spyOn(first,'step'),heldStep=vi.spyOn(held,'step');
    let born:typeof first|undefined,bornSteps=0;
    host.onStep('walk.birth',()=>{
      if(born!==undefined)return;
      born=host.spawn({...SIM_CREATURE_RECIPE,id:'born',at:{x:20,y:0,z:20}});
      const step=born.step.bind(born);vi.spyOn(born,'step').mockImplementation(dt=>{bornSteps++;step(dt);});
    });
    const plan={ticks:10,points:[{x:0,z:0},{x:100,z:0}],holdActors:true};
    runHeadlessJourney(host,()=>host.step(),plan);
    expect(firstStep).not.toHaveBeenCalled();expect(heldStep).not.toHaveBeenCalled();
    expect(first.harnessHold).toBe(false);expect(held.harnessHold).toBe(true);expect(born?.harnessHold).toBe(false);
    expect(bornSteps).toBe(0);
    expect(host.hasStep('physics.walk.hold')).toBe(false);
    host.step();expect(firstStep).toHaveBeenCalledTimes(1);expect(heldStep).not.toHaveBeenCalled();expect(bornSteps).toBe(1);
    expect(()=>runHeadlessJourney(host,()=>{throw new Error('Native refusal');},plan)).toThrow('Native refusal');
    expect(first.harnessHold).toBe(false);expect(held.harnessHold).toBe(true);expect(host.hasStep('physics.walk.hold')).toBe(false);
    const priorCalls=firstStep.mock.calls.length,priorBirthCalls=bornSteps;
    const live=runHeadlessJourney(host,()=>host.step(),{ticks:10,points:plan.points});
    const committed=live.ticks+live.preparationTicks+live.settledTicks;
    expect(firstStep).toHaveBeenCalledTimes(priorCalls+committed);expect(bornSteps).toBe(priorBirthCalls+committed);expect(heldStep).not.toHaveBeenCalled();
  }finally{sim.dispose();}
});
