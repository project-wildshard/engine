// One process for the layer's consumer-program proofs (VITEST-BENCH VB10): each original file is a describe
// block, each test body is unchanged, and every consumer program now reuses one parse of the shared sources.
// oxlint-disable-next-line import/no-nodejs-modules -- Verify source-owned export capture order without a browser.
import {runInNewContext} from 'node:vm';
// oxlint-disable-next-line import/no-nodejs-modules -- Inspect defining declarations without generated products.
import {readFileSync} from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Resolve an unwritten schema consumer.
import {resolve} from 'node:path';
import ts from '@typescript/typescript6';
import {describe,expect,test} from 'vitest';
import {consumerDiagnostics} from './declarationConsumer';

describe('isolated-engine-boot-trace-declarations',()=>{
for(const name of ["client/boot/bootTrace"])test(`${name} emits isolated declarations`,()=>{
 const emitted=ts.transpileDeclaration(readFileSync(`src/${name.replace(/^(client|shared|server|cook)\//u, '$1/engine/')}.ts`,'utf8'),{fileName:`${name}.ts`,reportDiagnostics:true,compilerOptions:{isolatedDeclarations:true,strict:true,exactOptionalPropertyTypes:true}});
 expect(emitted.diagnostics).toEqual([]);
 expect(emitted.outputText.length).toBeLessThan(100_000);
});

test('trace aliases retain complete existing callable signatures',()=>{
 const consumer=resolve('src/test/engine/t4-isolated-engine-boot-trace-declarations-consumer.ts');
 let source="import {bootTraceActive,previousBootLevel,flushBootReports,recordBootCheckpoint,startBoot,recordGpuRecovery} from '../../client/engine/boot/bootTrace';\nexport const active:boolean=bootTraceActive(); export const level:string=previousBootLevel();\nexport const flushed:Promise<void>=flushBootReports();\nrecordBootCheckpoint('unit',{count:1,ready:true,name:'unit'});\nrecordBootCheckpoint('unit'); startBoot({id:'unit',name:'unit'}); recordGpuRecovery('unit');\n";
 const options:ts.CompilerOptions={strict:true,exactOptionalPropertyTypes:true,noUncheckedIndexedAccess:true,
  target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,moduleResolution:ts.ModuleResolutionKind.Bundler,
  types:[],skipLibCheck:true,noEmit:true};
 const diagnostics=():readonly ts.Diagnostic[]=>consumerDiagnostics(consumer,source,options);
 expect(diagnostics()).toEqual([]);
 source+="recordBootCheckpoint(0);\nrecordBootCheckpoint('unit',{count:[]});\nstartBoot({id:0,name:'unit'});\nrecordGpuRecovery(false);\nexport const wrong:number=previousBootLevel();\nexport const missing=bootTraceActive.undeclared;\n";
 const refused=diagnostics().map(diagnostic=>diagnostic.code);
 expect(refused.filter(code=>code===2322)).toHaveLength(3);
 expect(refused.filter(code=>code===2339)).toHaveLength(1);
 expect(refused.filter(code=>code===2345)).toHaveLength(2);
 expect(refused).toHaveLength(6);
});

test('page aliases capture each original function once in order',()=>{
 const names=["bootTraceActive","previousBootLevel","flushBootReports","inspectPreviousBoot","previousBootLine","bootDiagnostic","bootDiagnosticJson","recordBootProgress","recordBootCheckpoint","startBoot","markBootPlanned","markBootHandledError","markBootContextLost","beginExploreEntry","endExploreEntry","exploreEntryPending","recordExploreFrame","recordGpuRecovery"];
 const path='src/client/engine/boot/bootTrace.ts',source=ts.createSourceFile(path,readFileSync(path,'utf8'),ts.ScriptTarget.Latest,true);
 const rows=source.statements.filter(ts.isVariableStatement).filter(node=>node.modifiers?.some(modifier=>modifier.kind===ts.SyntaxKind.ExportKeyword));
 expect(rows.flatMap(node=>node.declarationList.declarations.map(row=>row.name.getText(source)))).toEqual(names);
 const printer=ts.createPrinter(),scripts:string[]=[];
 for(const row of rows){
  expect(row.declarationList.declarations).toHaveLength(1);
  const declaration=row.declarationList.declarations[0];
  if(declaration===undefined)throw new Error('Missing trace binding');
  expect(declaration.initializer?.getText(source)).toBe(`page.${declaration.name.getText(source)}`);
  scripts.push(printer.printNode(ts.EmitHint.Unspecified,row,source));
 }
 const page:Record<string,unknown>={},reads:string[]=[],values=new Map<string,()=>string>();
 for(const name of names){const value=():string=>name;values.set(name,value);Object.defineProperty(page,name,{get(this:object){expect(this).toBe(page);reads.push(name);return value;}});}
 const emitted=ts.transpileModule(scripts.join('\n'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText.replaceAll('export ','');
 const raw:unknown=runInNewContext(`${emitted}\n[${names.join(',')}]`,{page});
 if(!Array.isArray(raw))throw new Error('Trace bindings did not return an array');
 const captured:readonly unknown[]=raw;
 expect(reads).toEqual(names); expect(captured).toHaveLength(names.length);
 for(const[index,name]of names.entries()){expect(typeof captured[index]).toBe('function');expect(captured[index]).toBe(values.get(name));}
});
});

describe('isolated-engine-constant-declarations',()=>{
for(const name of ["shared/app/resources", "client/app/runtime", "client/blocks", "shared/core/fixedStep", "client/core/crossroads", "server/script/queries", "shared/script/state", "shared/script/host", "shared/script/effects", "client/saves/slots", "client/render/desktopReference", "client/practice/dummyMetadata", "shared/sim/snapshotPhysics", "client/ui/authoredDebugRows"])test(`${name} emits isolated declarations`,()=>{
 const emitted=ts.transpileDeclaration(readFileSync(`src/${name.replace(/^(client|shared|server|cook)\//u, '$1/engine/')}.ts`,'utf8'),{fileName:`${name}.ts`,reportDiagnostics:true,compilerOptions:{isolatedDeclarations:true,strict:true,exactOptionalPropertyTypes:true}});
 expect(emitted.diagnostics).toEqual([]);
 expect(emitted.outputText.length).toBeLessThan(100_000);
});

test('engine constants retain borrowed owner and literal contracts',()=>{
 const consumer=resolve('src/test/engine/t4-engine-constant-consumer.ts');
 let source="import * as v from 'valibot';\nimport type {Scope} from '../../shared/engine/app/scope';\nimport type {App} from '../../client/engine/app/app';\nimport {pageScope} from '../../shared/engine/app/resources';\nimport {app} from '../../client/engine/app/runtime';\nimport {blocks} from '../../client/engine/blocks';\nimport {melee} from '../../shared/engine/combat/blocks/melee';\nimport {FIXED_STEP} from '../../shared/engine/core/fixedStep';\nimport {CROSSROADS_CONFIG} from '../../client/engine/core/crossroads';\nimport {SCRIPT_QUERY} from '../../server/engine/script/queries';\nimport {SCRIPT_STATE_OP} from '../../shared/engine/script/state';\nimport {SCRIPT_LIMITS} from '../../shared/engine/script/host';\nimport {jsonRecord,type Json} from '../../client/engine/saves/slots';\nimport {DESKTOP_REFERENCE} from '../../client/engine/render/desktopReference';\nimport {TRAINING_DUMMY_SCALE} from '../../client/engine/practice/dummyMetadata';\nimport {MAX_REFERENCE_BYTES} from '../../shared/engine/sim/snapshotPhysics';\nimport {authoredRows} from '../../client/engine/ui/authoredDebugRows';\nimport type {DebugRow} from '../../client/engine/ui/debugOptions';\nexport const owner:Scope=pageScope;\nexport const page:App=app;\nexport const block:typeof melee=blocks.melee;\nexport const step:number=FIXED_STEP;\nexport const n0:29=CROSSROADS_CONFIG.n0;\nexport const ray:1=SCRIPT_QUERY.raycast;\nexport const shared:5=SCRIPT_STATE_OP.shared;\nexport const limits=SCRIPT_LIMITS;\ndeclare const input:unknown;\nexport const saved:Record<string,Json>=v.parse(jsonRecord,input);\nexport const reference:number=DESKTOP_REFERENCE.k3060;\nexport const scale:number=TRAINING_DUMMY_SCALE;\nexport const bytes:number=MAX_REFERENCE_BYTES;\nexport const rows:Set<DebugRow>=authoredRows;\n";
 const options:ts.CompilerOptions={strict:true,exactOptionalPropertyTypes:true,noUncheckedIndexedAccess:true,
  target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,moduleResolution:ts.ModuleResolutionKind.Bundler,
  types:[],skipLibCheck:true,noEmit:true};
 const diagnostics=():readonly ts.Diagnostic[]=>consumerDiagnostics(consumer,source,options);
 expect(diagnostics()).toEqual([]);
 source+="blocks.melee=blocks.melee;\nSCRIPT_QUERY.raycast=2;\nSCRIPT_STATE_OP.shared=6;\nCROSSROADS_CONFIG.n0=30;\nexport const wrong:typeof SCRIPT_QUERY.raycast=5;\nexport const badJson:v.InferOutput<typeof jsonRecord>={bad:()=>1};\nexport const missing=blocks.undeclared;\n";
 const refused=diagnostics().map(diagnostic=>diagnostic.code);
 expect(refused.filter(code=>code===2540)).toHaveLength(4);
 expect(refused.filter(code=>code===2322)).toHaveLength(2);
 expect(refused).toContain(2339);
 expect(refused).toHaveLength(7);
});
});

describe('isolated-engine-lifetime-field-declarations',()=>{
for(const name of ["client/ui/perfLap","client/ui/Feedback","client/ui/layers","client/ui/loadProgress","client/player/WaterLine","client/practice/TrainingArena","client/practice/playground/hud","shared/boot/timeline","client/app/ui","shared/ai/GroupBrain","client/ai/view/eliteEntry","shared/combat/Firearm","server/combat/contactWeapon","client/combat/view/Bow","client/combat/view/SweptMelee","client/combat/view/projectile"])test(`${name} emits isolated declarations`,()=>{
 const emitted=ts.transpileDeclaration(readFileSync(`src/${name.replace(/^(client|shared|server|cook)\//u, '$1/engine/')}.ts`,'utf8'),{fileName:`${name}.ts`,reportDiagnostics:true,compilerOptions:{isolatedDeclarations:true,strict:true,exactOptionalPropertyTypes:true}});
 expect(emitted.diagnostics).toEqual([]);
 expect(emitted.outputText.length).toBeLessThan(100_000);
});

test('shared fields retain readonly owners and unknown blackboards',()=>{
 const consumer=resolve('src/test/engine/t4-engine-lifetime-field-consumer.ts');
 let source="import type {GroupBrain} from '../../shared/engine/ai/GroupBrain';\nimport type {LoadProgress} from '../../client/engine/ui/loadProgress';\nimport type {UiLayers} from '../../client/engine/ui/layers';\nimport type {AppUi} from '../../client/engine/app/ui';\nimport type {HudSlots} from '../../client/engine/ui/hudSlots';\nimport type {Bow} from '../../client/engine/combat/view/Bow';\nimport {RangedAction} from '../../shared/engine/combat/Firearm';\nimport type {Group,Vector3} from 'three';\ndeclare const brain:GroupBrain<{alive:boolean}>;\ndeclare const progress:LoadProgress;\ndeclare const layers:UiLayers;\ndeclare const ui:AppUi;\ndeclare const bow:Bow;\nbrain.blackboard.set('value',{alive:true});\nbrain.members.push({alive:true});\nexport const observed:unknown=brain.blackboard.get('value');\nexport const element:HTMLDivElement=progress.element;\nlayers.closedAt=0;\nexport const slots:HudSlots=ui.hud;\nexport const model:Group=bow.model;\nexport const velocity:Vector3=bow.carrierVelocity;\ndeclare const cycle:InstanceType<typeof RangedAction.Cycle>;\nexport const phase:'idle'|'beat'|'cycle'|'reload'=cycle.phase;\nexport const rounds:number=cycle.rounds;\n";
 const options:ts.CompilerOptions={strict:true,exactOptionalPropertyTypes:true,noUncheckedIndexedAccess:true,
  target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,moduleResolution:ts.ModuleResolutionKind.Bundler,
  types:[],skipLibCheck:true,noEmit:true};
 const diagnostics=():readonly ts.Diagnostic[]=>consumerDiagnostics(consumer,source,options);
 expect(diagnostics()).toEqual([]);
 source+="brain.blackboard=new Map<string,unknown>();\nprogress.element=document.createElement('div');\nui.hud=slots;\nexport const untrustedNumber:number=brain.blackboard.get('value');\nlayers.closedAt='time';\nexport const missing=bow.model.undeclared;\n";
 const refused=diagnostics().map(diagnostic=>diagnostic.code);
 expect(refused.filter(code=>code===2540)).toHaveLength(3);
 expect(refused.filter(code=>code===2322)).toHaveLength(2);
 expect(refused).toContain(2339);
 expect(refused).toHaveLength(6);
});
});

describe('isolated-engine-motion-default-declarations',()=>{
for(const name of ["shared/ai/ambientForager","client/audio/SetScore","client/audio/ambience","client/combat/view/slashTrail","client/core/assets","client/core/ktx2","shared/physics/navmesh","shared/physics/terrain","client/player/Hands","client/player/Player","client/practice/DummyMotion","client/quest/view/ui","client/render/allocationBytes","client/render/viewmodelFeel"])test(`${name} emits isolated declarations`,()=>{
 const emitted=ts.transpileDeclaration(readFileSync(`src/${name.replace(/^(client|shared|server|cook)\//u, '$1/engine/')}.ts`,'utf8'),{fileName:`${name}.ts`,reportDiagnostics:true,compilerOptions:{isolatedDeclarations:true,strict:true,exactOptionalPropertyTypes:true}});
 expect(emitted.diagnostics).toEqual([]);
 expect(emitted.outputText.length).toBeLessThan(100_000);
});

test('audio and motion defaults retain mutable values and omitted arguments',()=>{
 const consumer=resolve('src/test/engine/t4-engine-motion-default-consumer.ts');
 let source="import {foragerState,type ForagerPopulation} from '../../shared/engine/ai/ambientForager';\nimport {allocationImageBytes} from '../../client/engine/render/allocationBytes';\nimport type {Navmesh} from '../../shared/engine/physics/navmesh';\nimport type {Player} from '../../client/engine/player/Player';\nimport type {Hands} from '../../client/engine/player/Hands';\nimport type {DialogueBox} from '../../client/engine/quest/view/ui';\nimport type {Vector3,Group} from 'three';\nexport const implicit=foragerState(0,0,0);\nexport const explicit=foragerState(0,0,0,2,3);\nexport const bytes:number=allocationImageBytes(1,2,3);\nexport const specified:number=allocationImageBytes(1,2,3,4,5,6);\ndeclare const foragers:ForagerPopulation;\nexport const due:Uint8Array<ArrayBuffer>=foragers.due; due[0]=1;\ndeclare const nav:Navmesh; declare const point:Vector3;\nexport const closest:Vector3|null=nav.closestWalkable(point);\nexport const random:Vector3|null=nav.randomPointNear(point,4);\ndeclare const player:Player; player.keys.add('forward'); player.position.copy(point);\ndeclare const hands:Hands; export const group:Group=hands.group;\ndeclare const dialogue:DialogueBox; export const root:HTMLDivElement=dialogue.root;\n";
 const options:ts.CompilerOptions={strict:true,exactOptionalPropertyTypes:true,noUncheckedIndexedAccess:true,
  target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,moduleResolution:ts.ModuleResolutionKind.Bundler,
  types:[],skipLibCheck:true,noEmit:true};
 const diagnostics=():readonly ts.Diagnostic[]=>consumerDiagnostics(consumer,source,options);
 expect(diagnostics()).toEqual([]);
 source+="foragerState(0,0,0,'home');\nallocationImageBytes(1,2,3,'depth');\nnav.closestWalkable(point,'radius');\nplayer.keys.add(0);\nplayer.position=point;\nforagers.due=new Uint8Array(4);\nhands.group=group;\nexport const wrong:string=nav.closestWalkable(point);\nexport const missing=dialogue.undeclared;\n";
 const refused=diagnostics().map(diagnostic=>diagnostic.code);
 expect(refused.filter(code=>code===2345)).toHaveLength(4);
 expect(refused.filter(code=>code===2540)).toHaveLength(3);
 expect(refused.filter(code=>code===2322)).toHaveLength(1);
 expect(refused).toContain(2339);
 expect(refused).toHaveLength(9);
});
});

describe('isolated-engine-music-wire-declarations',()=>{
for(const name of ["shared/player/swim","client/audio/Music","shared/script/groupStepV2","client/ui/icons"])test(`${name} emits isolated declarations`,()=>{
 const emitted=ts.transpileDeclaration(readFileSync(`src/${name.replace(/^(client|shared|server|cook)\//u, '$1/engine/')}.ts`,'utf8'),{fileName:`${name}.ts`,reportDiagnostics:true,compilerOptions:{isolatedDeclarations:true,strict:true,exactOptionalPropertyTypes:true}});
 expect(emitted.diagnostics).toEqual([]);
 expect(emitted.outputText.length).toBeLessThan(100_000);
});

test('music, swimming and wire consumers retain their original signatures',()=>{
 const consumer=resolve('src/test/engine/t4-isolated-engine-music-wire-declarations-consumer.ts');
 let source="import {SWIM_IN,SWIM_OUT,FLOAT_DEPTH,SWIM_SPEED} from '../../shared/engine/player/swim';\nimport {iconParts} from '../../client/engine/ui/icons';\nimport type {GroupStepV2} from '../../shared/engine/script/groupStepV2';\nimport type {Music} from '../../client/engine/audio/Music';\nexport const depth:number=SWIM_IN+SWIM_OUT+FLOAT_DEPTH+SWIM_SPEED;\nexport const svg:string=iconParts.svg(''); export const legs:string=iconParts.legs([1,2],3,4);\nexport const stroke:string=iconParts.stroke;\ndeclare const step:GroupStepV2; export const bytes:number=step.layout.bytes;\ndeclare const music:Music; export const mode:'menu'|'calm'|'alert'|'combat'=music.state.mode;\n";
 const options:ts.CompilerOptions={strict:true,exactOptionalPropertyTypes:true,noUncheckedIndexedAccess:true,
  target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,moduleResolution:ts.ModuleResolutionKind.Bundler,
  types:[],skipLibCheck:true,noEmit:true};
 const diagnostics=():readonly ts.Diagnostic[]=>consumerDiagnostics(consumer,source,options);
 expect(diagnostics()).toEqual([]);
 source+="export const wrong:string=SWIM_SPEED;\niconParts.legs(1,2,3);\niconParts.stroke='stroke';\nstep.layout=step.layout;\nmusic.state.mode='invalid';\nexport const missing=step.layout.undeclared;\n";
 const refused=diagnostics().map(diagnostic=>diagnostic.code);
 expect(refused.filter(code=>code===2322)).toHaveLength(2);
 expect(refused.filter(code=>code===2339)).toHaveLength(1);
 expect(refused.filter(code=>code===2345)).toHaveLength(1);
 expect(refused.filter(code=>code===2540)).toHaveLength(2);
 expect(refused).toHaveLength(6);
});
});

describe('isolated-engine-native-constant-declarations',()=>{
for(const name of ["client/ui/debugOptions","shared/world/interact/types","client/world/interact/kit","client/world/HorizonMatte","shared/physics/bodies","client/world/blenderArea","shared/world/interact/barrel"])test(`${name} emits isolated declarations`,()=>{
 const emitted=ts.transpileDeclaration(readFileSync(`src/${name.replace(/^(client|shared|server|cook)\//u, '$1/engine/')}.ts`,'utf8'),{fileName:`${name}.ts`,reportDiagnostics:true,compilerOptions:{isolatedDeclarations:true,strict:true,exactOptionalPropertyTypes:true}});
 expect(emitted.diagnostics).toEqual([]);
 expect(emitted.outputText.length).toBeLessThan(100_000);
});

test('native constants retain literals and ownership',()=>{
 const consumer=resolve('src/test/engine/t4-engine-native-constant-consumer.ts');
 let source="import {TITLE_SKIPPERS} from '../../client/engine/ui/debugOptions';\nimport {TRANSIENT_PREFIXES} from '../../shared/engine/world/interact/types';\nimport {interactParts} from '../../client/engine/world/interact/kit';\nimport {lit} from '../../client/engine/models/interact';\nimport {HORIZON_RADIUS,type PaintedHorizon} from '../../client/engine/world/HorizonMatte';\nimport {DROP_BODY,type Bodies} from '../../shared/engine/physics/bodies';\nimport {BARREL_BODY} from '../../shared/engine/world/interact/barrel';\nimport {CELL,STEP} from '../../client/engine/world/blenderArea';\nimport type {Vector2} from 'three';\nTITLE_SKIPPERS.push('test'); TRANSIENT_PREFIXES.push('test:');\nexport const radius:2300=HORIZON_RADIUS;\nexport const part:typeof lit=interactParts.lit;\ndeclare const painted:PaintedHorizon;\nexport const veil:Vector2=painted.veil.value; painted.veil.value.set(0,1);\nexport const material:'wood'=DROP_BODY.material;\nexport const cylinder:0.38=BARREL_BODY.shape.cylinder.radius;\nexport const spacing:number=CELL+STEP;\ndeclare const bodies:Bodies; bodies.pre(); bodies.pre(0.016);\n";
 const options:ts.CompilerOptions={strict:true,exactOptionalPropertyTypes:true,noUncheckedIndexedAccess:true,
  target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,moduleResolution:ts.ModuleResolutionKind.Bundler,
  types:[],skipLibCheck:true,noEmit:true};
 const diagnostics=():readonly ts.Diagnostic[]=>consumerDiagnostics(consumer,source,options);
 expect(diagnostics()).toEqual([]);
 source+="TITLE_SKIPPERS.push(0);\npainted.veil={value:veil};\nBARREL_BODY.shape.cylinder.radius=0.4;\nexport const wrongMaterial:'metal'=DROP_BODY.material;\nexport const wrongRadius:4=HORIZON_RADIUS;\nexport const missing=interactParts.undeclared;\n";
 const refused=diagnostics().map(diagnostic=>diagnostic.code);
 expect(refused.filter(code=>code===2345)).toHaveLength(1);
 expect(refused.filter(code=>code===2540)).toHaveLength(2);
 expect(refused.filter(code=>code===2322)).toHaveLength(2);
 expect(refused).toContain(2339);
 expect(refused).toHaveLength(6);
});
});

describe('isolated-engine-native-save-declarations',()=>{
for(const name of ["shared/ai/diver","client/models/nativeGeometry","shared/quest/dialogueClock","shared/sim/moverLifecycle","shared/world/weather","shared/world/weatherContinuation"])test(`${name} emits isolated declarations`,()=>{
 const emitted=ts.transpileDeclaration(readFileSync(`src/${name.replace(/^(client|shared|server|cook)\//u, '$1/engine/')}.ts`,'utf8'),{fileName:`${name}.ts`,reportDiagnostics:true,compilerOptions:{isolatedDeclarations:true,strict:true,exactOptionalPropertyTypes:true}});
 expect(emitted.diagnostics).toEqual([]);
 expect(emitted.outputText.length).toBeLessThan(100_000);
});

test('native save contracts retain closed fields and typed records',()=>{
 const consumer=resolve('src/test/engine/t4-engine-native-save-consumer.ts');
 let source="import * as v from 'valibot';\nimport {NativeAttributeSchema,NativeAttributesSchema} from '../../client/engine/models/nativeGeometry';\nimport type {WindDiverSpec} from '../../shared/engine/ai/diver';\nimport type {DialogueSaved} from '../../shared/engine/quest/dialogueClock';\nimport type {MoverLifecycleState} from '../../shared/engine/sim/moverLifecycle';\nimport type {GustContinuation} from '../../shared/engine/world/weatherContinuation';\nexport const attribute:v.InferOutput<typeof NativeAttributeSchema>={semantic:'POSITION',storage:'Float32Array',normalized:false,itemSize:3};\nexport const attributes:v.InferOutput<typeof NativeAttributesSchema>={position:attribute};\nexport const dialogue:DialogueSaved={version:1,lines:[],index:0,shown:0,open:false};\nexport const gust:ReturnType<GustContinuation['snapshot']>={version:1,time:0,gust:0};\nexport const movers:MoverLifecycleState={contract:'movers',ends:[],pending:[]};\ndeclare const wind:WindDiverSpec;\nexport const speed:number=wind.stoop.speed;\nexport const altitude:string=wind.fields.altitude;\nexport const gustRecord:Record<string,unknown>=gust;\nexport const dialogueRecord:Record<string,unknown>=dialogue;\nexport const attributeRows=Object.values(attributes);\ntype AttributeAny=0 extends (1 & typeof attributeRows[number])?true:false;\nexport const typedAttribute:AttributeAny=false;\n";
 const options:ts.CompilerOptions={strict:true,exactOptionalPropertyTypes:true,noUncheckedIndexedAccess:true,
  target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,moduleResolution:ts.ModuleResolutionKind.Bundler,
  types:[],skipLibCheck:true,noEmit:true};
 const diagnostics=():readonly ts.Diagnostic[]=>consumerDiagnostics(consumer,source,options);
 expect(diagnostics()).toEqual([]);
 source+="export const badStorage:typeof attribute['storage']='Float64Array';\nexport const badDialogue:DialogueSaved['version']=2;\nexport const badGust:typeof gust['version']=2;\nexport const badEnd:MoverLifecycleState['ends'][number]['atEnd']='true';\nexport const badAltitude:number=wind.fields.altitude;\nexport const missing=attribute.undeclared;\n";
 const refused=diagnostics().map(diagnostic=>diagnostic.code);
 expect(refused.filter(code=>code===2322)).toHaveLength(4);
 expect(refused.filter(code=>code===2820)).toHaveLength(1);
 expect(refused).toContain(2339);
 expect(refused).toHaveLength(6);
});
});

describe('isolated-engine-object-field-declarations',()=>{
for(const name of ["client/entities/farHerd","client/explore/FreeCam","client/explore/fatLines","client/fx/LightPool","shared/physics/ropeChain","client/physics/ropeDeck","client/player/WeaponPickup","client/player/heldHandParts","client/world/Boundary","client/world/Grass","client/world/Terrain","client/world/backdropLayer","client/world/pond","client/world/skyRig","client/render/calibrationGpu","shared/physics/mover","client/quest/view"])test(`${name} emits isolated declarations`,()=>{
 const emitted=ts.transpileDeclaration(readFileSync(`src/${name.replace(/^(client|shared|server|cook)\//u, '$1/engine/')}.ts`,'utf8'),{fileName:`${name}.ts`,reportDiagnostics:true,compilerOptions:{isolatedDeclarations:true,strict:true,exactOptionalPropertyTypes:true}});
 expect(emitted.diagnostics).toEqual([]);
 expect(emitted.outputText.length).toBeLessThan(100_000);
});

test('object fields retain their borrowed types and mutability',()=>{
 const consumer=resolve('src/test/engine/t4-engine-object-field-consumer.ts');
 let source="import type {Group,Vector3} from 'three';\nimport type {Grass} from '../../client/engine/world/Grass';\nimport type {SkyRig} from '../../client/engine/world/skyRig';\nimport type {KinematicMover} from '../../shared/engine/physics/mover';\nimport type {Physics} from '../../shared/engine/physics/Physics';\nimport type {CalibrationGpu} from '../../client/engine/render/calibrationGpu';\ndeclare const grass:Grass;\ndeclare const group:Group;\ndeclare const sky:SkyRig;\ndeclare const mover:KinematicMover;\ndeclare const calibration:CalibrationGpu;\ngrass.group=group;\nexport const radius:number=grass.radius;\nexport const direction:Vector3=sky.sunDir;\nexport const body:ReturnType<Physics['world']['getRigidBody']>=mover.body;\nexport const pixelRatio:number=calibration.renderer.getPixelRatio();\n";
 const options:ts.CompilerOptions={strict:true,exactOptionalPropertyTypes:true,noUncheckedIndexedAccess:true,
  target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,moduleResolution:ts.ModuleResolutionKind.Bundler,
  types:[],skipLibCheck:true,noEmit:true};
 const diagnostics=():readonly ts.Diagnostic[]=>consumerDiagnostics(consumer,source,options);
 expect(diagnostics()).toEqual([]);
 source+="mover.body=mover.body;\ngrass.radius=4;\nexport const wrongDirection:number=sky.sunDir;\nexport const wrongGroup:string=grass.group;\nexport const wrongRenderer:number=calibration.renderer;\nexport const missing=mover.body.undeclared;\n";
 const refused=diagnostics().map(diagnostic=>diagnostic.code);
 expect(refused.filter(code=>code===2540)).toHaveLength(2);
 expect(refused.filter(code=>code===2322)).toHaveLength(3);
 expect(refused).toContain(2339);
 expect(refused).toHaveLength(6);
});
});

describe('isolated-engine-owner-default-declarations',()=>{
for(const name of ["client/app/sceneOwnership","client/boot/lastEnd","client/core/deflate","client/physics/navmeshLoad","client/render/precompile","server/script/inputInboxV2","client/world/geometryKit","client/ui/ownership","server/entities/AnimalManager","client/audio/AmbienceBeds","client/audio/Audio","client/audio/Stems","client/core/worldDepth","client/input/InputService","client/render/graph/glslMaterial"])test(`${name} emits isolated declarations`,()=>{
 const emitted=ts.transpileDeclaration(readFileSync(`src/${name.replace(/^(client|shared|server|cook)\//u, '$1/engine/')}.ts`,'utf8'),{fileName:`${name}.ts`,reportDiagnostics:true,compilerOptions:{isolatedDeclarations:true,strict:true,exactOptionalPropertyTypes:true}});
 expect(emitted.diagnostics).toEqual([]);
 expect(emitted.outputText.length).toBeLessThan(100_000);
});

test('owner defaults retain DOM, promise and unshared output laws',()=>{
 const consumer=resolve('src/test/engine/t4-engine-owner-default-consumer.ts');
 let source="import {unshuffleLanes} from '../../client/engine/core/deflate';\nimport {boundedLinkWait} from '../../client/engine/render/precompile';\nimport {uiScope,mountUi} from '../../client/engine/ui/ownership';\nimport type {Scope} from '../../shared/engine/app/scope';\ndeclare const owner:Scope;\ndeclare const lanes:Uint8Array;\nexport const restored:Uint8Array=unshuffleLanes(lanes);\nexport const explicit:Uint8Array=unshuffleLanes(lanes,new Uint8Array(16),0,4);\nexport const linked:Promise<boolean>=boundedLinkWait(()=>true,async()=>{});\nexport const timed:Promise<boolean>=boundedLinkWait(()=>true,async()=>{},100);\nexport const since:Promise<boolean>=boundedLinkWait(()=>true,async()=>{},100,()=>0);\nexport const child:Scope=uiScope('child',owner);\nexport const implicit:Scope=uiScope('child');\nexport const element:HTMLElement=document.createElement('div');\nmountUi(element,child);\nmountUi(element,child,document.body);\n";
 const options:ts.CompilerOptions={strict:true,exactOptionalPropertyTypes:true,noUncheckedIndexedAccess:true,
  target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,moduleResolution:ts.ModuleResolutionKind.Bundler,
  types:[],skipLibCheck:true,noEmit:true};
 const diagnostics=():readonly ts.Diagnostic[]=>consumerDiagnostics(consumer,source,options);
 expect(diagnostics()).toEqual([]);
 source+="unshuffleLanes(lanes,new Uint8Array(new SharedArrayBuffer(16)));\nboundedLinkWait(()=>true,async()=>{},'time');\nboundedLinkWait(()=>true,async()=>{},100,0);\nuiScope('child',0);\nmountUi(element,child,'parent');\nexport const wrong:number=boundedLinkWait(()=>true,async()=>{});\nexport const missing=child.undeclared;\n";
 const refused=diagnostics().map(diagnostic=>diagnostic.code);
 expect(refused.filter(code=>code===2345)).toHaveLength(5);
 expect(refused.filter(code=>code===2322)).toHaveLength(1);
 expect(refused).toContain(2339);
 expect(refused).toHaveLength(7);
});
});

describe('isolated-engine-pack-cable-declarations',()=>{
for(const name of ["server/ai/eliteRoster","shared/ai/stalker","shared/sim/cableTraversal"])test(`${name} emits isolated declarations`,()=>{
 const emitted=ts.transpileDeclaration(readFileSync(`src/${name.replace(/^(client|shared|server|cook)\//u, '$1/engine/')}.ts`,'utf8'),{fileName:`${name}.ts`,reportDiagnostics:true,compilerOptions:{isolatedDeclarations:true,strict:true,exactOptionalPropertyTypes:true}});
 expect(emitted.diagnostics).toEqual([]);
 expect(emitted.outputText.length).toBeLessThan(100_000);
});

test('elite, pack and cable saves retain complete scalar and tuple laws',()=>{
 const consumer=resolve('src/test/engine/t4-isolated-engine-pack-cable-declarations-consumer.ts');
 let source="import type {NativeEliteProjection,NativeEliteRosterRows} from '../../server/engine/ai/eliteRoster';\nimport type {HowlerSpec,PouncerSpec} from '../../shared/engine/ai/stalker';\nimport type {CableLayout,ZiplineDriver} from '../../shared/engine/sim/cableTraversal';\nimport type {Vector3} from 'three';\ndeclare const projection:NativeEliteProjection; const saved=projection.snapshot();\nexport const from:[number,number,number]=saved.laneFrom; export const elapsed:number=saved.elapsed;\ndeclare const rows:NativeEliteRosterRows; export const version:number=rows.version;\ndeclare const howler:HowlerSpec; export const speed:number=howler.speeds.hunt;\ndeclare const pouncer:PouncerSpec; export const field:string=pouncer.fields.leap;\ndeclare const layout:CableLayout; export const point:Vector3=layout.a; point.set(0,1,0);\ndeclare const driver:ZiplineDriver; const riding=driver.snapshot(); export const velocity:number=riding.v;\n";
 const options:ts.CompilerOptions={strict:true,exactOptionalPropertyTypes:true,noUncheckedIndexedAccess:true,
  target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,moduleResolution:ts.ModuleResolutionKind.Bundler,
  types:[],skipLibCheck:true,noEmit:true};
 const diagnostics=():readonly ts.Diagnostic[]=>consumerDiagnostics(consumer,source,options);
 expect(diagnostics()).toEqual([]);
 source+="howler.speeds.hunt='speed';\npouncer.fields.leap=0;\nsaved.laneFrom=[0,0];\nsaved.elapsed='time';\nriding.v='velocity';\nlayout.a=point;\nexport const missing=saved.undeclared;\n";
 const refused=diagnostics().map(diagnostic=>diagnostic.code);
 expect(refused.filter(code=>code===2322)).toHaveLength(5);
 expect(refused.filter(code=>code===2339)).toHaveLength(1);
 expect(refused.filter(code=>code===2540)).toHaveLength(1);
 expect(refused).toHaveLength(7);
});
});

describe('isolated-engine-parameter-declarations',()=>{
for(const name of ["shared/ai/ambientFlight","shared/ai/director","client/audio/declaredBank","client/audio/synth","client/audio/util","client/boot/bytes","client/boot/prefetch","client/boot/titleArrival","client/core/KeepAlive","shared/core/workSlice","client/explore/setView","client/explore/viewPoint","client/fx/groundFx","client/models/interact","client/telemetry/health","shared/world/dayCycle","shared/world/terrainField"])test(`${name} emits isolated declarations`,()=>{
 const emitted=ts.transpileDeclaration(readFileSync(`src/${name.replace(/^(client|shared|server|cook)\//u, '$1/engine/')}.ts`,'utf8'),{fileName:`${name}.ts`,reportDiagnostics:true,compilerOptions:{isolatedDeclarations:true,strict:true,exactOptionalPropertyTypes:true}});
 expect(emitted.diagnostics).toEqual([]);
 expect(emitted.outputText.length).toBeLessThan(100_000);
});

test('default parameters retain omission and typed input laws',()=>{
 const consumer=resolve('src/test/engine/t4-engine-default-parameter-consumer.ts');
 let source="import {freshPageArrival} from '../../client/engine/boot/titleArrival';\nimport {panFromYaw} from '../../client/engine/audio/util';\nimport {buildYield} from '../../shared/engine/core/workSlice';\nimport {KeepAlive} from '../../client/engine/core/KeepAlive';\nimport type {Scope} from '../../shared/engine/app/scope';\nexport const fresh:boolean=freshPageArrival(0);\nexport const clocked:boolean=freshPageArrival(0,100,0);\nexport const pan:number=panFromYaw(0,0,0);\nexport const distance:number=panFromYaw(0,0,0,0.8,10);\ndeclare const owner:Scope;\nexport const paused:Promise<void>=buildYield(owner);\nexport const budgeted:Promise<void>=buildYield(owner,4);\nexport const defaultOwner:KeepAlive=new KeepAlive();\nexport const explicitOwner:KeepAlive=new KeepAlive(owner);\n";
 const options:ts.CompilerOptions={strict:true,exactOptionalPropertyTypes:true,noUncheckedIndexedAccess:true,
  target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,moduleResolution:ts.ModuleResolutionKind.Bundler,
  types:[],skipLibCheck:true,noEmit:true};
 const diagnostics=():readonly ts.Diagnostic[]=>consumerDiagnostics(consumer,source,options);
 expect(diagnostics()).toEqual([]);
 source+="freshPageArrival(0,'now');\npanFromYaw(0,0,0,0.8,'far');\nbuildYield(owner,'budget');\nnew KeepAlive('owner');\nexport const wrong:number=freshPageArrival(0);\nexport const missing=defaultOwner.undeclared;\n";
 const refused=diagnostics().map(diagnostic=>diagnostic.code);
 expect(refused.filter(code=>code===2345)).toHaveLength(4);
 expect(refused.filter(code=>code===2322)).toHaveLength(1);
 expect(refused).toContain(2339);
 expect(refused).toHaveLength(6);
});
});

describe('isolated-engine-saved-declarations',()=>{
for(const name of ["server/ai/eliteKernels","server/ai/grazer","server/ai/moves","server/ai/platform","server/ai/scriptBrain","client/audio/credits","client/boot/stuck","shared/combat/projectileContact","shared/core/frameCost","shared/core/memoryAttribution","client/core/tier","client/models/trainingDummy","client/models/weld","shared/physics/CharacterMotor","client/player/TouchControls","client/player/viewmodelTextures"])test(`${name} emits isolated declarations`,()=>{
 const emitted=ts.transpileDeclaration(readFileSync(`src/${name.replace(/^(client|shared|server|cook)\//u, '$1/engine/')}.ts`,'utf8'),{fileName:`${name}.ts`,reportDiagnostics:true,compilerOptions:{isolatedDeclarations:true,strict:true,exactOptionalPropertyTypes:true}});
 expect(emitted.diagnostics).toEqual([]);
 expect(emitted.outputText.length).toBeLessThan(100_000);
});

test('engine constants retain borrowed owner and literal contracts',()=>{
 const consumer=resolve('src/test/engine/t4-engine-constant-consumer.ts');
 let source="import {BRAIN_FIELD} from '../../server/engine/ai/scriptBrain';\nimport {PLAYER_BODY} from '../../shared/engine/physics/CharacterMotor';\nimport {sstep} from '../../client/engine/player/viewmodelTextures';\nimport type {NativeEliteKernelRow} from '../../server/engine/ai/eliteKernels';\nimport type {ActorMoveRunner} from '../../server/engine/ai/moves';\nimport type {StoppedProjectileSaved} from '../../shared/engine/combat/projectileContact';\nexport const speed:2=BRAIN_FIELD.speed;\nexport const weight:80=PLAYER_BODY.weight;\nexport const easing:(a:number,b:number,value:number)=>number=sstep;\nexport const move:ReturnType<ActorMoveRunner['snapshot']>={version:1,contract:'move',elapsed:0,angle:0,complete:false};\nexport const stopped:StoppedProjectileSaved={version:1,frame:0,stuck:[]};\ndeclare const elite:NativeEliteKernelRow;\nexport const pattern:'pouncer'|'howler'=elite.profile.pattern;\nexport const moveRecord:Record<string,unknown>=move;\nexport const stoppedRecord:Record<string,unknown>=stopped;\nexport const eliteRecord:Record<string,unknown>=elite;\nexport const stoppedValues=Object.values(stopped);\ntype StoppedAny=0 extends (1 & typeof stoppedValues[number])?true:false;\nexport const typedStopped:StoppedAny=false;\n";
 const options:ts.CompilerOptions={strict:true,exactOptionalPropertyTypes:true,noUncheckedIndexedAccess:true,
  target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,moduleResolution:ts.ModuleResolutionKind.Bundler,
  types:[],skipLibCheck:true,noEmit:true};
 const diagnostics=():readonly ts.Diagnostic[]=>consumerDiagnostics(consumer,source,options);
 expect(diagnostics()).toEqual([]);
 source+="BRAIN_FIELD.speed=2;\nPLAYER_BODY.weight=80;\nexport const wrongMove:typeof move['version']=2;\nexport const wrongStopped:StoppedProjectileSaved['version']=2;\nexport const wrongPattern:NativeEliteKernelRow['profile']['pattern']='other';\nexport const missing=move.undeclared;\n";
 const refused=diagnostics().map(diagnostic=>diagnostic.code);
 expect(refused.filter(code=>code===2540)).toHaveLength(2);
 expect(refused.filter(code=>code===2322)).toHaveLength(3);
 expect(refused).toContain(2339);
 expect(refused).toHaveLength(6);
});
});

describe('isolated-engine-shared-value-declarations',()=>{
for(const name of ["shared/ai/huntPattern","shared/boot/steps","client/combat/view/ranged","client/entities/species/loft","shared/entities/species/rigs","client/models/hoverboard","client/models/place","client/models/swimHands","client/render/programRetention","shared/saves/runtime","client/script/client","shared/sim/dayClock","shared/sim/snapshot","client/ui/haptics","client/ui/hudSlots","client/ui/review"])test(`${name} emits isolated declarations`,()=>{
 const emitted=ts.transpileDeclaration(readFileSync(`src/${name.replace(/^(client|shared|server|cook)\//u, '$1/engine/')}.ts`,'utf8'),{fileName:`${name}.ts`,reportDiagnostics:true,compilerOptions:{isolatedDeclarations:true,strict:true,exactOptionalPropertyTypes:true}});
 expect(emitted.diagnostics).toEqual([]);
 expect(emitted.outputText.length).toBeLessThan(100_000);
});

test('shared values retain model, phase and literal contracts',()=>{
 const consumer=resolve('src/test/engine/t4-engine-shared-value-consumer.ts');
 let source="import {MathUtils} from 'three';\nimport {clamp} from '../../shared/engine/entities/species/rigs';\nimport {DAY_CLOCK_PHASES} from '../../shared/engine/sim/dayClock';\nimport {HAPTIC} from '../../client/engine/ui/haptics';\nimport {CLIENT_SCRIPT_OP,CLIENT_SCRIPT_LIMITS} from '../../client/engine/script/client';\nimport {INBOX_URL} from '../../client/engine/ui/review';\nimport {hoverboard} from '../../client/engine/models/hoverboard';\nimport {swimHands,type SwimHandsParams} from '../../client/engine/models/swimHands';\nimport type {ModelDef} from '../../client/engine/models/model';\nimport type {BootStep} from '../../shared/engine/boot/steps';\nexport const board:ModelDef<object>=hoverboard;\nexport const hands:ModelDef<SwimHandsParams>=swimHands;\nexport const phase:'dawn'=DAY_CLOCK_PHASES[0];\nexport const duration:22=HAPTIC.kill[0];\nexport const offset:101=CLIENT_SCRIPT_OP.offset;\nexport const fields:24=CLIENT_SCRIPT_LIMITS.fields;\nexport const step:BootStep='renderer';\nexport const math:typeof MathUtils.clamp=clamp;\nexport const wideInbox:typeof INBOX_URL='another endpoint';\n";
 const options:ts.CompilerOptions={strict:true,exactOptionalPropertyTypes:true,noUncheckedIndexedAccess:true,
  target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,moduleResolution:ts.ModuleResolutionKind.Bundler,
  types:[],skipLibCheck:true,noEmit:true};
 const diagnostics=():readonly ts.Diagnostic[]=>consumerDiagnostics(consumer,source,options);
 expect(diagnostics()).toEqual([]);
 source+="DAY_CLOCK_PHASES[0]='dawn';\nHAPTIC.hit=14;\nCLIENT_SCRIPT_OP.offset=101;\nexport const wrongPhase:typeof DAY_CLOCK_PHASES[0]='day';\nexport const wrongStep:BootStep='not-a-step';\nexport const missing=hoverboard.undeclared;\n";
 const refused=diagnostics().map(diagnostic=>diagnostic.code);
 expect(refused.filter(code=>code===2540)).toHaveLength(3);
 expect(refused.filter(code=>code===2322)).toHaveLength(2);
 expect(refused).toContain(2339);
 expect(refused).toHaveLength(6);
});
});

describe('isolated-engine-simulation-owner-declarations',()=>{
for(const name of ["client/app/app","client/core/Game","shared/entities/AnimalSim","shared/entities/animalPose","server/sim","client/world/interact/Interactables"])test(`${name} emits isolated declarations`,()=>{
 const emitted=ts.transpileDeclaration(readFileSync(`src/${name.replace(/^(client|shared|server|cook)\//u, '$1/engine/')}.ts`,'utf8'),{fileName:`${name}.ts`,reportDiagnostics:true,compilerOptions:{isolatedDeclarations:true,strict:true,exactOptionalPropertyTypes:true}});
 expect(emitted.diagnostics).toEqual([]);
 expect(emitted.outputText.length).toBeLessThan(100_000);
});

test('simulation resources retain mutable storage and readonly owners',()=>{
 const consumer=resolve('src/test/engine/t4-isolated-engine-simulation-owner-declarations-consumer.ts');
 let source="import type {App} from '../../client/engine/app/app';\nimport type {Game} from '../../client/engine/core/Game';\nimport type {AnimalSim} from '../../shared/engine/entities/AnimalSim';\nimport type {AnimalPoseLaw} from '../../shared/engine/entities/animalPose';\nimport type {SimHost} from '../../server/engine/sim';\nimport type {Live} from '../../client/engine/world/interact/Interactables';\nimport type {Vector3,Scene} from 'three';\ndeclare const app:App; app.params=new URLSearchParams(); app.params.set('key','value');\ndeclare const game:Game; export const root:Scene=game.rootScene; game.levelScope.child('unit');\ndeclare const animal:AnimalSim; declare const point:Vector3; animal.position=point; animal.lookWeight=0.5;\ndeclare const pose:AnimalPoseLaw; export const buffer:Float32Array<ArrayBuffer>=pose.pose; buffer[0]=1;\ndeclare const sim:SimHost; sim.entities.set('actor',animal);\ndeclare const live:Live; export const position:Vector3=live.position; position.set(0,1,0);\n";
 const options:ts.CompilerOptions={strict:true,exactOptionalPropertyTypes:true,noUncheckedIndexedAccess:true,
  target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,moduleResolution:ts.ModuleResolutionKind.Bundler,
  types:[],skipLibCheck:true,noEmit:true};
 const diagnostics=():readonly ts.Diagnostic[]=>consumerDiagnostics(consumer,source,options);
 expect(diagnostics()).toEqual([]);
 source+="app.clock=app.clock;\ngame.rootScene=root;\npose.pose=new Float32Array(4);\nsim.entities=new Map();\nsim.entities.set(0,animal);\nanimal.position='point';\npose.pose[0]='weight';\nexport const missing=live.undeclared;\n";
 const refused=diagnostics().map(diagnostic=>diagnostic.code);
 expect(refused.filter(code=>code===2322)).toHaveLength(2);
 expect(refused.filter(code=>code===2339)).toHaveLength(1);
 expect(refused.filter(code=>code===2345)).toHaveLength(1);
 expect(refused.filter(code=>code===2540)).toHaveLength(4);
 expect(refused).toHaveLength(8);
});
});

describe('isolated-engine-ui-owner-declarations',()=>{
for(const name of ["client/ui/BossBar","client/ui/Combat","client/ui/DeathFade","client/ui/EliteBar","client/ui/HUD","client/ui/HurtArc","client/ui/Loading","client/ui/LockOn","client/ui/Map","client/ui/Menu","client/ui/Minimap","client/ui/Perf","client/ui/SpeedLines","client/ui/ToastStack","client/ui/WeaponStrip","client/ui/WindupWarn","client/ui/perfHud"])test(`${name} emits isolated declarations`,()=>{
 const emitted=ts.transpileDeclaration(readFileSync(`src/${name.replace(/^(client|shared|server|cook)\//u, '$1/engine/')}.ts`,'utf8'),{fileName:`${name}.ts`,reportDiagnostics:true,compilerOptions:{isolatedDeclarations:true,strict:true,exactOptionalPropertyTypes:true}});
 expect(emitted.diagnostics).toEqual([]);
 expect(emitted.outputText.length).toBeLessThan(100_000);
});

test('UI scope owners retain readonly lifetime contracts',()=>{
 const consumer=resolve('src/test/engine/t4-engine-ui-owner-consumer.ts');
 let source="import type {Scope} from '../../shared/engine/app/scope';\nimport type {BossBar} from '../../client/engine/ui/BossBar';\nimport type {HUD} from '../../client/engine/ui/HUD';\nimport type {Loading} from '../../client/engine/ui/Loading';\nimport type {Perf} from '../../client/engine/ui/Perf';\nimport type {GameMenu} from '../../client/engine/ui/Menu';\nimport type {PerfHud} from '../../client/engine/ui/perfHud';\ndeclare const boss:BossBar;\ndeclare const hud:HUD;\ndeclare const loading:Loading;\ndeclare const perf:Perf;\ndeclare const menu:GameMenu;\ndeclare const perfHud:PerfHud;\nexport const owners:Scope[]=[boss.scope,hud.scope,loading.scope,perf.scope,menu.scope,perfHud.scope];\nexport const retired:boolean=boss.scope.disposed;\nexport const scope:Scope=loading.scope;\n";
 const options:ts.CompilerOptions={strict:true,exactOptionalPropertyTypes:true,noUncheckedIndexedAccess:true,
  target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,moduleResolution:ts.ModuleResolutionKind.Bundler,
  types:[],skipLibCheck:true,noEmit:true};
 const diagnostics=():readonly ts.Diagnostic[]=>consumerDiagnostics(consumer,source,options);
 expect(diagnostics()).toEqual([]);
 source+="boss.scope=hud.scope;\nloading.scope=perf.scope;\nmenu.scope.disposed=false;\nexport const wrongOwner:number=perf.scope;\nexport const wrongRetired:number=boss.scope.disposed;\nexport const missing=perfHud.scope.undeclared;\n";
 const refused=diagnostics().map(diagnostic=>diagnostic.code);
 expect(refused.filter(code=>code===2540)).toHaveLength(3);
 expect(refused.filter(code=>code===2322)).toHaveLength(2);
 expect(refused).toContain(2339);
 expect(refused).toHaveLength(6);
});
});

describe('isolated-engine-world-uniform-declarations',()=>{
for(const name of ["server/ai/hunt","shared/core/config","shared/world/BakedTerrain","client/world/wind","shared/world/waves","shared/physics/groups","client/player/LockOnTarget","client/ui/saveStrings","client/world/Atmosphere","client/world/Horizon","client/world/TreeFactory","client/world/painterly","client/world/skyBackdrop","shared/world/steppeWind","client/world/forest/Forest","client/audio/gen"])test(`${name} emits isolated declarations`,()=>{
 const emitted=ts.transpileDeclaration(readFileSync(`src/${name.replace(/^(client|shared|server|cook)\//u, '$1/engine/')}.ts`,'utf8'),{fileName:`${name}.ts`,reportDiagnostics:true,compilerOptions:{isolatedDeclarations:true,strict:true,exactOptionalPropertyTypes:true}});
 expect(emitted.diagnostics).toEqual([]);
 expect(emitted.outputText.length).toBeLessThan(100_000);
});

test('world constants keep literal keys and borrowed mutable uniforms',()=>{
 const consumer=resolve('src/test/engine/t4-isolated-engine-world-uniform-declarations-consumer.ts');
 let source="import {GROUP} from '../../shared/engine/physics/groups';\nimport {LOCK} from '../../client/engine/player/LockOnTarget';\nimport {SAVE_STRINGS} from '../../client/engine/ui/saveStrings';\nimport {FOREST_BANDS} from '../../client/engine/world/forest/Forest';\nimport {windUniforms} from '../../client/engine/world/TreeFactory';\nimport {fogUniforms} from '../../client/engine/world/Atmosphere';\nimport {CHUNK_SIZE} from '../../shared/engine/core/config';\nimport {CHUNK_SIZE as CONTENT_SIZE} from '@wildshard/format/contentBounds';\nimport type {Color} from 'three';\nexport const group:number=GROUP.WORLD; export const cone:number=LOCK.CONE;\nexport const title:string=SAVE_STRINGS.title; export const count:string=SAVE_STRINGS.imported(2);\nexport const distance:number=FOREST_BANDS.hi; windUniforms.uTime.value=1;\nexport const size:typeof CONTENT_SIZE=CHUNK_SIZE; fogUniforms.fogSunColor.value.set(0);\n";
 const options:ts.CompilerOptions={strict:true,exactOptionalPropertyTypes:true,noUncheckedIndexedAccess:true,
  target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,moduleResolution:ts.ModuleResolutionKind.Bundler,
  types:[],skipLibCheck:true,noEmit:true};
 const diagnostics=():readonly ts.Diagnostic[]=>consumerDiagnostics(consumer,source,options);
 expect(diagnostics()).toEqual([]);
 source+="GROUP.WORLD=2;\nLOCK.CONE=0;\nSAVE_STRINGS.title='title';\nFOREST_BANDS.hi=2;\nwindUniforms.uTime.value='time';\nSAVE_STRINGS.imported('count');\nexport const missing=fogUniforms.undeclared;\n";
 const refused=diagnostics().map(diagnostic=>diagnostic.code);
 expect(refused.filter(code=>code===2322)).toHaveLength(1);
 expect(refused.filter(code=>code===2339)).toHaveLength(1);
 expect(refused.filter(code=>code===2345)).toHaveLength(1);
 expect(refused.filter(code=>code===2540)).toHaveLength(4);
 expect(refused).toHaveLength(7);
});
});
