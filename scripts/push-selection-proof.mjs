// Real Git ranges and real Vitest dependency discovery; no cases are trimmed.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {dirname,join,resolve as resolvePath} from 'node:path';
import {mkdirSync,mkdtempSync,rmSync,symlinkSync,writeFileSync} from 'node:fs';
import {pushSelection} from './push-selection.mjs';
import {fileURLToPath} from 'node:url';

const directory=resolvePath(process.argv[2]??'tmp/push-selection-proof');mkdirSync(directory,{recursive:true});
const work=mkdtempSync(join(directory,'run-'));
/** @param {string[]} args */
const git=args=>execFileSync('git',['-c','user.name=Related proof','-c','user.email=proof@example.test',...args],{cwd:work,encoding:'utf8'}).trim();
/** @param {string} file @param {string} text */
const put=(file,text)=>{mkdirSync(dirname(join(work,file)),{recursive:true});writeFileSync(join(work,file),text);};
/** @param {string[]} files */
const change=files=>{
 const before=git(['rev-parse','HEAD']);
 for(const file of files)put(file,file.endsWith('.ts')?'export const value=1; // changed':file.endsWith('.json')?'{}':'changed');
 git(['add',...files]);git(['commit','--quiet','--allow-empty','-m','change input']);
 return pushSelection(`refs/heads/main ${git(['rev-parse','HEAD'])} refs/heads/main ${before}`,work);
};
try{
 git(['init','--quiet','--initial-branch=main']);
 put('package.json','{"type":"module"}');
 put('vitest.config.mjs',"import{defineConfig}from'vitest/config';export default defineConfig({test:{include:['test/**/*.test.mjs'],environment:'node',isolate:true,pool:'forks'}});");
 put('src/covered.ts','export const value=1;');put('src/uncovered.ts','export const value=1;');
 put('test/covered.test.mjs',"import{it,expect}from'vitest';import{value}from'../src/covered.ts';it('uses real source',()=>{expect(value).toBe(1);});");
 git(['add','package.json','vitest.config.mjs','src','test']);git(['commit','--quiet','-m','base']);
 symlinkSync(resolvePath('node_modules'),join(work,'node_modules'),'dir');
 for(const file of ['src/server/host/dedicated/saves/migrations/0002-report-delivery.sql','budgets/actual.json','lint/actual.json','vite/rapier.ts','.npmrc','pnpm-workspace.yaml','.bin-deps/manifest.json']){
  assert.equal(change([file]).mode,'full',`An unclassified input must run full: ${file}`);
 }
 const cli=fileURLToPath(new URL('vitest.mjs',import.meta.resolve('vitest/package.json')));
 const empty=execFileSync(process.execPath,[cli,'related','--run','src/uncovered.ts'],{cwd:work,encoding:'utf8',stdio:'pipe'});
 assert.match(empty,/No test files found/u,'Real related mode otherwise exits green with zero tests');
 const {completePushSelection}=await import('./push-related.mjs');
 const missing=change(['src/uncovered.ts']);assert.equal(missing.mode,'related');
 assert.equal((await completePushSelection(missing,{cwd:work})).mode,'full','Zero selected tests requires full');
 const covered=change(['src/covered.ts']);assert.equal((await completePushSelection(covered,{cwd:work})).mode,'related');
 put('src/uncovered.ts','export const value=2;');put('src/covered.ts','export const value=2;');
 const before=git(['rev-parse','HEAD']);git(['add','src']);git(['commit','--quiet','-m','mixed source edges']);
 const mixed=pushSelection(`refs/heads/main ${git(['rev-parse','HEAD'])} refs/heads/main ${before}`,work);
 assert.equal((await completePushSelection(mixed,{cwd:work})).mode,'full','Every source path needs an edge, not just one');
 console.log(JSON.stringify({invisibleInputsFull:7,actualEmptyRelatedExit:0,zeroTestsFull:true,coveredSourceRelated:true,mixedUncoveredFull:true}));
}finally{rmSync(work,{recursive:true,force:true});}
