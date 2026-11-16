// Real Git and kernel owner fixtures; no suite, push or network request.
import assert from 'node:assert/strict';
import {execFileSync,spawnSync} from 'node:child_process';
import {mkdirSync,mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {capturePushTree,readPushProof,writePushProof} from './push-proof-cache.mjs';
import {PUSH_PROFILE,SPLIT_PROFILE} from './push-budget.mjs';

const parent=resolve(process.argv[2]??process.env.VITEST_TMP_ROOT??'tmp/vitest');mkdirSync(parent,{recursive:true});
const root=mkdtempSync(join(parent,'proof-owner-'));
try{
 const env={PATH:process.env.PATH,GIT_CONFIG_GLOBAL:'/dev/null',GIT_CONFIG_NOSYSTEM:'1'};
 /** @param {string[]} args */
 const git=args=>execFileSync('git',['-c','user.name=Owner fixture','-c','user.email=owner@example.test',...args],{cwd:root,env,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
 git(['init','--quiet']);writeFileSync(join(root,'value.ts'),'export const value=1;');git(['add','value.ts']);git(['commit','--quiet','-m','seed']);
 const leaseRoot=join(root,'.git','owned-lease');mkdirSync(leaseRoot);
 const lease={token:'owned-fixture-token',runnerPid:process.pid,childPid:process.pid,resources:['full-test'],queuedAt:Date.now()/1000,startedAt:Date.now()/1000};
 writeFileSync(join(leaseRoot,'full-test.active.json'),JSON.stringify(lease));
 const leased={...env,WS_HEAVY_ROOT:leaseRoot,WS_HEAVY_TOKEN:lease.token};
 const full={mode:/** @type {const} */('full'),files:['value.ts']};
 const first=capturePushTree(PUSH_PROFILE,leased,root);assert.ok(first);
 assert.equal(first.measurement.owner?.pid,process.pid);assert.ok(first.measurement.owner.identity);
 assert.ok(BigInt(first.measurement.owner.bornNs)>0n);assert.deepEqual(first.measurement.lease,lease);
 const mismatch=spawnSync('python3',['scripts/cpu-census.py','--pid',String(process.pid),'--owner-only','--expected-identity','wrong-owner'],{encoding:'utf8'});
 assert.equal(mismatch.status,2);assert.equal(mismatch.stdout,'');assert.match(mismatch.stderr,/selected owner identity changed/u);
 const proof=writePushProof(first,full,.01),later=capturePushTree(PUSH_PROFILE,leased,root);assert.ok(later);
 assert.equal(proof.measurement.profile,PUSH_PROFILE);
 const reused=readPushProof(later,full);assert.ok(reused);
 assert.equal(reused.run,proof.run);assert.equal(reused.finished,proof.finished);assert.deepEqual(reused.measurement,proof.measurement);
 assert.notEqual(later.measurement.captured,proof.measurement.captured,'reuse must not replace the producer capture');
 const {measurement:_measurement,...legacy}=proof;
 writeFileSync(first.file,JSON.stringify(legacy));const old=readPushProof(later,full);assert.ok(old);
 assert.equal(old.run,proof.run);assert.equal(old.measurement,undefined,'v2 receipts without measurement still reuse');
 for(const mode of /** @type {const} */(['docs','related'])){
  const partial=writePushProof(first,{mode,files:['value.ts']},.01);
  assert.equal(partial.mode,mode);assert.equal(partial.measurement.profile,PUSH_PROFILE);
  assert.equal(readPushProof(first,full),null,'partial publication cannot cover a full gate');
 }
 const split=capturePushTree(SPLIT_PROFILE,leased,root);assert.ok(split);
 assert.equal(writePushProof(split,full,.01).measurement.profile,SPLIT_PROFILE,'a split full selection retains its actual profile');
 const unleased=capturePushTree(PUSH_PROFILE,{...leased,WS_HEAVY_TOKEN:'foreign-token'},root);assert.ok(unleased);
 assert.equal(unleased.measurement.lease,null,'a copied or wrong lease token cannot mint owner-bound metadata');
 console.log(JSON.stringify({kernelOwnerBound:true,ownerMismatchRefused:true,leaseBound:true,producerPreservedOnReuse:true,legacyCompatible:true,partialScopePreserved:true,splitProfilePreserved:true,wrongLeaseUnavailable:true}));
}finally{rmSync(root,{recursive:true,force:true});}
