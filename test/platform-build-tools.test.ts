import {expect,it} from 'vitest';
// oxlint-disable-next-line import/no-nodejs-modules -- Isolated attribution fixture sources.
import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- All paths stay within the fixture root.
import {dirname,join,resolve} from 'node:path';
// oxlint-disable-next-line import/no-nodejs-modules -- Small disposable fixture, never a repository export.
import {tmpdir} from 'node:os';
import {checkShares,sourceProgressInventory,codeLines} from '../scripts/shard-platform.mjs';
import {platformOutput} from './fixtures/platformOutputs';
import {legacyLineBasis} from './fixtures/legacyLineBasis';
import {authoredManifestSource} from '../scripts/authored-manifest.mjs';
import generatedSources from '../scripts/source-generation-outputs.json' with {type:'json'};

// LD10: a product ships no runtime TypeScript, so authored runtime roots its G294 users on the source basis
it('excludes only the G456 build-tool paths from whole-module charges',()=>{
 const root=mkdtempSync(join(tmpdir(),'platform-build-tools-'));
 const put=(path:string,source:string):void=>{const file=join(root,path);mkdirSync(dirname(file),{recursive:true});writeFileSync(file,source);};
 try{
  put('src/sharddev/package.json',JSON.stringify({name:'@wildshard/sharddev',exports:{'./bake/tool':'./bake/tool.ts','./project':'./project.ts','./bakeTools':'./bakeTools.ts','./projectOther':'./projectOther.ts'}}));
  put('src/sharddev/bake/tool.ts',"import {helper} from '../runtimeHelper'; export const bake=helper;");
  put('src/sharddev/project.ts','export const project=1;');
  put('src/sharddev/bakeTools.ts','export const runtimeTool=1;');
  put('src/sharddev/projectOther.ts','export const other=1;');
  put('src/sharddev/runtimeHelper.ts','export const helper=1;');
  platformOutput(root,'pine-hollow',{'runtime/index.ts':"import {bake} from '@wildshard/sharddev/bake/tool'; import {project} from '@wildshard/sharddev/project'; import {runtimeTool} from '@wildshard/sharddev/bakeTools'; import {other} from '@wildshard/sharddev/projectOther'; export const live=[bake,project,runtimeTool,other];"});
  expect(sourceProgressInventory(root)['pine-hollow']?.conversion.gameSystemAttribution.modules.map(row=>row.path)).toEqual(['src/sharddev/bakeTools.ts','src/sharddev/projectOther.ts','src/sharddev/runtimeHelper.ts']);
 }finally{rmSync(root,{recursive:true,force:true});}
});

it('also excludes sole declarations inside shared build modules, retaining runtime SDK declarations',()=>{
 const root=mkdtempSync(join(tmpdir(),'platform-build-exports-'));
 const put=(path:string,source:string):void=>{const file=join(root,path);mkdirSync(dirname(file),{recursive:true});writeFileSync(file,source);};
 try{
  put('src/sharddev/package.json',JSON.stringify({name:'@wildshard/sharddev',exports:{'./bake/tool':'./bake/tool.ts','./project':'./project.ts','./runtime':'./runtime.ts'}}));
  for(const path of ['src/sharddev/bake/tool.ts','src/sharddev/project.ts','src/sharddev/runtime.ts'])put(path,'export const first=1;\nexport const second=2;');
  for(const [slug,name]of [['pine-hollow','first'],['driftwood-isle','second']] as const)platformOutput(root,slug,{'runtime/index.ts':`import {${name} as bake} from '@wildshard/sharddev/bake/tool'; import {${name} as project} from '@wildshard/sharddev/project'; import {${name} as runtime} from '@wildshard/sharddev/runtime'; export const live=[bake,project,runtime];`});
  const rows=sourceProgressInventory(root);
  expect(rows['pine-hollow']?.conversion.gameSystemAttribution.exports).toEqual([{path:'src/sharddev/runtime.ts',name:'first',exported:true,lines:1}]);
  expect(rows['driftwood-isle']?.conversion.gameSystemAttribution.exports).toEqual([{path:'src/sharddev/runtime.ts',name:'second',exported:true,lines:1}]);
 }finally{rmSync(root,{recursive:true,force:true});}
});

it.each([0,1])('reports AS excess without enforcing it while checking %i custom TS lines',(custom)=>{
 const root=mkdtempSync(join(tmpdir(),'platform-as-budget-'));
 const put=(path:string,source:string):void=>{const file=join(root,path);mkdirSync(dirname(file),{recursive:true});writeFileSync(file,source);};
 try{
  platformOutput(root,'pine-hollow',{'runtime/index.ts':custom===0?'':'export const LIVE=1;'});
  put('src/shards/pine-hollow/behaviour/brain.as','export function step(): i32 {\n return 1;\n}');
  legacyLineBasis(root,'pine-hollow',{'manifest.ts':'export default {};','plugin.ts':Array.from({length:9},(_,i)=>`export const V${i}=${i};`).join('\n')});
  const row=sourceProgressInventory(root)['pine-hollow'];
  if(row===undefined)throw new Error('Missing fixture measure');
  expect(row.conversion.customRuntimeLines).toBe(custom);
  expect(row.assemblyScriptBudget).toEqual({ceiling:1,share:.3,passed:false,enforcement:'report-only'});
  expect(checkShares({baseline:{'pine-hollow':10},enforced:{'pine-hollow':2}},{'pine-hollow':row}))
   .toEqual(custom===0?[]:['pine-hollow: custom runtime is not zero (G604)']);
  platformOutput(root,'pastel-plain',{'runtime/index.ts':'export const LIVE=1;'});
  expect(sourceProgressInventory(root)['pastel-plain']?.assemblyScriptBudget).toEqual({ceiling:null,share:null,passed:null,enforcement:'report-only'});
 }finally{rmSync(root,{recursive:true,force:true});}
});

it('never roots build-only data, generators or project config as runtime users',()=>{
 const root=mkdtempSync(join('tmp/','platform-build-roots-'));
 const put=(path:string,source:string):void=>{const file=join(root,path);mkdirSync(dirname(file),{recursive:true});writeFileSync(file,source);};
 try{
  put('src/game/package.json',JSON.stringify({name:'@wildshard/game',exports:{'./painter':'./painter.ts'}}));
  put('src/game/painter.ts','export function paint() { return 1; }');
  platformOutput(root,'pine-hollow',{'runtime/index.ts':'export const live=1;'});
  for(const path of ['data/table.ts','generators/atlas.ts','shard.config.ts']){
   put(`src/shards/pine-hollow/${path}`,"import {paint} from '@wildshard/engine/game/painter'; export const baked=paint();");
  }
  const row=sourceProgressInventory(root)['pine-hollow'];
  expect(row?.conversion.gameSystemAttribution.lines).toBe(0);
  expect(row?.customSources?.some(source=>source.path==='src/game/painter.ts')).toBe(false);
 }finally{rmSync(root,{recursive:true,force:true});}
});

it('keeps a sole runtime user charged until a second runtime reaches the generator',()=>{
 const root=mkdtempSync(join('tmp/','platform-generator-users-'));
 const put=(path:string,source:string):void=>{const file=join(root,path);mkdirSync(dirname(file),{recursive:true});writeFileSync(file,source);};
 try{
  put('src/game/package.json',JSON.stringify({name:'@wildshard/game',exports:{'./shared':'./shared.ts'}}));
  put('src/shared/game.ts','export function live() { return 1; }\nexport function other() { return 2; }');
  platformOutput(root,'pine-hollow',{'runtime/index.ts':"import {live} from '@wildshard/engine/game/shared'; export const value=live();"});
  platformOutput(root,'driftwood-isle',{'runtime/index.ts':"import {other} from '@wildshard/engine/game/shared'; export const value=other();"});
  put('src/shards/driftwood-isle/data/bridge.ts',"import {baked} from '../generators/atlas'; export const value=baked;");
  put('src/shards/driftwood-isle/generators/atlas.ts',"import {live} from '@wildshard/engine/game/shared';\nexport const baked=live();");
  const before=sourceProgressInventory(root);
  expect(before['pine-hollow']?.conversion.gameSystemAttribution.exports).toEqual([{path:'src/shared/game.ts',name:'live',exported:true,lines:1}]);
  expect(before['driftwood-isle']?.customSources?.some(source=>source.path.endsWith('generators/atlas.ts'))).toBe(false);
  put('src/shards/driftwood-isle/runtime/index.ts',"import {other} from '@wildshard/engine/game/shared'; export async function value() { return [other(),(await import('../data/bridge')).value]; }");
  const after=sourceProgressInventory(root);
  expect(after['pine-hollow']?.conversion.gameSystemAttribution.exports).toEqual([]);
  expect(after['driftwood-isle']?.customSources).toContainEqual(expect.objectContaining({path:'src/shards/driftwood-isle/generators/atlas.ts',kind:'runtime-ts',lines:2}));
 }finally{rmSync(root,{recursive:true,force:true});}
});


it.each(['blender-template','nine-dragon-stack','ink-cel-valley','nalati-grasslands'])('registers %s discovery as generated without excluding its authored data',(slug)=>{
 const root=mkdtempSync(join('tmp/','platform-blender-discovery-'));
 const put=(path:string,source:string):void=>{const file=join(root,path);mkdirSync(dirname(file),{recursive:true});writeFileSync(file,source);};
 try{
  platformOutput(root,slug);
  const discovery=slug==='ink-cel-valley'?authoredManifestSource(resolve('.'),slug):'export const generated=1;';
  put(`src/shards/${slug}/discovery.generated.ts`,discovery);
  put(`src/shards/${slug}/data/authored.ts`,'export const authored=1;');
  expect(sourceProgressInventory(root)[slug]?.conversion.customRuntimeLines).toBe(1+codeLines(discovery));
  put('scripts/source-generation-outputs.json',JSON.stringify(generatedSources));
  const row=sourceProgressInventory(root)[slug];
  expect(row?.conversion.customRuntimeLines).toBe(1);
  expect(row?.customSources?.map(source=>source.path)).toEqual([`src/shards/${slug}/data/authored.ts`]);
 }finally{rmSync(root,{recursive:true,force:true});}
});
