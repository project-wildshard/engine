// One process for the layer's consumer-program proofs (VITEST-BENCH VB10): each original file is a describe
// block, each test body is unchanged, and every consumer program now reuses one parse of the shared sources.
// oxlint-disable-next-line import/no-nodejs-modules -- Inspect defining declarations without generated products.
import {readFileSync} from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Resolve an unwritten schema consumer.
import {resolve} from 'node:path';
import ts from '@typescript/typescript6';
import {describe,expect,test} from 'vitest';
import {consumerDiagnostics} from '../engine/declarationConsumer';

describe('isolated-game-arena-recovery-declarations',()=>{
for(const name of ["client/summary","client/boss/arenaRoom","server/riding/pastureController","shared/riding/physics","shared/quest/nativeProps"])test(`${name} emits isolated declarations`,()=>{
 const emitted=ts.transpileDeclaration(readFileSync(`src/${name.replace(/^(client|shared|server|cook)\//u, '$1/game/')}.ts`,'utf8'),{fileName:`${name}.ts`,reportDiagnostics:true,compilerOptions:{isolatedDeclarations:true,strict:true,exactOptionalPropertyTypes:true}});
 expect(emitted.diagnostics).toEqual([]);
 expect(emitted.outputText.length).toBeLessThan(100_000);
});

test('game arena and riding saves retain original revisions, tags and fixed tuples',()=>{
 const consumer=resolve('src/test/game/t4-isolated-game-arena-recovery-declarations-consumer.ts');
 let source="import type * as v from 'valibot';\nimport type {WildshardSummary} from '../../client/game/summary';\nimport { ArenaFightPageSchema, ArenaRoomPortalSchema, type ArenaRoomRows } from '../../shared/game/boss/arenaRoomRows';\nimport type {RhythmSpurState,MountedReinsState} from '../../shared/game/riding/physics';\ndeclare const room:ArenaRoomRows;\ndeclare const portal:v.InferOutput<typeof ArenaRoomPortalSchema>;\ndeclare const fight:v.InferOutput<typeof ArenaFightPageSchema>;\ndeclare const reins:MountedReinsState;\nexport const summary:WildshardSummary={v:1,shards:{}};\nexport const origin:number=room.origin.x;\nexport const fade:number=portal.fade.out;\nexport const reward:[number,number,number]=fight.reward;\nexport const spur:number=reins.spur.streak;\n";
 const options:ts.CompilerOptions={strict:true,exactOptionalPropertyTypes:true,noUncheckedIndexedAccess:true,
  target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,moduleResolution:ts.ModuleResolutionKind.Bundler,
  types:[],skipLibCheck:true,noEmit:true};
 const diagnostics=():readonly ts.Diagnostic[]=>consumerDiagnostics(consumer,source,options);
 expect(diagnostics()).toEqual([]);
 source+="export const wrongVersion:WildshardSummary[\"v\"]=2;\nexport const wrongSpur:RhythmSpurState[\"version\"]=2;\nexport const wrongIdentity:v.InferOutput<typeof ArenaFightPageSchema>[\"identity\"]=\"hidden\";\nexport const wrongReward:v.InferOutput<typeof ArenaFightPageSchema>[\"reward\"]=[1,2];\nexport const wrongFade:v.InferOutput<typeof ArenaRoomPortalSchema>[\"fade\"][\"out\"]=\"later\";\nexport const absent=room.undeclared;\n";
 const refused=diagnostics().map(diagnostic=>diagnostic.code);
 expect(refused.filter(code=>code===2322)).toHaveLength(5);
 expect(refused.filter(code=>code===2339)).toHaveLength(1);
 expect(refused).toHaveLength(6);
});
});

describe('isolated-game-look-expression-declarations',()=>{
for(const name of ["client/looks/toonLighting","client/plugin/shaderFamily","shared/riding/taming","client/looks/grassPresentation","client/looks/toonLook","client/grid/frameModel","shared/shardfile/clientState","client/audio/theme","client/generators/pickups"])test(`${name} emits isolated declarations`,()=>{
 const emitted=ts.transpileDeclaration(readFileSync(`src/${name.replace(/^(client|shared|server|cook)\//u, '$1/game/')}.ts`,'utf8'),{fileName:`${name}.ts`,reportDiagnostics:true,compilerOptions:{isolatedDeclarations:true,strict:true,exactOptionalPropertyTypes:true}});
 expect(emitted.diagnostics).toEqual([]);
 expect(emitted.outputText.length).toBeLessThan(100_000);
});

test('game look expressions retain literal blending, mutable scales and typed factories',()=>{
 const consumer=resolve('src/test/game/t4-isolated-game-look-expression-declarations-consumer.ts');
 let source="import type {Color,BufferGeometry} from 'three';\nimport {toonLighting} from '../../client/game/looks/toonLighting';\nimport {BLEND_KEEP_ALPHA} from '../../client/game/plugin/shaderFamily';\nimport {LYDIAN,thirdAbove,ARRANGEMENTS} from '../../client/game/audio/theme';\nimport {seaGlassGeometry,authoredPickups} from '../../client/game/generators/pickups';\ndeclare const state:ReturnType<typeof toonLighting>;\nexport const light:Color=state.uToonLift.value;\nexport const mode:5=BLEND_KEEP_ALPHA.blending;\nLYDIAN.push(12);\nexport const note:number=thirdAbove(60,[0,3,7]);\nexport const shape:BufferGeometry=seaGlassGeometry();\nexport const arrangements=ARRANGEMENTS.theme.segments;\nexport const pickup=authoredPickups[0];\n";
 const options:ts.CompilerOptions={strict:true,exactOptionalPropertyTypes:true,noUncheckedIndexedAccess:true,
  target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,moduleResolution:ts.ModuleResolutionKind.Bundler,
  types:[],skipLibCheck:true,noEmit:true};
 const diagnostics=():readonly ts.Diagnostic[]=>consumerDiagnostics(consumer,source,options);
 expect(diagnostics()).toEqual([]);
 source+="BLEND_KEEP_ALPHA.blending=5;\nARRANGEMENTS.theme=ARRANGEMENTS.theme;\nstate.uCloudTime.value=\"later\";\nthirdAbove(60,[\"C\"]);\nseaGlassGeometry(\"seed\");\nexport const absent=state.undeclared;\n";
 const refused=diagnostics().map(diagnostic=>diagnostic.code);
 expect(refused.filter(code=>code===2322)).toHaveLength(2);
 expect(refused.filter(code=>code===2339)).toHaveLength(1);
 expect(refused.filter(code=>code===2345)).toHaveLength(1);
 expect(refused.filter(code=>code===2540)).toHaveLength(2);
 expect(refused).toHaveLength(6);
});
});

describe('isolated-game-look-save-declarations',()=>{
for(const name of ["shared/compendium/rules","shared/grid/recovery","client/looks/paintedLook","client/looks/painterlyLook","client/looks/postGraphLook","client/models/islandLibrary","client/quest/questPageViews","server/shardfile/homeKeeper"])test(`${name} emits isolated declarations`,()=>{
 const emitted=ts.transpileDeclaration(readFileSync(`src/${name.replace(/^(client|shared|server|cook)\//u, '$1/game/')}.ts`,'utf8'),{fileName:`${name}.ts`,reportDiagnostics:true,compilerOptions:{isolatedDeclarations:true,strict:true,exactOptionalPropertyTypes:true}});
 expect(emitted.diagnostics).toEqual([]);
 expect(emitted.outputText.length).toBeLessThan(100_000);
});

test('game look and recovery data retain tuples, keys and literal revisions',()=>{
 const consumer=resolve('src/test/game/t4-isolated-game-look-save-declarations-consumer.ts');
 let source="import type * as v from 'valibot';\nimport type {CompendiumSnapshot} from '../../shared/game/compendium/rules';\nimport type {GridSavedLocation} from '../../shared/game/grid/recovery';\nimport {PaintedAirSchema} from '@wildshard/format/paintedResources';\nimport {PaintedPanoramaSchema} from '@wildshard/format/paintedResources';\nimport {IslandLibrarySchema} from '../../client/game/models/islandLibrary';\nimport type {QuestPageViewRows} from '../../client/game/quest/questPageViews';\ndeclare const air:v.InferOutput<typeof PaintedAirSchema>;\ndeclare const panorama:v.InferOutput<typeof PaintedPanoramaSchema>;\ndeclare const page:QuestPageViewRows;\nexport const drift:[number,number]=air.drift;\nexport const image:string=panorama.dome.image.phone;\nexport const road:GridSavedLocation={kind:\"road\"};\nexport const journal:CompendiumSnapshot={version:1,entries:{}};\nexport const content:QuestPageViewRows[\"content\"]=page.content;\n";
 const options:ts.CompilerOptions={strict:true,exactOptionalPropertyTypes:true,noUncheckedIndexedAccess:true,
  target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,moduleResolution:ts.ModuleResolutionKind.Bundler,
  types:[],skipLibCheck:true,noEmit:true};
 const diagnostics=():readonly ts.Diagnostic[]=>consumerDiagnostics(consumer,source,options);
 expect(diagnostics()).toEqual([]);
 source+="export const wrongVersion:CompendiumSnapshot[\"version\"]=2;\nexport const wrongLocation:GridSavedLocation[\"kind\"]=\"sky\";\nexport const wrongDrift:v.InferOutput<typeof PaintedAirSchema>[\"drift\"]=[0];\nexport const wrongImage:v.InferOutput<typeof PaintedPanoramaSchema>[\"dome\"][\"image\"][\"phone\"]=0;\nexport const wrongContent:QuestPageViewRows[\"content\"]=\"unscoped\";\nexport const wrongSection:v.InferOutput<typeof IslandLibrarySchema>[\"draws\"][\"section\"]=\"unscoped\";\nexport const absent=air.undeclared;\n";
 const refused=diagnostics().map(diagnostic=>diagnostic.code);
 expect(refused.filter(code=>code===2322)).toHaveLength(6);
 expect(refused.filter(code=>code===2339)).toHaveLength(1);
 expect(refused).toHaveLength(7);
});
});

describe('isolated-game-metadata-declarations',()=>{
for(const name of ["shared/grid/catalogue","server/plugin/simulation","shared/plugin/quests"])test(`${name} emits isolated declarations`,()=>{
 const emitted=ts.transpileDeclaration(readFileSync(`src/${name.replace(/^(client|shared|server|cook)\//u, '$1/game/')}.ts`,'utf8'),{fileName:`${name}.ts`,reportDiagnostics:true,compilerOptions:{isolatedDeclarations:true,strict:true,exactOptionalPropertyTypes:true}});
 expect(emitted.diagnostics).toEqual([]);
 expect(emitted.outputText.length).toBeLessThan(100_000);
});

test('game metadata retains grid literals, quest overloads and NPC field contracts',()=>{
 const consumer=resolve('src/test/game/t4-isolated-game-metadata-declarations-consumer.ts');
 let source="import type * as v from 'valibot';\nimport type {GridCatalogue,CopyIdentity,GridEdgeLook} from '../../shared/game/grid/catalogue';\nimport {readRuntimeWorldMetadata} from '../../server/game/plugin/simulation';\nimport {NpcMotionSchema,NpcDialogueRowSchema} from '../../shared/game/plugin/quests';\ndeclare const grid:GridCatalogue;\ndeclare const motion:v.InferOutput<typeof NpcMotionSchema>;\ndeclare const dialogue:v.InferOutput<typeof NpcDialogueRowSchema>;\nexport const version:0=grid.version;\nexport const pitch:562.5=grid.pitch;\nexport const accent:CopyIdentity[\"accent\"]=\"ember\";\nexport const edge:GridEdgeLook={height:1};\nexport const turns:boolean=motion.turns;\nexport const talks=dialogue.dialogue;\nexport const world=readRuntimeWorldMetadata({});\nexport const quests=readRuntimeWorldMetadata({},true);\nexport const spots:readonly {id:string;x:number;y:number;z:number;radius:number}[]=quests.spots.interact;\n";
 const options:ts.CompilerOptions={strict:true,exactOptionalPropertyTypes:true,noUncheckedIndexedAccess:true,
  target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,moduleResolution:ts.ModuleResolutionKind.Bundler,
  types:[],skipLibCheck:true,noEmit:true};
 const diagnostics=():readonly ts.Diagnostic[]=>consumerDiagnostics(consumer,source,options);
 expect(diagnostics()).toEqual([]);
 source+="export const wrongVersion:GridCatalogue[\"version\"]=1;\nexport const wrongPitch:GridCatalogue[\"pitch\"]=500;\nexport const wrongAccent:CopyIdentity[\"accent\"]=\"ultraviolet\";\nexport const wrongEdge:GridEdgeLook={height:\"low\"};\nexport const wrongTurns:v.InferOutput<typeof NpcMotionSchema>[\"turns\"]=1;\nexport const missing=world.spots;\n";
 const refused=diagnostics().map(diagnostic=>diagnostic.code);
 expect(refused.filter(code=>code===2322)).toHaveLength(5);
 expect(refused.filter(code=>code===2339)).toHaveLength(1);
 expect(refused).toHaveLength(6);
});
});

describe('isolated-game-optional-owner-declarations',()=>{
for(const name of ["client/Elite"])test(`${name} emits isolated declarations`,()=>{
 const emitted=ts.transpileDeclaration(readFileSync(`src/${name.replace(/^(client|shared|server|cook)\//u, '$1/game/')}.ts`,'utf8'),{fileName:`${name}.ts`,reportDiagnostics:true,compilerOptions:{isolatedDeclarations:true,strict:true,exactOptionalPropertyTypes:true}});
 expect(emitted.diagnostics).toEqual([]);
 expect(emitted.outputText.length).toBeLessThan(100_000);
});

test('optional presentation owners retain explicit undefined and constructor argument laws',()=>{
 const consumer=resolve('src/test/game/t4-isolated-game-optional-owner-declarations-consumer.ts');
 let source="import {Scene} from 'three';\nimport {GroundTell} from '../../client/game/eliteView';\ndeclare const scene:Scene;\nexport const omitted=new GroundTell(scene,\"ring\",0);\nexport const absent=new GroundTell(scene,\"ring\",0,undefined);\nexport const position:number=omitted.mesh.position.x;\n";
 const options:ts.CompilerOptions={strict:true,exactOptionalPropertyTypes:true,noUncheckedIndexedAccess:true,
  target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,moduleResolution:ts.ModuleResolutionKind.Bundler,
  types:[],skipLibCheck:true,noEmit:true};
 const diagnostics=():readonly ts.Diagnostic[]=>consumerDiagnostics(consumer,source,options);
 expect(diagnostics()).toEqual([]);
 source+="new GroundTell(scene,\"disc\",0);\nnew GroundTell(scene,\"ring\",0,{cone:1});\nomitted.mesh=absent.mesh;\nexport const missing=omitted.undeclared;\n";
 const refused=diagnostics().map(diagnostic=>diagnostic.code);
 expect(refused.filter(code=>code===2339)).toHaveLength(1);
 expect(refused.filter(code=>code===2345)).toHaveLength(2);
 expect(refused.filter(code=>code===2540)).toHaveLength(1);
 expect(refused).toHaveLength(4);
});
});

describe('isolated-game-owner-field-declarations',()=>{
for(const name of ["client/ambient/ambientFlock","client/ambient/wingField","client/bag/BagButton","client/compendium/Journal","client/cosmetics/bodyShadow","client/cosmetics/cosmetics","client/cosmetics/locker","client/grapple/ribbon","client/loadout/cosmeticFinishes","client/looks/forestGround","client/looks/streamedCover","client/loot/runtime","client/loot/ui/CoinChip","server/population/environment","server/population/perchBody","client/population/projection","server/quest/bodyOps","client/systems/effects/view"])test(`${name} emits isolated declarations`,()=>{
 const emitted=ts.transpileDeclaration(readFileSync(`src/${name.replace(/^(client|shared|server|cook)\//u, '$1/game/')}.ts`,'utf8'),{fileName:`${name}.ts`,reportDiagnostics:true,compilerOptions:{isolatedDeclarations:true,strict:true,exactOptionalPropertyTypes:true}});
 expect(emitted.diagnostics).toEqual([]);
 expect(emitted.outputText.length).toBeLessThan(100_000);
});

test('game owners retain exact borrowed fields and mutable contents',()=>{
 const consumer=resolve('src/test/game/t4-isolated-game-owner-field-declarations-consumer.ts');
 let source="import type {Group} from 'three';\nimport type {Scope} from '@wildshard/engine/app/scope';\nimport type {AmbientFlockDraw} from '../../client/game/ambient/ambientFlock';\nimport type {Journal} from '../../client/game/compendium/Journal';\nimport type {CosmeticsLocker} from '../../client/game/cosmetics/locker';\nimport type {DeclaredBodyOps} from '../../server/game/quest/bodyOps';\ndeclare const flock:AmbientFlockDraw;\ndeclare const journal:Journal;\ndeclare const locker:CosmeticsLocker<string,{id:string}>;\ndeclare const body:DeclaredBodyOps;\nexport const root:Group=flock.group;\nexport const scope:Scope=journal.scope;\nlocker.owned.add('example');\nexport const owned:Set<string>=locker.owned;\nexport const bodies:ReadonlyMap<string,number>=body.registries.bodies;\n";
 const options:ts.CompilerOptions={strict:true,exactOptionalPropertyTypes:true,noUncheckedIndexedAccess:true,
  target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,moduleResolution:ts.ModuleResolutionKind.Bundler,
  types:[],skipLibCheck:true,noEmit:true};
 const diagnostics=():readonly ts.Diagnostic[]=>consumerDiagnostics(consumer,source,options);
 expect(diagnostics()).toEqual([]);
 source+="flock.group=flock.group;\njournal.scope=journal.scope;\nlocker.owned=locker.owned;\nexport const wrongGroup:number=flock.group;\nexport const wrongCount:string=locker.owned.size;\nexport const missing=body.registries.undeclared;\n";
 const refused=diagnostics().map(diagnostic=>diagnostic.code);
 expect(refused.filter(code=>code===2322)).toHaveLength(2);
 expect(refused.filter(code=>code===2339)).toHaveLength(1);
 expect(refused.filter(code=>code===2540)).toHaveLength(3);
 expect(refused).toHaveLength(6);
});
});

describe('isolated-game-registry-declarations',()=>{
for(const name of ["client/Inventory","client/grid/budgetPoints","shared/grid/cellEvents","shared/grid/roadLayout","shared/loot/Owned","client/models/interact","client/models/mountedSpecimen","shared/shardfile/movers","client/systems/viewmodel/armRig","shared/weapons/starterMoves"])test(`${name} emits isolated declarations`,()=>{
 const emitted=ts.transpileDeclaration(readFileSync(`src/${name.replace(/^(client|shared|server|cook)\//u, '$1/game/')}.ts`,'utf8'),{fileName:`${name}.ts`,reportDiagnostics:true,compilerOptions:{isolatedDeclarations:true,strict:true,exactOptionalPropertyTypes:true}});
 expect(emitted.diagnostics).toEqual([]);
 expect(emitted.outputText.length).toBeLessThan(100_000);
});

test('game registries retain literal identities, readonly rows and live singletons',()=>{
 const consumer=resolve('src/test/game/t4-isolated-game-registry-declarations-consumer.ts');
 let source="import {PACK_SLOTS} from '../../client/game/Inventory';\nimport {ENTRY_ASPHALT,GAP_HALF} from '../../shared/game/grid/roadLayout';\nimport {pageGridCells,type GridCellEvents} from '../../shared/game/grid/cellEvents';\nimport {OWNED,type CosmeticId} from '../../shared/game/loot/Owned';\nimport {MOVER_FIELDS} from '../../shared/game/shardfile/movers';\nimport {BONES,LIMITS,TWISTS} from '../../client/game/systems/viewmodel/armRig';\nexport const slots:12=PACK_SLOTS;\nexport const asphalt:15=ENTRY_ASPHALT;\nexport const gap:number=GAP_HALF;\nexport const events:GridCellEvents=pageGridCells;\nexport const cosmetic:CosmeticId=\"cape\";\nexport const label:\"Sailcloth cape\"=OWNED.cape.label;\nexport const pitch:1=MOVER_FIELDS.pitch;\nexport const hand:\"R_hand\"=BONES.right[6];\nexport const twist:0.85=TWISTS[0].at;\nexport const low:-75=LIMITS.pronation[0];\n";
 const options:ts.CompilerOptions={strict:true,exactOptionalPropertyTypes:true,noUncheckedIndexedAccess:true,
  target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,moduleResolution:ts.ModuleResolutionKind.Bundler,
  types:[],skipLibCheck:true,noEmit:true};
 const diagnostics=():readonly ts.Diagnostic[]=>consumerDiagnostics(consumer,source,options);
 expect(diagnostics()).toEqual([]);
 source+="export const wrongSlots:13=PACK_SLOTS;\nexport const wrongCosmetic:CosmeticId=\"iron-sword\";\nMOVER_FIELDS.pitch=1;\nBONES.right[0]=\"R_shoulder\";\nOWNED.cape.kind=\"cosmetic\";\nexport const missing=pageGridCells.undeclared;\n";
 const refused=diagnostics().map(diagnostic=>diagnostic.code);
 expect(refused.filter(code=>code===2322)).toHaveLength(2);
 expect(refused.filter(code=>code===2339)).toHaveLength(1);
 expect(refused.filter(code=>code===2540)).toHaveLength(3);
 expect(refused).toHaveLength(6);
});
});

describe('isolated-game-rig-default-declarations',()=>{
for(const name of ["shared/systems/looks/grassField","client/systems/viewmodel/rigArms","client/weapons/heldLauncher","client/weapons/heldPolearm","client/weather/rainPresentation","client/plugin/headless","client/plugin/geometry","shared/grid/ghosts","client/grid/live","client/systems/species/view/boar","client/systems/species/view/bear"])test(`${name} emits isolated declarations`,()=>{
 const emitted=ts.transpileDeclaration(readFileSync(`src/${name.replace(/^(client|shared|server|cook)\//u, '$1/game/')}.ts`,'utf8'),{fileName:`${name}.ts`,reportDiagnostics:true,compilerOptions:{isolatedDeclarations:true,strict:true,exactOptionalPropertyTypes:true}});
 expect(emitted.diagnostics).toEqual([]);
 expect(emitted.outputText.length).toBeLessThan(100_000);
});

test('game rigs and default diagnostics retain resource ownership and mutable tuple palettes',()=>{
 const consumer=resolve('src/test/game/t4-isolated-game-rig-default-declarations-consumer.ts');
 let source="import type {Group,Object3D} from 'three';\nimport {vmScale,type RigArms} from '../../client/game/systems/viewmodel/rigArms';\nimport type {GhostWorlds} from '../../shared/game/grid/ghosts';\nimport type {HeldLauncher} from '../../client/game/weapons/heldLauncher';\nimport {BOAR_PALETTE} from '../../client/game/systems/species/view/boar';\ndeclare const arms:RigArms;\ndeclare const ghosts:GhostWorlds;\ndeclare const launcher:HeldLauncher;\nexport const root:Group=arms.root;\nexport const node:Object3D|undefined=arms.nodes.get(\"hand\");\nexport const model:Group=launcher.model;\nexport const scale:number=vmScale(60);\nexport const count:number=ghosts.count();\nexport const colour:[number,number,number]=BOAR_PALETTE.base;\nBOAR_PALETTE.base[0]=0;\n";
 const options:ts.CompilerOptions={strict:true,exactOptionalPropertyTypes:true,noUncheckedIndexedAccess:true,
  target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,moduleResolution:ts.ModuleResolutionKind.Bundler,
  types:[],skipLibCheck:true,noEmit:true};
 const diagnostics=():readonly ts.Diagnostic[]=>consumerDiagnostics(consumer,source,options);
 expect(diagnostics()).toEqual([]);
 source+="arms.root=arms.root;\narms.nodes=arms.nodes;\nexport const wrongColour:typeof BOAR_PALETTE.base=[1,2];\nghosts.count(\"later\");\nvmScale(60,\"wide\");\nexport const missing=launcher.model.undeclared;\n";
 const refused=diagnostics().map(diagnostic=>diagnostic.code);
 expect(refused.filter(code=>code===2322)).toHaveLength(1);
 expect(refused.filter(code=>code===2339)).toHaveLength(1);
 expect(refused.filter(code=>code===2345)).toHaveLength(2);
 expect(refused.filter(code=>code===2540)).toHaveLength(2);
 expect(refused).toHaveLength(6);
});
});

describe('isolated-game-save-slot-declarations',()=>{
for(const name of ["shared/saves","shared/grapple/sim","shared/grid/continuations","server/plugin/brain","client/plugin/context","shared/quest/interactionRows","shared/quest/legacyRecords","shared/quest/persistence","client/weapons/Sword"])test(`${name} emits isolated declarations`,()=>{
 const emitted=ts.transpileDeclaration(readFileSync(`src/${name.replace(/^(client|shared|server|cook)\//u, '$1/game/')}.ts`,'utf8'),{fileName:`${name}.ts`,reportDiagnostics:true,compilerOptions:{isolatedDeclarations:true,strict:true,exactOptionalPropertyTypes:true}});
 expect(emitted.diagnostics).toEqual([]);
 expect(emitted.outputText.length).toBeLessThan(100_000);
});

test('game save slots and context aliases retain exact reads and writes',()=>{
 const consumer=resolve('src/test/game/t4-isolated-game-save-slot-declarations-consumer.ts');
 let source="import type {SaveSlot} from '@wildshard/engine/saves/store';\nimport {progressSave,inventorySave,purseSave,bountySave} from '../../shared/game/saves';\nimport {gridCells,gridHomeSim,type GridHomeHandoff} from '../../client/game/plugin/context';\nimport type {GridCellEvents} from '../../shared/game/grid/cellEvents';\nexport const coins:SaveSlot<number>=purseSave;\nexport const cells:GridCellEvents=gridCells;\nexport const home:GridHomeHandoff=gridHomeSim;\nexport const progress:ReturnType<typeof progressSave.read>={counts:{},earned:[],title:null,playS:0};\nexport const inventory:ReturnType<typeof inventorySave.read>={counts:{},order:[]};\nexport const bounty:ReturnType<typeof bountySave.read>={example:2};\n";
 const options:ts.CompilerOptions={strict:true,exactOptionalPropertyTypes:true,noUncheckedIndexedAccess:true,
  target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,moduleResolution:ts.ModuleResolutionKind.Bundler,
  types:[],skipLibCheck:true,noEmit:true};
 const diagnostics=():readonly ts.Diagnostic[]=>consumerDiagnostics(consumer,source,options);
 expect(diagnostics()).toEqual([]);
 source+="purseSave.write(\"coins\");\nexport const wrongOrder:ReturnType<typeof inventorySave.read>[\"order\"]=[0];\nexport const wrongEarned:ReturnType<typeof progressSave.read>[\"earned\"]=[0];\nexport const wrongCount:ReturnType<typeof bountySave.read>={example:\"two\"};\nexport const absent=gridHomeSim.undeclared;\n";
 const refused=diagnostics().map(diagnostic=>diagnostic.code);
 expect(refused.filter(code=>code===2322)).toHaveLength(3);
 expect(refused.filter(code=>code===2339)).toHaveLength(1);
 expect(refused.filter(code=>code===2345)).toHaveLength(1);
 expect(refused).toHaveLength(5);
});
});

describe('isolated-game-session-declarations',()=>{
for(const name of ["client/session/data","client/session/world","client/session/loadout","client/session/play"])test(`${name} emits isolated declarations`,()=>{
 const emitted=ts.transpileDeclaration(readFileSync(`src/${name.replace(/^(client|shared|server|cook)\//u, '$1/game/')}.ts`,'utf8'),{fileName:`${name}.ts`,reportDiagnostics:true,compilerOptions:{isolatedDeclarations:true,strict:true,exactOptionalPropertyTypes:true}});
 expect(emitted.diagnostics).toEqual([]);
 expect(emitted.outputText.length).toBeLessThan(100_000);
});

test('game session stages retain their full asynchronous composition contracts',()=>{
 const consumer=resolve('src/test/game/t4-isolated-game-session-declarations-consumer.ts');
 let source="import {dataStage} from '../../client/game/session/data';\nimport {worldStage} from '../../client/game/session/world';\nimport {loadoutStage} from '../../client/game/session/loadout';\nimport {playStage} from '../../client/game/session/play';\nimport type {Loading} from '@wildshard/engine/ui/Loading';\nimport type {SkyRig} from '@wildshard/engine/world/skyRig';\nimport type {RowBodies} from '@wildshard/engine/entities/RowBodies';\nimport type {GridSession} from '../../client/game/grid/session';\ndeclare const data:Awaited<ReturnType<typeof dataStage>>;\ndeclare const world:Awaited<ReturnType<typeof worldStage>>;\ndeclare const loadout:Awaited<ReturnType<typeof loadoutStage>>;\ndeclare const play:Awaited<ReturnType<typeof playStage>>;\nexport const loading:Loading=data.loading;\nexport const sky:SkyRig=world.sky;\nexport const animals:RowBodies=loadout.animals;\nexport const grid:GridSession|null=play.grid;\nexport const slug:string=play.slug;\n";
 const options:ts.CompilerOptions={strict:true,exactOptionalPropertyTypes:true,noUncheckedIndexedAccess:true,
  target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,moduleResolution:ts.ModuleResolutionKind.Bundler,
  types:[],skipLibCheck:true,noEmit:true};
 const diagnostics=():readonly ts.Diagnostic[]=>consumerDiagnostics(consumer,source,options);
 expect(diagnostics()).toEqual([]);
 source+="export const wrongLoading:number=data.loading;\nexport const wrongSky:string=world.sky;\nexport const wrongAnimals:boolean=loadout.animals;\nexport const wrongGrid:number=play.grid;\ndataStage(\"context\");\nexport const missing=play.undeclared;\n";
 const refused=diagnostics().map(diagnostic=>diagnostic.code);
 expect(refused.filter(code=>code===2322)).toHaveLength(4);
 expect(refused.filter(code=>code===2339)).toHaveLength(1);
 expect(refused.filter(code=>code===2345)).toHaveLength(1);
 expect(refused).toHaveLength(6);
});
});
