import {expect,it} from 'vitest';
// oxlint-disable-next-line import/no-nodejs-modules -- This static guard fixture owns all temporary source files.
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Construct paths only inside the isolated fixture.
import {dirname,join} from 'node:path';
// oxlint-disable-next-line import/no-nodejs-modules -- Small source fixture, never an exported checkout.
import {tmpdir} from 'node:os';
import {simRuntimeInventory,simRuntimeFailures} from '../scripts/sim-in-runtime.mjs';

it('tracks value reach through other shard folders, lazy edges and cycles, excluding client/type-only code',()=>{
 const root=mkdtempSync(join(tmpdir(),'sim-runtime-reach-'));
 const put=(path:string,source:string):void=>{const file=join(root,'src/shards/demo',path);mkdirSync(dirname(file),{recursive:true});writeFileSync(file,source);};
 try{
  put('runtime/headless.ts',"import '../world/server'; import type {Client} from './client'; export const prepareHeadlessRuntime=() => import('./quest');");
  put('world/server.ts',"export {step} from '../runtime/combat'; export type {Client} from '../runtime/client';");
  put('runtime/combat.ts',"import '../world/server'; export const step=1;");
  put('runtime/quest.ts','export const quest=1;');
  put('runtime/client.ts','export interface Client { id:string }');
  put('runtime/view.ts',"export const draw=() => 'client-only';");
  expect(simRuntimeInventory(root)['demo']).toEqual({entries:['src/shards/demo/runtime/headless.ts'],files:['src/shards/demo/runtime/combat.ts','src/shards/demo/runtime/headless.ts','src/shards/demo/runtime/quest.ts']});
  const inventory=simRuntimeInventory(root),files=inventory['demo']?.files??[];
  const policy={budgets:{'sim-in-runtime/demo':3},allow:{'shardfile/sim-in-runtime':Object.fromEntries(files.map(path=>[path,'G453 baseline']))}};
  expect(simRuntimeFailures(policy,inventory)).toEqual([]);
  put('runtime/quest.ts',"export const quest=() => import('./newSim');");put('runtime/newSim.ts','export const rule=1;');
  expect(simRuntimeFailures(policy,simRuntimeInventory(root))).toEqual(['demo: sim-in-runtime files 4 exceeds 3','src/shards/demo/runtime/newSim.ts: new sim-in-runtime file; move server logic to sections/hosts or Wasm (G453)']);
  put('runtime/quest.ts','export const quest=1;');put('runtime/headless.ts',"export const prepareHeadlessRuntime=() => import('./quest');");
  expect(simRuntimeFailures(policy,simRuntimeInventory(root))).toEqual(['demo: lower sim-in-runtime baseline 3 to 2','src/shards/demo/runtime/combat.ts: remove retired sim-in-runtime allowance (G453)']);
 }finally{rmSync(root,{recursive:true,force:true});}
});

it('recognizes a renamed exported entry and refuses computed or unresolved value edges',()=>{
 const root=mkdtempSync(join(tmpdir(),'sim-runtime-entry-'));
 const put=(path:string,source:string):void=>{const file=join(root,'src/shards/demo',path);mkdirSync(dirname(file),{recursive:true});writeFileSync(file,source);};
 try{
  put('sim/server.ts',"export const prepareHeadlessRuntime=() => import('../runtime/rule');");
  put('runtime/rule.ts','export const rule=1;');
  expect(simRuntimeInventory(root)['demo']?.files).toEqual(['src/shards/demo/runtime/rule.ts']);
  put('runtime/rule.ts','export const rule=(path:string) => import(path);');
  expect(()=>simRuntimeInventory(root)).toThrow('computed import');
  put('runtime/rule.ts',"import './missing'; export const rule=1;");
  expect(()=>simRuntimeInventory(root)).toThrow('unresolved value import');
 }finally{rmSync(root,{recursive:true,force:true});}
});

it('does not let replacement files spend room from retired sim debt',()=>{
 const inventory={demo:{entries:[],files:['src/shards/demo/runtime/new.ts']}};
 const policy={budgets:{'sim-in-runtime/demo':1},allow:{'shardfile/sim-in-runtime':{'src/shards/demo/runtime/old.ts':'G453 baseline'}}};
 expect(simRuntimeFailures(policy,inventory)).toEqual(['src/shards/demo/runtime/new.ts: new sim-in-runtime file; move server logic to sections/hosts or Wasm (G453)','src/shards/demo/runtime/old.ts: remove retired sim-in-runtime allowance (G453)']);
 expect(simRuntimeFailures({},inventory)).toContain('demo: missing sim-in-runtime baseline');
});

it('keeps declared assembly installer dependencies in the native census',()=>{
 const root=mkdtempSync(join(tmpdir(),'sim-runtime-assembly-'));
 const put=(path:string,source:string):void=>{const file=join(root,'src/shards/demo',path);mkdirSync(dirname(file),{recursive:true});writeFileSync(file,source);};
 try{
  put('sim/headlessModules.ts',"import * as owners from '../runtime/owners'; export const headlessModules = { 'src/shards/demo/runtime/owners': owners };");
  put('runtime/owners.ts',"import './quest'; export const install=() => undefined;");
  put('runtime/quest.ts','export const quest=1;');
  expect(simRuntimeInventory(root)['demo']).toEqual({entries:['src/shards/demo/sim/headlessModules.ts'],files:['src/shards/demo/runtime/owners.ts','src/shards/demo/runtime/quest.ts']});
  expect(simRuntimeFailures({budgets:{'sim-in-runtime/demo':0}},simRuntimeInventory(root))).toContain('demo: sim-in-runtime files 2 exceeds 0');
 }finally{rmSync(root,{recursive:true,force:true});}
});

it('keeps JSON native roots visible after the catalogue moves outside source',()=>{
 const root=mkdtempSync(join(tmpdir(),'sim-runtime-generated-map-'));
 const put=(path:string,source:string):void=>{const file=join(root,'src/shards/demo',path);mkdirSync(dirname(file),{recursive:true});writeFileSync(file,source);};
 try{
  put('data/headlessAssembly.json',JSON.stringify({version:1,modules:{'src/shards/demo/runtime/owners':['install'],'src/shards/demo/data/constants.json':['default'],'@wildshard/engine/game/proof/entryways':['proveEntryways']}}));
  put('runtime/owners.ts',"import './quest'; export const install=() => undefined;");
  put('runtime/quest.ts','export const quest=1;');
  put('data/constants.json','{}');
  const inventory=simRuntimeInventory(root),files=inventory['demo']?.files??[];
  expect(inventory['demo']).toEqual({entries:['src/shards/demo/runtime/owners.ts'],files:['src/shards/demo/runtime/owners.ts','src/shards/demo/runtime/quest.ts']});
  expect(simRuntimeFailures({budgets:{'sim-in-runtime/demo':2},allow:{'shardfile/sim-in-runtime':Object.fromEntries(files.map(path=>[path,'G453 baseline']))}},inventory)).toEqual([]);
  put('data/headlessAssembly.json',JSON.stringify({version:1,modules:{'src/shards/demo/runtime/missing':['install']}}));
  expect(()=>simRuntimeInventory(root)).toThrow('unresolved declared assembly module');
 }finally{rmSync(root,{recursive:true,force:true});}
});
