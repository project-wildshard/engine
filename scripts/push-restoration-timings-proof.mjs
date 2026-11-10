// Real Git publication must refuse an inherited test restored without clocks.
import assert from 'node:assert/strict';
import {execFileSync,spawnSync} from 'node:child_process';
import {chmodSync,mkdirSync,mkdtempSync,rmSync,symlinkSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';

mkdirSync('tmp',{recursive:true});
const work=mkdtempSync(resolve('tmp/restored-clock-proof-')),root=join(work,'repo'),remote=join(work,'remote.git'),began=performance.now();
mkdirSync(root);
const env={...process.env,GIT_CONFIG_GLOBAL:'/dev/null',GIT_CONFIG_NOSYSTEM:'1'};
/** @param {string[]} args */
const git=args=>execFileSync('git',['-c','user.name=Restored clock proof','-c','user.email=proof@example.test',...args],{cwd:root,env,encoding:'utf8'}).trim();
try{
 git(['init','--quiet','--initial-branch=main']);git(['init','--quiet','--bare','--initial-branch=main',remote]);git(['remote','add','origin',remote]);
 mkdirSync(join(root,'.githooks'));mkdirSync(join(root,'test/pins'),{recursive:true});
 const file='test/inherited.test.ts';
 writeFileSync(join(root,'package.json'),JSON.stringify({name:'restored-clock-proof',private:true,type:'module'}));
 writeFileSync(join(root,'.gitignore'),'node_modules\n');symlinkSync(resolve('node_modules'),join(root,'node_modules'),'dir');
 writeFileSync(join(root,'vitest.config.mjs'),"import{readFileSync}from'node:fs';export default {test:{include:['test/**/*.test.ts'],exclude:JSON.parse(readFileSync('test/lift-pending.json','utf8')),pool:'forks',maxWorkers:1}};\n");
 writeFileSync(join(root,file),"import{test,expect}from'vitest';test('retained inherited assertion',()=>expect(2+2).toBe(4));\n");
 writeFileSync(join(root,'test/lift-pending.json'),`${JSON.stringify([file])}\n`);
 for(const name of ['durations','durations-ring1','durations-source'])writeFileSync(join(root,`test/${name}.json`),'{}\n');
 writeFileSync(join(root,'test/pins/ring-2-tests.json'),'[]\n');
 const helper=pathToFileURL(resolve('scripts/push-test-timings.mjs')).href;
 writeFileSync(join(root,'gate.mjs'),`import{readFileSync}from'node:fs';import{missingTestTimings}from${JSON.stringify(helper)};const rows=missingTestTimings(readFileSync(0,'utf8'));if(rows.length)throw new Error('Restored tests need committed timings: '+rows.map(row=>row.file).join(', '));`);
 writeFileSync(join(root,'.githooks/pre-push'),'#!/usr/bin/env bash\nset -euo pipefail\nnode gate.mjs\n');chmodSync(join(root,'.githooks/pre-push'),0o755);
 git(['add','package.json','.gitignore','vitest.config.mjs',file,'test/lift-pending.json','test/durations.json','test/durations-ring1.json','test/durations-source.json','test/pins/ring-2-tests.json','gate.mjs','.githooks/pre-push']);
 git(['commit','--quiet','-m','retained inherited test excluded']);git(['config','core.hooksPath','.githooks']);git(['push','--quiet','origin','main']);
 const before=git(['rev-parse','HEAD']);
 git(['tag','known-main']);git(['push','--quiet','origin','refs/tags/known-main']);
 writeFileSync(join(root,'test/lift-pending.json'),'[]\n');git(['commit','--quiet','-m','restore inherited test','--','test/lift-pending.json']);
 const restored=git(['rev-parse','HEAD']),rejected=spawnSync('git',['push','origin','main'],{cwd:root,env,encoding:'utf8'});
 assert.notEqual(rejected.status,0,'Restoration must not publish an unmeasured existing test');assert.match(rejected.stderr,/Restored tests need committed timings: test\/inherited\.test\.ts/u);
 assert.equal(git(['--git-dir',remote,'rev-parse','main']),before);
 rmSync(join(root,file));git(['add',file]);git(['commit','--quiet','-m','move the test to its owner']);git(['push','--quiet','origin','main']);
 assert.notEqual(git(['--git-dir',remote,'rev-parse','main']),restored);
 console.log(JSON.stringify({inheritedRestorationRefused:true,remoteUnchangedOnRefusal:true,publishedMainTagAdmitted:true,removedFileNotMisclassified:true,seconds:(performance.now()-began)/1000}));
}finally{rmSync(work,{recursive:true,force:true});}
