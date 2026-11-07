// oxlint-disable-next-line import/no-nodejs-modules -- Inspect defining declarations without generated products.
import {readFileSync} from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Resolve an unwritten schema consumer.
import {resolve} from 'node:path';
import ts from '@typescript/typescript6';
import {expect,test} from 'vitest';

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
 const host=ts.createCompilerHost(options),read=host.readFile.bind(host),exists=host.fileExists.bind(host);
 host.fileExists=file=>file===consumer||exists(file);
 host.readFile=file=>file===consumer?source:read(file);
 const diagnostics=():readonly ts.Diagnostic[]=>{
  const program=ts.createProgram([consumer],options,host),file=program.getSourceFile(consumer);
  if(file===undefined)throw new Error('Missing virtual declarative world consumer');
  return program.getSemanticDiagnostics(file);
 };
 expect(diagnostics()).toEqual([]);
 source+="app.clock=app.clock;\ngame.rootScene=root;\npose.pose=new Float32Array(4);\nsim.entities=new Map();\nsim.entities.set(0,animal);\nanimal.position='point';\npose.pose[0]='weight';\nexport const missing=live.undeclared;\n";
 const refused=diagnostics().map(diagnostic=>diagnostic.code);
 expect(refused.filter(code=>code===2322)).toHaveLength(2);
 expect(refused.filter(code=>code===2339)).toHaveLength(1);
 expect(refused.filter(code=>code===2345)).toHaveLength(1);
 expect(refused.filter(code=>code===2540)).toHaveLength(4);
 expect(refused).toHaveLength(8);
});
