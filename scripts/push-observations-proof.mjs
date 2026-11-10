// Concurrent real clocks must merge through the production private-rebase path.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {chmodSync,cpSync,mkdirSync,mkdtempSync,readFileSync,rmSync,symlinkSync,unlinkSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {completeTestTimings,prepareTestTimings,readTestTimings,recordTestTimings} from './push-test-timings.mjs';
import {rebaseQueuedSnapshot} from './push-queue-rebase.mjs';

mkdirSync('tmp',{recursive:true});
const work=mkdtempSync(resolve('tmp/observations-proof-')),seed=join(work,'seed'),remote=join(work,'remote.git'),began=performance.now();
const modules=resolve('node_modules'),vitest=resolve('node_modules/vitest/vitest.mjs'),reporter=resolve('scripts/push-timing-reporter.ts');
const env={...process.env,GIT_CONFIG_GLOBAL:'/dev/null',GIT_CONFIG_NOSYSTEM:'1'};
/** @param {string} root @param {string[]} args */
const git=(root,args)=>execFileSync('git',['-c','user.name=Observation proof','-c','user.email=proof@example.test',...args],{cwd:root,env,encoding:'utf8'}).trim();
/** @param {string} root */
function configure(root){
 git(root,['config','user.name','Observation proof']);git(root,['config','user.email','proof@example.test']);
 git(root,['config','core.hooksPath','.githooks']);symlinkSync(modules,join(root,'node_modules'),'dir');
}
/** @param {string} root @param {string[]} files @param {('full'|'1')[]} [rings] @param {boolean} [persist] */
function collect(root,files,rings=['full','1'],persist=true){
 const rows=files.map(file=>({file,blob:git(root,['rev-parse',`HEAD:${file}`]),rings}));
 const evidence=prepareTestTimings(rows,'VB18-actual-Vitest',root,join(work,'evidence'));
 for(const ring of rings){
  const request=evidence.requests[ring];assert.ok(request);
  /** @type {NodeJS.ProcessEnv & {WILDSHARD_RING?:string}} */const variables={...env,WS_PUSH_TIMING_REQUEST:request};
  if(ring==='1')variables.WILDSHARD_RING='1';else Reflect.deleteProperty(variables,'WILDSHARD_RING');
  execFileSync(process.execPath,[vitest,'run',...files,'--config','vitest.config.mjs',`--reporter=${reporter}`],{cwd:root,env:variables,stdio:'pipe'});
  completeTestTimings(request,0);
 }
 if(persist)recordTestTimings(evidence.directory,root);
 return evidence.directory;
}
try{
 mkdirSync(seed);git(seed,['init','--quiet','--initial-branch=main']);git(seed,['init','--quiet','--bare','--initial-branch=main',remote]);git(seed,['remote','add','origin',remote]);
 mkdirSync(join(seed,'test/pins'),{recursive:true});mkdirSync(join(seed,'.githooks'));configure(seed);
 writeFileSync(join(seed,'package.json'),JSON.stringify({name:'observation-proof',private:true,type:'module'}));
 writeFileSync(join(seed,'.gitignore'),'node_modules\n');
 writeFileSync(join(seed,'.gitattributes'),'/test/durations-observations.jsonl merge=union\n');
 writeFileSync(join(seed,'vitest.config.mjs'),"export default {test:{include:['test/**/*.test.ts'],pool:'forks',maxWorkers:1,isolate:false}};\n");
 for(const name of ['durations','durations-ring1','durations-source'])writeFileSync(join(seed,`test/${name}.json`),'{}\n');
 writeFileSync(join(seed,'test/pins/ring-2-tests.json'),'[]\n');writeFileSync(join(seed,'test/durations-observations.jsonl'),'');
 const helper=pathToFileURL(resolve('scripts/push-test-timings.mjs')).href;
 writeFileSync(join(seed,'gate.mjs'),`import{readFileSync}from'node:fs';import{missingTestTimings}from${JSON.stringify(helper)};if(missingTestTimings(readFileSync(0,'utf8')).length)throw new Error('Actual committed clocks required');`);
 writeFileSync(join(seed,'.githooks/pre-push'),'#!/usr/bin/env bash\nset -euo pipefail\nnode gate.mjs\n');chmodSync(join(seed,'.githooks/pre-push'),0o755);
 const anchors=['d','h','l','p','t','x'].map(name=>`test/${name}-anchor.test.ts`);
 const body="import{test,expect}from'vitest';test('actual assertion',()=>expect(2+2).toBe(4));\n";
 for(const file of anchors)writeFileSync(join(seed,file),body);
 git(seed,['add','package.json','.gitignore','.gitattributes','vitest.config.mjs','gate.mjs','.githooks/pre-push','test/durations.json','test/durations-ring1.json','test/durations-source.json','test/durations-observations.jsonl','test/pins/ring-2-tests.json',...anchors]);git(seed,['commit','--quiet','-m','actual anchor sources']);
 collect(seed,anchors);
 // Real completed records in the old shape prove backward compatibility.
 const log=join(seed,'test/durations-observations.jsonl');
 const historical=readFileSync(log,'utf8').trim().split('\n').map(line=>JSON.parse(line));
 assert.equal(historical.length,2);writeFileSync(join(seed,'test/durations-source.json'),JSON.stringify({localPushObservations:historical}));
 const firstLine=JSON.stringify(historical[0]);writeFileSync(log,firstLine);
 git(seed,['commit','--quiet','-m','retain actual historical clocks','--','test/durations.json','test/durations-ring1.json','test/durations-source.json','test/durations-observations.jsonl']);git(seed,['push','--quiet','origin','main']);
 const legacy=readFileSync(join(seed,'test/durations-source.json'),'utf8'),a=join(work,'a'),b=join(work,'b');
 for(const root of [a,b]){git(seed,['clone','--quiet','--no-hardlinks',remote,root]);configure(root);}
 /** @type {string|undefined} */let secondEvidence;
 /** @type {[string,string][]} */const lanes=[[a,'a'],[b,'z']];
 for(const [root,name] of lanes){
  const file=`test/${name}-clock.test.ts`;writeFileSync(join(root,file),body);git(root,['add',file]);git(root,['commit','--quiet','-m',`actual ${name} source`]);
  const ringTable=join(root,'test/durations-ring1.json'),beforeRing=readFileSync(ringTable,'utf8');
  const evidence=collect(root,[file]);if(root===b)secondEvidence=evidence;
  const recorded=readFileSync(join(root,'test/durations-observations.jsonl'),'utf8');
  assert.ok(recorded.startsWith(`${firstLine}\n`),'A valid last line without a newline remains a complete observation');
  if(root===a){
   const afterRing=readFileSync(ringTable,'utf8');
   writeFileSync(ringTable,beforeRing);
   git(root,['commit','--quiet','-m','retain complete append before recovery','--','test/durations.json','test/durations-observations.jsonl']);
   recordTestTimings(evidence,root);
   assert.equal(readFileSync(ringTable,'utf8'),afterRing,'Replaying sealed evidence finishes an interrupted table update');
   assert.equal(readFileSync(join(root,'test/durations-observations.jsonl'),'utf8'),recorded,'Recovery keeps the original observation exactly once');
  }
  assert.equal(readFileSync(join(root,'test/durations-source.json'),'utf8'),legacy);
  git(root,['commit','--quiet','-m',`actual ${name} clocks`,'--','test/durations.json','test/durations-ring1.json','test/durations-observations.jsonl']);
 }
 rebaseQueuedSnapshot(a,env);git(a,['push','--quiet','origin','main']);
 rebaseQueuedSnapshot(b,env);git(b,['push','--quiet','origin','main']);
 assert.equal(git(b,['--git-dir',remote,'rev-parse','main']),git(b,['rev-parse','HEAD']));
 const mergedFile=join(b,'test/durations-observations.jsonl'),merged=readFileSync(mergedFile,'utf8');
 const observations=merged.trim().split('\n').map(line=>JSON.parse(line));
 assert.equal(observations.length,5);assert.equal(JSON.stringify(observations[0]),firstLine);
 const additions=observations.slice(1);
 assert.ok(additions.every(row=>row.completed&&row.files.length===1&&row.files[0].passedTests===1));
 assert.deepEqual(additions.map(row=>`${row.ring}:${row.files[0].file}`).sort(),['1:test/a-clock.test.ts','1:test/z-clock.test.ts','full:test/a-clock.test.ts','full:test/z-clock.test.ts']);
 assert.equal(readFileSync(join(b,'test/durations-source.json'),'utf8'),legacy);
 const actualEvidence=secondEvidence;assert.ok(actualEvidence);
 const tables=()=>['test/durations.json','test/durations-ring1.json'].map(path=>readFileSync(join(b,path),'utf8'));
 const before=tables(),interrupted=`${merged}{"schema":`;
 writeFileSync(mergedFile,interrupted);git(b,['commit','--quiet','-m','real partial observation control','--','test/durations-observations.jsonl']);
 assert.throws(()=>recordTestTimings(actualEvidence,b),/Invalid timing observation/u);assert.deepEqual(tables(),before);assert.equal(readFileSync(mergedFile,'utf8'),interrupted);
 writeFileSync(mergedFile,merged);git(b,['commit','--quiet','-m','repair owned malformed control','--','test/durations-observations.jsonl']);
 const outside=join(work,'owned-outside.txt');writeFileSync(outside,'owned sentinel');unlinkSync(mergedFile);symlinkSync(outside,mergedFile);git(b,['add','test/durations-observations.jsonl']);git(b,['commit','--quiet','-m','real redirected log control']);
 assert.throws(()=>recordTestTimings(actualEvidence,b),/ELOOP/u);assert.equal(readFileSync(outside,'utf8'),'owned sentinel');assert.deepEqual(tables(),before);
 // Two real independent measurements of the same existing module update the
 // same weight key. Only observation lines have union semantics.
 const left=join(work,'weight-left'),right=join(work,'weight-right'),file='test/a-clock.test.ts';
 /** @type {number[]} */const independent=[];
 for(const root of [left,right]){
  git(seed,['clone','--quiet','--no-hardlinks',remote,root]);configure(root);
  const evidence=collect(root,[file],['full'],false),report=readTestTimings(evidence,root)[0];
  const measured=report?.files[0];assert.ok(measured);independent.push(measured.durationMs);
  const table=join(root,'test/durations.json'),values=JSON.parse(readFileSync(table,'utf8'));
  values[file]=measured.durationMs/1000;writeFileSync(table,`${JSON.stringify(values,null,2)}\n`);
  git(root,['commit','--quiet','-m','independent actual weight update','--','test/durations.json']);
 }
 assert.notEqual(independent[0],independent[1]);git(left,['push','--quiet','origin','main']);
 assert.throws(()=>rebaseQueuedSnapshot(right,env),/rebase conflict: test\/durations\.json/u);
 const retained=mkdtempSync(resolve('tmp/observations-evidence-'));
 cpSync(join(work,'evidence'),join(retained,'timings'),{recursive:true});
 writeFileSync(join(retained,'merged-observations.jsonl'),merged);writeFileSync(join(retained,'legacy-source.json'),legacy);
 const result={realVitestInvocations:8,actualClocks:18,concurrentRecordCommits:2,productionQueueRebases:3,bothObservationsKept:true,legacyFactsKept:true,actualPushesAccepted:true,unterminatedLineFixed:true,interruptedTailRefused:true,tableReplay:true,sameWeightConflictRefused:true,redirectRefused:true,seconds:(performance.now()-began)/1000,retained};
 writeFileSync(join(retained,'result.json'),`${JSON.stringify(result,null,2)}\n`);
 console.log(JSON.stringify(result));
}finally{rmSync(work,{recursive:true,force:true});}
