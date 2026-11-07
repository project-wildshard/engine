import { afterEach, beforeEach, expect, it } from 'vitest';
import { Scope } from '../src/shared/engine/app/scope';
import { lendNalatiHeld } from './fixtures/nalati-return-modules';
import { StealthDetection } from '../src/shared/game/stealth/stealthLaw';
import { originalHeldMetadata } from './fixtures/nalati-held-original';
import {onFault,type Fault} from '../src/shared/engine/core/faults';

const { stealth: rows } = originalHeldMetadata();

let scope:Scope;
beforeEach(()=>{scope=new Scope('stealth-law');lendNalatiHeld(scope);});
afterEach(()=>{scope.dispose();});

const observation={...rows.tuning,grass:1,forced:0,blocked:0,practice:0,crouched:1,px:0,pz:0,sprint:0,jump:0,toggle:0};
it('runs eligibility and detection only at 10 Hz',()=>{
 const law=new StealthDetection(rows.program,scope);
 expect(law.step(.05,observation,[])).toBe(false);expect(law.state['can']).toBe(0);
 expect(law.step(.05,observation,[])).toBe(true);
 law.step(.1,observation,[]);law.step(.1,observation,[]);
 expect(law.state['can']).toBe(1);expect(law.state['state']).toBe(2);
 law.step(.1,{...observation,toggle:1},[]);expect(law.state['latched']).toBe(1);
 law.step(.1,{...observation,jump:1},[]);expect(law.state['latched']).toBe(0);
});
it('observes detection and direction from the existing animal senses',()=>{
 const law=new StealthDetection(rows.program,scope),threats=[{x:10,z:5,awareness:.5,alert:.35,hunting:1}];
 law.step(.1,observation,threats);expect(law.state['state']).toBe(4);expect(law.state['threat']).toBe(1);expect(law.state['x']).toBe(10);
 law.step(.1,observation,[{...threats[0],x:1000,z:0,awareness:1,alert:.35,hunting:1}]);expect(law.state['state']).toBe(2);
});
it('lets an unrelated marsh fixture tune crouch cover and hysteresis entirely through rows',()=>{
 const law=new StealthDetection(rows.program,scope),marsh={...observation,longGrass:.25,inAfter:.1,hiddenCover:.5,grass:.5,low:.65,high:1.8};
 law.step(.1,marsh,[]);expect(law.state['can']).toBe(1);expect(law.state['state']).toBe(2);
 law.step(.1,{...marsh,blocked:1},[]);expect(law.state['can']).toBe(0);expect(law.state['inLong']).toBe(0);
});

it('admits the full bounded threat snapshot',()=>{
 const law=new StealthDetection(rows.program,scope),threats=Array.from({length:8},(_,i)=>({x:i+2,z:0,awareness:i===7?1:0,alert:.35,hunting:0}));
 law.step(.1,{...observation,sense:200},threats);expect(law.state['state']).toBe(4);expect(law.state['x']).toBe(9);
});

it.each(['delta','threats','observation'])('a refused %s frame keeps pending cadence and recovers without publishing state',kind=>{
 const law=new StealthDetection(rows.program,scope),control=new StealthDetection(rows.program,scope),faults:Fault[]=[];
 const off=onFault(fault=>{faults.push(fault);});
 try{
  expect(law.step(.05,observation,[])).toBe(false);expect(control.step(.05,observation,[])).toBe(false);
  const state=law.state,threats=kind==='threats'?Array.from({length:9},()=>({x:0,z:0,awareness:0,alert:0,hunting:0})):[];
  const bad=kind==='observation'?{...observation,grass:Number.NaN}:observation,dt=kind==='delta'?Number.NaN:.05;
  for(let i=0;i<2;i++)expect(law.step(dt,bad,threats)).toBe(false);
  expect(law.state).toBe(state);expect(faults).toHaveLength(1);expect(faults[0]).toMatchObject({system:'stealth.detection',verdict:'retry'});
  if(kind==='delta')expect(faults[0]?.error).toMatchObject({message:'Invalid stealth step delta'});
  if(kind==='threats')expect(faults[0]?.error).toMatchObject({message:'Stealth threat observation bound'});
  expect(law.step(.05,observation,[])).toBe(true);expect(control.step(.05,observation,[])).toBe(true);
  expect(law.state).toEqual(control.state);
  expect(()=>law.program.project('step',{...observation,grass:Number.NaN})).toThrow();
 }finally{off();}
});
