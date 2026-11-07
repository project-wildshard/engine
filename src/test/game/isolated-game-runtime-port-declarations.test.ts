// oxlint-disable-next-line import/no-nodejs-modules -- Inspect defining declarations without generated products.
import {readFileSync} from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Resolve an unwritten schema consumer.
import {resolve} from 'node:path';
import ts from '@typescript/typescript6';
import {expect,test} from 'vitest';

for(const name of ["shared/weapons/starterCombat","server/plugin/nativeItems","client/shardfile/clientForestPage","client/Boss"])test(`${name} emits isolated declarations`,()=>{
 const emitted=ts.transpileDeclaration(readFileSync(`src/${name.replace(/^(client|shared|server|cook)\//u, '$1/game/')}.ts`,'utf8'),{fileName:`${name}.ts`,reportDiagnostics:true,compilerOptions:{isolatedDeclarations:true,strict:true,exactOptionalPropertyTypes:true}});
 expect(emitted.diagnostics).toEqual([]);
 expect(emitted.outputText.length).toBeLessThan(100_000);
});

test('game runtime ports retain contact arguments, combat owners and generic entry results',()=>{
 const consumer=resolve('src/test/game/t4-isolated-game-runtime-port-declarations-consumer.ts');
 let source="import type {Scope} from '@wildshard/engine/app/scope';\nimport type {Player} from '@wildshard/engine/player/Player';\nimport {STARTER_MELEE_PROFILE,IRON_MELEE_PROFILE} from '../../shared/game/weapons/starterCombat';\nimport {nativeRangedHit} from '../../server/game/plugin/nativeItems';\nimport {FOREST_PAGE_PORTS} from '../../client/game/shardfile/clientForestPage';\nimport type {CaveInterior} from '../../client/game/shardfile/caveInterior';\nimport type {PageCombatSession} from '../../client/game/Boss';\ndeclare const scope:Scope;\ndeclare const combat:PageCombatSession;\nexport const family:\"melee\"=STARTER_MELEE_PROFILE.family;\nexport const damage:number=IRON_MELEE_PROFILE.damage;\nexport const player:Player=combat.context.player;\nexport const dusk:number=combat.context.dusk();\nexport const cave:CaveInterior=FOREST_PAGE_PORTS.entryOwner(scope,\"cave\",\"id\");\ndeclare const args:Parameters<typeof nativeRangedHit>;\nexport const hit=nativeRangedHit(...args);\n";
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
 source+="export const wrongFamily:typeof STARTER_MELEE_PROFILE.family=\"ranged\";\ncombat.context=combat.context;\ncombat.context.god=\"yes\";\nFOREST_PAGE_PORTS.entryOwner(scope,\"undeclared\",\"id\");\nnativeRangedHit(\"actors\",args[1],args[2],10);\nexport const missing=combat.context.undeclared;\n";
 const refused=diagnostics().map(diagnostic=>diagnostic.code);
 expect(refused.filter(code=>code===2322)).toHaveLength(2);
 expect(refused.filter(code=>code===2339)).toHaveLength(1);
 expect(refused.filter(code=>code===2345)).toHaveLength(2);
 expect(refused.filter(code=>code===2540)).toHaveLength(1);
 expect(refused).toHaveLength(6);
});
