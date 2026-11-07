// oxlint-disable-next-line import/no-nodejs-modules -- Inspect defining declarations without generated products.
import {readFileSync} from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Resolve an unwritten schema consumer.
import {resolve} from 'node:path';
import ts from '@typescript/typescript6';
import {expect,test} from 'vitest';

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
 const host=ts.createCompilerHost(options),read=host.readFile.bind(host),exists=host.fileExists.bind(host);
 host.fileExists=file=>file===consumer||exists(file);
 host.readFile=file=>file===consumer?source:read(file);
 const diagnostics=():readonly ts.Diagnostic[]=>{
  const program=ts.createProgram([consumer],options,host),file=program.getSourceFile(consumer);
  if(file===undefined)throw new Error('Missing virtual declarative world consumer');
  return program.getSemanticDiagnostics(file);
 };
 expect(diagnostics()).toEqual([]);
 source+="freshPageArrival(0,'now');\npanFromYaw(0,0,0,0.8,'far');\nbuildYield(owner,'budget');\nnew KeepAlive('owner');\nexport const wrong:number=freshPageArrival(0);\nexport const missing=defaultOwner.undeclared;\n";
 const refused=diagnostics().map(diagnostic=>diagnostic.code);
 expect(refused.filter(code=>code===2345)).toHaveLength(4);
 expect(refused.filter(code=>code===2322)).toHaveLength(1);
 expect(refused).toContain(2339);
 expect(refused).toHaveLength(6);
});
