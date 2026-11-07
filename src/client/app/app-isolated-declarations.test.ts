// oxlint-disable-next-line import/no-nodejs-modules -- Read the defining production project and sources.
import {readFileSync} from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Resolve the actual production project without writing consumers.
import {resolve} from 'node:path';
import ts from '@typescript/typescript6';
import {expect,test} from 'vitest';

function appProject():ts.ParsedCommandLine {
 const path=resolve('tsconfig.app.json'),config=ts.readConfigFile(path,file=>ts.sys.readFile(file));
 if(config.error!==undefined)throw new Error(ts.flattenDiagnosticMessageText(config.error.messageText,' '));
 return ts.parseJsonConfigFileContent(config.config,ts.sys,'.',undefined,path);
}

test('app production requires isolated output and excludes test owners',()=>{
 const project=appProject();
 expect(project.errors).toEqual([]);
 expect(project.options.isolatedDeclarations).toBe(true);
 expect(project.options.declaration).toBe(true);
 expect(project.options.types).not.toContain('node');
 expect(project.fileNames.some(file=>file.endsWith('.test.ts')||file.includes('/src/test/'))).toBe(false);
 const options:ts.CompilerOptions={isolatedDeclarations:true,strict:true,exactOptionalPropertyTypes:true};
 const explicit=ts.transpileDeclaration('export const owner:Readonly<{active:true}>=Object.freeze({active:true});',{
  fileName:'owner.ts',reportDiagnostics:true,compilerOptions:options,
 });
 expect(explicit.diagnostics).toEqual([]);
 const implicit=ts.transpileDeclaration('export const owner=Object.freeze({active:true});',{
  fileName:'inferred.ts',reportDiagnostics:true,compilerOptions:options,
 });
 expect((implicit.diagnostics??[]).map(row=>row.code)).toContain(9010);
 const missingReturn=ts.transpileDeclaration('export function owner(){return Object.freeze({active:true});}',{
  fileName:'return.ts',reportDiagnostics:true,compilerOptions:options,
 });
 expect((missingReturn.diagnostics??[]).map(row=>row.code)).toContain(9007);
});

test('every owned app implementation emits isolated declarations',()=>{
 const project=appProject(),files=project.fileNames.filter(file=>/\.m?ts$/.test(file)&&!ts.createSourceFile(file,readFileSync(file,'utf8'),ts.ScriptTarget.Latest).isDeclarationFile);
 expect(files.length).toBeGreaterThan(0);
 for(const file of files){
  const emitted=ts.transpileDeclaration(readFileSync(file,'utf8'),{fileName:file,reportDiagnostics:true,
   compilerOptions:{isolatedDeclarations:true,strict:true,exactOptionalPropertyTypes:true}});
  expect(emitted.diagnostics,file).toEqual([]);
  expect(emitted.outputText.length,file).toBeGreaterThan(0);
 }
});
