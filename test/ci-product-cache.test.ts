// oxlint-disable-next-line import/no-nodejs-modules -- Create only owned cache and output fixtures.
import {existsSync,mkdirSync,mkdtempSync,readFileSync,writeFileSync,rmSync,symlinkSync} from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Confine fixture paths below tmp.
import {resolve} from 'node:path';
// oxlint-disable-next-line import/no-nodejs-modules -- Exercise the local-run refusal in the real CLI process.
import {spawn} from 'node:child_process';
import type {ChildProcess} from 'node:child_process';
// oxlint-disable-next-line import/no-nodejs-modules -- Launch the same Node runtime.
import process from 'node:process';
import {afterAll,afterEach,expect,it} from 'vitest';
import {trimFolderCache} from '../scripts/ci-folder-cache.mjs';

const owned:string[]=[];
afterEach(()=>{for(const root of owned.splice(0))rmSync(root,{recursive:true,force:true});});
// A sync spawn froze the worker past vitest's timeout and hung CI shard 20 for 259 s (run 45430448538). The CLI runs
// async with its own deadline, so a stalled child fails its test, and teardown kills any child still running.
const CLI_DEADLINE_MS=20_000,TEST_DEADLINE_MS=30_000;
const children=new Set<ChildProcess>();
afterAll(()=>{for(const child of children)child.kill('SIGKILL');children.clear();});
async function runCli(args:readonly string[],env:NodeJS.ProcessEnv):Promise<{status:number|null;stderr:string}> {
  const child=spawn(process.execPath,['scripts/ci-folder-cache.mjs',...args],{env,stdio:['ignore','ignore','pipe']});
  children.add(child);let stderr='';child.stderr?.setEncoding('utf8').on('data',(chunk:string)=>{stderr+=chunk;});
  const timer=setTimeout(()=>{stderr+=`\nci-folder-cache.mjs passed its ${CLI_DEADLINE_MS} ms deadline; killed`;child.kill('SIGKILL');},CLI_DEADLINE_MS);
  try {return await new Promise((done,fail)=>{child.once('error',fail);child.once('close',(status:number|null)=>{done({status,stderr});});});}
  finally {clearTimeout(timer);children.delete(child);}
}
function fixture():{root:string;cache:string;put:(path:string,text:string)=>void} {
  mkdirSync('tmp',{recursive:true});const root=mkdtempSync(resolve('tmp/ci-folder-cache-'));owned.push(root);
  const put=(path:string,text:string):void=>{const target=resolve(root,path);mkdirSync(resolve(target,'..'),{recursive:true});writeFileSync(target,text);};
  mkdirSync(resolve(root,'out'));
  return {root,cache:resolve(root,'cache'),put};
}
it('keeps current keys, exact bytes and receipts while dropping old payload versions',()=>{
  const {root,cache,put}=fixture(),old='a'.repeat(64),current='b'.repeat(64);
  for(const slug of ['alpha','beta']) {
    put(`out/${slug}/validation.json`,JSON.stringify({buildKey:current}));
    put(`out/${slug}/shard.json`,`${slug}:${current}`);
    for(const key of [old,current]) {
      put(`cache/${slug}/${key}/.build-key`,key);
      put(`cache/${slug}/${key}/shard.json`,`${slug}:${key}`);
    }
    put(`cache/.inputs-v2/${slug}/receipt.json`,'input evidence');
    put(`cache/${slug}/notes/keep`,'unrelated');
  }
  expect(trimFolderCache(root,cache)).toEqual({products:2,removed:2});
  for(const slug of ['alpha','beta']) {
    expect(readFileSync(resolve(cache,slug,current,'shard.json'),'utf8')).toBe(`${slug}:${current}`);
    expect(existsSync(resolve(cache,slug,old))).toBe(false);
    expect(readFileSync(resolve(cache,'.inputs-v2',slug,'receipt.json'),'utf8')).toBe('input evidence');
    expect(existsSync(resolve(cache,slug,'notes/keep'))).toBe(true);
  }
});
it('does not prune without a complete matching current cache key',()=>{
  const {root,cache,put}=fixture(),old='a'.repeat(64),current='b'.repeat(64);
  put('out/alpha/validation.json',JSON.stringify({buildKey:current}));
  put(`cache/alpha/${old}/.build-key`,old);
  expect(trimFolderCache(root,cache)).toEqual({products:0,removed:0});
  put(`cache/alpha/${current}/.build-key`,old);
  expect(trimFolderCache(root,cache)).toEqual({products:0,removed:0});
  expect(existsSync(resolve(cache,'alpha',old))).toBe(true);
  put(`cache/alpha/${current}/.build-key`,current);
  expect(trimFolderCache(root,cache)).toEqual({products:0,removed:0});
  put('out/alpha/shard.json','current manifest');
  put(`cache/alpha/${current}/shard.json`,'different manifest');
  expect(trimFolderCache(root,cache)).toEqual({products:0,removed:0});
  expect(existsSync(resolve(cache,'alpha',old))).toBe(true);
});
it('never follows linked cache products or linked historical entries',()=>{
  const {root,cache,put}=fixture(),old='a'.repeat(64),current='b'.repeat(64);
  put('out/alpha/validation.json',JSON.stringify({buildKey:current}));
  put('out/alpha/shard.json','current manifest');
  put(`cache/alpha/${current}/.build-key`,current);
  put(`cache/alpha/${current}/shard.json`,'current manifest');
  put('outside/keep','foreign');
  symlinkSync(resolve(root,'outside'),resolve(cache,'alpha',old),'dir');
  expect(trimFolderCache(root,cache)).toEqual({products:1,removed:0});
  expect(readFileSync(resolve(root,'outside/keep'),'utf8')).toBe('foreign');
  mkdirSync(resolve(root,'out/beta'));
  writeFileSync(resolve(root,'out/beta/validation.json'),JSON.stringify({buildKey:current}));
  symlinkSync(resolve(cache,'alpha'),resolve(cache,'beta'),'dir');
  expect(trimFolderCache(root,cache)).toEqual({products:1,removed:0});
});
it('refuses the actual CLI outside GitHub Actions without touching local caches',async()=>{
  const result=await runCli([],{...process.env,GITHUB_ACTIONS:'false',CI:'true'});
  expect(result.stderr).toContain('only on an isolated GitHub Actions runner');expect(result.status).toBe(1);
},TEST_DEADLINE_MS);

it('does not prune through a linked root or a linked current manifest',()=>{
  const {root,cache,put}=fixture(),old='a'.repeat(64),current='b'.repeat(64);
  put('out/alpha/validation.json',JSON.stringify({buildKey:current}));
  put('out/alpha/shard.json','manifest');
  put(`cache/alpha/${old}/.build-key`,old);
  put(`cache/alpha/${current}/.build-key`,current);
  symlinkSync(resolve(root,'out/alpha/shard.json'),resolve(cache,'alpha',current,'shard.json'));
  expect(trimFolderCache(root,cache)).toEqual({products:0,removed:0});
  const linked=resolve(root,'linked-cache');symlinkSync(cache,linked,'dir');
  expect(trimFolderCache(root,linked)).toEqual({products:0,removed:0});
  expect(existsSync(resolve(cache,'alpha',old))).toBe(true);
});


it('refuses generation-history apply outside the isolated hosted Linux workspace',async()=>{
  const result=await runCli(['--prune-generation'],{...process.env,GITHUB_ACTIONS:'true',CI:'true',RUNNER_ENVIRONMENT:'self-hosted'});
  expect(result.stderr).toContain('requires the isolated hosted Linux workspace');expect(result.status).toBe(1);
},TEST_DEADLINE_MS);

// Release CI 45458806208: the refusal above passed its 20 s deadline under load while the CLI loaded the generation
// prune's module graph it never used. Only --prune-generation may load it, so a refusal or plain trim starts light.
it('loads the generation prune only for --prune-generation',()=>{
  const source=readFileSync(resolve('scripts/ci-folder-cache.mjs'),'utf8');
  expect(source).not.toMatch(/^import[^\n]*generation-cache-prune/mu);
  expect(source).toContain("await import('./generation-cache-prune.mjs')");
});
