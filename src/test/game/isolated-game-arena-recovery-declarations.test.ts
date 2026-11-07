// oxlint-disable-next-line import/no-nodejs-modules -- Inspect defining declarations without generated products.
import {readFileSync} from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Resolve an unwritten schema consumer.
import {resolve} from 'node:path';
import ts from '@typescript/typescript6';
import {expect,test} from 'vitest';

for(const name of ["client/summary","client/boss/arenaRoom","server/riding/pastureController","shared/riding/physics","shared/quest/nativeProps"])test(`${name} emits isolated declarations`,()=>{
 const emitted=ts.transpileDeclaration(readFileSync(`src/${name.replace(/^(client|shared|server|cook)\//u, '$1/game/')}.ts`,'utf8'),{fileName:`${name}.ts`,reportDiagnostics:true,compilerOptions:{isolatedDeclarations:true,strict:true,exactOptionalPropertyTypes:true}});
 expect(emitted.diagnostics).toEqual([]);
 expect(emitted.outputText.length).toBeLessThan(100_000);
});

test('game arena and riding saves retain original revisions, tags and fixed tuples',()=>{
 const consumer=resolve('src/test/game/t4-isolated-game-arena-recovery-declarations-consumer.ts');
 let source="import type * as v from 'valibot';\nimport type {WildshardSummary} from '../../client/game/summary';\nimport { ArenaFightPageSchema, ArenaRoomPortalSchema, type ArenaRoomRows } from '../../shared/game/boss/arenaRoomRows';\nimport type {RhythmSpurState,MountedReinsState} from '../../shared/game/riding/physics';\ndeclare const room:ArenaRoomRows;\ndeclare const portal:v.InferOutput<typeof ArenaRoomPortalSchema>;\ndeclare const fight:v.InferOutput<typeof ArenaFightPageSchema>;\ndeclare const reins:MountedReinsState;\nexport const summary:WildshardSummary={v:1,shards:{}};\nexport const origin:number=room.origin.x;\nexport const fade:number=portal.fade.out;\nexport const reward:[number,number,number]=fight.reward;\nexport const spur:number=reins.spur.streak;\n";
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
 source+="export const wrongVersion:WildshardSummary[\"v\"]=2;\nexport const wrongSpur:RhythmSpurState[\"version\"]=2;\nexport const wrongIdentity:v.InferOutput<typeof ArenaFightPageSchema>[\"identity\"]=\"hidden\";\nexport const wrongReward:v.InferOutput<typeof ArenaFightPageSchema>[\"reward\"]=[1,2];\nexport const wrongFade:v.InferOutput<typeof ArenaRoomPortalSchema>[\"fade\"][\"out\"]=\"later\";\nexport const absent=room.undeclared;\n";
 const refused=diagnostics().map(diagnostic=>diagnostic.code);
 expect(refused.filter(code=>code===2322)).toHaveLength(5);
 expect(refused.filter(code=>code===2339)).toHaveLength(1);
 expect(refused).toHaveLength(6);
});
