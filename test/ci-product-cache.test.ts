// oxlint-disable-next-line import/no-nodejs-modules -- Create only owned cache and output fixtures.
import {existsSync,mkdirSync,mkdtempSync,readFileSync,writeFileSync,rmSync,symlinkSync} from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Confine fixture paths below tmp.
import {resolve} from 'node:path';
// oxlint-disable-next-line import/no-nodejs-modules -- Exercise the local-run refusal in the real CLI process.
import {spawnSync} from 'node:child_process';
// oxlint-disable-next-line import/no-nodejs-modules -- Launch the same Node runtime.
import process from 'node:process';
import {afterEach,expect,it} from 'vitest';
import {trimProductCache} from '../scripts/ci-product-cache.mjs';

const owned:string[]=[];
afterEach(()=>{for(const root of owned.splice(0))rmSync(root,{recursive:true,force:true});});
function fixture():{root:string;cache:string;put:(path:string,text:string)=>void} {
  mkdirSync('tmp',{recursive:true});const root=mkdtempSync(resolve('tmp/ci-product-cache-'));owned.push(root);
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
  expect(trimProductCache(root,cache)).toEqual({products:2,removed:2});
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
  expect(trimProductCache(root,cache)).toEqual({products:0,removed:0});
  put(`cache/alpha/${current}/.build-key`,old);
  expect(trimProductCache(root,cache)).toEqual({products:0,removed:0});
  expect(existsSync(resolve(cache,'alpha',old))).toBe(true);
  put(`cache/alpha/${current}/.build-key`,current);
  expect(trimProductCache(root,cache)).toEqual({products:0,removed:0});
  put('out/alpha/shard.json','current manifest');
  put(`cache/alpha/${current}/shard.json`,'different manifest');
  expect(trimProductCache(root,cache)).toEqual({products:0,removed:0});
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
  expect(trimProductCache(root,cache)).toEqual({products:1,removed:0});
  expect(readFileSync(resolve(root,'outside/keep'),'utf8')).toBe('foreign');
  mkdirSync(resolve(root,'out/beta'));
  writeFileSync(resolve(root,'out/beta/validation.json'),JSON.stringify({buildKey:current}));
  symlinkSync(resolve(cache,'alpha'),resolve(cache,'beta'),'dir');
  expect(trimProductCache(root,cache)).toEqual({products:1,removed:0});
});
it('refuses the actual CLI outside GitHub Actions without touching local caches',()=>{
  const result=spawnSync(process.execPath,['scripts/ci-product-cache.mjs'],{encoding:'utf8',env:{...process.env,GITHUB_ACTIONS:'false',CI:'true'}});
  expect(result.status).toBe(1);expect(result.stderr).toContain('only on an isolated GitHub Actions runner');
});

it('does not prune through a linked root or a linked current manifest',()=>{
  const {root,cache,put}=fixture(),old='a'.repeat(64),current='b'.repeat(64);
  put('out/alpha/validation.json',JSON.stringify({buildKey:current}));
  put('out/alpha/shard.json','manifest');
  put(`cache/alpha/${old}/.build-key`,old);
  put(`cache/alpha/${current}/.build-key`,current);
  symlinkSync(resolve(root,'out/alpha/shard.json'),resolve(cache,'alpha',current,'shard.json'));
  expect(trimProductCache(root,cache)).toEqual({products:0,removed:0});
  const linked=resolve(root,'linked-cache');symlinkSync(cache,linked,'dir');
  expect(trimProductCache(root,linked)).toEqual({products:0,removed:0});
  expect(existsSync(resolve(cache,'alpha',old))).toBe(true);
});


it('refuses generation-history apply outside the isolated hosted Linux workspace',()=>{
  const result=spawnSync(process.execPath,['scripts/ci-product-cache.mjs','--prune-generation'],{
    encoding:'utf8',env:{...process.env,GITHUB_ACTIONS:'true',CI:'true',RUNNER_ENVIRONMENT:'self-hosted'}});
  expect(result.status).toBe(1);expect(result.stderr).toContain('requires the isolated hosted Linux workspace');
});
