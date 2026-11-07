// oxlint-disable-next-line import/no-nodejs-modules -- Invoke the actual native compiler against an isolated fixture.
import {spawnSync} from 'node:child_process';
// oxlint-disable-next-line import/no-nodejs-modules -- Run the installed compiler without a shell.
import {execPath} from 'node:process';
// oxlint-disable-next-line import/no-nodejs-modules -- Read defining sources and own small cold compiler fixtures.
import {mkdirSync,mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Resolve the actual production project without writing consumers.
import {resolve} from 'node:path';
import ts from '@typescript/typescript6';
import {expect,test} from 'vitest';

function gameProject():ts.ParsedCommandLine {
 const path=resolve('tsconfig.game.json'),config=ts.readConfigFile(path,file=>ts.sys.readFile(file));
 if(config.error!==undefined)throw new Error(ts.flattenDiagnosticMessageText(config.error.messageText,' '));
 return ts.parseJsonConfigFileContent(config.config,ts.sys,'.',undefined,path);
}

test('game production requires isolated output while Node tests stay separate',()=>{
 const project=gameProject();
 expect(project.errors).toEqual([]);
 expect(project.options.isolatedDeclarations).toBe(true);
 expect(project.options.declaration).toBe(true);
 // The cook runs on Node inside this layer, so the types reach it: no other game file may reach for Node.
 expect(project.options.types).toContain('node');
 expect(project.fileNames.filter(file=>file.endsWith('.ts')&&!file.includes('/src/cook/game/')&&readFileSync(file,'utf8').includes("from 'node:"))).toEqual([]);
 expect(project.fileNames.some(file=>file.endsWith('.test.ts')||file.includes('/src/test/game/'))).toBe(false);
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

test('every owned game implementation emits isolated declarations',()=>{
 const project=gameProject(),files=project.fileNames.filter(file=>file.endsWith('.ts')&&!ts.createSourceFile(file,readFileSync(file,'utf8'),ts.ScriptTarget.Latest).isDeclarationFile);
 expect(files.length).toBeGreaterThan(0);
 for(const file of files){
  const emitted=ts.transpileDeclaration(readFileSync(file,'utf8'),{fileName:file,reportDiagnostics:true,
   compilerOptions:{isolatedDeclarations:true,strict:true,exactOptionalPropertyTypes:true}});
  expect(emitted.diagnostics,file).toEqual([]);
  expect(emitted.outputText.length,file).toBeGreaterThan(0);
 }
});


// Use the native compiler for the cross-file check; the per-file API above has no augmentation graph.
test('cold native declarations preserve strict augmentation contracts',()=>{
 mkdirSync('tmp',{recursive:true});
 const root=mkdtempSync(resolve('tmp/game-isolated-native-'));
 const put=(file:string,text:string):void=>writeFileSync(resolve(root,file),text);
 const run=():ReturnType<typeof spawnSync>=>spawnSync(execPath,[resolve('node_modules/typescript/bin/tsc'),'-p',resolve(root,'tsconfig.json')],{encoding:'utf8',timeout:10_000});
 const message=(result:ReturnType<typeof spawnSync>):string=>String(result.stdout)+String(result.stderr);
 try{
  put('tsconfig.json',JSON.stringify({compilerOptions:{strict:true,exactOptionalPropertyTypes:true,
   isolatedDeclarations:gameProject().options.isolatedDeclarations,declaration:true,emitDeclarationOnly:true,
   module:'ESNext',moduleResolution:'bundler',target:'ES2022',types:[],skipLibCheck:true,outDir:'out'},include:['*.ts']}));
  const actor='export interface Actor {id:string}\n';
  const maps='import type {Actor} from "./pipeline";\nexport interface EventMap {"ai.windup":{actor:Actor;duration:number}}\n';
  put('pipeline.ts',`${actor}declare module "./maps" {interface EventMap {"damage.dealt":{dealt:number}}}\n`);
  put('maps.ts',maps);
  const cycle=run();
  expect(cycle.status,message(cycle)).not.toBe(0);
  expect(message(cycle)).toContain('TS9026');
  put('pipeline.ts',actor);
  put('maps.ts',maps.replace('duration:number}}','duration:number};"damage.dealt":{dealt:number}}'));
  const extension='import type {EventMap} from "./maps";\ndeclare module "./maps" {interface EventMap {"fixture.extra":{count:number}}}\nexport const extension:EventMap["fixture.extra"]={count:1};\n';
  put('consumer.ts',`${extension}export const damage:EventMap["damage.dealt"]={dealt:1};\n`);
  const admitted=run();
  expect(admitted.status,message(admitted)).toBe(0);
  expect(readFileSync(resolve(root,'out/maps.d.ts'),'utf8')).toContain('"damage.dealt"');
  put('consumer.ts',`${extension}export const damage:EventMap["damage.dealt"]={dealt:"wrong"};\n`);
  const refused=run();
  expect(refused.status,message(refused)).not.toBe(0);
  expect(message(refused)).toContain('TS2322');
 }finally{rmSync(root,{recursive:true,force:true});}
});
