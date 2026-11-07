import * as v from 'valibot';
import {unzlibSync} from 'fflate';
import {expect,test,vi} from 'vitest';
import {Scope} from '@wildshard/engine/app/scope';
import {BinarySourceSchema} from '@wildshard/format/binarySource';
import {binarySourceBytes,prepareBinarySources} from './binarySource';

test('binary rows refuse ambiguity and getters before touching the file owner',async()=>{
  let getters=0;const source=Object.defineProperty({},'file',{enumerable:true,get:()=>{getters++;return 'shape';}}),file=vi.fn(()=>Promise.resolve(new Uint8Array(4)));
  await expect(prepareBinarySources({file},[{source,bytes:4}])).rejects.toThrow();
  expect(getters).toBe(0);expect(file).not.toHaveBeenCalled();
  expect(()=>v.parse(BinarySourceSchema,{file:'shape',data:'inline'})).toThrow();
  for(const bytes of [-1,.5,Infinity,Number.NaN])await expect(prepareBinarySources({file},[{source:{file:'shape'},bytes}])).rejects.toThrow();
  await expect(prepareBinarySources({file},[{source:{file:'shape'},bytes:4},{source:{file:'shape'},bytes:8}])).rejects.toThrow('Conflicting');
  expect(file).not.toHaveBeenCalled();
});

test('preparation reads each exact file once, keeping raw bytes and offset views unchanged',async()=>{
  const raw=Uint8Array.from([0,255,4,128]),file=vi.fn(()=>Promise.resolve(raw));
  const rows=[{source:{file:'shape'},bytes:4},{source:{file:'shape'},bytes:4}];
  const files=await prepareBinarySources({file,hasFile:()=>true},rows);
  expect(file.mock.calls).toEqual([['shape']]);expect(binarySourceBytes({file:'shape'},files)).toBe(raw);
  const data='eJxj+M/SAAADiQGE'; // The same zlib wire for [0, 255, 4, 128], without an encoder in the fixture.
  const original=unzlibSync(new Uint8Array([120,156,99,248,207,210,0,0,3,137,1,132]));expect(original).toEqual(raw);
  expect(v.parse(BinarySourceSchema,{data})).toEqual({data});
  expect(()=>binarySourceBytes({data})).toThrow('Binary sources require named files');
  await expect(prepareBinarySources({},[{source:{data},bytes:4}])).rejects.toThrow('Binary sources require named files');
  expect(await prepareBinarySources({},[])).toEqual(new Map());
  const backing=new Uint8Array(12);backing.set(raw,4);const offset=backing.subarray(4,8);
  expect(binarySourceBytes({file:'offset'},new Map([['offset',offset]]))).toBe(offset);expect(offset).toEqual(original);
  await expect(prepareBinarySources({file},[{source:{file:'shape'},bytes:8}])).rejects.toThrow('byte count');
  await expect(prepareBinarySources({file,hasFile:()=>false},rows)).rejects.toThrow('Missing');
});

test('held reads refuse reader replacement and sliced ancestor retirement without publication',async()=>{
  for(const retire of [false,true]){
    const parent=new Scope('binary.parent'),scope=parent.child('binary.child');let finish:(bytes:Uint8Array)=>void=()=>undefined;
    const held=new Promise<Uint8Array>(resolve=>{finish=resolve;}),file=vi.fn(()=>held),product={file};
    const pending=prepareBinarySources(product,[{source:{file:'shape'},bytes:4}],scope);
    expect(file).toHaveBeenCalledTimes(1);
    if(retire){const steps=parent.disposeSteps();steps.next();expect(scope.disposing||scope.disposed).toBe(true);}
    else product.file=vi.fn(()=>Promise.resolve(new Uint8Array(4)));
    finish(new Uint8Array(4));await expect(pending).rejects.toThrow(retire?'retired':'changed');parent.dispose();
  }
  const scope=new Scope('binary.ended');scope.dispose();const file=vi.fn(()=>Promise.resolve(new Uint8Array(4)));
  await expect(prepareBinarySources({file},[{source:{file:'shape'},bytes:4}],scope)).rejects.toThrow('retired');expect(file).not.toHaveBeenCalled();
});

test('binary preparation overlaps at most four files and preserves declared result order',async()=>{
  let release:()=>void=()=>undefined;const gate=new Promise<void>(resolve=>{release=resolve;});let active=0,maximum=0;
  const rows=Array.from({length:9},(_,i)=>({source:{file:`field-${i}`},bytes:1}));
  const file=vi.fn(async(name:string)=>{active++;maximum=Math.max(maximum,active);await gate;active--;return new Uint8Array([Number(name.slice(6))]);});
  const task=prepareBinarySources({file},rows);expect(file).toHaveBeenCalledTimes(4);release();
  const files=await task;expect(maximum).toBe(4);expect(file).toHaveBeenCalledTimes(9);expect([...files.keys()]).toEqual(rows.map(row=>row.source.file));
  for(const [i,row]of rows.entries())expect(files.get(row.source.file)).toEqual(new Uint8Array([i]));
});

test('binary read-ahead retains the first authored failure and starts no tail after it',async()=>{
  let refuse:(error:Error)=>void=()=>undefined;const first=new Promise<Uint8Array>((_resolve,reject)=>{refuse=reject;});
  const file=vi.fn((name:string)=>name==='field-0'?first:name==='field-1'?Promise.reject(new Error('second refusal')):Promise.resolve(new Uint8Array([3])));
  const rows=Array.from({length:9},(_,i)=>({source:{file:`field-${i}`},bytes:1}));
  const task=prepareBinarySources({file},rows);expect(file).toHaveBeenCalledTimes(4);refuse(new Error('first refusal'));
  await expect(task).rejects.toThrow('first refusal');expect(file).toHaveBeenCalledTimes(4);
  const unread=vi.fn(()=>Promise.resolve(new Uint8Array([0])));
  await expect(prepareBinarySources({file:unread,hasFile:name=>name!=='field-8'},rows)).rejects.toThrow('Missing binary source field-8');expect(unread).not.toHaveBeenCalled();
});

test('binary completion rechecks its owner after the final drain microtask',async()=>{
  for(const retire of [true,false]){
    const scope=new Scope('binary.completion');let finish:(bytes:Uint8Array)=>void=()=>undefined;
    const wire=new Promise<Uint8Array>(resolve=>{finish=resolve;}),product={file:()=>wire};
    const pending=prepareBinarySources(product,[{source:{file:'shape'},bytes:1}],scope);
    void wire.then(()=>{queueMicrotask(()=>{if(retire)scope.dispose();else product.file=()=>Promise.resolve(new Uint8Array([2]));});return undefined;});
    finish(new Uint8Array([1]));await expect(pending).rejects.toThrow(retire?'retired':'changed');scope.dispose();
  }
});
