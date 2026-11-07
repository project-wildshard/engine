import {expect,test,vi} from 'vitest';
import {readFileInputs} from './fileInputs';

function gate(){
  let finish:((bytes:Uint8Array)=>void)|undefined,fail:((error:Error)=>void)|undefined;
  const promise=new Promise<Uint8Array>((resolve,reject)=>{finish=resolve;fail=reject;});
  return{promise,finish:(bytes:Uint8Array)=>{finish?.(bytes);},fail:(error:Error)=>{fail?.(error);}};
}

test('four input reads overlap but complete in original order without copying their storage',async()=>{
  const names=['a','b','c','d','e','f'],gates=names.map(()=>gate()),started:string[]=[];let active=0,maximum=0;
  const pending=readFileInputs(names,name=>{
    const index=names.indexOf(name),item=gates[index];if(item===undefined)throw new Error('Unknown source');
    started.push(name);active++;maximum=Math.max(maximum,active);
    return item.promise.finally(()=>{active--;});
  },()=>undefined);
  expect(started).toEqual(names.slice(0,4));
  const bytes=names.map((_,index)=>Uint8Array.of(index));
  for(const index of [0,1]){gates[index]?.finish(bytes[index]??new Uint8Array());await vi.waitFor(()=>{expect(started).toHaveLength(index+5);});}
  for(const index of [5,3,4,2])gates[index]?.finish(bytes[index]??new Uint8Array());
  const result=await pending;expect([...result.keys()]).toEqual(names);expect(maximum).toBe(4);
  for(const [index,name]of names.entries())expect(result.get(name)).toBe(bytes[index]);
});

test('an input refusal stops new reads and drains its already-started siblings',async()=>{
  const names=['a','b','c','d','never'],gates=names.map(()=>gate()),started:string[]=[];
  const pending=readFileInputs(names,name=>{const item=gates[names.indexOf(name)];if(item===undefined)throw new Error('Unknown source');started.push(name);return item.promise;},()=>undefined);
  let settled=false;void pending.then(()=>{settled=true;return undefined;},()=>{settled=true;return undefined;});
  gates[1]?.fail(new Error('Original second refusal'));await Promise.resolve();
  gates[0]?.finish(Uint8Array.of(0));await Promise.resolve();await Promise.resolve();
  expect(settled).toBe(false);expect(started).toEqual(names.slice(0,4));
  gates[2]?.finish(Uint8Array.of(2));gates[3]?.finish(Uint8Array.of(3));
  await expect(pending).rejects.toThrow('Original second refusal');expect(started).not.toContain('never');
});

test('an owner changed during a read refuses the whole unpublished input set',async()=>{
  const names=['a','b','c','d','never'],gates=names.map(()=>gate());let retired=false;
  const read=vi.fn((name:string)=>{const item=gates[names.indexOf(name)];if(item===undefined)throw new Error('Unknown source');return item.promise;});
  const pending=readFileInputs(names,read,()=>{if(retired)throw new Error('Original owner retired');});
  retired=true;for(const item of gates.slice(0,4))item.finish(Uint8Array.of(1));
  await expect(pending).rejects.toThrow('Original owner retired');expect(read).toHaveBeenCalledTimes(4);
});
