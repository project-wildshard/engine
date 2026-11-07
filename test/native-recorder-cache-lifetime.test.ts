// oxlint-disable-next-line import/no-nodejs-modules -- Own cache/source fixtures only.
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Own fixture paths only.
import { resolve } from 'node:path';
// oxlint-disable-next-line import/no-nodejs-modules -- Release an owned eviction lock asynchronously.
import { setTimeout as delay } from 'node:timers/promises';
// oxlint-disable-next-line import/no-nodejs-modules -- Identify the owned fixture lock holder.
import { pid } from 'node:process';
import { afterEach, expect, it } from 'vitest';
import { bakeInputHashes } from '../scripts/bake-input-hashes.mjs';
import { pruneRecorderCache, runNativeRecorder } from '../scripts/native-recorder-cache.mjs';

const owned: string[]=[];
afterEach(()=>{for(const root of owned.splice(0))rmSync(root,{recursive:true,force:true});});
function fixture(): string {
  mkdirSync('tmp',{recursive:true});const root=mkdtempSync(resolve('tmp/generation-lifetime-'));owned.push(root);
  writeFileSync(resolve(root,'input.txt'),'first');return root;
}
function descriptor(root:string) {
  return {id:'fixture-upstream',inputs:bakeInputHashes(root,['input.txt']),outputs:['a.bin','b.bin'],command:['fixture'],platform:'portable' as const};
}
function generate(directory:string): Promise<void> {
  writeFileSync(resolve(directory,'a.bin'),'a');writeFileSync(resolve(directory,'b.bin'),'b');return Promise.resolve();
}
it('refuses incomplete publication and regenerates an incomplete warm entry',async()=>{
  const root=fixture(),cacheDir=resolve(root,'cache'),job=descriptor(root);
  await expect(runNativeRecorder(root,job,{cacheDir,generate:directory=>{
    writeFileSync(resolve(directory,'a.bin'),'a');return Promise.resolve();
  }})).rejects.toThrow();
  expect(readdirSync(resolve(cacheDir,job.id)).filter(name=>/^[a-f0-9]{64}$/u.test(name))).toEqual([]);
  const first=await runNativeRecorder(root,job,{cacheDir,generate});first.release();
  rmSync(resolve(first.directory,'b.bin'));
  let builds=0;
  const repaired=await runNativeRecorder(root,job,{cacheDir,generate:directory=>{builds++;return generate(directory);}});
  expect(repaired.hit).toBe(false);expect(builds).toBe(1);
  expect(readFileSync(resolve(repaired.directory,'b.bin'),'utf8')).toBe('b');repaired.release();
  // Same-size edits cannot reuse an old digest by restoring mtime alone.
  const path=resolve(repaired.directory,'a.bin'),before=statSync(path);
  writeFileSync(path,'x');utimesSync(path,before.atime,before.mtime);
  const edited=await runNativeRecorder(root,job,{cacheDir,generate});
  expect(edited.hit).toBe(false);expect(readFileSync(resolve(edited.directory,'a.bin'),'utf8')).toBe('a');edited.release();
});

it('keeps coalesced upstream readers pinned through downstream copies and prunes after release',async()=>{
  const root=fixture(),cacheDir=resolve(root,'cache'),job=descriptor(root);
  const [first,second]=await Promise.all([runNativeRecorder(root,job,{cacheDir,generate}),runNativeRecorder(root,job,{cacheDir,generate})]);
  expect(first.directory).toBe(second.directory);
  // A second revision makes the referenced entry old enough for normal pruning.
  writeFileSync(resolve(root,'input.txt'),'second');
  const newer=await runNativeRecorder(root,descriptor(root),{cacheDir,generate});newer.release();
  const old=new Date(Date.now()-3_600_000);utimesSync(first.directory,old,old);
  const prune=()=>pruneRecorderCache(cacheDir,{maxAgeMs:1_800_000});
  expect(prune().deleted).toHaveLength(0);
  first.release();expect(prune().deleted).toHaveLength(0);
  const copied=resolve(root,'downstream.bin');copyFileSync(resolve(second.directory,'b.bin'),copied);
  expect(readFileSync(copied,'utf8')).toBe('b');second.release();
  expect(prune().deleted.map(row=>row.key)).toContain(first.key);
  expect(existsSync(`${first.directory}.readers`)).toBe(false);
  expect(existsSync(first.directory)).toBe(false);expect(existsSync(newer.directory)).toBe(true);
});

it('waits for an eviction already holding the key lock before validating a warm entry',async()=>{
  const root=fixture(),cacheDir=resolve(root,'cache'),job=descriptor(root);
  const first=await runNativeRecorder(root,job,{cacheDir,generate});first.release();
  const lock=`${first.directory}.lock`;mkdirSync(lock);writeFileSync(resolve(lock,'owner.json'),JSON.stringify({pid}));
  const waiting=runNativeRecorder(root,job,{cacheDir,generate});
  await delay(10);rmSync(first.directory,{recursive:true});rmSync(lock,{recursive:true});
  const repaired=await waiting;
  expect(repaired.hit).toBe(false);expect(readFileSync(resolve(repaired.directory,'b.bin'),'utf8')).toBe('b');repaired.release();
});
