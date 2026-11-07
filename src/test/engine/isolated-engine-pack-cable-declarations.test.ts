// oxlint-disable-next-line import/no-nodejs-modules -- Inspect defining declarations without generated products.
import {readFileSync} from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Resolve an unwritten schema consumer.
import {resolve} from 'node:path';
import ts from '@typescript/typescript6';
import {expect,test} from 'vitest';

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
 const host=ts.createCompilerHost(options),read=host.readFile.bind(host),exists=host.fileExists.bind(host);
 host.fileExists=file=>file===consumer||exists(file);
 host.readFile=file=>file===consumer?source:read(file);
 const diagnostics=():readonly ts.Diagnostic[]=>{
  const program=ts.createProgram([consumer],options,host),file=program.getSourceFile(consumer);
  if(file===undefined)throw new Error('Missing virtual declarative world consumer');
  return program.getSemanticDiagnostics(file);
 };
 expect(diagnostics()).toEqual([]);
 source+="howler.speeds.hunt='speed';\npouncer.fields.leap=0;\nsaved.laneFrom=[0,0];\nsaved.elapsed='time';\nriding.v='velocity';\nlayout.a=point;\nexport const missing=saved.undeclared;\n";
 const refused=diagnostics().map(diagnostic=>diagnostic.code);
 expect(refused.filter(code=>code===2322)).toHaveLength(5);
 expect(refused.filter(code=>code===2339)).toHaveLength(1);
 expect(refused.filter(code=>code===2540)).toHaveLength(1);
 expect(refused).toHaveLength(7);
});
