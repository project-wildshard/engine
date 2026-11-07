import {expect,test,vi} from 'vitest';
import * as v from 'valibot';
import {SaveStore,type SaveStorage} from '../src/shared/engine/saves/store';
import {checkpointByteText} from '../src/shared/engine/script/checkpointBytes';

function fixture() {
  const values=new Map<string,string>();let writes=0,blocked=false;
  const storage:SaveStorage={get length(){return values.size;},key:index=>[...values.keys()][index]??null,
    getItem:key=>values.get(key)??null,setItem:(key,value)=>{writes++;if(blocked)throw new Error('full');values.set(key,value);},removeItem:key=>{values.delete(key);}};
  const store=new SaveStore({local:storage,session:storage});
  const slot=store.define({key:'heap.value',scope:'global',version:1,schema:v.object({value:v.number()}),initial:()=>({value:0})});
  return {slot,values,writes:()=>writes,block:()=>{blocked=true;},unblock:()=>{blocked=false;}};
}

test('unchanged document reads reuse parsing and identical writes preserve durable content',()=>{
  const f=fixture(),input={value:1};expect(f.slot.write(input)).toBe(true);input.value=9;
  const before=f.writes(),parse=vi.spyOn(JSON,'parse');
  try {
    expect(f.slot.read()).toEqual({value:1});expect(f.slot.read()).toEqual({value:1});
    expect(parse).not.toHaveBeenCalled();expect(f.slot.write({value:1})).toBe(true);expect(f.writes()).toBe(before);
  }finally{parse.mockRestore();}
  const document=[...f.values.entries()].find(([,raw])=>raw.includes('heap.value'));
  if(document===undefined)throw new Error('Missing saved document');
  f.values.set(document[0],JSON.stringify({keys:{'heap.value':{v:1,data:{value:3}},foreign:{v:1,data:'preserved'}}}));
  expect(f.slot.read()).toEqual({value:3});expect(f.slot.write({value:4})).toBe(true);
  expect(f.values.get(document[0])).toContain('preserved');
});

test('equal memory content still retries a failed durable write',()=>{
  const f=fixture();expect(f.slot.write({value:1})).toBe(true);f.block();
  expect(f.slot.write({value:2})).toBe(false);const before=f.writes();
  expect(f.slot.write({value:2})).toBe(false);expect(f.writes()).toBeGreaterThan(before);
  f.unblock();expect(f.slot.write({value:2})).toBe(true);expect(f.slot.read()).toEqual({value:2});
});

test('raw byte checkpoint encoding preserves the complete historical JSON wire',()=>{
  for(const bytes of [new Uint8Array(),Uint8Array.from({length:256},(_,index)=>index),new Uint8Array(65536).fill(255)])
    expect(checkpointByteText(bytes)).toBe(JSON.stringify(Array.from(bytes)));
});
