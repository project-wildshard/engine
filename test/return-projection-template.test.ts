import {beforeAll,expect,test,vi} from 'vitest';
import * as observations from '../src/shared/engine/script/observationsV2';
import {ScriptModuleV2} from '../src/shared/engine/script/moduleV2';
import {ReturnProjectionV2} from '../src/shared/game/population/returnProjectionV2';
import {returnProjectionV2Layout,parseReturnProjectionV2,type ReturnProjectionV2Rows} from '@wildshard/format/returnProjectionV2';
import {compileScriptV2} from '../src/sharddev/bake/compileScriptV2';
import {v2CoreSource} from '../src/sharddev/as/wsV2';
import {SCRIPT_V2_REVISIONS} from '@wildshard/format/scriptAdmissionV2';
import {hashImmutableBytes} from '../src/shared/host/immutable';
import {writeV2Frame} from '@wildshard/format/scriptWireV2';
import {prepareV2Rng} from '@wildshard/format/scriptRngV2';
import {Rng} from '../src/shared/engine/core/rng';
import {Scope} from '../src/shared/engine/app/scope';

let row:ReturnProjectionV2Rows;
beforeAll(async()=>{
  const layout=returnProjectionV2Layout(2);
  const bytes=await compileScriptV2(`import * as core from './core';
    export function ws_abi():i32{return 2;}export function ws_io():i32{return 0;}
    export function ws_init(lo:i32,hi:i32,fuel:i32):i32{return fuel;}
    export function ws_project(fuel:i32):i32{
      core.beginState();assert(core.beginBinding(0));
      core.pageOutput(2,core.field(0));core.pageOutput(1,core.parameter(0));
      core.endBinding();return fuel;
    }`,{lane:'project',ioBytes:layout.bytes,sources:{'core.ts':v2CoreSource(0)}});
  row=parseReturnProjectionV2({artifact:{abi:2,minor:0,compilerRevision:SCRIPT_V2_REVISIONS.compiler,admissionRevision:SCRIPT_V2_REVISIONS.admission,
    hash:hashImmutableBytes(bytes),lane:'project',pages:1,ioBytes:layout.bytes},fields:['a','z'],signals:['first','second'],channels:['signal','value'],
    bytes:btoa(Array.from(bytes,byte=>String.fromCodePoint(byte)).join(''))});
},30000);

function genericFrame(signal:number,frames:readonly Readonly<Record<string,number>>[],random:Rng|undefined,count=frames.length):Uint8Array {
  const layout=returnProjectionV2Layout(row.fields.length),view=new DataView(new ArrayBuffer(layout.pages*65536));
  const fields=Array.from({length:count},(_,actor)=>row.fields.map((field,index)=>({name:`${actor}/${field}`,id:actor*row.fields.length+index+1,value:frames[actor]?.[field]}))).flat();
  const input=observations.prepareV2Observations(layout,0,{bindings:[{identity:'projection',handle:1,self:1,player:0,observed:new Set([1]),enabled:true,due:true,
    divisor:6,fuel:400000,previousTick:0,currentTick:0,state:[],parameters:[{name:'signal',value:signal}],fields,sample:{atTick:0,target:0}}],
    players:[],edges:[],events:[],actions:new Set(),eventKinds:new Set()});
  const before=random?.snapshot(),rng=prepareV2Rng(layout,before===undefined?[]:[{binding:1,stream:1,algorithm:1,state:[before.state,before.initial,Number(before.scrambledFork),0,0,0]}]);
  const counts=new Map(input.counts);counts.set(21,rng.count);
  writeV2Frame(view,layout,{lane:2,module:1,sequence:0,tick:0,due:1},counts);input.write(view);
  const bank=layout.regions[20];if(bank===undefined)throw new Error('Missing RNG bank');
  new Uint8Array(view.buffer,layout.io+bank.offset,rng.bytes.length).set(rng.bytes);
  return new Uint8Array(view.buffer);
}

test('reused shapes write the exact generic ABI bytes with fresh values, absent fields and signed zero',()=>{
  const prepare=vi.spyOn(observations,'prepareV2Observations'),project=vi.spyOn(ScriptModuleV2.prototype,'project');
  const program=new ReturnProjectionV2(row),random=new Rng(812),original=random.snapshot();
  const cases=[{signal:'first',frames:[{a:-0,z:9}]},{signal:'second',frames:[{a:4}]},
    {signal:'first',frames:[{a:2,z:-0},{a:3},{a:6,z:7}]},{signal:'second',frames:[{a:-8,z:12}]},
    {signal:'first',frames:Array.from({length:9},(_,index)=>({a:index+.25,z:-index}))}];
  try {
    for(const sample of cases){
      const first=sample.frames[0];if(first===undefined)throw new Error('Missing test frame');
      const answer=program.prepare(sample.signal,first,random,sample.frames.slice(1));
      expect(answer.values).toStrictEqual({value:first.a,signal:sample.signal==='first'?1:2});
    }
    expect(prepare).toHaveBeenCalledTimes(3); // Only the three actual actor counts allocate fixed input banks.
    expect(random.snapshot()).toStrictEqual(original);
    for(let index=0;index<cases.length;index++){
      const sample=cases[index],write=project.mock.calls[index]?.[1];
      if(sample===undefined||write===undefined)throw new Error('Missing captured writer');
      const actual=new DataView(new ArrayBuffer(65536));write(actual);
      expect(new Uint8Array(actual.buffer)).toEqual(genericFrame(sample.signal==='first'?1:2,sample.frames,random));
    }
  } finally {prepare.mockRestore();project.mockRestore();}
});

test('later calls cannot alter detached captures or leak values through a refused or retired call',()=>{
  const project=vi.spyOn(ScriptModuleV2.prototype,'project'),scope=new Scope('projection-template'),program=new ReturnProjectionV2(row,scope),random=new Rng(71);
  try {
    const frame={a:1,z:8},candidate={a:2,z:4};
    const first=program.prepare('first',frame,random,[candidate]),write=project.mock.calls[0]?.[1];
    frame.a=99;candidate.z=99;
    expect(()=>program.prepare('first',{z:3},random)).toThrow();
    expect(program.project('second',{a:5},random)).toStrictEqual({value:5,signal:2});
    expect(first.values).toStrictEqual({value:1,signal:1});
    if(write===undefined)throw new Error('Missing captured writer');
    const actual=new DataView(new ArrayBuffer(65536));write(actual);
    expect(new Uint8Array(actual.buffer)).toEqual(genericFrame(1,[{a:1,z:8},{a:2,z:4}],new Rng(71)));
    let reads=0;const accessor={get a(){reads++;return 1;}};
    expect(()=>program.prepare('first',accessor,random)).toThrow('Invalid return observation frame');expect(reads).toBe(0);
    scope.dispose();expect(()=>program.prepare('first',{a:7},random)).toThrow('disposed');expect(()=>first.accept()).toThrow('disposed');
  } finally {scope.dispose();project.mockRestore();}
});

test('declared candidate slots retain absent bytes when the candidate iterator yields fewer frames',()=>{
  class ShortCandidates extends Array<Readonly<Record<string,number>>> {
    override [Symbol.iterator]():ArrayIterator<Readonly<Record<string,number>>>{return [{a:7,z:-0}].values();}
  }
  const project=vi.spyOn(ScriptModuleV2.prototype,'project'),program=new ReturnProjectionV2(row),random=new Rng(39);
  const candidates=new ShortCandidates({a:100},{a:200}),first={a:3,z:4};
  try {
    expect(program.prepare('first',first,random,candidates).values).toStrictEqual({value:3,signal:1});
    const write=project.mock.calls[0]?.[1];if(write===undefined)throw new Error('Missing captured writer');
    const actual=new DataView(new ArrayBuffer(65536));write(actual);
    expect(new Uint8Array(actual.buffer)).toEqual(genericFrame(1,[first,{a:7,z:-0}],random,3));
  }finally{project.mockRestore();}
});

test('alternating RNG presence and shapes keeps every retained input writer detached and exact',()=>{
  const project=vi.spyOn(ScriptModuleV2.prototype,'project'),program=new ReturnProjectionV2(row),random=new Rng(817);
  const cases=[
    {frames:[{a:1,z:-0}],random:undefined},{frames:[{a:2,z:3}],random},
    {frames:[{a:4,z:5},{a:6,z:7}],random},{frames:[{a:-0},{a:8}],random:undefined},
    {frames:[{a:9}],random:undefined},{frames:[{a:10,z:11}],random},
  ];
  try {
    for(const sample of cases){
      const first=sample.frames[0];if(first===undefined)throw new Error('Missing first frame');
      const prepared=program.prepare('first',first,sample.random,sample.frames.slice(1));prepared.accept();
    }
    // Replay after the opposite RNG mode and another shape have both run.
    for(let index=0;index<cases.length;index++){
      const sample=cases[index],write=project.mock.calls[index]?.[1];
      if(sample===undefined||write===undefined)throw new Error('Missing retained writer');
      const actual=new DataView(new ArrayBuffer(65536));write(actual);
      expect(new Uint8Array(actual.buffer)).toEqual(genericFrame(1,sample.frames,sample.random));
    }
  }finally{project.mockRestore();}
});

test('candidate iteration completes before ordered descriptor capture and nested preparation stays independent',()=>{
  const program=new ReturnProjectionV2(row),order:string[]=[],nested:Readonly<Record<string,number>>[]=[];
  const original={a:-0,z:3},frame=new Proxy(original,{
    ownKeys(target){order.push('keys');return Reflect.ownKeys(target);},
    getOwnPropertyDescriptor(target,key){
      order.push(`descriptor:${String(key)}`);
      if(key==='a')nested.push(program.project('second',{a:9}));
      return Reflect.getOwnPropertyDescriptor(target,key);
    },
  });
  const candidates=[{a:2}];
  Object.defineProperty(candidates,Symbol.iterator,{*value(){order.push('iterate');yield {a:2};order.push('done');}});
  expect(program.project('first',frame,undefined,candidates)).toStrictEqual({value:-0,signal:1});
  expect(nested).toStrictEqual([{value:9,signal:2}]);
  expect(order).toEqual(['iterate','done','keys','descriptor:a','descriptor:z']);
  expect(Object.is(original.a,-0)).toBe(true);
  expect(()=>program.project('first',{a:1,unused:Number.NaN})).toThrow('Invalid return observation frame');
  expect(()=>program.project('first',{a:1,[Symbol('unused')]:2})).toThrow('Invalid return observation frame');
});
