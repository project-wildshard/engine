// oxlint-disable-next-line import/no-nodejs-modules -- Inspect defining declarations without generated products.
import {readFileSync} from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Resolve an unwritten schema consumer.
import {resolve} from 'node:path';
import ts from '@typescript/typescript6';
import {expect,test} from 'vitest';

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
 const host=ts.createCompilerHost(options),read=host.readFile.bind(host),exists=host.fileExists.bind(host);
 host.fileExists=file=>file===consumer||exists(file);
 host.readFile=file=>file===consumer?source:read(file);
 const diagnostics=():readonly ts.Diagnostic[]=>{
  const program=ts.createProgram([consumer],options,host),file=program.getSourceFile(consumer);
  if(file===undefined)throw new Error('Missing virtual declarative world consumer');
  return program.getSemanticDiagnostics(file);
 };
 expect(diagnostics()).toEqual([]);
 source+="export const wrongVersion:CompendiumSnapshot[\"version\"]=2;\nexport const wrongLocation:GridSavedLocation[\"kind\"]=\"sky\";\nexport const wrongDrift:v.InferOutput<typeof PaintedAirSchema>[\"drift\"]=[0];\nexport const wrongImage:v.InferOutput<typeof PaintedPanoramaSchema>[\"dome\"][\"image\"][\"phone\"]=0;\nexport const wrongContent:QuestPageViewRows[\"content\"]=\"unscoped\";\nexport const wrongSection:v.InferOutput<typeof IslandLibrarySchema>[\"draws\"][\"section\"]=\"unscoped\";\nexport const absent=air.undeclared;\n";
 const refused=diagnostics().map(diagnostic=>diagnostic.code);
 expect(refused.filter(code=>code===2322)).toHaveLength(6);
 expect(refused.filter(code=>code===2339)).toHaveLength(1);
 expect(refused).toHaveLength(7);
});
