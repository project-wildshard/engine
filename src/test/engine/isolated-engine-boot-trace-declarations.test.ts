// oxlint-disable-next-line import/no-nodejs-modules -- Verify source-owned export capture order without a browser.
import {runInNewContext} from 'node:vm';
// oxlint-disable-next-line import/no-nodejs-modules -- Inspect defining declarations without generated products.
import {readFileSync} from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Resolve an unwritten schema consumer.
import {resolve} from 'node:path';
import ts from '@typescript/typescript6';
import {expect,test} from 'vitest';

for(const name of ["client/boot/bootTrace"])test(`${name} emits isolated declarations`,()=>{
 const emitted=ts.transpileDeclaration(readFileSync(`src/${name.replace(/^(client|shared|server|cook)\//u, '$1/engine/')}.ts`,'utf8'),{fileName:`${name}.ts`,reportDiagnostics:true,compilerOptions:{isolatedDeclarations:true,strict:true,exactOptionalPropertyTypes:true}});
 expect(emitted.diagnostics).toEqual([]);
 expect(emitted.outputText.length).toBeLessThan(100_000);
});

test('trace aliases retain complete existing callable signatures',()=>{
 const consumer=resolve('src/test/engine/t4-isolated-engine-boot-trace-declarations-consumer.ts');
 let source="import {bootTraceActive,previousBootLevel,flushBootReports,recordBootCheckpoint,startBoot,recordGpuRecovery} from '../../client/engine/boot/bootTrace';\nexport const active:boolean=bootTraceActive(); export const level:string=previousBootLevel();\nexport const flushed:Promise<void>=flushBootReports();\nrecordBootCheckpoint('unit',{count:1,ready:true,name:'unit'});\nrecordBootCheckpoint('unit'); startBoot({id:'unit',name:'unit'}); recordGpuRecovery('unit');\n";
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
 source+="recordBootCheckpoint(0);\nrecordBootCheckpoint('unit',{count:[]});\nstartBoot({id:0,name:'unit'});\nrecordGpuRecovery(false);\nexport const wrong:number=previousBootLevel();\nexport const missing=bootTraceActive.undeclared;\n";
 const refused=diagnostics().map(diagnostic=>diagnostic.code);
 expect(refused.filter(code=>code===2322)).toHaveLength(3);
 expect(refused.filter(code=>code===2339)).toHaveLength(1);
 expect(refused.filter(code=>code===2345)).toHaveLength(2);
 expect(refused).toHaveLength(6);
});

test('page aliases capture each original function once in order',()=>{
 const names=["bootTraceActive","previousBootLevel","flushBootReports","inspectPreviousBoot","previousBootLine","bootDiagnostic","bootDiagnosticJson","recordBootProgress","recordBootCheckpoint","startBoot","markBootPlanned","markBootHandledError","markBootContextLost","beginExploreEntry","endExploreEntry","exploreEntryPending","recordExploreFrame","recordGpuRecovery"];
 const path='src/client/engine/boot/bootTrace.ts',source=ts.createSourceFile(path,readFileSync(path,'utf8'),ts.ScriptTarget.Latest,true);
 const rows=source.statements.filter(ts.isVariableStatement).filter(node=>node.modifiers?.some(modifier=>modifier.kind===ts.SyntaxKind.ExportKeyword));
 expect(rows.flatMap(node=>node.declarationList.declarations.map(row=>row.name.getText(source)))).toEqual(names);
 const printer=ts.createPrinter(),scripts:string[]=[];
 for(const row of rows){
  expect(row.declarationList.declarations).toHaveLength(1);
  const declaration=row.declarationList.declarations[0];
  if(declaration===undefined)throw new Error('Missing trace binding');
  expect(declaration.initializer?.getText(source)).toBe(`page.${declaration.name.getText(source)}`);
  scripts.push(printer.printNode(ts.EmitHint.Unspecified,row,source));
 }
 const page:Record<string,unknown>={},reads:string[]=[],values=new Map<string,()=>string>();
 for(const name of names){const value=():string=>name;values.set(name,value);Object.defineProperty(page,name,{get(this:object){expect(this).toBe(page);reads.push(name);return value;}});}
 const emitted=ts.transpileModule(scripts.join('\n'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText.replaceAll('export ','');
 const raw:unknown=runInNewContext(`${emitted}\n[${names.join(',')}]`,{page});
 if(!Array.isArray(raw))throw new Error('Trace bindings did not return an array');
 const captured:readonly unknown[]=raw;
 expect(reads).toEqual(names); expect(captured).toHaveLength(names.length);
 for(const[index,name]of names.entries()){expect(typeof captured[index]).toBe('function');expect(captured[index]).toBe(values.get(name));}
});
