// Ring 2: two actual complete engine gates are necessary to prove a real cache
// hit cannot bypass new-file admission. Never included in a hook/test glob.
import assert from 'node:assert/strict';
import {execFileSync,spawn} from 'node:child_process';
import {resolve as resolvePath} from 'node:path';
import {missingTestTimings,readTestTimings} from './push-test-timings.mjs';

/** @param {string[]} args */
const git=args=>execFileSync('git',args,{encoding:'utf8'}).trim();
const old=process.argv.find(arg=>arg.startsWith('--older-base='))?.slice(13);
if(old===undefined||!/^[a-f0-9]{40}$/u.test(old))throw new Error('Give the full older ancestor SHA with --older-base=');
for(const key of ['SKIP_CHECK','SKIP_BUDGET','ALLOW_BIG','ALLOW_SECRET'])if(process.env[key])throw new Error(`Proof refuses bypass input ${key}`);
assert.equal(git(['status','--porcelain','--untracked-files=normal']),'','Commit the complete source before the actual gates');
const head=git(['rev-parse','HEAD']),tree=git(['rev-parse','HEAD^{tree}']),base=git(['merge-base','HEAD','origin/main']),remote=git(['remote','get-url','origin']);
/** @param {string} older */
const refs=older=>`refs/heads/main ${head} refs/heads/main ${older}\n`;
assert.deepEqual(missingTestTimings(refs(base)),[],'The real current-origin range must be admitted');
assert.ok(missingTestTimings(refs(old)).length>0,'The older real range must contain an unrecorded test blob');
/** @param {string} older */
async function gate(older){
 const began=performance.now(),child=spawn('bash',['.githooks/pre-push','origin',remote],{env:{...process.env,WS_FULL_SUITE:'1'},stdio:['pipe','pipe','pipe']});
 let stdout='',stderr='';child.stdout.on('data',data=>{stdout+=data;process.stdout.write(data);});child.stderr.on('data',data=>{stderr+=data;process.stderr.write(data);});child.stdin.end(refs(older));
 const code=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',resolve);});
 assert.equal(git(['rev-parse','HEAD']),head);assert.equal(git(['rev-parse','HEAD^{tree}']),tree);assert.equal(git(['status','--porcelain','--untracked-files=normal']),'');
 return {code,stdout,stderr,seconds:(performance.now()-began)/1000};
}
console.log('Ring2: actual current-range normal full gate first');
const positive=await gate(base);assert.equal(positive.code,0);assert.match(positive.stderr,/saved exact-tree proof run/u,'This proof needs a fresh real full gate, not an existing cache hit');
console.log('Ring2: same checked tree, actual older range with missing timing');
const negative=await gate(old);assert.notEqual(negative.code,0);assert.match(negative.stderr,/full push budget/u,'Both production cache entry points must refuse reuse');assert.doesNotMatch(negative.stderr,/exact-tree green reuse/u);
const receipt=negative.stderr.split('\n').find(line=>line.startsWith('timing-evidence: '));assert.ok(receipt,'Production refusal must export durable usable evidence');
const evidence=JSON.parse(receipt.slice('timing-evidence: '.length));assert.ok(!resolvePath(evidence.directory).startsWith(`${process.cwd()}/`),'Evidence must survive queue snapshot cleanup');
const reports=readTestTimings(evidence.directory);assert.ok(reports.length>0);assert.ok(reports.every(report=>report.files.every(file=>file.passedTests>0)));
console.log(JSON.stringify({ring:2,reason:'Two actual full engine gates prove both production cache entries and durable timing recovery, without a fake green receipt',positiveSeconds:positive.seconds,negativeSeconds:negative.seconds,bothProductionCacheEntriesRefuse:true,durableEvidence:evidence.directory,treeUnchanged:true,networkPublication:false}));
