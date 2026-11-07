// oxlint-disable-next-line import/no-nodejs-modules -- Inspect defining declarations without generated products.
import {readFileSync} from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Resolve an unwritten schema consumer.
import {resolve} from 'node:path';
import ts from '@typescript/typescript6';
import {expect,test} from 'vitest';

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
 const host=ts.createCompilerHost(options),read=host.readFile.bind(host),exists=host.fileExists.bind(host);
 host.fileExists=file=>file===consumer||exists(file);
 host.readFile=file=>file===consumer?source:read(file);
 const diagnostics=():readonly ts.Diagnostic[]=>{
  const program=ts.createProgram([consumer],options,host),file=program.getSourceFile(consumer);
  if(file===undefined)throw new Error('Missing virtual declarative world consumer');
  return program.getSemanticDiagnostics(file);
 };
 expect(diagnostics()).toEqual([]);
 source+="BRAIN_FIELD.speed=2;\nPLAYER_BODY.weight=80;\nexport const wrongMove:typeof move['version']=2;\nexport const wrongStopped:StoppedProjectileSaved['version']=2;\nexport const wrongPattern:NativeEliteKernelRow['profile']['pattern']='other';\nexport const missing=move.undeclared;\n";
 const refused=diagnostics().map(diagnostic=>diagnostic.code);
 expect(refused.filter(code=>code===2540)).toHaveLength(2);
 expect(refused.filter(code=>code===2322)).toHaveLength(3);
 expect(refused).toContain(2339);
 expect(refused).toHaveLength(6);
});
