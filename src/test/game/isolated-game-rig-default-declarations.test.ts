// oxlint-disable-next-line import/no-nodejs-modules -- Inspect defining declarations without generated products.
import {readFileSync} from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Resolve an unwritten schema consumer.
import {resolve} from 'node:path';
import ts from '@typescript/typescript6';
import {expect,test} from 'vitest';

for(const name of ["shared/systems/looks/grassField","client/systems/viewmodel/rigArms","client/weapons/heldLauncher","client/weapons/heldPolearm","client/weather/rainPresentation","client/plugin/headless","client/plugin/geometry","shared/grid/ghosts","client/grid/live","client/systems/species/view/boar","client/systems/species/view/bear"])test(`${name} emits isolated declarations`,()=>{
 const emitted=ts.transpileDeclaration(readFileSync(`src/${name.replace(/^(client|shared|server|cook)\//u, '$1/game/')}.ts`,'utf8'),{fileName:`${name}.ts`,reportDiagnostics:true,compilerOptions:{isolatedDeclarations:true,strict:true,exactOptionalPropertyTypes:true}});
 expect(emitted.diagnostics).toEqual([]);
 expect(emitted.outputText.length).toBeLessThan(100_000);
});

test('game rigs and default diagnostics retain resource ownership and mutable tuple palettes',()=>{
 const consumer=resolve('src/test/game/t4-isolated-game-rig-default-declarations-consumer.ts');
 let source="import type {Group,Object3D} from 'three';\nimport {vmScale,type RigArms} from '../../client/game/systems/viewmodel/rigArms';\nimport type {GhostWorlds} from '../../shared/game/grid/ghosts';\nimport type {HeldLauncher} from '../../client/game/weapons/heldLauncher';\nimport {BOAR_PALETTE} from '../../client/game/systems/species/view/boar';\ndeclare const arms:RigArms;\ndeclare const ghosts:GhostWorlds;\ndeclare const launcher:HeldLauncher;\nexport const root:Group=arms.root;\nexport const node:Object3D|undefined=arms.nodes.get(\"hand\");\nexport const model:Group=launcher.model;\nexport const scale:number=vmScale(60);\nexport const count:number=ghosts.count();\nexport const colour:[number,number,number]=BOAR_PALETTE.base;\nBOAR_PALETTE.base[0]=0;\n";
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
 source+="arms.root=arms.root;\narms.nodes=arms.nodes;\nexport const wrongColour:typeof BOAR_PALETTE.base=[1,2];\nghosts.count(\"later\");\nvmScale(60,\"wide\");\nexport const missing=launcher.model.undeclared;\n";
 const refused=diagnostics().map(diagnostic=>diagnostic.code);
 expect(refused.filter(code=>code===2322)).toHaveLength(1);
 expect(refused.filter(code=>code===2339)).toHaveLength(1);
 expect(refused.filter(code=>code===2345)).toHaveLength(2);
 expect(refused.filter(code=>code===2540)).toHaveLength(2);
 expect(refused).toHaveLength(6);
});
