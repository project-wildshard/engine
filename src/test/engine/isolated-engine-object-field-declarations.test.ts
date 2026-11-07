// oxlint-disable-next-line import/no-nodejs-modules -- Inspect defining declarations without generated products.
import {readFileSync} from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Resolve an unwritten schema consumer.
import {resolve} from 'node:path';
import ts from '@typescript/typescript6';
import {expect,test} from 'vitest';

for(const name of ["client/entities/farHerd","client/explore/FreeCam","client/explore/fatLines","client/fx/LightPool","shared/physics/ropeChain","client/physics/ropeDeck","client/player/WeaponPickup","client/player/heldHandParts","client/world/Boundary","client/world/Grass","client/world/Terrain","client/world/backdropLayer","client/world/pond","client/world/skyRig","client/render/calibrationGpu","shared/physics/mover","client/quest/view"])test(`${name} emits isolated declarations`,()=>{
 const emitted=ts.transpileDeclaration(readFileSync(`src/${name.replace(/^(client|shared|server|cook)\//u, '$1/engine/')}.ts`,'utf8'),{fileName:`${name}.ts`,reportDiagnostics:true,compilerOptions:{isolatedDeclarations:true,strict:true,exactOptionalPropertyTypes:true}});
 expect(emitted.diagnostics).toEqual([]);
 expect(emitted.outputText.length).toBeLessThan(100_000);
});

test('object fields retain their borrowed types and mutability',()=>{
 const consumer=resolve('src/test/engine/t4-engine-object-field-consumer.ts');
 let source="import type {Group,Vector3} from 'three';\nimport type {Grass} from '../../client/engine/world/Grass';\nimport type {SkyRig} from '../../client/engine/world/skyRig';\nimport type {KinematicMover} from '../../shared/engine/physics/mover';\nimport type {Physics} from '../../shared/engine/physics/Physics';\nimport type {CalibrationGpu} from '../../client/engine/render/calibrationGpu';\ndeclare const grass:Grass;\ndeclare const group:Group;\ndeclare const sky:SkyRig;\ndeclare const mover:KinematicMover;\ndeclare const calibration:CalibrationGpu;\ngrass.group=group;\nexport const radius:number=grass.radius;\nexport const direction:Vector3=sky.sunDir;\nexport const body:ReturnType<Physics['world']['getRigidBody']>=mover.body;\nexport const pixelRatio:number=calibration.renderer.getPixelRatio();\n";
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
 source+="mover.body=mover.body;\ngrass.radius=4;\nexport const wrongDirection:number=sky.sunDir;\nexport const wrongGroup:string=grass.group;\nexport const wrongRenderer:number=calibration.renderer;\nexport const missing=mover.body.undeclared;\n";
 const refused=diagnostics().map(diagnostic=>diagnostic.code);
 expect(refused.filter(code=>code===2540)).toHaveLength(2);
 expect(refused.filter(code=>code===2322)).toHaveLength(3);
 expect(refused).toContain(2339);
 expect(refused).toHaveLength(6);
});
