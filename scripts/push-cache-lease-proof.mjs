// Same real tree and two real authenticated leases must reuse one green proof.
import assert from 'node:assert/strict';
import {execFileSync,spawnSync} from 'node:child_process';
import {mkdirSync,mkdtempSync,rmSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';

const directory=resolve(process.argv[2]??'tmp/push-cache-lease-proof');mkdirSync(directory,{recursive:true});
const work=mkdtempSync(join(directory,'run-')),repo=join(work,'repo');mkdirSync(repo);
try{
 /** @param {string[]} args */
 const git=args=>execFileSync('git',['-c','user.name=Lease proof','-c','user.email=proof@example.test',...args],{cwd:repo,encoding:'utf8'}).trim();
 git(['init','--quiet']);writeFileSync(join(repo,'value.json'),'{"value":1}');git(['add','value.json']);git(['commit','--quiet','-m','fixture']);
 const module=pathToFileURL(resolve('scripts/push-proof-cache.mjs')).href,runner=join(work,'gate.mjs');
 writeFileSync(runner,`import assert from'node:assert/strict';import{readFileSync}from'node:fs';import{capturePushTree,readPushProof,writePushProof}from'${module}';const context=capturePushTree('proof-v1',process.env);assert.ok(context);const selection={mode:'full',files:['value.json']};if(process.argv[2]==='first'){assert.equal(JSON.parse(readFileSync('value.json')).value,1);writePushProof(context,selection,.01);}else assert.ok(readPushProof(context,selection),'same tree must reuse across actual lease lifetimes');`);
 for(const phase of ['first','second']){
  const env={...process.env,WS_FULL_SUITE:'1',WS_HEAVY_ROOT:join(work,'heavy'),WS_HEAVY_SCHEDULER_ROOT:join(work,'heavy')};Reflect.deleteProperty(env,'WS_HEAVY_TOKEN');
  const result=spawnSync('python3',[resolve('scripts/heavy-lane.py'),'full-test','--',process.execPath,runner,phase],{cwd:repo,env,encoding:'utf8',timeout:10000});
  assert.equal(result.status,0,result.stderr);
 }
 console.log(JSON.stringify({sameTree:true,twoRealLeases:true,reused:true}));
}finally{rmSync(work,{recursive:true,force:true});}
