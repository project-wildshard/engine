// Actual annotated-tag pushes through the timing guard; no products or browsers.
import assert from 'node:assert/strict';
import {execFileSync,spawnSync} from 'node:child_process';
import {chmodSync,mkdirSync,mkdtempSync,rmSync,symlinkSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {capturePushTree} from './push-proof-cache.mjs';

const base=resolve(process.argv[2]??'tmp/push-new-ref-timings-proof');mkdirSync(base,{recursive:true});
const work=mkdtempSync(join(base,'run-')),root=join(work,'repo'),remote=join(work,'remote.git'),began=performance.now();mkdirSync(root);
/** @param {string[]} args */
const git=args=>execFileSync('git',['-c','user.name=New ref proof','-c','user.email=proof@example.test',...args],{cwd:root,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
/** @param {string[]} args */
const push=args=>spawnSync('git',['push',...args],{cwd:root,encoding:'utf8',timeout:15_000});
try{
 git(['init','--quiet','--initial-branch=main']);git(['init','--quiet','--bare','--initial-branch=main',remote]);git(['remote','add','origin',remote]);
 mkdirSync(join(root,'test/pins'),{recursive:true});mkdirSync(join(root,'.githooks'));
 writeFileSync(join(root,'package.json'),JSON.stringify({name:'new-ref-proof',private:true,type:'module'}));
 writeFileSync(join(root,'.gitignore'),'node_modules\n');symlinkSync(resolve('node_modules'),join(root,'node_modules'),'dir');
 writeFileSync(join(root,'vitest.config.mjs'),"export default {test:{include:['test/**/*.test.ts'],pool:'forks',maxWorkers:1}};\n");
 for(const name of ['durations','durations-ring1','durations-source'])writeFileSync(join(root,`test/${name}.json`),'{}\n');
 writeFileSync(join(root,'test/pins/ring-2-tests.json'),'[]\n');
 const body="import{test,expect}from'vitest';test('actual assertion',()=>expect(2+2).toBe(4));\n";
 writeFileSync(join(root,'test/historical.test.ts'),body);
 git(['add','package.json','.gitignore','vitest.config.mjs','test/durations.json','test/durations-ring1.json','test/durations-source.json','test/pins/ring-2-tests.json','test/historical.test.ts']);git(['commit','--quiet','-m','historical main before timing admission']);git(['push','--quiet','origin','main']);
 const helper=pathToFileURL(resolve('scripts/push-test-timings.mjs')).href;
 writeFileSync(join(root,'.githooks/pre-push'),'#!/usr/bin/env bash\nset -euo pipefail\nexport WS_PUSH_DESTINATION="$2"\nnode gate.mjs\n');chmodSync(join(root,'.githooks/pre-push'),0o755);
 writeFileSync(join(root,'gate.mjs'),`import{readFileSync}from'node:fs';import{missingTestTimings}from${JSON.stringify(helper)};const missing=missingTestTimings(readFileSync(0,'utf8'));if(missing.length)throw new Error('New tests need committed timing: '+missing.map(row=>row.file).join(', '));`);
 git(['add','.githooks/pre-push','gate.mjs']);git(['commit','--quiet','-m','install timing gate']);git(['config','core.hooksPath','.githooks']);git(['push','--quiet','origin','main']);
 writeFileSync(join(root,'test/historical.test.ts'),`${body}// existing test modified after the baseline\n`);git(['commit','--quiet','-m','modify historical file','--','test/historical.test.ts']);git(['push','--quiet','origin','main']);
 const published=git(['rev-parse','HEAD']);git(['tag','-a','v-proof','-m','published main tag']);
 const env={PATH:process.env.PATH},beforeHook=capturePushTree('new-ref-proof',env,root),insideHook=capturePushTree('new-ref-proof',{...env,WS_PUSH_DESTINATION:remote},root);
 assert.ok(beforeHook);assert.ok(insideHook);assert.equal(beforeHook.runtime,insideHook.runtime);
 // Tracking refs can be stale/missing: use this push destination's actual main.
 git(['update-ref','-d','refs/remotes/origin/main']);
 const tag=push(['origin','refs/tags/v-proof']);assert.equal(tag.status,0,tag.stderr);assert.equal(git(['--git-dir',remote,'rev-parse','v-proof^{commit}']),published);
 const publisher=join(work,'publisher');git(['clone','--quiet',remote,publisher]);git(['-C',publisher,'config','core.hooksPath','.githooks']);
 writeFileSync(join(publisher,'published.md'),'independent main advance\n');git(['-C',publisher,'add','published.md']);git(['-C',publisher,'commit','--quiet','-m','advance remote main independently']);git(['-C',publisher,'push','--quiet','origin','main']);
 const advanced=git(['-C',publisher,'rev-parse','HEAD']);assert.notEqual(spawnSync('git',['cat-file','-e',advanced],{cwd:root,stdio:'ignore'}).status,0);
 git(['tag','-a','v-proof-hydrate','-m','published ancestor of remote main']);const hydrated=push(['origin','refs/tags/v-proof-hydrate']);assert.equal(hydrated.status,0,hydrated.stderr);assert.equal(git(['rev-parse','HEAD']),published);git(['cat-file','-e',advanced]);
 writeFileSync(join(root,'test/genuinely-new.test.ts'),body);git(['add','test/genuinely-new.test.ts']);git(['commit','--quiet','-m','unpublished new test']);git(['tag','-a','v-unpublished','-m','new unpublished test']);
 const refused=push(['origin','refs/tags/v-unpublished']);assert.notEqual(refused.status,0);assert.match(refused.stderr,/New tests need committed timing: test\/genuinely-new\.test\.ts/u);
 assert.equal(spawnSync('git',['--git-dir',remote,'show-ref','--verify','--quiet','refs/tags/v-unpublished'],{encoding:'utf8'}).status,1);
 // Publishing to an empty different destination must not borrow origin's main.
 const other=join(work,'other.git');git(['init','--quiet','--bare','--initial-branch=main',other]);git(['remote','add','other',other]);
 const isolated=push(['other','refs/tags/v-proof']);assert.notEqual(isolated.status,0);assert.match(isolated.stderr,/New tests need committed timing: test\/historical\.test\.ts/u);
 git(['remote','set-url','--push','origin',other]);const split=push(['origin','refs/tags/v-proof']);assert.notEqual(split.status,0,'a published fetch URL cannot prove an empty push destination');assert.match(split.stderr,/New tests need committed timing: test\/historical\.test\.ts/u);
 git(['tag','-a','v-direct','-m','direct destination URL',published]);const direct=push([remote,'refs/tags/v-direct']);assert.equal(direct.status,0,direct.stderr);
 git(['remote','set-url','origin',other]);git(['remote','set-url','--push','origin',remote]);git(['tag','-a','v-split-published','-m','published push URL despite empty fetch URL',published]);const inverse=push(['origin','refs/tags/v-split-published']);assert.equal(inverse.status,0,inverse.stderr);
 console.log(JSON.stringify({publishedAnnotatedTagAdmitted:true,modifiedHistoricalFileNotNew:true,missingTrackingRefSafe:true,missingAdvertisedCommitHydrated:true,checkedHeadUnchanged:true,genuinelyNewTagTestRefused:true,otherRemoteNotBorrowed:true,splitFetchPushBothDirections:true,directUrlAdmitted:true,seconds:(performance.now()-began)/1000}));
}finally{rmSync(work,{recursive:true,force:true});}
