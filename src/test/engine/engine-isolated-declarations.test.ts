// oxlint-disable-next-line import/no-nodejs-modules -- Read the defining production project and sources.
import {readFileSync} from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Resolve the actual production project without writing consumers.
import {resolve} from 'node:path';
import ts from '@typescript/typescript6';
import {expect,test} from 'vitest';

function engineProject():ts.ParsedCommandLine {
 const path=resolve('tsconfig.engine.json'),config=ts.readConfigFile(path,file=>ts.sys.readFile(file));
 if(config.error!==undefined)throw new Error(ts.flattenDiagnosticMessageText(config.error.messageText,' '));
 return ts.parseJsonConfigFileContent(config.config,ts.sys,'.',undefined,path);
}

test('engine production requires isolated output while Node tests stay separate',()=>{
 const project=engineProject();
 expect(project.errors).toEqual([]);
 expect(project.options.isolatedDeclarations).toBe(true);
 expect(project.options.declaration).toBe(true);
 expect(project.options.types).not.toContain('node');
 expect(project.fileNames.some(file=>file.endsWith('.test.ts')||file.includes('/src/test/engine/'))).toBe(false);
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

test('every owned engine implementation emits isolated declarations',()=>{
 const project=engineProject(),files=project.fileNames.filter(file=>file.endsWith('.ts')&&!ts.createSourceFile(file,readFileSync(file,'utf8'),ts.ScriptTarget.Latest).isDeclarationFile);
 expect(files.length).toBeGreaterThan(0);
 for(const file of files){
  const emitted=ts.transpileDeclaration(readFileSync(file,'utf8'),{fileName:file,reportDiagnostics:true,
   compilerOptions:{isolatedDeclarations:true,strict:true,exactOptionalPropertyTypes:true}});
  expect(emitted.diagnostics,file).toEqual([]);
  expect(emitted.outputText.length,file).toBeGreaterThan(0);
 }
});

// A single-file transpile cannot see imports which augment their importer.
test('event maps cold-emit their complete merged declarations',()=>{
 const project=engineProject(),outputs=new Map<string,string>();
 const host=ts.createCompilerHost(project.options);
 host.writeFile=(file,text)=>{outputs.set(file,text);};
 const program=ts.createProgram(project.fileNames,{...project.options,incremental:false},host);
 const maps=program.getSourceFile(resolve('src/client/engine/events/maps.ts'));
 if(maps===undefined)throw new Error('Missing defining event maps');
 expect(program.getDeclarationDiagnostics(maps).map(row=>({code:row.code,message:ts.flattenDiagnosticMessageText(row.messageText,' ')}))).toEqual([]);
 const result=program.emit(maps);
 expect(result.diagnostics).toEqual([]);
 const declaration=[...outputs].find(([file])=>file.endsWith('/events/maps.d.ts'))?.[1];
 expect(declaration).toBeDefined();
 for(const key of ['ai.windup','damage.dealt','actor.died','player.died','player.respawned','damage.admit','damage.modify','death.checkpoint']){
  expect(declaration).toContain(`'${key}'`);
 }
});
