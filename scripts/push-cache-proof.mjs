// Outer-edge CLI proof; deliberately outside hook and Vitest discovery.
import assert from 'node:assert/strict';
import {execFileSync,spawnSync} from 'node:child_process';
import {mkdtempSync,mkdirSync,rmSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {capturePushTree,readPushProof,writePushProof} from './push-proof-cache.mjs';

const directory=resolve(process.argv[2]??'tmp/push-cache-proof');mkdirSync(directory,{recursive:true});
const work=mkdtempSync(join(directory,'run-'));
try{
  /** @param {string[]} args */
  const git=args=>execFileSync('git',['-c','user.name=Cache proof','-c','user.email=proof@example.test',...args],{cwd:work,encoding:'utf8'}).trim();
  git(['init','--quiet']);writeFileSync(join(work,'source.ts'),'export const value=1;');git(['add','source.ts']);git(['commit','--quiet','-m','base']);
  const env={PATH:process.env.PATH},full={mode:/** @type {const} */('full'),files:['source.ts']};
  const first=capturePushTree('proof-v1',env,work);assert.ok(first);assert.equal(readPushProof(first,full),null);
  assert.equal(spawnSync(process.execPath,['-e','process.exitCode=0']).status,0);
  const proof=writePushProof(first,full,.01),same=capturePushTree('proof-v1',env,work);assert.ok(same);
  assert.equal(readPushProof(same,full)?.run,proof.run);
  git(['commit','--quiet','--allow-empty','-m','same tree']);const newCommit=capturePushTree('proof-v1',env,work);assert.ok(newCommit);assert.notEqual(newCommit.commit,first.commit);assert.equal(readPushProof(newCommit,full)?.run,proof.run);
  writeFileSync(join(work,'source.ts'),'export const value=2;');assert.equal(capturePushTree('proof-v1',env,work),null);
  git(['add','source.ts']);git(['commit','--quiet','-m','changed tree']);const changed=capturePushTree('proof-v1',env,work);assert.ok(changed);assert.equal(readPushProof(changed,full),null);
  writePushProof(changed,{mode:'docs',files:['note.md']},.01);assert.equal(readPushProof(changed,full),null);
  writePushProof(changed,{mode:'related',files:['source.ts']},.01);assert.equal(readPushProof(changed,full),null);
  assert.ok(readPushProof(changed,{mode:'related',files:['source.ts']}));assert.equal(readPushProof(changed,{mode:'related',files:['other.ts']}),null);
  assert.equal(capturePushTree('proof-v1',{...env,CI:'true'},work),null);
  const runtime=capturePushTree('different-profile',env,work);assert.ok(runtime);assert.equal(readPushProof(runtime,full),null);
  writeFileSync(changed.file,'{"version":1}');assert.equal(readPushProof(changed,full),null);
  console.log(JSON.stringify({sameTreeRun:proof.run,newCommitSameTree:true,changedTreeMiss:true,dirtyRefused:true,partialCannotCoverFull:true,ciAlwaysRuns:true,invalidReceiptMiss:true}));
}finally{rmSync(work,{recursive:true,force:true});}
