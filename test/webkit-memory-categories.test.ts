import { expect, test } from 'vitest';
import { memoryCategories } from '../scripts/soak/memory-categories.mjs';

test('passive categories preserve all six domains and retire without requesting a heap collection',async()=>{
  const calls:string[]=[];
  let emit:(params:unknown)=>void=()=>{throw new Error('Listener not installed');};
  const event={timestamp:123,categories:['javascript','jit','images','layers','page','other'].map((type,index)=>({type,size:index+1}))};
  const result=await memoryCategories({
    on:(method,listener)=>{calls.push(method);emit=listener;return()=>{calls.push('off');};},
    send:(method)=>{calls.push(method);return Promise.resolve({});},
  },ms=>{expect(ms).toBe(2500);emit({event});return Promise.resolve();});
  expect(result.samples).toEqual([event]);expect(result.errors).toEqual([]);
  expect(calls).toEqual(['Memory.trackingUpdate','Memory.enable','Memory.startTracking','Memory.stopTracking','Memory.disable','off']);
});

test('unsupported or corrupt passive categories remain explicit unknowns',async()=>{
  const calls:string[]=[];
  const result=await memoryCategories({
    on:(_method,listener)=>{listener({event:{timestamp:1,categories:[{type:'javascript',size:-1}]}});return()=>{calls.push('off');};},
    send:method=>{calls.push(method);return Promise.reject(new Error('unsupported'));},
  },()=>Promise.resolve());
  expect(result.samples).toEqual([]);
  expect(result.errors).toEqual(['Invalid WebKit memory category event','Error: unsupported']);
  expect(calls).toEqual(['Memory.enable','off']);
});
