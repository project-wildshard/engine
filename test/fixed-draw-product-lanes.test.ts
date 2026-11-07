import { expect, test, vi } from 'vitest';
import { zlibSync } from 'fflate';
import { Scope } from '../src/shared/engine/app/scope';
import { coldFixedDraws, fixedDraws, productFixedDraws } from '../src/client/game/models/fixedDraws';

const raw = new Uint8Array(new Float32Array([0,0,0,1,0,0,0,1,0, 2,0,0,3,0,0,2,1,0]).buffer);
const lanes = new Uint8Array(raw.length);
for(let i=0;i<raw.length/4;i++)for(let channel=0;channel<4;channel++)lanes[channel*raw.length/4+i]=raw[i*4+channel]??0;
const compressed=zlibSync(lanes);
const baked={attrs:[['position','f32',3,false]],count:3,index:null,indexCount:0,box:true,expand:false};
const rows=[{slot:'first',channels:[],lane:{file:'models/actors.bin',offset:0},baked},
  {slot:'second',channels:[],lane:{file:'models/actors.bin',offset:36},baked}];

test('product lane blocks decode one verified bank and retain both original byte spans',async()=>{
  const file=vi.fn(()=>Promise.resolve(compressed)),fallback=vi.fn(()=>Promise.reject(new Error('No URL fallback')));
  const draws=fixedDraws({slug:'lane-fixture',file},rows,undefined,fallback);
  await draws.load();expect(file).toHaveBeenCalledExactlyOnceWith('models/actors.bin');expect(fallback).not.toHaveBeenCalled();
  for(const [index,slot]of ['first','second'].entries()){
    const geometry=draws.handle(slot).copy(),actual=geometry.getAttribute('position').array;
    expect(Array.from(actual)).toEqual(Array.from(new Float32Array(raw.buffer,index*36,9)));geometry.dispose();draws.handle(slot).take().dispose();
  }
});

test('lane files require the product capability and refuse mixed locations and corrupt bytes',async()=>{
  await expect(productFixedDraws({json:()=>Promise.resolve(rows)},'draws')).rejects.toThrow('file reader required');
  expect(()=>fixedDraws({slug:'x',file:()=>Promise.resolve(compressed)},[{...rows[0],lane:{file:'bank',url:'/assets/bank',offset:0}}])).toThrow();
  const fallback=vi.fn(()=>Promise.resolve(raw));
  await expect(fixedDraws({slug:'x',file:()=>Promise.resolve(new Uint8Array([1,2,3]))},rows,undefined,fallback).load()).rejects.toThrow();
  expect(fallback).not.toHaveBeenCalled();
});

test('product lane reads pin their reader and cold cards release their exact selected slots',async()=>{
  let deliver:(value:Uint8Array)=>void=()=>undefined;
  const pending=new Promise<Uint8Array>(resolve=>{deliver=resolve;});
  const product={slug:'lanes',json:()=>Promise.resolve(rows),file:()=>pending};
  const draws=await productFixedDraws(product,'draws'),load=draws.load();
  await Promise.resolve();product.file=()=>Promise.resolve(compressed);deliver(compressed);
  await expect(load).rejects.toThrow('reader changed');
  const scope=new Scope('lane-card'),file=vi.fn(()=>Promise.resolve(compressed));
  const cold=await coldFixedDraws({slug:'lanes',file},rows,scope,['second']);
  expect(file).toHaveBeenCalledOnce();expect(cold.handle('second').copy().getAttribute('position').getX(0)).toBe(2);
  expect(()=>cold.handle('first')).toThrow('Undeclared');scope.dispose();expect(cold.ready).toBe(false);
  expect(()=>cold.handle('second')).toThrow('owner left');
});
