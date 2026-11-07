// oxlint-disable-next-line import/no-nodejs-modules -- Inspect defining declarations without generated products.
import {readFileSync} from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Resolve an unwritten schema consumer.
import {resolve} from 'node:path';
import ts from '@typescript/typescript6';
import {expect,test} from 'vitest';

for(const name of ["shared/ai/diver","client/models/nativeGeometry","shared/quest/dialogueClock","shared/sim/moverLifecycle","shared/world/weather","shared/world/weatherContinuation"])test(`${name} emits isolated declarations`,()=>{
 const emitted=ts.transpileDeclaration(readFileSync(`src/${name.replace(/^(client|shared|server|cook)\//u, '$1/engine/')}.ts`,'utf8'),{fileName:`${name}.ts`,reportDiagnostics:true,compilerOptions:{isolatedDeclarations:true,strict:true,exactOptionalPropertyTypes:true}});
 expect(emitted.diagnostics).toEqual([]);
 expect(emitted.outputText.length).toBeLessThan(100_000);
});

test('native save contracts retain closed fields and typed records',()=>{
 const consumer=resolve('src/test/engine/t4-engine-native-save-consumer.ts');
 let source="import * as v from 'valibot';\nimport {NativeAttributeSchema,NativeAttributesSchema} from '../../client/engine/models/nativeGeometry';\nimport type {WindDiverSpec} from '../../shared/engine/ai/diver';\nimport type {DialogueSaved} from '../../shared/engine/quest/dialogueClock';\nimport type {MoverLifecycleState} from '../../shared/engine/sim/moverLifecycle';\nimport type {GustContinuation} from '../../shared/engine/world/weatherContinuation';\nexport const attribute:v.InferOutput<typeof NativeAttributeSchema>={semantic:'POSITION',storage:'Float32Array',normalized:false,itemSize:3};\nexport const attributes:v.InferOutput<typeof NativeAttributesSchema>={position:attribute};\nexport const dialogue:DialogueSaved={version:1,lines:[],index:0,shown:0,open:false};\nexport const gust:ReturnType<GustContinuation['snapshot']>={version:1,time:0,gust:0};\nexport const movers:MoverLifecycleState={contract:'movers',ends:[],pending:[]};\ndeclare const wind:WindDiverSpec;\nexport const speed:number=wind.stoop.speed;\nexport const altitude:string=wind.fields.altitude;\nexport const gustRecord:Record<string,unknown>=gust;\nexport const dialogueRecord:Record<string,unknown>=dialogue;\nexport const attributeRows=Object.values(attributes);\ntype AttributeAny=0 extends (1 & typeof attributeRows[number])?true:false;\nexport const typedAttribute:AttributeAny=false;\n";
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
 source+="export const badStorage:typeof attribute['storage']='Float64Array';\nexport const badDialogue:DialogueSaved['version']=2;\nexport const badGust:typeof gust['version']=2;\nexport const badEnd:MoverLifecycleState['ends'][number]['atEnd']='true';\nexport const badAltitude:number=wind.fields.altitude;\nexport const missing=attribute.undeclared;\n";
 const refused=diagnostics().map(diagnostic=>diagnostic.code);
 expect(refused.filter(code=>code===2322)).toHaveLength(4);
 expect(refused.filter(code=>code===2820)).toHaveLength(1);
 expect(refused).toContain(2339);
 expect(refused).toHaveLength(6);
});
