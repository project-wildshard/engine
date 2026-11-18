import {expect,test} from 'vitest';
import {censusTable,closure,siteOf} from '../scripts/memory/census.mjs';

test('the census table sums live bytes by site and by ledger owner',()=>{
  const t=censusTable([{kind:'Float32Array',bytes:100,site:'a.ts:1',owner:'engine/ground-merge'},{kind:'Float32Array',bytes:50,site:'a.ts:1',owner:null},{kind:'ArrayBuffer.slice',bytes:10,site:'b.ts:2',owner:'unattributed'}]);
  expect(t).toMatchObject({total:160,owned:100,byOwner:{'engine/ground-merge':100,'not in the ledger':50,unattributed:10}});
  expect(t.bySite[0]).toMatchObject({site:'Float32Array | a.ts:1',bytes:150,count:2});
});

test('closure: ArrayBuffer kinds of the page and every worker against the partition; wasm against live memories',()=>{
  const ledger={ram:{'array-buffer':20,'geometry-cpu':60,wasm:7,'audio-buffer':500,canvas:9},workers:{'standalone-server/wasm':3,'standalone-server/physics':10,'decode/isolate':0}};
  expect(closure(ledger,{partition:100,censusBytes:95,wasm:10})).toEqual({arrayBuffers:90,ratio:0.9,within10Pct:true,censusRatio:0.95,wasm:10,wasmSeen:10,wasmEqual:true,workerNames:['standalone-server','decode']});
  expect(closure(ledger,{partition:200,censusBytes:95,wasm:11})).toMatchObject({ratio:0.45,within10Pct:false,wasmEqual:false});
  expect(closure(null,{partition:null,censusBytes:0,wasm:0})).toMatchObject({arrayBuffers:0,ratio:null,within10Pct:false});
});

test('a worker name passes through; an unmapped frame keeps its column',()=>{
  expect(siteOf('worker tileDecodeWorker.js',()=>null,'/d',()=>({}))).toBe('worker tileDecodeWorker.js');
  expect(siteOf('Error\n    at f (http://127.0.0.1:1/b/x.js:3:44)',()=>null,'/d',()=>({}))).toBe('x.js:3:44');
});
