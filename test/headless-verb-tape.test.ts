// @vitest-environment node
// oxlint-disable-next-line import/no-nodejs-modules -- Real native physics, no DOM or renderer host.
import {readFileSync} from 'node:fs';
import {beforeAll,expect,test} from 'vitest';
import * as v from 'valibot';
import {loadRapier,type Rapier} from '../src/shared/engine/physics/rapier';
import {createSimHost} from '../src/server/engine/sim';
import {headlessTapePlanSchema,runTrustedHeadlessTape,createTrustedHeadlessTape,type HeadlessTapePlan} from '../src/shared/host/headlessTape';
import {TickCommandSchema,simPlayerCommand} from '../src/shared/host/tickProtocol';
import {SIM_LEVEL} from './fixtures/sim-level/level';
import { leadCommands } from '@wildshard/engine/sim/leadPlayer';

let rapier:Rapier;
beforeAll(async()=>{rapier=await loadRapier(readFileSync('public/assets/physics/rapier.wasm'));});
const schema=headlessTapePlanSchema(TickCommandSchema);
const plan:HeadlessTapePlan={version:1,observe:['counter'],segments:[
  {id:'walk',ticks:120,commands:[{kind:'player',moveX:.2,moveZ:0,yaw:0}]},
  {id:'release',ticks:60,commands:[]},
]};

test('tape admission is finite, capped, distinct and uses the actual canonical command grammar',()=>{
  expect(v.safeParse(schema,plan).success).toBe(true);
  for(const bad of [{...plan,segments:[]},{...plan,observe:['counter','counter']},
    {...plan,segments:[plan.segments[0],plan.segments[0]]},
    {...plan,segments:[{id:'x',ticks:18_001,commands:[]}]},
    {...plan,segments:Array.from({length:4},(_,i)=>({id:String(i),ticks:18_000,commands:[]}))},
    {...plan,segments:[{id:'x',ticks:1,commands:[{kind:'launcher',slot:1,ads:1,pitch:Number.NaN}]}]},
    {...plan,segments:[{id:'x',ticks:2,commands:[],frames:[[]]}]},
    {...plan,segments:[{id:'x',ticks:1,commands:[{kind:'player',moveX:0,moveZ:0,yaw:0}],frames:[[]]}]},
    {...plan,segments:[{id:'x',ticks:1,commands:[],frames:[[]],route:[{x:0,z:0},{x:1,z:0}]}]},
    {...plan,segments:[{id:'x',ticks:1,commands:[],frames:[[{kind:'launcher',slot:1,ads:1,pitch:Number.NaN}]]}]},
    {...plan,run:()=>undefined}])expect(v.safeParse(schema,bad).success).toBe(false);
});

test('per-tick input is detached data and cannot exceed the total declared command allowance',()=>{
  const source:HeadlessTapePlan={version:1,observe:[],segments:[{id:'recorded',ticks:2,commands:[],frames:[[{kind:'player',moveX:.2,moveZ:0,yaw:0}],[]]}]};
  const admitted=v.parse(schema,source),first=source.segments[0]?.frames?.[0];
  if(first===undefined)throw new Error('Missing actual source frame');first.length=0;
  expect(admitted.segments[0]?.frames?.[0]).toHaveLength(1);
  const command={kind:'player',moveX:0,moveZ:0,yaw:0} as const;
  expect(v.safeParse(schema,{version:1,observe:[],segments:[{id:'overflow',ticks:60,commands:[],frames:Array.from({length:60},()=>Array.from({length:1001},()=>command))}]}).success).toBe(false);
});

test('compact tape executes every native tick and reads actual owners at each segment end',()=>{
  const host=createSimHost({...SIM_LEVEL,entities:[]},{rapier});let count=0;
  host.onStep('counter',()=>{count++;},{snapshot:()=>({count}),restore:()=>undefined});
  try {
    const report=runTrustedHeadlessTape(host,commands=>{
      const player=commands.find(command=>command.kind==='player');host.step(leadCommands(host, player===undefined?undefined:simPlayerCommand(player)));
    },()=>[],v.parse(schema,plan));
    expect(report.ticks).toBe(180);expect(count).toBe(180);
    expect(report.observations.map(row=>row.tick)).toEqual([120,180]);
    expect(report.observations[0]?.position[0]).toBeGreaterThan(0);
    expect(report.observations[1]?.grounded).toBe(true);
    expect(report.observations.map(row=>v.parse(v.object({count:v.number()}),JSON.parse(row.adapters[0]?.state??'null')))).toEqual([{count:120},{count:180}]);
    expect(host.state.tick).toBe(180);
  }finally{host.dispose();}
});

test('missing, replaced and nonfinite owners cannot publish a successful tape observation',()=>{
  const host=createSimHost({...SIM_LEVEL,entities:[]},{rapier});
  try {
    expect(()=>runTrustedHeadlessTape(host,()=>host.step(),()=>[],plan)).toThrow('Missing tape observation owner');
    expect(host.state.tick).toBe(0);
    host.onStep('counter',()=>undefined,{snapshot:()=>({value:Number.NaN}),restore:()=>undefined});
    expect(()=>runTrustedHeadlessTape(host,()=>host.step(),()=>[],plan)).toThrow('Nonfinite tape owner');
    expect(()=>runTrustedHeadlessTape(host,()=>{host.step();host.adapters.delete('counter');},()=>[],plan)).toThrow('owner changed');
  }finally{host.dispose();}
  expect(()=>runTrustedHeadlessTape(host,()=>undefined,()=>[],plan)).toThrow('owner retired');
});


test('a declared route uses actual movement and refuses a blocked endpoint instead of advancing it',()=>{
  const host=createSimHost({...SIM_LEVEL,entities:[]},{rapier});
  const route:HeadlessTapePlan={version:1,observe:[],segments:[{id:'approach',ticks:600,commands:[],route:[{x:0,z:0},{x:2,z:0}]}]};
  try {
    const report=runTrustedHeadlessTape(host,commands=>{const command=commands.find(row=>row.kind==='player');host.step(leadCommands(host, command===undefined?undefined:simPlayerCommand(command)));},()=>[],v.parse(schema,route));
    expect(report.ticks).toBeGreaterThan(0);expect(report.ticks).toBeLessThan(600);
    expect(report.observations[0]?.position[0]).toBeGreaterThan(1.2);
    const blocked=createSimHost({...SIM_LEVEL,entities:[]},{rapier});
    try {expect(()=>runTrustedHeadlessTape(blocked,()=>blocked.step(),()=>[],v.parse(schema,route))).toThrow('route stuck');}
    finally{blocked.dispose();}
  }finally{host.dispose();}
});


test('a streamed resident keeps the original observation owner between parts',()=>{
  const host=createSimHost({...SIM_LEVEL,entities:[]},{rapier});
  host.onStep('counter',()=>undefined,{snapshot:()=>({count:host.state.tick}),restore:()=>undefined});
  try{
    const tape=createTrustedHeadlessTape(host,()=>host.step(),()=>[]);
    tape({...plan,segments:[{id:'first',ticks:1,commands:[]}]});
    const old=host.adapters.get('counter');if(old===undefined)throw new Error('Missing counter owner');
    host.adapters.set('counter',{...old,snapshot:()=>({count:host.state.tick})});
    expect(()=>tape({...plan,segments:[{id:'second',ticks:1,commands:[]}]})).toThrow('owner changed between parts');
    expect(host.state.tick).toBe(1);
  }finally{host.dispose();}
});
