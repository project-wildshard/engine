import {expect,test} from 'vitest';
import {TapePartBudget} from '../../shared/host/headlessTapeParts';
import type {HeadlessTapePlan} from '../../shared/host/headlessTape';
import type {HeadlessTapePartReport} from '../../shared/host/tickProtocol';

function plan(id:string,ticks=1):HeadlessTapePlan{return {version:1,observe:[],segments:[{id,ticks,commands:[]}]};}
function reply(id:string,tick:number,ticks=1):HeadlessTapePartReport{return {commit:{tick,snapshot:'checked',effects:[]},report:{version:1,ticks,
  observations:[{id,tick,position:[0,0,0],peakY:0,grounded:true,flags:[],quests:[],effects:[],adapters:[]}]}};}

test('parts retain the initial tick, distinct ids and one observation selection',()=>{
  const budget=new TapePartBudget(17);
  budget.admit(plan('first',2));budget.accept(reply('first',19,2));
  expect(()=>budget.admit(plan('first'))).toThrow('aggregate');
  expect(()=>budget.admit({...plan('second'),observe:['new-owner']})).toThrow('selection');
  budget.admit(plan('second'));budget.accept(reply('second',20));
});

test('part bounds count declared ticks and commands across requests',()=>{
  const ticks=new TapePartBudget(0);
  for(let index=0;index<3;index++){
    const input=plan(String(index),18_000);
    const segment=input.segments[0];if(segment===undefined)throw new Error('Missing test input');
    segment.route=[{x:0,z:0},{x:0,z:0}];ticks.admit(input);ticks.accept(reply(String(index),0,0));
  }
  expect(()=>ticks.admit(plan('over-ticks',6001))).toThrow('aggregate');
  const commands=new TapePartBudget(0);
  for(let index=0;index<60;index++){
    const input=plan(String(index)),segment=input.segments[0];if(segment===undefined)throw new Error('Missing test input');
    segment.commands=Array.from({length:1000},()=>({kind:'player',moveX:0,moveZ:0,yaw:0}));
    commands.admit(input);commands.accept(reply(String(index),index+1));
  }
  const over=plan('over-commands');over.segments[0]?.commands.push({kind:'player',moveX:0,moveZ:0,yaw:0});
  expect(()=>commands.admit(over)).toThrow('aggregate');
});

test('all 128 parts share the cap and incomplete or mismatched commits refuse',()=>{
  const budget=new TapePartBudget(0);
  for(let index=0;index<128;index++){budget.admit(plan(String(index)));budget.accept(reply(String(index),index+1));}
  expect(()=>budget.admit(plan('one-more'))).toThrow('aggregate');
  for(const value of [reply('wrong-id',1),reply('input',2),reply('input',0,0)]){
    const fresh=new TapePartBudget(0);fresh.admit(plan('input'));expect(()=>fresh.accept(value)).toThrow('complete ordered input');
  }
  const busy=new TapePartBudget(0);busy.admit(plan('pending'));expect(()=>busy.admit(plan('later'))).toThrow('pending');
  expect(()=>new TapePartBudget(0).admit({...plan('multiple'),segments:[...plan('a').segments,...plan('b').segments]})).toThrow('one segment');
});

test('observation bytes accumulate rather than resetting with each checkpoint',()=>{
  const budget=new TapePartBudget(0);
  for(let index=0;index<3;index++){
    budget.admit(plan(String(index)));const value=reply(String(index),index+1),observation=value.report.observations[0];
    if(observation===undefined)throw new Error('Missing test observation');
    observation.adapters=Array.from({length:3},(_,slot)=>({id:String(slot),state:'x'.repeat(1_000_000)}));
    if(index<2)budget.accept(value);else expect(()=>budget.accept(value)).toThrow('observation allowance');
  }
});
