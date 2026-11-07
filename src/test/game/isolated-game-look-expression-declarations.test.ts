// oxlint-disable-next-line import/no-nodejs-modules -- Inspect defining declarations without generated products.
import {readFileSync} from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Resolve an unwritten schema consumer.
import {resolve} from 'node:path';
import ts from '@typescript/typescript6';
import {expect,test} from 'vitest';

for(const name of ["client/looks/toonLighting","client/plugin/shaderFamily","shared/riding/taming","client/looks/grassPresentation","client/looks/toonLook","client/grid/frameModel","shared/shardfile/clientState","client/audio/theme","client/generators/pickups"])test(`${name} emits isolated declarations`,()=>{
 const emitted=ts.transpileDeclaration(readFileSync(`src/${name.replace(/^(client|shared|server|cook)\//u, '$1/game/')}.ts`,'utf8'),{fileName:`${name}.ts`,reportDiagnostics:true,compilerOptions:{isolatedDeclarations:true,strict:true,exactOptionalPropertyTypes:true}});
 expect(emitted.diagnostics).toEqual([]);
 expect(emitted.outputText.length).toBeLessThan(100_000);
});

test('game look expressions retain literal blending, mutable scales and typed factories',()=>{
 const consumer=resolve('src/test/game/t4-isolated-game-look-expression-declarations-consumer.ts');
 let source="import type {Color,BufferGeometry} from 'three';\nimport {toonLighting} from '../../client/game/looks/toonLighting';\nimport {BLEND_KEEP_ALPHA} from '../../client/game/plugin/shaderFamily';\nimport {LYDIAN,thirdAbove,ARRANGEMENTS} from '../../client/game/audio/theme';\nimport {seaGlassGeometry,authoredPickups} from '../../client/game/generators/pickups';\ndeclare const state:ReturnType<typeof toonLighting>;\nexport const light:Color=state.uToonLift.value;\nexport const mode:5=BLEND_KEEP_ALPHA.blending;\nLYDIAN.push(12);\nexport const note:number=thirdAbove(60,[0,3,7]);\nexport const shape:BufferGeometry=seaGlassGeometry();\nexport const arrangements=ARRANGEMENTS.theme.segments;\nexport const pickup=authoredPickups[0];\n";
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
 source+="BLEND_KEEP_ALPHA.blending=5;\nARRANGEMENTS.theme=ARRANGEMENTS.theme;\nstate.uCloudTime.value=\"later\";\nthirdAbove(60,[\"C\"]);\nseaGlassGeometry(\"seed\");\nexport const absent=state.undeclared;\n";
 const refused=diagnostics().map(diagnostic=>diagnostic.code);
 expect(refused.filter(code=>code===2322)).toHaveLength(2);
 expect(refused.filter(code=>code===2339)).toHaveLength(1);
 expect(refused.filter(code=>code===2345)).toHaveLength(1);
 expect(refused.filter(code=>code===2540)).toHaveLength(2);
 expect(refused).toHaveLength(6);
});
