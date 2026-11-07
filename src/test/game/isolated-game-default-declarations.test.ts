// oxlint-disable-next-line import/no-nodejs-modules -- Inspect defining declarations without generated products.
import {readFileSync} from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Resolve an unwritten schema consumer.
import {resolve} from 'node:path';
import ts from '@typescript/typescript6';
import {expect,test} from 'vitest';

for(const name of ["client/titleDeck","client/complete/declared","client/grid/menu","client/grid/pageResidency","shared/grid/roadRecovery","client/grid/roadSky","client/grid/tileDecoder","shared/plugin/animation","shared/plugin/director","server/population/actorProjectionV2","shared/quest/pagePersistence","shared/quest/pageState","client/quest/story","client/riding/seatedFigure","client/shardfile/clientSource","client/shardfile/tileDriver","client/travel/travel"])test(`${name} emits isolated declarations`,()=>{
 const emitted=ts.transpileDeclaration(readFileSync(`src/${name.replace(/^(client|shared|server|cook)\//u, '$1/game/')}.ts`,'utf8'),{fileName:`${name}.ts`,reportDiagnostics:true,compilerOptions:{isolatedDeclarations:true,strict:true,exactOptionalPropertyTypes:true}});
 expect(emitted.diagnostics).toEqual([]);
 expect(emitted.outputText.length).toBeLessThan(100_000);
});

test('game defaults retain optional parameters and original argument kinds',()=>{
 const consumer=resolve('src/test/game/t4-isolated-game-default-declarations-consumer.ts');
 let source="import {titleCards} from '../../client/game/titleDeck';\nimport {gridEntryShown} from '../../client/game/grid/menu';\nimport {roadSunDir} from '../../client/game/grid/roadSky';\nimport {followRing} from '../../client/game/shardfile/tileDriver';\nimport {travelSlot} from '../../client/game/travel/travel';\nimport type {Vector3} from 'three';\nexport const cards=titleCards();\nexport const hidden=titleCards(true);\nexport const shown:boolean=gridEntryShown();\nexport const sun:Vector3=roadSunDir(0,0);\nexport const contains:boolean=followRing()({x:0,z:0})(0,0);\nexport const slot=travelSlot();\n";
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
 source+="titleCards('yes');\ngridEntryShown(undefined,'passed');\nroadSunDir(0,0,0);\nfollowRing('near');\nexport const wrongSun:number=roadSunDir(0,0);\nexport const missing=slot.undeclared;\n";
 const refused=diagnostics().map(diagnostic=>diagnostic.code);
 expect(refused.filter(code=>code===2322)).toHaveLength(1);
 expect(refused.filter(code=>code===2339)).toHaveLength(1);
 expect(refused.filter(code=>code===2345)).toHaveLength(4);
 expect(refused).toHaveLength(6);
});
