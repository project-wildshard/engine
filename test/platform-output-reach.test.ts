import {expect,it,vi} from 'vitest';
// oxlint-disable-next-line import/no-nodejs-modules -- Disposable output/reach fixture, never a repository export.
import {mkdtempSync,mkdirSync,writeFileSync,rmSync,unlinkSync} from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Confined fixture paths.
import {join,dirname} from 'node:path';
// oxlint-disable-next-line import/no-nodejs-modules -- Small temporary test repository.
import {tmpdir} from 'node:os';
import {outputCensus,outputShardLines,sourceProgressLines,sourceProgressInventory} from '../scripts/shard-platform.mjs';
import {sectionHostImports} from '../scripts/shard-platform-hosts.mjs';
import {platformOutput} from './fixtures/platformOutputs';

// LD10: a product ships no runtime TypeScript. The output basis roots only its emitted section hosts; authored runtime
// roots its G294 users on the source basis. Build imports are users on neither.
it('roots G294 in emitted section hosts and authored runtime, never build imports',()=>{
 const root=mkdtempSync(join(tmpdir(),'platform-output-reach-'));
 const put=(path:string,source:string):void=>{const file=join(root,path);mkdirSync(dirname(file),{recursive:true});writeFileSync(file,source);};
 try{
  put('src/game/package.json',JSON.stringify({name:'@wildshard/game',exports:{'./private':'./private.ts'}}));
  put('src/game/private.ts','export function live() { return 1; }\nexport function authored() { return 2; }');
  put('src/shared/game/shard/declaredRows.ts','export function declaredWeather() { return 1; }\nexport function unrelated() { return 2; }');
  platformOutput(root,'pine-hollow',{'runtime/index.ts':"import {live} from '@wildshard/engine/game/private'; export const value=live();"},{'world/weather':'{"rows":{"weather":[]}}'});
  platformOutput(root,'driftwood-isle',{'runtime/index.ts':'export const value=1;'});
  put('src/shards/driftwood-isle/data/build.ts',"import {live,authored} from '@wildshard/engine/game/private'; export const table=[live(),authored()];");
  const pine=outputShardLines(root,true)['pine-hollow'];
  expect(pine?.measurement).toBe('built-output');
  expect(pine?.conversion.shardRuntimeLines).toBe(0);
  expect(pine?.conversion.gameSystemAttribution.modules.map(row=>row.path)).toContain('src/shared/game/shard/declaredRows.ts');
  expect(pine?.customSources?.some(row=>row.kind==='runtime-ts'||row.path.includes('data/'))).toBe(false);
  const source=sourceProgressInventory(root)['pine-hollow'];
  expect(source?.conversion.shardRuntimeLines).toBe(1);
  expect(source?.conversion.gameSystemAttribution.modules.map(row=>row.path)).toContain('src/game/private.ts');
  expect(source?.conversion.gameSystemAttribution.modules.map(row=>row.path)).toContain('src/shared/game/shard/declaredRows.ts');
  // A real second runtime user, unlike the authoring import above, shares the module.
  platformOutput(root,'driftwood-isle',{'runtime/index.ts':"import {live} from '@wildshard/engine/game/private'; export const value=live();"});
  expect(sourceProgressInventory(root)['pine-hollow']?.conversion.gameSystemAttribution.modules.map(row=>row.path)).not.toContain('src/game/private.ts');
 }finally{rmSync(root,{recursive:true,force:true});}
});

it('rejects unknown section hosts and absent outputs instead of measuring source',()=>{
 expect(()=>sectionHostImports([{name:'world/unreviewed'}])).toThrow('No output host attribution');
 expect(sectionHostImports([{name:'custom/private'}])).toBe('');
 const root=mkdtempSync(join(tmpdir(),'platform-output-missing-'));
 try{
  mkdirSync(join(root,'src/shards/_template/runtime'),{recursive:true});
  writeFileSync(join(root,'src/shards/_template/runtime/index.ts'),'export const value=1;');
  expect(()=>outputShardLines(root)).toThrow('section inventory missing');
 }finally{rmSync(root,{recursive:true,force:true});}
});

it('attributes body sections to defining hosts without a native barrel adapter',()=>{
 const roots=sectionHostImports([{name:'sim/bodies'},{name:'sim/bodies'}]);
 expect(roots.split('\n')).toEqual([
  "import { DeclaredBodyOpsSchema as host0 } from '@wildshard/format/bodySlots'; void host0;",
  "import { DeclaredBodyOps as host1 } from '../../src/server/game/quest/bodyOps'; void host1;",
 ]);
 expect(roots).not.toContain('nativeBodyScripts');
});

it('attributes portable collection and island roots to their defining native owners',()=>{
 const roots=sectionHostImports([{name:'collections/displays'},{name:'models/island-library'},{name:'collections/displays'}]);
 expect(roots.split('\n')).toEqual([
  "import { CollectionCatalogue as host0 } from '../../src/client/game/models/collectionDisplay'; void host0;",
  "import { IslandLibrary as host1 } from '../../src/client/game/models/islandLibrary'; void host1;",
 ]);
 const root=mkdtempSync(join('tmp/','platform-island-hosts-'));
 const put=(path:string,source:string):void=>{const file=join(root,path);mkdirSync(dirname(file),{recursive:true});writeFileSync(file,source);};
 try{
  put('src/client/game/models/collectionDisplay.ts','export class CollectionCatalogue { prepare() { return 1; } }\nexport function authorOnly() { return 2; }');
  put('src/client/game/models/islandLibrary.ts',"import {CollectionCatalogue} from './collectionDisplay'; export class IslandLibrary { collections=new CollectionCatalogue(); }");
  platformOutput(root,'driftwood-isle',{'runtime/index.ts':'export const entry=1;'},
   {'collections/displays':'{}','models/island-library':'{}'});
  const charge=outputShardLines(root)['driftwood-isle']?.conversion.gameSystemAttribution;
  expect(charge?.modules.map(row=>row.path)).toEqual(expect.arrayContaining(['src/client/game/models/collectionDisplay.ts','src/client/game/models/islandLibrary.ts']));
  // Classes retain whole-module charges; their native owners must not vanish
  // merely because no explicit copied runtime import names them.
  expect(charge?.modules.filter(row=>row.lines>0)).toHaveLength(2);
  expect(sourceProgressLines(root)['driftwood-isle']?.customLines).toBeGreaterThan(1);
 }finally{rmSync(root,{recursive:true,force:true});}
});

it('attributes declared moves and decisions to their defining sim hosts',()=>{
 const roots=sectionHostImports([{name:'actors/moves'},{name:'sim/scripts'}]);
 expect(roots).toContain('engine/server/ai/moves');
 expect(roots).toContain('ActorMoveRunner');
 expect(roots).toContain('format/actorMoves');
 expect(roots).toContain('engine/server/script/decision');
 expect(roots).toContain('DecisionHost');
 expect(roots).toContain('format/decisionScripts');
});


it('keeps a data-selected native plan as a real user after its wrapper is removed',()=>{
 const root=mkdtempSync(join(tmpdir(),'platform-native-plan-'));
 const put=(path:string,source:string):void=>{const file=join(root,path);mkdirSync(dirname(file),{recursive:true});writeFileSync(file,source);};
 try{
  put('src/game/package.json',JSON.stringify({name:'@wildshard/game',exports:{'./plugin/simulation':'./plugin/simulation.ts'}}));
  put('src/server/game/plugin/simulation.ts','export function prepareRuntimePlan() { return 1; }\nexport function unrelated() { return 2; }');
  put('src/server/game/shardfile/nativePlan.ts',"import {prepareRuntimePlan} from '../plugin/simulation'; export function prepareProductRuntimePlan() { return prepareRuntimePlan(); }");
  platformOutput(root,'sunscar-dunes',{'runtime/index.ts':"import {prepareRuntimePlan} from '@wildshard/engine/game/plugin/simulation'; export const plan=prepareRuntimePlan();"});
  platformOutput(root,'far-reach',{'runtime/index.ts':'export const view=1;'});
  const before=sourceProgressLines(root)['sunscar-dunes']?.customLines;
  platformOutput(root,'far-reach',{'runtime/index.ts':'export const view=1;'},{'sim/runtime-plan':'{}'});
  expect(before).toBe(3);
  expect(sourceProgressLines(root)['sunscar-dunes']?.customLines).toBe(1);
  expect(sourceProgressInventory(root)['sunscar-dunes']?.conversion.gameSystemAttribution.exports.map(row=>row.name)).not.toContain('prepareRuntimePlan');
  expect(sectionHostImports([{name:'sim/runtime-plan'}])).toContain('prepareProductRuntimePlan');
  const index=join(root,'out/far-reach/shard.json');
  unlinkSync(index);
  expect(()=>sourceProgressLines(root)).toThrow('far-reach: section inventory missing');
  platformOutput(root,'far-reach',{'runtime/index.ts':'export const view=1;'},{'sim/runtime-plan':'{}'});
  expect(sourceProgressLines(root)['sunscar-dunes']?.customLines).toBe(1);
  put('out/far-reach/sections/sim/runtime-plan.json','{"corrupt":true}');
  expect(()=>sourceProgressLines(root)).toThrow('section hash/size mismatch');
 }finally{rmSync(root,{recursive:true,force:true});}
});


it('does not grant runtime users to inert JSON proof module strings',()=>{
 const root=mkdtempSync(join('tmp/','platform-native-proof-'));
 const put=(path:string,source:string):void=>{const file=join(root,path);mkdirSync(dirname(file),{recursive:true});writeFileSync(file,source);};
 try{
  put('src/game/package.json',JSON.stringify({name:'@wildshard/game',exports:{'./proof':'./proof.ts'}}));
  put('src/game/proof.ts','export function admitted() { return 1; }\nexport function unrelated() { return 2; }');
  platformOutput(root,'pine-hollow',{'runtime/index.ts':"import {admitted,unrelated} from '@wildshard/engine/game/proof'; export const value=[admitted(),unrelated()];"});
  platformOutput(root,'driftwood-isle',{'runtime/index.ts':'export const value=1;'});
  put('src/shards/driftwood-isle/data/headlessAssembly.json',JSON.stringify({version:1,modules:{'src/game/proof':['admitted']}}));
  expect(sourceProgressLines(root)['pine-hollow']?.customLines).toBe(3);
  put('src/shards/driftwood-isle/data/headlessAssembly.json',JSON.stringify({version:1,modules:{'src/game/proof':['missing']}}));
  expect(sourceProgressLines(root)['pine-hollow']?.customLines).toBe(3);
 }finally{rmSync(root,{recursive:true,force:true});}
});


it('shares syntax facts without merging source and output attribution',()=>{
 const root=mkdtempSync(join('tmp/','platform-shared-census-'));
 const put=(path:string,source:string):void=>{const file=join(root,path);mkdirSync(dirname(file),{recursive:true});writeFileSync(file,source);};
 try{
  vi.stubEnv('WS_SHARD_PARSE_CACHE',join(root,'.cache/parse'));
  put('src/game/package.json',JSON.stringify({name:'@wildshard/game',exports:{'./shared':'./shared.ts'}}));
  put('src/shared/game.ts','export function shared() { return 1; }');
  put('docs/ENGINE.md','game/shared');
  put('docs/plans/decisions.md','| G475 | approved toon |');
  put('lint/platform-pending-users.json',JSON.stringify({schema:'platform-pending-users/1',entries:[{
   module:'src/shared/game.ts',export:'shared',documentation:'docs/ENGINE.md',
   approvedFeature:{name:'toon look host',decision:{path:'docs/plans/decisions.md',row:'G475'}}
  }]}));
  platformOutput(root,'pine-hollow',{'runtime/index.ts':"import {shared} from '@wildshard/engine/game/shared'; export const value=shared();"});
  platformOutput(root,'driftwood-isle',{'runtime/index.ts':'export const value=1;'});
  put('src/shards/driftwood-isle/data/authored.ts',"import {shared} from '@wildshard/engine/game/shared'; export const value=shared();");
  const expected={measures:outputShardLines(root,true),inventory:sourceProgressInventory(root),source:sourceProgressLines(root)};
  expect(outputCensus(root)).toEqual(expected);
  put('src/shared/game.ts','export function shared() {\n return 2;\n}');
  const changed=outputCensus(root);
  expect(changed.measures).toEqual(outputShardLines(root,true));
  expect(changed.source).toEqual(sourceProgressLines(root));
  expect(changed.inventory).toEqual(sourceProgressInventory(root));
  expect(changed.inventory).not.toEqual(expected.inventory);
  // A new report must validate current policy and exports even with a warm disk cache.
  put('docs/plans/decisions.md','| G476 | unrelated |');
  expect(()=>outputCensus(root)).toThrow('Missing platform feature decision');
  put('docs/plans/decisions.md','| G475 | approved toon |');
  put('src/shared/game.ts','export function renamed() { return 2; }');
  expect(()=>outputCensus(root)).toThrow('Missing pending platform export');
 }finally{vi.unstubAllEnvs();rmSync(root,{recursive:true,force:true});}
});


it.each([
 ["import { privateWork as defining } from '@wildshard/engine/game/implementation'; export const forwarded: typeof defining = defining;", "import { forwarded as previous } from './inner'; const local = previous; export const chosen = local;"],
 ["export { privateWork as forwarded } from '@wildshard/engine/game/implementation';", "export { forwarded as chosen } from './inner';"],
 ["import * as defining from '@wildshard/engine/game/implementation'; export const forwarded = defining.privateWork;", "import * as previous from './inner'; export const chosen = previous.forwarded;"],
 ["import { privateWork as defining } from '@wildshard/engine/game/implementation'; export default defining;", "import previous from './inner'; export const chosen = previous;"],
])('follows SDK forwarding chains to the same defining declarations (%s)',(inner,outer)=>{
 const root=mkdtempSync(join('tmp/','platform-forwarding-'));
 const put=(path:string,source:string):void=>{const file=join(root,path);mkdirSync(dirname(file),{recursive:true});writeFileSync(file,source);};
 try{
  put('src/game/package.json',JSON.stringify({name:'@wildshard/game',exports:{'./implementation':'./implementation.ts'}}));
  put('src/sharddev/package.json',JSON.stringify({name:'@wildshard/sharddev',exports:{'./outer':'./outer.ts'}}));
  put('src/game/implementation.ts','function helper() { return 1; }\nexport function privateWork() { return helper(); }\nexport function sharedWork() { return 2; }\nexport function unused() { return 3; }');
  put('src/sharddev/inner.ts',inner);put('src/sharddev/outer.ts',outer);
  platformOutput(root,'pine-hollow',{'runtime/index.ts':"import {privateWork} from '@wildshard/engine/game/implementation'; export const value=privateWork();"});
  platformOutput(root,'driftwood-isle',{'runtime/index.ts':"import {sharedWork} from '@wildshard/engine/game/implementation'; export const value=sharedWork();"});
  const defining=()=>sourceProgressInventory(root)['pine-hollow']?.customSources?.filter(row=>row.path==='src/game/implementation.ts');
  const direct=defining();
  expect(direct?.map(row=>row.name)).toEqual(['helper','privateWork']);
  platformOutput(root,'pine-hollow',{'runtime/index.ts':"import {chosen} from '@wildshard/sharddev/outer'; export const value=chosen();"});
  expect(defining()).toEqual(direct);
  // A genuine second shard using the same forwarded binding shares it;
  // forwarding modules themselves never manufacture another shard user.
  platformOutput(root,'driftwood-isle',{'runtime/index.ts':"import {chosen} from '@wildshard/sharddev/outer'; import {sharedWork} from '@wildshard/engine/game/implementation'; export const value=[chosen(),sharedWork()];"});
  expect(defining()).toEqual([]);
 }finally{rmSync(root,{recursive:true,force:true});}
});


it('attributes held loadout only to the shipping installer',()=>{
 const rows=sectionHostImports([{name:'held/loadout'}]);
 expect(rows).toBe("import { installHeldLoadout as host0 } from '../../src/client/game/loadout/held'; void host0;");
 expect(rows).not.toContain('NativeHeldAmmunition');
});
