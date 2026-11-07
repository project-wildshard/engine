// oxlint-disable-next-line import/no-nodejs-modules -- Inspect defining declarations without generated products.
import {readFileSync} from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Resolve an unwritten schema consumer.
import {resolve} from 'node:path';
import ts from '@typescript/typescript6';
import {expect,test} from 'vitest';

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
 const host=ts.createCompilerHost(options),read=host.readFile.bind(host),exists=host.fileExists.bind(host);
 host.fileExists=file=>file===consumer||exists(file);
 host.readFile=file=>file===consumer?source:read(file);
 const diagnostics=():readonly ts.Diagnostic[]=>{
  const program=ts.createProgram([consumer],options,host),file=program.getSourceFile(consumer);
  if(file===undefined)throw new Error('Missing virtual declarative world consumer');
  return program.getSemanticDiagnostics(file);
 };
 expect(diagnostics()).toEqual([]);
 source+="GRID_HAZE.near=600;\nFAR_RING.count=9;\nexport const wrongScope:\"page\"=inventoryKey.scope;\nexport const wrongCoins:string=purseKey.initial();\ntrample.uniforms.uMoverCount.value=\"many\";\npushLentParams({push:looks=>{looks.undeclared();}});\n";
 const refused=diagnostics().map(diagnostic=>diagnostic.code);
 expect(refused.filter(code=>code===2322)).toHaveLength(3);
 expect(refused.filter(code=>code===2339)).toHaveLength(1);
 expect(refused.filter(code=>code===2540)).toHaveLength(2);
 expect(refused).toHaveLength(6);
});
