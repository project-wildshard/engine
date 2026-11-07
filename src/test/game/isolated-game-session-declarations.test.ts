// oxlint-disable-next-line import/no-nodejs-modules -- Inspect defining declarations without generated products.
import {readFileSync} from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Resolve an unwritten schema consumer.
import {resolve} from 'node:path';
import ts from '@typescript/typescript6';
import {expect,test} from 'vitest';

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
 const host=ts.createCompilerHost(options),read=host.readFile.bind(host),exists=host.fileExists.bind(host);
 host.fileExists=file=>file===consumer||exists(file);
 host.readFile=file=>file===consumer?source:read(file);
 const diagnostics=():readonly ts.Diagnostic[]=>{
  const program=ts.createProgram([consumer],options,host),file=program.getSourceFile(consumer);
  if(file===undefined)throw new Error('Missing virtual declarative world consumer');
  return program.getSemanticDiagnostics(file);
 };
 expect(diagnostics()).toEqual([]);
 source+="export const wrongLoading:number=data.loading;\nexport const wrongSky:string=world.sky;\nexport const wrongAnimals:boolean=loadout.animals;\nexport const wrongGrid:number=play.grid;\ndataStage(\"context\");\nexport const missing=play.undeclared;\n";
 const refused=diagnostics().map(diagnostic=>diagnostic.code);
 expect(refused.filter(code=>code===2322)).toHaveLength(4);
 expect(refused.filter(code=>code===2339)).toHaveLength(1);
 expect(refused.filter(code=>code===2345)).toHaveLength(1);
 expect(refused).toHaveLength(6);
});
