// oxlint-disable-next-line import/no-nodejs-modules -- Inspect defining declarations without generated products.
import {readFileSync} from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Resolve an unwritten schema consumer.
import {resolve} from 'node:path';
import ts from '@typescript/typescript6';
import {expect,test} from 'vitest';

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
 const host=ts.createCompilerHost(options),read=host.readFile.bind(host),exists=host.fileExists.bind(host);
 host.fileExists=file=>file===consumer||exists(file);
 host.readFile=file=>file===consumer?source:read(file);
 const diagnostics=():readonly ts.Diagnostic[]=>{
  const program=ts.createProgram([consumer],options,host),file=program.getSourceFile(consumer);
  if(file===undefined)throw new Error('Missing virtual declarative world consumer');
  return program.getSemanticDiagnostics(file);
 };
 expect(diagnostics()).toEqual([]);
 source+="foragerState(0,0,0,'home');\nallocationImageBytes(1,2,3,'depth');\nnav.closestWalkable(point,'radius');\nplayer.keys.add(0);\nplayer.position=point;\nforagers.due=new Uint8Array(4);\nhands.group=group;\nexport const wrong:string=nav.closestWalkable(point);\nexport const missing=dialogue.undeclared;\n";
 const refused=diagnostics().map(diagnostic=>diagnostic.code);
 expect(refused.filter(code=>code===2345)).toHaveLength(4);
 expect(refused.filter(code=>code===2540)).toHaveLength(3);
 expect(refused.filter(code=>code===2322)).toHaveLength(1);
 expect(refused).toContain(2339);
 expect(refused).toHaveLength(9);
});
