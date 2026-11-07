// oxlint-disable-next-line import/no-nodejs-modules -- Inspect defining declarations without generated products.
import {readFileSync} from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Resolve an unwritten schema consumer.
import {resolve} from 'node:path';
import ts from '@typescript/typescript6';
import {expect,test} from 'vitest';

for(const name of ["client/ui/debugOptions","shared/world/interact/types","client/world/interact/kit","client/world/HorizonMatte","shared/physics/bodies","client/world/blenderArea","shared/world/interact/barrel"])test(`${name} emits isolated declarations`,()=>{
 const emitted=ts.transpileDeclaration(readFileSync(`src/${name.replace(/^(client|shared|server|cook)\//u, '$1/engine/')}.ts`,'utf8'),{fileName:`${name}.ts`,reportDiagnostics:true,compilerOptions:{isolatedDeclarations:true,strict:true,exactOptionalPropertyTypes:true}});
 expect(emitted.diagnostics).toEqual([]);
 expect(emitted.outputText.length).toBeLessThan(100_000);
});

test('native constants retain literals and ownership',()=>{
 const consumer=resolve('src/test/engine/t4-engine-native-constant-consumer.ts');
 let source="import {TITLE_SKIPPERS} from '../../client/engine/ui/debugOptions';\nimport {TRANSIENT_PREFIXES} from '../../shared/engine/world/interact/types';\nimport {interactParts} from '../../client/engine/world/interact/kit';\nimport {lit} from '../../client/engine/models/interact';\nimport {HORIZON_RADIUS,type PaintedHorizon} from '../../client/engine/world/HorizonMatte';\nimport {DROP_BODY,type Bodies} from '../../shared/engine/physics/bodies';\nimport {BARREL_BODY} from '../../shared/engine/world/interact/barrel';\nimport {CELL,STEP} from '../../client/engine/world/blenderArea';\nimport type {Vector2} from 'three';\nTITLE_SKIPPERS.push('test'); TRANSIENT_PREFIXES.push('test:');\nexport const radius:2300=HORIZON_RADIUS;\nexport const part:typeof lit=interactParts.lit;\ndeclare const painted:PaintedHorizon;\nexport const veil:Vector2=painted.veil.value; painted.veil.value.set(0,1);\nexport const material:'wood'=DROP_BODY.material;\nexport const cylinder:0.38=BARREL_BODY.shape.cylinder.radius;\nexport const spacing:number=CELL+STEP;\ndeclare const bodies:Bodies; bodies.pre(); bodies.pre(0.016);\n";
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
 source+="TITLE_SKIPPERS.push(0);\npainted.veil={value:veil};\nBARREL_BODY.shape.cylinder.radius=0.4;\nexport const wrongMaterial:'metal'=DROP_BODY.material;\nexport const wrongRadius:4=HORIZON_RADIUS;\nexport const missing=interactParts.undeclared;\n";
 const refused=diagnostics().map(diagnostic=>diagnostic.code);
 expect(refused.filter(code=>code===2345)).toHaveLength(1);
 expect(refused.filter(code=>code===2540)).toHaveLength(2);
 expect(refused.filter(code=>code===2322)).toHaveLength(2);
 expect(refused).toContain(2339);
 expect(refused).toHaveLength(6);
});
