// One process for the layer's consumer-program proofs (VITEST-BENCH VB10): each original file is a describe
// block, each test body is unchanged, and every consumer program now reuses one parse of the shared sources.
// oxlint-disable-next-line import/no-nodejs-modules -- Inspect defining declarations without generated products.
import {readFileSync} from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Resolve an unwritten schema consumer.
import {resolve} from 'node:path';
import ts from '@typescript/typescript6';
import {describe,expect,test} from 'vitest';
import {consumerDiagnostics} from '../engine/declarationConsumer';

describe('isolated-game-default-declarations',()=>{
for(const name of ["client/titleDeck","client/complete/declared","client/grid/menu","client/grid/pageResidency","shared/grid/roadRecovery","client/grid/roadSky","client/grid/tileDecoder","shared/plugin/animation","shared/plugin/director","server/population/actorProjectionV2","shared/quest/pagePersistence","shared/quest/pageState","client/quest/story","client/riding/seatedFigure","client/shardfile/clientSource","client/shardfile/tileDriver","client/travel/travel"])test(`${name} emits isolated declarations`,()=>{
 const emitted=ts.transpileDeclaration(readFileSync(`src/${name.replace(/^(client|shared|server|cook)\//u, '$1/game/')}.ts`,'utf8'),{fileName:`${name}.ts`,reportDiagnostics:true,compilerOptions:{isolatedDeclarations:true,strict:true,exactOptionalPropertyTypes:true}});
 expect(emitted.diagnostics).toEqual([]);
 expect(emitted.outputText.length).toBeLessThan(100_000);
});

test('game defaults retain optional parameters and original argument kinds',()=>{
 const consumer=resolve('src/test/game/t4-isolated-game-default-declarations-consumer.ts');
 let source="import {titleCards} from '../../client/game/titleDeck';\nimport {gridEntryShown} from '../../client/game/grid/menu';\nimport {roadSunDir} from '../../client/game/grid/roadSky';\nimport {followRing} from '../../client/game/shardfile/tileDriver';\nimport {travelSlot} from '../../client/game/travel/travel';\nimport type {Vector3} from 'three';\nexport const cards=titleCards();\nexport const hidden=titleCards(true);\nexport const shown:boolean=gridEntryShown();\nexport const sun:Vector3=roadSunDir(0,0);\nexport const contains:boolean=followRing()({x:0,z:0})(0,0);\nexport const slot=travelSlot();\n";
 const options:ts.CompilerOptions={strict:true,exactOptionalPropertyTypes:true,noUncheckedIndexedAccess:true,
  target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,moduleResolution:ts.ModuleResolutionKind.Bundler,
  types:[],skipLibCheck:true,noEmit:true};
 const diagnostics=():readonly ts.Diagnostic[]=>consumerDiagnostics(consumer,source,options);
 expect(diagnostics()).toEqual([]);
 source+="titleCards('yes');\ngridEntryShown(undefined,'passed');\nroadSunDir(0,0,0);\nfollowRing('near');\nexport const wrongSun:number=roadSunDir(0,0);\nexport const missing=slot.undeclared;\n";
 const refused=diagnostics().map(diagnostic=>diagnostic.code);
 expect(refused.filter(code=>code===2322)).toHaveLength(1);
 expect(refused.filter(code=>code===2339)).toHaveLength(1);
 expect(refused.filter(code=>code===2345)).toHaveLength(4);
 expect(refused).toHaveLength(6);
});
});

describe('isolated-game-expression-declarations',()=>{
for(const name of ["shared/localSaveKeys","shared/grid/farProxy","client/systems/looks/trample","server/population/nativeManager","client/shardfile/lentLooks"])test(`${name} emits isolated declarations`,()=>{
 const emitted=ts.transpileDeclaration(readFileSync(`src/${name.replace(/^(client|shared|server|cook)\//u, '$1/game/')}.ts`,'utf8'),{fileName:`${name}.ts`,reportDiagnostics:true,compilerOptions:{isolatedDeclarations:true,strict:true,exactOptionalPropertyTypes:true}});
 expect(emitted.diagnostics).toEqual([]);
 expect(emitted.outputText.length).toBeLessThan(100_000);
});

test('game expressions retain save fields, readonly limits and borrowed uniforms',()=>{
 const consumer=resolve('src/test/game/t4-isolated-game-expression-declarations-consumer.ts');
 let source="import type {Vector4} from 'three';\nimport {inventoryKey,purseKey} from '../../shared/game/localSaveKeys';\nimport {GRID_HAZE,FAR_RING} from '../../shared/game/grid/farProxy';\nimport {trample} from '../../client/game/systems/looks/trample';\nimport {pushLentParams} from '../../client/game/shardfile/lentLooks';\nexport const scope:\"shard\"=inventoryKey.scope;\nexport const count:number|undefined=inventoryKey.initial().counts[\"example\"];\nexport const coins:number=purseKey.initial();\nexport const near:600=GRID_HAZE.near;\nexport const ring:9=FAR_RING.count;\nexport const movers:Vector4[]=trample.uniforms.uMovers.value;\npushLentParams({push:looks=>{looks.setParam(\"look\",\"value\",1);}});\n";
 const options:ts.CompilerOptions={strict:true,exactOptionalPropertyTypes:true,noUncheckedIndexedAccess:true,
  target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,moduleResolution:ts.ModuleResolutionKind.Bundler,
  types:[],skipLibCheck:true,noEmit:true};
 const diagnostics=():readonly ts.Diagnostic[]=>consumerDiagnostics(consumer,source,options);
 expect(diagnostics()).toEqual([]);
 source+="GRID_HAZE.near=600;\nFAR_RING.count=9;\nexport const wrongScope:\"page\"=inventoryKey.scope;\nexport const wrongCoins:string=purseKey.initial();\ntrample.uniforms.uMoverCount.value=\"many\";\npushLentParams({push:looks=>{looks.undeclared();}});\n";
 const refused=diagnostics().map(diagnostic=>diagnostic.code);
 expect(refused.filter(code=>code===2322)).toHaveLength(3);
 expect(refused.filter(code=>code===2339)).toHaveLength(1);
 expect(refused.filter(code=>code===2540)).toHaveLength(2);
 expect(refused).toHaveLength(6);
});
});

describe('isolated-game-presentation-field-declarations',()=>{
for(const name of ["client/boss/encounterView","client/looks/keyedSky","client/models/collectionWall","client/plugin/heldFirearm","client/plugin/heldTool","server/plugin/mover","shared/quest/eliteDecisions","client/riding/hud","client/riding/reins","server/riding/roster","client/shardfile/emptyEquipment","client/shardfile/sceneDressing","client/shardfile/sceneMotion","client/systems/looks/particles","client/systems/looks/waterSurface","client/systems/npc/figureRows","client/systems/npc/kitFigure","client/systems/tools/hoverboard"])test(`${name} emits isolated declarations`,()=>{
 const emitted=ts.transpileDeclaration(readFileSync(`src/${name.replace(/^(client|shared|server|cook)\//u, '$1/game/')}.ts`,'utf8'),{fileName:`${name}.ts`,reportDiagnostics:true,compilerOptions:{isolatedDeclarations:true,strict:true,exactOptionalPropertyTypes:true}});
 expect(emitted.diagnostics).toEqual([]);
 expect(emitted.outputText.length).toBeLessThan(100_000);
});

test('game presentation owners retain mutable resources and readonly handles',()=>{
 const consumer=resolve('src/test/game/t4-isolated-game-presentation-field-declarations-consumer.ts');
 let source="import type {Group} from 'three';\nimport type {Scope} from '@wildshard/engine/app/scope';\nimport type {TrophyWall} from '../../client/game/models/collectionWall';\nimport type {HeldFirearm} from '../../client/game/plugin/heldFirearm';\nimport type {WaterSurface} from '../../client/game/systems/looks/waterSurface';\nimport type {Hoverboard} from '../../client/game/systems/tools/hoverboard';\ndeclare const wall:TrophyWall;\ndeclare const firearm:HeldFirearm;\ndeclare const water:WaterSurface;\ndeclare const board:Hoverboard;\nexport const owner:Scope=wall.scope;\nexport const root:Group=wall.group;\nexport const model:Group=board.model;\nwater.group.position.y=1;\nfirearm.inspectYaw=0;\n";
 const options:ts.CompilerOptions={strict:true,exactOptionalPropertyTypes:true,noUncheckedIndexedAccess:true,
  target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,moduleResolution:ts.ModuleResolutionKind.Bundler,
  types:[],skipLibCheck:true,noEmit:true};
 const diagnostics=():readonly ts.Diagnostic[]=>consumerDiagnostics(consumer,source,options);
 expect(diagnostics()).toEqual([]);
 source+="wall.group=wall.group;\nwall.scope=wall.scope;\nboard.model=board.model;\nexport const wrongOwner:number=wall.scope;\nfirearm.inspectYaw=\"later\";\nexport const missing=water.group.undeclared;\n";
 const refused=diagnostics().map(diagnostic=>diagnostic.code);
 expect(refused.filter(code=>code===2322)).toHaveLength(2);
 expect(refused.filter(code=>code===2339)).toHaveLength(1);
 expect(refused.filter(code=>code===2540)).toHaveLength(3);
 expect(refused).toHaveLength(6);
});
});

describe('isolated-game-runtime-port-declarations',()=>{
for(const name of ["shared/weapons/starterCombat","server/plugin/nativeItems","client/shardfile/clientForestPage","client/Boss"])test(`${name} emits isolated declarations`,()=>{
 const emitted=ts.transpileDeclaration(readFileSync(`src/${name.replace(/^(client|shared|server|cook)\//u, '$1/game/')}.ts`,'utf8'),{fileName:`${name}.ts`,reportDiagnostics:true,compilerOptions:{isolatedDeclarations:true,strict:true,exactOptionalPropertyTypes:true}});
 expect(emitted.diagnostics).toEqual([]);
 expect(emitted.outputText.length).toBeLessThan(100_000);
});

test('game runtime ports retain contact arguments, combat owners and generic entry results',()=>{
 const consumer=resolve('src/test/game/t4-isolated-game-runtime-port-declarations-consumer.ts');
 let source="import type {Scope} from '@wildshard/engine/app/scope';\nimport type {Player} from '@wildshard/engine/player/Player';\nimport {STARTER_MELEE_PROFILE,IRON_MELEE_PROFILE} from '../../shared/game/weapons/starterCombat';\nimport {nativeRangedHit} from '../../server/game/plugin/nativeItems';\nimport {FOREST_PAGE_PORTS} from '../../client/game/shardfile/clientForestPage';\nimport type {CaveInterior} from '../../client/game/shardfile/caveInterior';\nimport type {PageCombatSession} from '../../client/game/Boss';\ndeclare const scope:Scope;\ndeclare const combat:PageCombatSession;\nexport const family:\"melee\"=STARTER_MELEE_PROFILE.family;\nexport const damage:number=IRON_MELEE_PROFILE.damage;\nexport const player:Player=combat.context.player;\nexport const dusk:number=combat.context.dusk();\nexport const cave:CaveInterior=FOREST_PAGE_PORTS.entryOwner(scope,\"cave\",\"id\");\ndeclare const args:Parameters<typeof nativeRangedHit>;\nexport const hit=nativeRangedHit(...args);\n";
 const options:ts.CompilerOptions={strict:true,exactOptionalPropertyTypes:true,noUncheckedIndexedAccess:true,
  target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,moduleResolution:ts.ModuleResolutionKind.Bundler,
  types:[],skipLibCheck:true,noEmit:true};
 const diagnostics=():readonly ts.Diagnostic[]=>consumerDiagnostics(consumer,source,options);
 expect(diagnostics()).toEqual([]);
 source+="export const wrongFamily:typeof STARTER_MELEE_PROFILE.family=\"ranged\";\ncombat.context=combat.context;\ncombat.context.god=\"yes\";\nFOREST_PAGE_PORTS.entryOwner(scope,\"undeclared\",\"id\");\nnativeRangedHit(\"actors\",args[1],args[2],10);\nexport const missing=combat.context.undeclared;\n";
 const refused=diagnostics().map(diagnostic=>diagnostic.code);
 expect(refused.filter(code=>code===2322)).toHaveLength(2);
 expect(refused.filter(code=>code===2339)).toHaveLength(1);
 expect(refused.filter(code=>code===2345)).toHaveLength(2);
 expect(refused.filter(code=>code===2540)).toHaveLength(1);
 expect(refused).toHaveLength(6);
});
});

describe('isolated-game-save-declarations',()=>{
for(const name of ["shared/ledger","client/animation/limbQueryPose","shared/compendium/tracker","shared/grid/wallet","server/population/nativeReturns","server/population/shelter","shared/quest/contractBoard","shared/shardfile/ladder","shared/shardfile/walkInPortalRide"])test(`${name} emits isolated declarations`,()=>{
 const emitted=ts.transpileDeclaration(readFileSync(`src/${name.replace(/^(client|shared|server|cook)\//u, '$1/game/')}.ts`,'utf8'),{fileName:`${name}.ts`,reportDiagnostics:true,compilerOptions:{isolatedDeclarations:true,strict:true,exactOptionalPropertyTypes:true}});
 expect(emitted.diagnostics).toEqual([]);
 expect(emitted.outputText.length).toBeLessThan(100_000);
});

test('game save contracts retain literal revisions, tuple poses and board fields',()=>{
 const consumer=resolve('src/test/game/t4-isolated-game-save-declarations-consumer.ts');
 let source="import * as v from 'valibot';\nimport type {CompendiumTrackerSnapshot} from '../../shared/game/compendium/tracker';\nimport type {LimbQueryPoseSaved} from '../../client/game/animation/limbQueryPose';\nimport {PortalRideStateSchema} from '../../shared/game/shardfile/walkInPortalRide';\nimport type {ContractBoard} from '../../shared/game/quest/contractBoard';\ndeclare const tracked:CompendiumTrackerSnapshot;\ndeclare const pose:LimbQueryPoseSaved;\nexport const revision:1=tracked.version;\nexport const names:string[]=tracked.heard;\nexport const ride:v.InferOutput<typeof PortalRideStateSchema>={version:2,director:\"route\",entered:null,armed:false,t:-1,from:\"\",moved:false,rides:[],refused:[]};\ndeclare const board:ReturnType<ContractBoard[\"snapshot\"]>;\nexport const boardVersion:1=board.version;\nexport const next:number=board.board.next;\n";
 const options:ts.CompilerOptions={strict:true,exactOptionalPropertyTypes:true,noUncheckedIndexedAccess:true,
  target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,moduleResolution:ts.ModuleResolutionKind.Bundler,
  types:[],skipLibCheck:true,noEmit:true};
 const diagnostics=():readonly ts.Diagnostic[]=>consumerDiagnostics(consumer,source,options);
 expect(diagnostics()).toEqual([]);
 source+="export const wrongRevision:CompendiumTrackerSnapshot[\"version\"]=2;\nexport const wrongName:CompendiumTrackerSnapshot[\"heard\"]=[1];\nexport const wrongRideVersion:v.InferOutput<typeof PortalRideStateSchema>[\"version\"]=1;\nexport const wrongEdge:v.InferOutput<typeof PortalRideStateSchema>[\"entered\"]=\"up\";\nexport const wrongNext:ReturnType<ContractBoard[\"snapshot\"]>[\"board\"][\"next\"]=\"later\";\nexport const absent=pose.undeclared;\n";
 const refused=diagnostics().map(diagnostic=>diagnostic.code);
 expect(refused.filter(code=>code===2322)).toHaveLength(5);
 expect(refused.filter(code=>code===2339)).toHaveLength(1);
 expect(refused).toHaveLength(6);
});
});
