// Actual Git pre-push must reuse the same checked tree and compiler environment.
import assert from 'node:assert/strict';
import {execFileSync,spawnSync} from 'node:child_process';
import {chmodSync,mkdirSync,mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {delimiter,join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';

const directory=resolve(process.argv[2]??'tmp/push-cache-git-proof');mkdirSync(directory,{recursive:true});
const work=mkdtempSync(join(directory,'run-')),repo=join(work,'repo'),remote=join(work,'remote.git');mkdirSync(repo);
try{
 const env={...process.env};for(const key of Object.keys(env))if(key.startsWith('GIT_'))Reflect.deleteProperty(env,key);
 /** @param {string[]} args */
 const git=args=>execFileSync('git',['-c','user.name=Git cache proof','-c','user.email=proof@example.test',...args],{cwd:repo,env,encoding:'utf8'}).trim();
 git(['init','--quiet']);git(['init','--bare','--quiet',remote]);
 writeFileSync(join(repo,'value.json'),'{"value":1}');git(['add','value.json']);git(['commit','--quiet','-m','fixture']);git(['remote','add','origin',remote]);
 const budget=pathToFileURL(resolve('.githooks/push-checks.mjs')).href,cache=pathToFileURL(resolve('scripts/push-proof-cache.mjs')).href;
 const runner=join(work,'gate.mjs'),hook=join(repo,'.git/hooks/pre-push');
 writeFileSync(runner,`import assert from 'node:assert/strict';import {readFileSync,writeFileSync} from 'node:fs';import {createHash} from 'node:crypto';import {pushEnvironment} from ${JSON.stringify(budget)};import {capturePushTree,readPushProof,writePushProof} from ${JSON.stringify(cache)};
export function gate(phase){const env=pushEnvironment(Object.fromEntries(Object.entries(process.env).filter(([key])=>!key.startsWith('GIT_'))));const context=capturePushTree('git-proof-v1',env);assert.ok(context);const selection={mode:'full',files:['value.json']},keys=Object.fromEntries(Object.entries(env).map(([key,value])=>[key,createHash('sha256').update(value??'').digest('hex')])),keyFile=${JSON.stringify(join(work,'environment-keys.json'))};if(phase==='write'){assert.equal(JSON.parse(readFileSync('value.json')).value,1);writePushProof(context,selection,.01);writeFileSync(keyFile,JSON.stringify(keys));const again=capturePushTree('git-proof-v1',pushEnvironment(env));assert.ok(again);assert.ok(readPushProof(again,selection),'normalization must be idempotent');for(const key of ['CPATH','LIBRARY_PATH','MANPATH','SDKROOT']){const changed=capturePushTree('git-proof-v1',{...env,[key]:(env[key]??'')+'/different'});assert.ok(changed);assert.equal(readPushProof(changed,selection),null,key+' must remain fingerprinted');}}else{if(readPushProof(context,selection)===null){const before=JSON.parse(readFileSync(keyFile));console.error('changed environment keys: '+[...new Set([...Object.keys(before),...Object.keys(keys)])].filter(key=>before[key]!==keys[key]).join(','));}assert.ok(readPushProof(context,selection),'real Git hook must reuse the proved compiler environment');console.log('actual Git exact-tree proof reused');}}
if(process.argv[2]==='write')gate('write');`);
 writeFileSync(hook,`#!/usr/bin/env node\nimport {gate} from ${JSON.stringify(pathToFileURL(runner).href)};gate('reuse');\n`);chmodSync(hook,0o755);
 const first=spawnSync(process.execPath,[runner,'write'],{cwd:repo,env,encoding:'utf8',timeout:5000});assert.equal(first.status,0,first.stderr);
 const pushed=spawnSync('git',['push','origin','HEAD:main'],{cwd:repo,env,encoding:'utf8',timeout:5000});assert.equal(pushed.status,0,pushed.stderr);
 assert.match(pushed.stdout,/actual Git exact-tree proof reused/u);
 const published=git(['rev-parse','HEAD']);git(['commit','--quiet','--allow-empty','-m','same tree']);
 const changed={...env,CPATH:[...(env.CPATH===undefined?[]:[env.CPATH]),join(work,'other-headers')].join(delimiter)};
 const refused=spawnSync('git',['push','origin','HEAD:main'],{cwd:repo,env:changed,encoding:'utf8',timeout:5000});assert.notEqual(refused.status,0);assert.match(refused.stderr,/real Git hook must reuse/u);
 assert.equal(git(['--git-dir',remote,'rev-parse','refs/heads/main']),published,'Changed compiler input must not publish');
 const rechecked=spawnSync(process.execPath,[runner,'write'],{cwd:repo,env:changed,encoding:'utf8',timeout:5000});assert.equal(rechecked.status,0,rechecked.stderr);
 const recovered=spawnSync('git',['push','origin','HEAD:main'],{cwd:repo,env:changed,encoding:'utf8',timeout:5000});assert.equal(recovered.status,0,recovered.stderr);
 console.log(JSON.stringify({actualGitPushes:2,sameTree:true,reused:true,changedCompilerRefused:true,newCompilerRechecked:true,sdkInputsRetained:4}));
}finally{rmSync(work,{recursive:true,force:true});}
