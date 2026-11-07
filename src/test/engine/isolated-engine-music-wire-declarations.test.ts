// oxlint-disable-next-line import/no-nodejs-modules -- Inspect defining declarations without generated products.
import {readFileSync} from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Resolve an unwritten schema consumer.
import {resolve} from 'node:path';
import ts from '@typescript/typescript6';
import {expect,test} from 'vitest';

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
 const host=ts.createCompilerHost(options),read=host.readFile.bind(host),exists=host.fileExists.bind(host);
 host.fileExists=file=>file===consumer||exists(file);
 host.readFile=file=>file===consumer?source:read(file);
 const diagnostics=():readonly ts.Diagnostic[]=>{
  const program=ts.createProgram([consumer],options,host),file=program.getSourceFile(consumer);
  if(file===undefined)throw new Error('Missing virtual declarative world consumer');
  return program.getSemanticDiagnostics(file);
 };
 expect(diagnostics()).toEqual([]);
 source+="export const wrong:string=SWIM_SPEED;\niconParts.legs(1,2,3);\niconParts.stroke='stroke';\nstep.layout=step.layout;\nmusic.state.mode='invalid';\nexport const missing=step.layout.undeclared;\n";
 const refused=diagnostics().map(diagnostic=>diagnostic.code);
 expect(refused.filter(code=>code===2322)).toHaveLength(2);
 expect(refused.filter(code=>code===2339)).toHaveLength(1);
 expect(refused.filter(code=>code===2345)).toHaveLength(1);
 expect(refused.filter(code=>code===2540)).toHaveLength(2);
 expect(refused).toHaveLength(6);
});
