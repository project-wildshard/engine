// oxlint-disable-next-line import/no-nodejs-modules -- Inspect defining declarations without generated products.
import {readFileSync} from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Resolve an unwritten schema consumer.
import {resolve} from 'node:path';
import ts from '@typescript/typescript6';
import {expect,test} from 'vitest';

for(const name of ["client/Inventory","client/grid/budgetPoints","shared/grid/cellEvents","shared/grid/roadLayout","shared/loot/Owned","client/models/interact","client/models/mountedSpecimen","shared/shardfile/movers","client/systems/viewmodel/armRig","shared/weapons/starterMoves"])test(`${name} emits isolated declarations`,()=>{
 const emitted=ts.transpileDeclaration(readFileSync(`src/${name.replace(/^(client|shared|server|cook)\//u, '$1/game/')}.ts`,'utf8'),{fileName:`${name}.ts`,reportDiagnostics:true,compilerOptions:{isolatedDeclarations:true,strict:true,exactOptionalPropertyTypes:true}});
 expect(emitted.diagnostics).toEqual([]);
 expect(emitted.outputText.length).toBeLessThan(100_000);
});

test('game registries retain literal identities, readonly rows and live singletons',()=>{
 const consumer=resolve('src/test/game/t4-isolated-game-registry-declarations-consumer.ts');
 let source="import {PACK_SLOTS} from '../../client/game/Inventory';\nimport {ENTRY_ASPHALT,GAP_HALF} from '../../shared/game/grid/roadLayout';\nimport {pageGridCells,type GridCellEvents} from '../../shared/game/grid/cellEvents';\nimport {OWNED,type CosmeticId} from '../../shared/game/loot/Owned';\nimport {MOVER_FIELDS} from '../../shared/game/shardfile/movers';\nimport {BONES,LIMITS,TWISTS} from '../../client/game/systems/viewmodel/armRig';\nexport const slots:12=PACK_SLOTS;\nexport const asphalt:15=ENTRY_ASPHALT;\nexport const gap:number=GAP_HALF;\nexport const events:GridCellEvents=pageGridCells;\nexport const cosmetic:CosmeticId=\"cape\";\nexport const label:\"Sailcloth cape\"=OWNED.cape.label;\nexport const pitch:1=MOVER_FIELDS.pitch;\nexport const hand:\"R_hand\"=BONES.right[6];\nexport const twist:0.85=TWISTS[0].at;\nexport const low:-75=LIMITS.pronation[0];\n";
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
 source+="export const wrongSlots:13=PACK_SLOTS;\nexport const wrongCosmetic:CosmeticId=\"iron-sword\";\nMOVER_FIELDS.pitch=1;\nBONES.right[0]=\"R_shoulder\";\nOWNED.cape.kind=\"cosmetic\";\nexport const missing=pageGridCells.undeclared;\n";
 const refused=diagnostics().map(diagnostic=>diagnostic.code);
 expect(refused.filter(code=>code===2322)).toHaveLength(2);
 expect(refused.filter(code=>code===2339)).toHaveLength(1);
 expect(refused.filter(code=>code===2540)).toHaveLength(3);
 expect(refused).toHaveLength(6);
});
