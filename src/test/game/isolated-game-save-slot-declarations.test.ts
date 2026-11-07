// oxlint-disable-next-line import/no-nodejs-modules -- Inspect defining declarations without generated products.
import {readFileSync} from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Resolve an unwritten schema consumer.
import {resolve} from 'node:path';
import ts from '@typescript/typescript6';
import {expect,test} from 'vitest';

for(const name of ["shared/saves","shared/grapple/sim","shared/grid/continuations","server/plugin/brain","client/plugin/context","shared/quest/interactionRows","shared/quest/legacyRecords","shared/quest/persistence","client/weapons/Sword"])test(`${name} emits isolated declarations`,()=>{
 const emitted=ts.transpileDeclaration(readFileSync(`src/${name.replace(/^(client|shared|server|cook)\//u, '$1/game/')}.ts`,'utf8'),{fileName:`${name}.ts`,reportDiagnostics:true,compilerOptions:{isolatedDeclarations:true,strict:true,exactOptionalPropertyTypes:true}});
 expect(emitted.diagnostics).toEqual([]);
 expect(emitted.outputText.length).toBeLessThan(100_000);
});

test('game save slots and context aliases retain exact reads and writes',()=>{
 const consumer=resolve('src/test/game/t4-isolated-game-save-slot-declarations-consumer.ts');
 let source="import type {SaveSlot} from '@wildshard/engine/saves/store';\nimport {progressSave,inventorySave,purseSave,bountySave} from '../../shared/game/saves';\nimport {gridCells,gridHomeSim,type GridHomeHandoff} from '../../client/game/plugin/context';\nimport type {GridCellEvents} from '../../shared/game/grid/cellEvents';\nexport const coins:SaveSlot<number>=purseSave;\nexport const cells:GridCellEvents=gridCells;\nexport const home:GridHomeHandoff=gridHomeSim;\nexport const progress:ReturnType<typeof progressSave.read>={counts:{},earned:[],title:null,playS:0};\nexport const inventory:ReturnType<typeof inventorySave.read>={counts:{},order:[]};\nexport const bounty:ReturnType<typeof bountySave.read>={example:2};\n";
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
 source+="purseSave.write(\"coins\");\nexport const wrongOrder:ReturnType<typeof inventorySave.read>[\"order\"]=[0];\nexport const wrongEarned:ReturnType<typeof progressSave.read>[\"earned\"]=[0];\nexport const wrongCount:ReturnType<typeof bountySave.read>={example:\"two\"};\nexport const absent=gridHomeSim.undeclared;\n";
 const refused=diagnostics().map(diagnostic=>diagnostic.code);
 expect(refused.filter(code=>code===2322)).toHaveLength(3);
 expect(refused.filter(code=>code===2339)).toHaveLength(1);
 expect(refused.filter(code=>code===2345)).toHaveLength(1);
 expect(refused).toHaveLength(5);
});
