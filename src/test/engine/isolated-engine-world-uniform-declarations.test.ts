// oxlint-disable-next-line import/no-nodejs-modules -- Inspect defining declarations without generated products.
import {readFileSync} from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Resolve an unwritten schema consumer.
import {resolve} from 'node:path';
import ts from '@typescript/typescript6';
import {expect,test} from 'vitest';

for(const name of ["server/ai/hunt","shared/core/config","shared/world/BakedTerrain","client/world/wind","shared/world/waves","shared/physics/groups","client/player/LockOnTarget","client/ui/saveStrings","client/world/Atmosphere","client/world/Horizon","client/world/TreeFactory","client/world/painterly","client/world/skyBackdrop","shared/world/steppeWind","client/world/forest/Forest","client/audio/gen"])test(`${name} emits isolated declarations`,()=>{
 const emitted=ts.transpileDeclaration(readFileSync(`src/${name.replace(/^(client|shared|server|cook)\//u, '$1/engine/')}.ts`,'utf8'),{fileName:`${name}.ts`,reportDiagnostics:true,compilerOptions:{isolatedDeclarations:true,strict:true,exactOptionalPropertyTypes:true}});
 expect(emitted.diagnostics).toEqual([]);
 expect(emitted.outputText.length).toBeLessThan(100_000);
});

test('world constants keep literal keys and borrowed mutable uniforms',()=>{
 const consumer=resolve('src/test/engine/t4-isolated-engine-world-uniform-declarations-consumer.ts');
 let source="import {GROUP} from '../../shared/engine/physics/groups';\nimport {LOCK} from '../../client/engine/player/LockOnTarget';\nimport {SAVE_STRINGS} from '../../client/engine/ui/saveStrings';\nimport {FOREST_BANDS} from '../../client/engine/world/forest/Forest';\nimport {windUniforms} from '../../client/engine/world/TreeFactory';\nimport {fogUniforms} from '../../client/engine/world/Atmosphere';\nimport {CHUNK_SIZE} from '../../shared/engine/core/config';\nimport {CHUNK_SIZE as CONTENT_SIZE} from '@wildshard/format/contentBounds';\nimport type {Color} from 'three';\nexport const group:number=GROUP.WORLD; export const cone:number=LOCK.CONE;\nexport const title:string=SAVE_STRINGS.title; export const count:string=SAVE_STRINGS.imported(2);\nexport const distance:number=FOREST_BANDS.hi; windUniforms.uTime.value=1;\nexport const size:typeof CONTENT_SIZE=CHUNK_SIZE; fogUniforms.fogSunColor.value.set(0);\n";
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
 source+="GROUP.WORLD=2;\nLOCK.CONE=0;\nSAVE_STRINGS.title='title';\nFOREST_BANDS.hi=2;\nwindUniforms.uTime.value='time';\nSAVE_STRINGS.imported('count');\nexport const missing=fogUniforms.undeclared;\n";
 const refused=diagnostics().map(diagnostic=>diagnostic.code);
 expect(refused.filter(code=>code===2322)).toHaveLength(1);
 expect(refused.filter(code=>code===2339)).toHaveLength(1);
 expect(refused.filter(code=>code===2345)).toHaveLength(1);
 expect(refused.filter(code=>code===2540)).toHaveLength(4);
 expect(refused).toHaveLength(7);
});
