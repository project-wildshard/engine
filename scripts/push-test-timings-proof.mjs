// Real Vitest module clocks and a real Git push, without products or browser fixtures.
import assert from 'node:assert/strict';
import {execFileSync,spawnSync} from 'node:child_process';
import {chmodSync,mkdirSync,mkdtempSync,readFileSync,renameSync,rmSync,symlinkSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {missingTestTimings,prepareTestTimings,readTestTimings,recordTestTimings,completeTestTimings} from './push-test-timings.mjs';

const base=resolve(process.argv[2]??'tmp/push-test-timings-proof');mkdirSync(base,{recursive:true});
const work=mkdtempSync(join(base,'run-')),root=join(work,'repo'),remote=join(work,'remote.git'),began=performance.now();mkdirSync(root);
/** @param {string[]} args */
const git=args=>execFileSync('git',['-c','user.name=Timing proof','-c','user.email=proof@example.test',...args],{cwd:root,encoding:'utf8'}).trim();
try{
 git(['init','--quiet','--initial-branch=main']);git(['init','--quiet','--bare','--initial-branch=main',remote]);git(['remote','add','origin',remote]);
 mkdirSync(join(root,'.githooks'));mkdirSync(join(root,'test/pins'),{recursive:true});
 const helper=pathToFileURL(resolve('scripts/push-test-timings.mjs')).href;
 writeFileSync(join(root,'.githooks/pre-push'),`#!/usr/bin/env bash\nset -euo pipefail\nnode gate.mjs\n`);chmodSync(join(root,'.githooks/pre-push'),0o755);
 writeFileSync(join(root,'gate.mjs'),`import{readFileSync}from'node:fs';import{missingTestTimings}from${JSON.stringify(helper)};const missing=missingTestTimings(readFileSync(0,'utf8'));if(missing.length)throw new Error('New tests need committed timing: '+missing.map(row=>row.file).join(', '));`);
 writeFileSync(join(root,'package.json'),JSON.stringify({name:'timing-proof',private:true,type:'module'}));
 writeFileSync(join(root,'.gitignore'),'node_modules\n');symlinkSync(resolve('node_modules'),join(root,'node_modules'),'dir');
 writeFileSync(join(root,'vitest.config.mjs'),"export default {test:{include:['test/**/*.test.ts'],pool:'forks',maxWorkers:1}};\n");
 for(const name of ['durations','durations-ring1','durations-source'])writeFileSync(join(root,`test/${name}.json`),'{}\n');writeFileSync(join(root,'test/pins/ring-2-tests.json'),'[]\n');
 git(['add','.githooks/pre-push','gate.mjs','package.json','.gitignore','vitest.config.mjs','test/durations.json','test/durations-ring1.json','test/durations-source.json','test/pins/ring-2-tests.json']);git(['commit','--quiet','-m','base']);git(['config','core.hooksPath','.githooks']);git(['push','--quiet','origin','main']);const before=git(['rev-parse','HEAD']);
 const file='test/new-clock.test.ts',body="import{test,expect}from'vitest';test('actual assertion',()=>{expect(2+2).toBe(4);if(process.env['TIMING_PROOF_UNHANDLED']==='1')void Promise.reject(new Error('actual unhandled timing proof'));});\n";
 writeFileSync(join(root,file),body);git(['add',file]);git(['commit','--quiet','-m','new actual test']);
 const rejected=spawnSync('git',['push','origin','main'],{cwd:root,encoding:'utf8'});assert.notEqual(rejected.status,0);assert.match(rejected.stderr,/New tests need committed timing/u);assert.equal(git(['--git-dir',remote,'rev-parse','main']),before);
 const unproven=`${JSON.stringify({[file]:.001})}\n`;
 for(const name of ['durations','durations-ring1'])writeFileSync(join(root,`test/${name}.json`),unproven);
 mkdirSync(join(root,'src/cli'),{recursive:true});writeFileSync(join(root,'src/cli/kit-only.test.ts'),"import {test} from 'node:test';test('kit assertion',()=>{});\n");
 git(['add','src/cli/kit-only.test.ts']);git(['commit','--quiet','-m','unproven numbers and a real kit file','--','test/durations.json','test/durations-ring1.json','src/cli/kit-only.test.ts']);
 const missing=missingTestTimings(`refs/heads/main ${git(['rev-parse','HEAD'])} refs/heads/main ${before}`,root);assert.deepEqual(missing.map(row=>row.file),[file]);const evidence=prepareTestTimings(missing,'actual-fixture-Vitest',root,join(work,'durable-evidence'));
 for(const ring of /** @type {const} */(['full','1'])){
  const request=evidence.requests[ring];assert.ok(request);
  /** @type {NodeJS.ProcessEnv & {WILDSHARD_RING?:string}} */const env={...process.env,WS_PUSH_TIMING_REQUEST:request};if(ring==='1')env.WILDSHARD_RING='1';else Reflect.deleteProperty(env,'WILDSHARD_RING');
  execFileSync(process.execPath,[resolve('node_modules/vitest/vitest.mjs'),'run','--config','vitest.config.mjs','--passWithNoTests=false','--reporter=default',`--reporter=${resolve('scripts/push-timing-reporter.ts')}`],{cwd:root,env,stdio:'pipe'});
  completeTestTimings(request,0);
 }
 const captured=`${root}.captured`;renameSync(root,captured);execFileSync('git',['clone','--quiet','--no-hardlinks',captured,root]);git(['remote','set-url','origin',remote]);git(['config','core.hooksPath','.githooks']);symlinkSync(resolve('node_modules'),join(root,'node_modules'),'dir');rmSync(captured,{recursive:true,force:true});
 const reports=readTestTimings(evidence.directory,root);assert.equal(reports.length,2);assert.ok(reports.every(row=>row.files[0].passedTests===1&&row.files[0].durationMs>0));
 const reportPath=join(evidence.directory,'full.report.json'),original=readFileSync(reportPath,'utf8');
 const fullRequest=evidence.requests.full;assert.ok(fullRequest);
 const unhandled=spawnSync(process.execPath,[resolve('node_modules/vitest/vitest.mjs'),'run','--config','vitest.config.mjs',`--reporter=${resolve('scripts/push-timing-reporter.ts')}`],{cwd:root,env:{...process.env,TIMING_PROOF_UNHANDLED:'1',WS_PUSH_TIMING_REQUEST:evidence.requests.full},encoding:'utf8'});
 assert.notEqual(unhandled.status,0);assert.ok(JSON.parse(readFileSync(reportPath,'utf8')).errorCount>0);assert.throws(()=>completeTestTimings(fullRequest,0));assert.throws(()=>recordTestTimings(evidence.directory,root));writeFileSync(reportPath,original);
 const empty=spawnSync(process.execPath,[resolve('node_modules/vitest/vitest.mjs'),'run','test/absent.test.ts','--config','vitest.config.mjs','--passWithNoTests=false',`--reporter=${resolve('scripts/push-timing-reporter.ts')}`],{cwd:root,env:{...process.env,WS_PUSH_TIMING_REQUEST:evidence.requests.full},encoding:'utf8'});
 assert.notEqual(empty.status,0);assert.throws(()=>recordTestTimings(evidence.directory,root));writeFileSync(reportPath,original);
 for(const bad of [{reason:'failed'},{files:[{...reports[0].files[0],passedTests:0}]},{files:[{...reports[0].files[0],durationMs:0}]},{files:[{...reports[0].files[0],durationMs:60_001}]},{files:[{...reports[0].files[0],state:'failed'}]},{tree:'0'.repeat(40)}]){
  writeFileSync(reportPath,JSON.stringify({...reports[0],...bad}));assert.throws(()=>recordTestTimings(evidence.directory,root));assert.equal(readFileSync(join(root,'test/durations.json'),'utf8'),unproven);
 }
 writeFileSync(reportPath,original);renameSync(reportPath,`${reportPath}.saved`);assert.throws(()=>recordTestTimings(evidence.directory,root));renameSync(`${reportPath}.saved`,reportPath);
 writeFileSync(join(root,file),`${body}// changed source\n`);assert.throws(()=>recordTestTimings(evidence.directory,root),/clean checked source/u);writeFileSync(join(root,file),body);
 const recorded=execFileSync(process.execPath,[resolve('scripts/push-test-timings.mjs'),'record',evidence.directory],{cwd:root,encoding:'utf8'});assert.match(recorded,/Recorded full:/u);assert.equal(JSON.parse(readFileSync(join(root,'test/durations-source.json'),'utf8')).localPushObservations[0].platform,process.platform);
 git(['commit','--quiet','-m','record actual clocks','--','test/durations.json','test/durations-ring1.json','test/durations-source.json']);git(['push','--quiet','origin','main']);
 assert.equal(git(['--git-dir',remote,'rev-parse','main']),git(['rev-parse','HEAD']));assert.deepEqual(missingTestTimings(`refs/heads/main ${git(['rev-parse','HEAD'])} refs/heads/main ${before}`,root),[]);
 writeFileSync(join(root,file),`${body}// actual changed test blob\n`);git(['commit','--quiet','-m','change the measured test','--',file]);assert.equal(missingTestTimings(`refs/heads/main ${git(['rev-parse','HEAD'])} refs/heads/main ${before}`,root).length,1);
 console.log(JSON.stringify({realGitRefusal:true,realVitestRings:2,passedTestsPerRing:1,failedMissingZeroStaleRefused:true,unhandledErrorRefused:true,bareAndStaleCommittedWeightsRefused:true,kitTestNotSentToVitest:true,evidenceSurvivesSnapshotDeletion:true,sourceNotChangedByMeasurement:true,committedClockAdmitted:true,seconds:(performance.now()-began)/1000}));
}finally{rmSync(work,{recursive:true,force:true});}
