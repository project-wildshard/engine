// oxlint-disable-next-line import/no-nodejs-modules -- Inspect defining declarations without generated products.
import {readFileSync} from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Resolve an unwritten schema consumer.
import {resolve} from 'node:path';
import ts from '@typescript/typescript6';
import {expect,test} from 'vitest';

for(const name of ["shared/grid/catalogue","server/plugin/simulation","shared/plugin/quests"])test(`${name} emits isolated declarations`,()=>{
 const emitted=ts.transpileDeclaration(readFileSync(`src/${name.replace(/^(client|shared|server|cook)\//u, '$1/game/')}.ts`,'utf8'),{fileName:`${name}.ts`,reportDiagnostics:true,compilerOptions:{isolatedDeclarations:true,strict:true,exactOptionalPropertyTypes:true}});
 expect(emitted.diagnostics).toEqual([]);
 expect(emitted.outputText.length).toBeLessThan(100_000);
});

test('game metadata retains grid literals, quest overloads and NPC field contracts',()=>{
 const consumer=resolve('src/test/game/t4-isolated-game-metadata-declarations-consumer.ts');
 let source="import type * as v from 'valibot';\nimport type {GridCatalogue,CopyIdentity,GridEdgeLook} from '../../shared/game/grid/catalogue';\nimport {readRuntimeWorldMetadata} from '../../server/game/plugin/simulation';\nimport {NpcMotionSchema,NpcDialogueRowSchema} from '../../shared/game/plugin/quests';\ndeclare const grid:GridCatalogue;\ndeclare const motion:v.InferOutput<typeof NpcMotionSchema>;\ndeclare const dialogue:v.InferOutput<typeof NpcDialogueRowSchema>;\nexport const version:0=grid.version;\nexport const pitch:562.5=grid.pitch;\nexport const accent:CopyIdentity[\"accent\"]=\"ember\";\nexport const edge:GridEdgeLook={height:1};\nexport const turns:boolean=motion.turns;\nexport const talks=dialogue.dialogue;\nexport const world=readRuntimeWorldMetadata({});\nexport const quests=readRuntimeWorldMetadata({},true);\nexport const spots:readonly {id:string;x:number;y:number;z:number;radius:number}[]=quests.spots.interact;\n";
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
 source+="export const wrongVersion:GridCatalogue[\"version\"]=1;\nexport const wrongPitch:GridCatalogue[\"pitch\"]=500;\nexport const wrongAccent:CopyIdentity[\"accent\"]=\"ultraviolet\";\nexport const wrongEdge:GridEdgeLook={height:\"low\"};\nexport const wrongTurns:v.InferOutput<typeof NpcMotionSchema>[\"turns\"]=1;\nexport const missing=world.spots;\n";
 const refused=diagnostics().map(diagnostic=>diagnostic.code);
 expect(refused.filter(code=>code===2322)).toHaveLength(5);
 expect(refused.filter(code=>code===2339)).toHaveLength(1);
 expect(refused).toHaveLength(6);
});
