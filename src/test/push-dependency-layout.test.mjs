import {afterEach,expect,test} from 'vitest';
// oxlint-disable-next-line import/no-nodejs-modules -- Real installed byte graphs and Git rebases.
import {execFileSync} from 'node:child_process';
// oxlint-disable-next-line import/no-nodejs-modules -- Each managed install is private and removed after its case.
import {chmodSync,mkdirSync,mkdtempSync,rmSync,symlinkSync,truncateSync,writeFileSync} from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Owned fixture paths.
import {dirname,join,resolve} from 'node:path';
import {pushDependencyIdentity} from '../scripts/push-dependencies.mjs';
import {installProofFixture} from '../scripts/proof-fixture-install.mjs';
import {capturePushTree,writePushProof} from '../scripts/push-proof-cache.mjs';
import {discoverLocalDeltaPlan,localDeltaPlan} from '../scripts/local-land-delta.mjs';

const roots=[];
afterEach(()=>{for(const root of roots.splice(0))rmSync(root,{recursive:true,force:true});});
function fixture(global=true){
 const parent=resolve(process.env.VITEST_TMP_ROOT??'tmp/codex-pagesize');mkdirSync(parent,{recursive:true});
 const root=mkdtempSync(join(parent,'managed-proof-'));roots.push(root);
 const put=(path,text)=>{mkdirSync(dirname(path),{recursive:true});writeFileSync(path,text);};
 const lock="lockfileVersion: '9.0'\npackages:\n  fixture@1.0.0:\n    resolution: {tarball: https://example.test/source/"+'a'.repeat(40)+"}\n";
 const context=global?join(root,'store/links/fixture/hash/node_modules'):join(root,'node_modules/.pnpm/fixture@1/node_modules');
 const leafContext=global?join(root,'store/links/leaf/hash/node_modules'):join(root,'node_modules/.pnpm/leaf@1/node_modules');
 put(join(context,'fixture/package.json'),'{"name":"fixture","version":"1.0.0","main":"index.cjs"}');
 put(join(context,'fixture/index.cjs'),"module.exports=require('leaf');");
 const leaf=join(leafContext,'leaf/index.cjs');put(leaf,'module.exports=41;');
 put(join(leafContext,'leaf/package.json'),'{"name":"leaf","version":"1.0.0","main":"index.cjs"}');
 symlinkSync(join(leafContext,'leaf'),join(context,'leaf'),'dir');
 mkdirSync(join(root,'node_modules/.pnpm'),{recursive:true});
 symlinkSync(join(context,'fixture'),join(root,'node_modules/fixture'),'dir');
 put(join(root,'package.json'),JSON.stringify({name:'proof-consumer',type:'module',packageManager:'pnpm@10.34.9',dependencies:{fixture:'1.0.0'}}));
 put(join(root,'pnpm-lock.yaml'),lock);
 put(join(root,'node_modules/.pnpm/lock.yaml'),lock.replace('resolution: {','resolution: {gitHosted: true, '));
 if(global)put(join(root,'node_modules/.modules.yaml'),JSON.stringify({storeDir:join(root,'store'),packageManager:'pnpm@10.34.9'}));
 const binary=join(root,'bin/pnpm');put(binary,`#!/usr/bin/env node\nif(process.argv.slice(2).join(' ')!=='store path')process.exit(2);console.log(${JSON.stringify(join(root,'store'))});\n`);chmodSync(binary,0o755);
 const env={PATH:`${join(root,'bin')}:${process.env.PATH??''}`,CI:'',GITHUB_ACTIONS:'',GIT_CONFIG_GLOBAL:'/dev/null',GIT_CONFIG_NOSYSTEM:'1'};
 const git=(...args)=>execFileSync('git',['-c','user.name=Fixture','-c','user.email=fixture@example.test',...args],{cwd:root,env,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
 const commit=()=>{git('add','--','.');git('commit','--quiet','-m','fixture');return git('rev-parse','HEAD');};
 const runtime=()=>execFileSync(process.execPath,['-e',"console.log(require('fixture'))"],{cwd:root,env,encoding:'utf8'}).trim();
 installProofFixture(root);
 return {root,put,env,git,commit,leaf,runtime,lock};
}
test.each([false,true])('managed pnpm lock metadata permits the actual installed graph (global %s)',global=>{
 const f=fixture(global),before=pushDependencyIdentity(f.root,f.env);
 expect(before).not.toBeNull();expect(f.runtime()).toBe('41');
 f.put(f.leaf,'module.exports=42;');expect(f.runtime()).toBe('42');
 expect(pushDependencyIdentity(f.root,f.env)).not.toBe(before);
},30000);
test('managed snapshot tolerance never hides a changed resolution or live alias',()=>{
 const f=fixture();
 f.put(join(f.root,'pnpm-lock.yaml'),f.lock.replace('a'.repeat(40),'b'.repeat(40)));
 expect(pushDependencyIdentity(f.root,f.env)).toBeNull();
 f.put(join(f.root,'pnpm-lock.yaml'),f.lock);
 rmSync(join(f.root,'node_modules/fixture'));
 f.put(join(f.root,'live/package.json'),'{"name":"fixture","main":"index.cjs"}');f.put(join(f.root,'live/index.cjs'),'module.exports=41;');
 symlinkSync(join(f.root,'live'),join(f.root,'node_modules/fixture'),'dir');expect(f.runtime()).toBe('41');
 expect(pushDependencyIdentity(f.root,f.env)).toBeNull();
},30000);
test('an oversized installed file is refused before a large allocation',()=>{
 const f=fixture();expect(pushDependencyIdentity(f.root,f.env)).not.toBeNull();
 truncateSync(f.leaf,256*1024*1024+1);
 expect(pushDependencyIdentity(f.root,f.env)).toBeNull();
},30000);
test('an undeclared working source alias cannot remain outside the identity',()=>{
 const f=fixture(),before=pushDependencyIdentity(f.root,f.env);expect(before).not.toBeNull();
 f.put(join(f.root,'extra/package.json'),'{"name":"extra","main":"index.cjs"}');f.put(join(f.root,'extra/index.cjs'),'module.exports=7;');
 symlinkSync(join(f.root,'extra'),join(f.root,'node_modules/extra'),'dir');
 expect(execFileSync(process.execPath,['-e',"console.log(require('extra'))"],{cwd:f.root,env:f.env,encoding:'utf8'}).trim()).toBe('7');
 expect(pushDependencyIdentity(f.root,f.env)).toBeNull();
},30000);
test('a managed-global full proof survives a real separate rebase',()=>{
 const f=fixture();
 f.git('init','--quiet','-b','main');f.put(join(f.root,'.gitignore'),'node_modules/\nstore/\nbin/\n');
 f.put(join(f.root,'src/a.ts'),'export const a=1;');f.put(join(f.root,'src/b.ts'),'export const b=1;');f.commit();
 f.git('switch','--quiet','-c','plan/managed');f.put(join(f.root,'src/a.ts'),'export const a=2;');const tested=f.commit();
 const before=capturePushTree('managed-fixture',f.env,f.root);if(before===null)throw new Error('Missing clean managed context');expect(before.dependencies).not.toBeNull();
 expect(f.runtime()).toBe('41');writePushProof(before,{mode:'full',files:['src/a.ts']},.01);
 f.git('switch','--quiet','main');f.put(join(f.root,'src/b.ts'),'export const b=2;');const incoming=f.commit();
 f.git('switch','--quiet','plan/managed');f.git('rebase','--quiet','main');
 const plan=discoverLocalDeltaPlan(capturePushTree('managed-fixture',f.env,f.root),incoming);
 expect(plan.eligible).toBe(true);expect(plan.proof.commit).toBe(tested);expect(plan.selection.files).toEqual(['src/b.ts']);
 const current=capturePushTree('managed-fixture',f.env,f.root);
 f.git('switch','--quiet','--detach','HEAD');
 expect(discoverLocalDeltaPlan(current,incoming).eligible).toBe(false);
 expect(discoverLocalDeltaPlan(current,incoming,'refs/heads/main').eligible).toBe(false);
 expect(discoverLocalDeltaPlan(current,incoming,'refs/heads/plan/managed').proof?.run).toBe(plan.proof?.run);
},30000);

test('one passed full proof carries four consecutive disjoint main rebases',()=>{
 const f=fixture();
 f.git('init','--quiet','-b','main');f.put(join(f.root,'.gitignore'),'node_modules/\nstore/\nbin/\n');
 f.put(join(f.root,'src/a.ts'),'export const a=1;');f.put(join(f.root,'src/b.ts'),'export const b=1;');const baseMain=f.commit();
 f.git('switch','--quiet','-c','plan/four-races');f.put(join(f.root,'src/a.ts'),'export const a=2;');const testedHead=f.commit();
 const context=capturePushTree('four-races',f.env,f.root);if(context===null)throw new Error('Missing clean fixture');
 const run=source=>execFileSync(process.execPath,['--input-type=module','-e',source],{cwd:f.root,env:f.env,stdio:'pipe'});
 run("import assert from 'node:assert/strict';import{a}from'./src/a.ts';import{b}from'./src/b.ts';assert.equal(a,2);assert.equal(b,1);");
 const full=writePushProof(context,{mode:'full',files:['src/a.ts']},.01),rounds=[];
 let fullGates=1,staticAndAffected=0;
 for(let round=1;round<=4;round++){
  f.git('switch','--quiet','main');f.put(join(f.root,'src/b.ts'),`export const b=${round+1};`);const incomingMain=f.commit();
  f.git('switch','--quiet','plan/four-races');f.git('rebase','--quiet','main');
  const current=capturePushTree('four-races',f.env,f.root);
  if(current===null)throw new Error('Missing rebased fixture context');
  const planned=localDeltaPlan(current,{baseMain,testedHead,incomingMain,head:f.git('rev-parse','HEAD')});
  const recovered=discoverLocalDeltaPlan(current,incomingMain);
  rounds.push({eligible:planned.eligible,recovered:recovered.eligible,reason:planned.reason,run:planned.proof?.run,files:planned.selection?.files});
  expect(f.git('show','HEAD:src/a.ts')).toBe('export const a=2;');
  if(planned.eligible){
   for(const file of ['src/a.ts','src/b.ts'])execFileSync(process.execPath,['--check',file],{cwd:f.root,env:f.env,stdio:'pipe'});
   run(`import assert from 'node:assert/strict';import{b}from'./src/b.ts';assert.equal(b,${round+1});`);staticAndAffected++;
   writePushProof(current,{mode:'full',files:[]},.01,{run:full.run,commit:full.commit});
  }else{
   run(`import assert from 'node:assert/strict';import{a}from'./src/a.ts';import{b}from'./src/b.ts';assert.equal(a,2);assert.equal(b,${round+1});`);fullGates++;
   writePushProof(current,{mode:'full',files:['src/a.ts','src/b.ts']},.01);
  }
 }
 expect(rounds.map(row=>({eligible:row.eligible,reason:row.eligible?'matched':row.reason}))).toEqual(Array.from({length:4},()=>({eligible:true,reason:'matched'})));
 for(const row of rounds){expect(row.recovered).toBe(true);expect(row.run).toBe(full.run);expect(row.files).toEqual(['src/b.ts']);}
 expect({fullGates,staticAndAffected}).toEqual({fullGates:1,staticAndAffected:4});
},60000);

test('reachable npm package bytes bind while node_modules compiler cache output stays stable',()=>{
 const f=fixture(false),consumer=join(f.root,'consumer');
 f.put(join(consumer,'package.json'),'{"name":"nested-consumer"}');
 f.put(join(f.root,'node_modules/.package-lock.json'),'{"lockfileVersion":3}');
 f.put(join(f.root,'node_modules/npm-extra/package.json'),'{"name":"npm-extra","exports":"./index.cjs"}');
 const source=join(f.root,'node_modules/npm-extra/index.cjs');f.put(source,'module.exports=1;');
 const before=pushDependencyIdentity(consumer,f.env);expect(before).not.toBeNull();
 f.put(join(f.root,'node_modules/.cache/compiler/result.json'),'{"derived":1}');
 f.put(join(f.root,'node_modules/.DS_Store'),'finder output');
 f.put(join(f.root,'node_modules/.ignored/old-package/index.js'),'derived ignored install');
 expect(pushDependencyIdentity(consumer,f.env)).toBe(before);
 f.put(source,'module.exports=2;');expect(pushDependencyIdentity(consumer,f.env)).not.toBe(before);
},30000);

test('hidden generated packages remain bound even beside disposable module metadata',()=>{
 const f=fixture(false),consumer=join(f.root,'hidden-consumer');
 f.put(join(consumer,'package.json'),'{"name":"hidden-consumer"}');
 f.put(join(f.root,'node_modules/.package-lock.json'),'{"lockfileVersion":3}');
 const source=join(f.root,'node_modules/.generated/client.cjs');
 f.put(source,'module.exports=1;');
 const load=()=>execFileSync(process.execPath,['-e',"console.log(require('.generated/client.cjs'))"],{cwd:consumer,env:f.env,encoding:'utf8'}).trim();
 expect(load()).toBe('1');const before=pushDependencyIdentity(consumer,f.env);expect(before).not.toBeNull();
 f.put(source,'module.exports=2;');expect(load()).toBe('2');
 expect(pushDependencyIdentity(consumer,f.env)).not.toBe(before);
},30000);

test('a shared-store shim rewritten by another checkout install keeps the identity; its target still binds',()=>{
 const f=fixture(),bin=join(f.root,'store/links/fixture/hash/node_modules/fixture/node_modules/.bin/tool');
 const shim=(checkout,target)=>`#!/bin/sh\nexport NODE_PATH="${join(f.root,'store/links/leaf/hash/node_modules')}:${checkout}/node_modules/.pnpm/node_modules"\nexec node "$basedir/../${target}/index.cjs" "$@"\n`;
 f.put(bin,shim(join(f.root,'clone-a'),'leaf'));const before=pushDependencyIdentity(f.root,f.env);expect(before).not.toBeNull();
 f.put(bin,shim(join(f.root,'clone-b'),'leaf'));expect(pushDependencyIdentity(f.root,f.env)).toBe(before);
 f.put(bin,shim(f.root,'leaf'));expect(pushDependencyIdentity(f.root,f.env)).toBe(before);
 f.put(bin,shim(join(f.root,'clone-b'),'other'));expect(pushDependencyIdentity(f.root,f.env)).not.toBe(before);
},30000);
