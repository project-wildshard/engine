// Manual DS1 proof: real complete Git ranges, generated stamps and Vitest execution.
import assert from 'node:assert/strict';
import {execFileSync,spawnSync} from 'node:child_process';
import {dirname,join,resolve} from 'node:path';
import {mkdirSync,mkdtempSync,readFileSync,rmSync,symlinkSync,writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {pushSelection} from './push-selection.mjs';
import {completePushSelection} from './push-related.mjs';
import {rendererRevision} from './renderer-revision.mjs';
import {shardfileValidationRevision} from './shardfile-validation-revision.mjs';

const parent=resolve(process.argv[2]??'tmp/push-selection-dev-proof');mkdirSync(parent,{recursive:true});
const root=mkdtempSync(join(parent,'run-')),began=performance.now();
/** @param {string[]} args */
const git=args=>execFileSync('git',['-c','user.name=DS1 proof','-c','user.email=proof@example.test',...args],{cwd:root,encoding:'utf8'}).trim();
/** @param {string} path @param {string} body */
const put=(path,body)=>{mkdirSync(dirname(join(root,path)),{recursive:true});writeFileSync(join(root,path),body);};
/** @param {string[]} files */
const commit=files=>{git(['add',...files]);git(['commit','--quiet','--allow-empty','-m','actual proof change']);};
const stamp=()=>{
 put('scripts/renderer-revision.json',JSON.stringify({revision:rendererRevision(root)}));
 put('scripts/validation-revision.json',JSON.stringify({revision:shardfileValidationRevision(root)}));
 commit(['scripts/renderer-revision.json','scripts/validation-revision.json']);
};
/** @param {string} before */
const selected=before=>pushSelection(`refs/heads/main ${git(['rev-parse','HEAD'])} refs/heads/main ${before}`,root);
const cli=fileURLToPath(new URL('vitest.mjs',import.meta.resolve('vitest/package.json')));
/** @param {string[]} files */
const run=files=>spawnSync(process.execPath,[cli,'related','--run','--passWithNoTests=false',...files],{cwd:root,encoding:'utf8'});
try{
 git(['init','--quiet','--initial-branch=main']);
 put('package.json','{"type":"module"}');put('pnpm-lock.yaml','lockfileVersion: 9.0\n');
 put('vitest.config.mjs',"import{defineConfig}from'vitest/config';export default defineConfig({test:{include:['test/**/*.test.mjs'],environment:'node',isolate:true,pool:'forks',maxWorkers:1}});");
 put('src/covered.ts','export const value=1;');put('scripts/covered.mjs','export const value=1;');
 for(const [name,source] of [['source','src/covered.ts'],['script','scripts/covered.mjs']])put(`test/${name}.test.mjs`,`import{it,expect}from'vitest';import{value}from'../${source}';it('observes ${name} behavior',()=>expect(value).toBe(1));`);
 commit(['package.json','pnpm-lock.yaml','vitest.config.mjs','src/covered.ts','scripts/covered.mjs','test/source.test.mjs','test/script.test.mjs']);stamp();
 symlinkSync(resolve('node_modules'),join(root,'node_modules'),'dir');
 let before=git(['rev-parse','HEAD']);
 put('scripts/covered.mjs','export const value=2;');put('project/journal/change.md','Why the tool changed.\n');
 commit(['scripts/covered.mjs','project/journal/change.md']);stamp();
 let choice=selected(before);
 assert.equal(choice.mode,'related','A covered script plus its journal and official stamp must not force full');
 assert.deepEqual(choice.files,['scripts/covered.mjs']);choice=await completePushSelection(choice,{cwd:root});assert.equal(choice.mode,'related');
 let actual=run(choice.files);assert.equal(actual.status,1);assert.match(actual.stdout+actual.stderr,/observes script behavior/u,'The real changed script assertion must run and fail');
 before=git(['rev-parse','HEAD']);put('scripts/covered.mjs','export const value=1;');commit(['scripts/covered.mjs']);stamp();
 choice=await completePushSelection(selected(before),{cwd:root});assert.equal(choice.mode,'related');actual=run(choice.files);assert.equal(actual.status,0,actual.stderr);
 before=git(['rev-parse','HEAD']);put('.github/workflows/proof.yml','name: proof\non: push\n');commit(['.github/workflows/proof.yml']);assert.equal(selected(before).mode,'docs','Workflow-only local gate runs static checks without Vitest');
 assert.equal(pushSelection(`refs/heads/main ${git(['rev-parse','HEAD'])} refs/heads/main ${before}`,root,{hosted:true}).mode,'full','Hosted workflow changes retain full code-proving CI');
 before=git(['rev-parse','HEAD']);put('.github/workflows/proof.yml','name: changed\non: push\n');put('src/covered.ts','export const value=2;');commit(['.github/workflows/proof.yml','src/covered.ts']);stamp();
 choice=await completePushSelection(selected(before),{cwd:root});assert.equal(choice.mode,'related');assert.deepEqual(choice.files,['src/covered.ts']);actual=run(choice.files);assert.equal(actual.status,1);assert.match(actual.stdout+actual.stderr,/observes source behavior/u);
 before=git(['rev-parse','HEAD']);put('scripts/uncovered.mjs','export const unseen=1;');commit(['scripts/uncovered.mjs']);stamp();
 assert.equal((await completePushSelection(selected(before),{cwd:root})).mode,'full','Zero real test edges still require the complete suite');
 actual=spawnSync(process.execPath,[cli,'run'],{cwd:root,encoding:'utf8'});assert.equal(actual.status,1);assert.match(actual.stdout+actual.stderr,/observes source behavior/u,'The full fallback must retain the existing failing source case');
 before=git(['rev-parse','HEAD']);put('scripts/vitest-cpu.ts','export const setup=true;');commit(['scripts/vitest-cpu.ts']);stamp();assert.equal(selected(before).mode,'full','Actual setup/harness still runs full');
 before=git(['rev-parse','HEAD']);put('scripts/renderer-revision.json',JSON.stringify({revision:'0'.repeat(64)}));commit(['scripts/renderer-revision.json']);assert.equal(selected(before).mode,'full','Unverified stamp cannot hide changed inputs');
 before=git(['rev-parse','HEAD']);stamp();assert.equal(selected(before).mode,'docs','A correct stamp alone has no changed source input');
 assert.equal(pushSelection(`refs/heads/main ${git(['rev-parse','HEAD'])} refs/heads/main ${before}`,root,{hosted:true}).mode,'full','Hosted generated-stamp changes retain full CI');
 put('held-stamp.json',readFileSync(join(root,'scripts/renderer-revision.json'),'utf8'));commit(['held-stamp.json']);
 before=git(['rev-parse','HEAD']);rmSync(join(root,'scripts/renderer-revision.json'));symlinkSync('../held-stamp.json',join(root,'scripts/renderer-revision.json'));commit(['scripts/renderer-revision.json']);
 assert.equal(selected(before).mode,'full','A generated stamp must remain a regular file, even with valid target bytes');
 rmSync(join(root,'scripts/renderer-revision.json'));stamp();
 before=git(['rev-parse','HEAD']);put('docs/contract.md','input');put('test/contract-reader.test.mjs',"import{it}from'vitest';import{readFileSync}from'node:fs';it('reads real contract',()=>readFileSync('docs/contract.md'));");commit(['docs/contract.md','test/contract-reader.test.mjs']);
 before=git(['rev-parse','HEAD']);put('docs/contract.md','changed input');commit(['docs/contract.md']);assert.equal(selected(before).mode,'full','Filesystem-consumed Markdown stays a full-suite input');
 put('scripts/test-shard-plan.ts','export const value=1;');put('test/planner.test.mjs',"import{it,expect}from'vitest';import{value}from'../scripts/test-shard-plan.ts';it('uses planner',()=>expect(value).toBe(1));");commit(['scripts/test-shard-plan.ts','test/planner.test.mjs']);
 before=git(['rev-parse','HEAD']);put('scripts/test-shard-plan.ts','export const value=2;');commit(['scripts/test-shard-plan.ts']);stamp();
 assert.equal((await completePushSelection(selected(before),{cwd:root})).mode,'full','An imported planner dependency is still harness, not an ordinary covered tool');
 for(const [file,body] of [['test/setup.ts','export const setup=true;'],['test/fixtures/shared.ts','export const fixture=true;'],['scripts/test-timings.mjs','export const timings=true;'],['vite/rapier.ts','export const binding=true;'],['.githooks/check.mjs','export const gate=true;'],['vitest.config.ts','export default {};'],['package.json','{"type":"module","private":true}'],['pnpm-lock.yaml','lockfileVersion: 9.0\n# changed dependency input\n']]){
  before=git(['rev-parse','HEAD']);put(file,body);commit([file]);assert.equal(selected(before).mode,'full',`Real harness/dependency input still requires full: ${file}`);
 }
 console.log(JSON.stringify({coveredScriptWithJournalAndStampRelated:true,actualBrokenScriptRefused:true,actualScriptFixPasses:true,workflowOnlyNoLocalVitest:true,hostedWorkflowAndStampStillFull:true,mixedWorkflowSourceAssertionRuns:true,zeroEdgesFull:true,actualFullFallbackRetainsFailure:true,harnessFull:10,invalidStampFull:true,validStampOnlyStatic:true,symlinkStampFull:true,consumedMarkdownFull:true,seconds:(performance.now()-began)/1000}));
}finally{rmSync(root,{recursive:true,force:true});}
