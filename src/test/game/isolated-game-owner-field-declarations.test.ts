// oxlint-disable-next-line import/no-nodejs-modules -- Inspect defining declarations without generated products.
import {readFileSync} from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Resolve an unwritten schema consumer.
import {resolve} from 'node:path';
import ts from '@typescript/typescript6';
import {expect,test} from 'vitest';

for(const name of ["client/ambient/ambientFlock","client/ambient/wingField","client/bag/BagButton","client/compendium/Journal","client/cosmetics/bodyShadow","client/cosmetics/cosmetics","client/cosmetics/locker","client/grapple/ribbon","client/loadout/cosmeticFinishes","client/looks/forestGround","client/looks/streamedCover","client/loot/runtime","client/loot/ui/CoinChip","server/population/environment","server/population/perchBody","client/population/projection","server/quest/bodyOps","client/systems/effects/view"])test(`${name} emits isolated declarations`,()=>{
 const emitted=ts.transpileDeclaration(readFileSync(`src/${name.replace(/^(client|shared|server|cook)\//u, '$1/game/')}.ts`,'utf8'),{fileName:`${name}.ts`,reportDiagnostics:true,compilerOptions:{isolatedDeclarations:true,strict:true,exactOptionalPropertyTypes:true}});
 expect(emitted.diagnostics).toEqual([]);
 expect(emitted.outputText.length).toBeLessThan(100_000);
});

test('game owners retain exact borrowed fields and mutable contents',()=>{
 const consumer=resolve('src/test/game/t4-isolated-game-owner-field-declarations-consumer.ts');
 let source="import type {Group} from 'three';\nimport type {Scope} from '@wildshard/engine/app/scope';\nimport type {AmbientFlockDraw} from '../../client/game/ambient/ambientFlock';\nimport type {Journal} from '../../client/game/compendium/Journal';\nimport type {CosmeticsLocker} from '../../client/game/cosmetics/locker';\nimport type {DeclaredBodyOps} from '../../server/game/quest/bodyOps';\ndeclare const flock:AmbientFlockDraw;\ndeclare const journal:Journal;\ndeclare const locker:CosmeticsLocker<string,{id:string}>;\ndeclare const body:DeclaredBodyOps;\nexport const root:Group=flock.group;\nexport const scope:Scope=journal.scope;\nlocker.owned.add('example');\nexport const owned:Set<string>=locker.owned;\nexport const bodies:ReadonlyMap<string,number>=body.registries.bodies;\n";
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
 source+="flock.group=flock.group;\njournal.scope=journal.scope;\nlocker.owned=locker.owned;\nexport const wrongGroup:number=flock.group;\nexport const wrongCount:string=locker.owned.size;\nexport const missing=body.registries.undeclared;\n";
 const refused=diagnostics().map(diagnostic=>diagnostic.code);
 expect(refused.filter(code=>code===2322)).toHaveLength(2);
 expect(refused.filter(code=>code===2339)).toHaveLength(1);
 expect(refused.filter(code=>code===2540)).toHaveLength(3);
 expect(refused).toHaveLength(6);
});
