import {installProofFixture} from './proof-fixture-install.mjs';
// Real Git and kernel owner fixtures; no suite, push or network request.
import assert from 'node:assert/strict';
import {execFileSync,spawnSync} from 'node:child_process';
import {existsSync,mkdirSync,mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {capturePushTree,readPushProof,writePushProof} from './push-proof-cache.mjs';
import {PUSH_PROFILE,SPLIT_PROFILE} from './push-budget.mjs';

const parent=resolve(process.argv[2]??process.env.VITEST_TMP_ROOT??'tmp/vitest');mkdirSync(parent,{recursive:true});
const root=mkdtempSync(join(parent,'proof-owner-'));
const originalPath=process.env.PATH;
try{
 const tools=JSON.parse(execFileSync('python3',['-c','import json,sys,shutil;print(json.dumps(dict(python=sys.executable,ps=shutil.which("ps"))))'],{encoding:'utf8'}));
 const env={PATH:originalPath,GIT_CONFIG_GLOBAL:'/dev/null',GIT_CONFIG_NOSYSTEM:'1'};
 /** @param {string[]} args */
 const git=args=>execFileSync('git',['-c','user.name=Owner fixture','-c','user.email=owner@example.test',...args],{cwd:root,env,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
 git(['init','--quiet']);installProofFixture(root);writeFileSync(join(root,'value.ts'),'export const value=1;');git(['add','value.ts']);git(['commit','--quiet','-m','seed']);
 const bin=join(root,'.git','probe-bin'),log=join(root,'.git','probe.log');mkdirSync(bin);
 for(const [name,tool] of [['python3',tools.python],['ps',tools.ps]]){
  writeFileSync(join(bin,name),`#!${process.execPath}\nimport{appendFileSync}from'node:fs';import{spawnSync}from'node:child_process';appendFileSync(${JSON.stringify(log)},${JSON.stringify(`${name}\n`)});const result=spawnSync(${JSON.stringify(tool)},process.argv.slice(2),{stdio:'inherit'});if(result.error)throw result.error;process.exit(result.status??1);`,{mode:0o700});
 }
 // This CLI is an isolated child of Vitest; its PATH never changes the worker.
 process.env.PATH=`${bin}:${originalPath}`;env.PATH=process.env.PATH;
 const probes=()=>existsSync(log)?readFileSync(log,'utf8').trim().split('\n'):[];
 const leaseRoot=join(root,'.git','owned-lease');mkdirSync(leaseRoot);
 const lease={token:'owned-fixture-token',runnerPid:process.pid,childPid:process.pid,resources:['full-test'],queuedAt:Date.now()/1000,startedAt:Date.now()/1000};
 writeFileSync(join(leaseRoot,'full-test.active.json'),JSON.stringify(lease));
 const leased={...env,WS_HEAVY_ROOT:leaseRoot,WS_HEAVY_TOKEN:lease.token};
 const full={mode:/** @type {const} */('full'),files:['value.ts']};
 const first=capturePushTree(PUSH_PROFILE,leased,root);assert.ok(first);
 assert.deepEqual(probes(),[],'discarded capture must not spawn producer probes');
 const mismatch=spawnSync(tools.python,['src/scripts/cpu-census.py','--pid',String(process.pid),'--owner-only','--expected-identity','wrong-owner'],{encoding:'utf8'});
 assert.equal(mismatch.status,2);assert.equal(mismatch.stdout,'');assert.match(mismatch.stderr,/selected owner identity changed/u);
 const proof=writePushProof(first,full,.01);assert.deepEqual(probes(),['python3','ps'],'fresh publication probes exactly once');
 assert.equal(proof.measurement.owner?.pid,process.pid);assert.ok(proof.measurement.owner.identity);
 assert.ok(BigInt(proof.measurement.owner.bornNs)>0n);assert.deepEqual(proof.measurement.lease,lease);
 assert.ok(Date.parse(proof.measurement.captured)<=Date.parse(proof.finished));
 const later=capturePushTree(PUSH_PROFILE,leased,root);assert.ok(later);
 assert.equal(proof.measurement.profile,PUSH_PROFILE);
 const reused=readPushProof(later,full);assert.ok(reused);
 assert.equal(reused.run,proof.run);assert.equal(reused.finished,proof.finished);assert.deepEqual(reused.measurement,proof.measurement);
 const preLease=capturePushTree(PUSH_PROFILE,env,root);assert.ok(preLease);
 assert.equal(readPushProof(preLease,full)?.run,proof.run,'pre-lease and release-check capture reuses the actual producer');
 assert.deepEqual(probes(),['python3','ps'],'comparison and reuse must not run discarded probes');
 assert.equal(proof.version,2);
 assert.deepEqual(proof.exclusions,{files:[],deadline:null});
 const localOnly={...later,sharedFile:null};
 for(const exclusions of [{files:['test/omitted.test.ts'],deadline:null},{files:[],deadline:proof.finished}]){
  writeFileSync(first.file,JSON.stringify({...proof,exclusions}));
  assert.equal(readPushProof(localOnly,full),null,'Version 2 rejects receipts with excluded tests or a deadline');
 }
 const {measurement:_measurement,...legacy}=proof;
 writeFileSync(first.file,JSON.stringify(legacy));const old=readPushProof(later,full);assert.ok(old);
 assert.equal(old.run,proof.run);assert.equal(old.measurement,undefined,'v2 receipts without measurement still reuse');
 assert.deepEqual(probes(),['python3','ps']);
 for(const mode of /** @type {const} */(['docs','related'])){
  const partial=writePushProof(first,{mode,files:['value.ts']},.01);
  assert.equal(partial.mode,mode);assert.equal(partial.measurement.profile,PUSH_PROFILE);
  assert.equal(readPushProof(first,full),null,'partial publication cannot cover a full gate');
 }
 const split=capturePushTree(SPLIT_PROFILE,leased,root);assert.ok(split);
 assert.equal(writePushProof(split,full,.01).measurement.profile,SPLIT_PROFILE,'a split full selection retains its actual profile');
 const unleased=capturePushTree(PUSH_PROFILE,{...leased,WS_HEAVY_TOKEN:'foreign-token'},root);assert.ok(unleased);
 assert.equal(writePushProof(unleased,full,.01).measurement.lease,null,'a copied or wrong lease token cannot mint owner-bound metadata');
 const initial={...lease,childPid:null};writeFileSync(join(leaseRoot,'full-test.active.json'),JSON.stringify(initial));
 const initialContext=capturePushTree(PUSH_PROFILE,leased,root);assert.ok(initialContext);
 const initialProof=writePushProof(initialContext,full,.01);assert.deepEqual(initialProof.measurement.lease,initial);
 assert.equal(readPushProof(initialContext,full)?.measurement?.lease?.childPid,null,'initial lease remains cache-compatible');
 console.log(JSON.stringify({kernelOwnerBound:true,ownerMismatchRefused:true,leaseBound:true,producerPreservedOnReuse:true,legacyCompatible:true,partialScopePreserved:true,splitProfilePreserved:true,wrongLeaseUnavailable:true,discardedCapturesUnprobed:true,freshWriterProbedOnce:true,initialNullChildPreserved:true}));
}finally{process.env.PATH=originalPath;rmSync(root,{recursive:true,force:true});}
