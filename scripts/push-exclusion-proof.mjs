// Real Git policy introduction, actual clock expiry and a restored failing test.
import assert from 'node:assert/strict';
import {execFileSync,spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {chmodSync,existsSync,mkdirSync,mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {delimiter,join,resolve as resolvePath} from 'node:path';
import {pathToFileURL} from 'node:url';

const engine=resolvePath(process.argv.find(arg=>arg.startsWith('--engine='))?.slice(9)??'.');
const directory=resolvePath(process.argv.find(arg=>arg.startsWith('--out='))?.slice(6)??'tmp/push-exclusion-proof');mkdirSync(directory,{recursive:true});
const work=mkdtempSync(join(directory,'run-')),began=performance.now();
const {capturePushTree,readPushProof,writePushProof}=await import(pathToFileURL(join(engine,'scripts/push-proof-cache.mjs')).href);
const {readLiftPending}=await import(pathToFileURL(join(engine,'scripts/lift-pending.mjs')).href);
const selected=process.argv.find(arg=>arg.startsWith('--case='))?.slice(7);
/** @type {string[]} */const executed=[];
/** @param {string} name @param {number} seconds */
function fixture(name,seconds){
 const repo=join(work,name);mkdirSync(join(repo,'test'),{recursive:true});
 const admitted=(Math.floor(Date.now()/1000)-1)*1000,deadline=new Date(admitted+seconds*1000).toISOString();
 const env={...process.env,GIT_COMMITTER_DATE:new Date(admitted).toISOString()};
 /** @param {string[]} args */
 const git=args=>execFileSync('git',['-c','user.name=Exclusion proof','-c','user.email=proof@example.test',...args],{cwd:repo,env,encoding:'utf8'}).trim();
 git(['init','--quiet','--initial-branch=main']);
 const inventory=join(repo,'test/lift-pending.json'),policyFile=join(repo,'test/lift-pending-policy.json');
 const files='["test/hidden.test.mjs"]\n';writeFileSync(inventory,files);
 const policy={schema:1,owner:'codex-mock',registeredAt:new Date(admitted).toISOString(),deadline,inventorySha256:createHash('sha256').update(files).digest('hex'),reason:'Disposable real exclusion policy with immutable introducing Git timestamp for cache expiry proof.'};writeFileSync(policyFile,JSON.stringify(policy));
 writeFileSync(join(repo,'test/visible.test.mjs'),"import assert from'node:assert/strict';assert.equal(1+1,2);");
 writeFileSync(join(repo,'test/hidden.test.mjs'),"throw new Error('restored excluded fixture executed');");
 writeFileSync(join(repo,'gate.mjs'),`import{execFileSync}from'node:child_process';import{readLiftPending}from${JSON.stringify(pathToFileURL(join(engine,'scripts/lift-pending.mjs')).href)};const excluded=readLiftPending(process.cwd()).excluded;for(const file of ['test/visible.test.mjs','test/hidden.test.mjs'])if(!excluded.includes(file))execFileSync(process.execPath,[file],{stdio:'inherit'});`);
 git(['add','test/lift-pending.json','test/lift-pending-policy.json','test/visible.test.mjs','test/hidden.test.mjs','gate.mjs']);git(['commit','--quiet','-m','introduce policy']);
 assert.deepEqual(readLiftPending(repo).excluded,['test/hidden.test.mjs']);
 const context=capturePushTree('exclusion-proof-v1',{PATH:process.env.PATH},repo);assert.ok(context);
 execFileSync(process.execPath,['gate.mjs'],{cwd:repo,stdio:'pipe'});writePushProof(context,{mode:'full',files:[]},.01);assert.ok(readPushProof(context,{mode:'full',files:[]}));
 return {repo,deadline,policyFile,policy,inventory,context,git};
}
/** Delay the last real Git metadata read across the real deadline. Git's
 * bytes/results are untouched; only its process scheduling is constrained.
 * @param {ReturnType<typeof fixture>} f @param {()=>unknown} action */
function crossDeadlineDuringGit(f,action){
 const actualGit=execFileSync('which',['git'],{encoding:'utf8'}).trim(),bin=`${f.repo}-git-bin`,marker=`${f.repo}-crossed`;
 mkdirSync(bin);const wrapper=join(bin,'git');
 writeFileSync(wrapper,`#!${process.execPath}\nimport{spawnSync}from'node:child_process';import{writeFileSync}from'node:fs';if(process.argv.includes('--format=%ct')){Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,Math.max(0,${Date.parse(f.deadline)}-Date.now()+25));writeFileSync(${JSON.stringify(marker)},String(Date.now()));}const child=spawnSync(${JSON.stringify(actualGit)},process.argv.slice(2),{stdio:'inherit'});process.exitCode=child.status??1;`);chmodSync(wrapper,0o755);
 const before=process.env.PATH;process.env.PATH=[bin,before??''].join(delimiter);
 try{return action();}finally{
  if(before===undefined)delete process.env.PATH;else process.env.PATH=before;
  assert.ok(existsSync(marker),'Real final Git read must cross the deadline');assert.ok(Number(readFileSync(marker,'utf8'))>=Date.parse(f.deadline));
 }
}
try{
 if(selected===undefined||selected==='expiry'){
  const f=fixture('expiry',4);
  const delay=Math.max(0,Date.parse(f.deadline)-Date.now()+25);await new Promise(resolve=>{setTimeout(resolve,delay);});
  assert.deepEqual(readLiftPending(f.repo).excluded,[]);
  const actual=spawnSync(process.execPath,['gate.mjs'],{cwd:f.repo,encoding:'utf8'});assert.notEqual(actual.status,0);assert.match(actual.stderr,/restored excluded fixture executed/u);
  assert.equal(readPushProof(f.context,{mode:'full',files:[]}),null,'Real expiry must invalidate a previously captured proof context');
  const fresh=capturePushTree('exclusion-proof-v1',{PATH:process.env.PATH},f.repo);assert.ok(fresh);assert.equal(readPushProof(fresh,{mode:'full',files:[]}),null);
  assert.throws(()=>writePushProof(f.context,{mode:'full',files:[]},.01),/exclusion scope changed/u);
  const stored=JSON.parse(readFileSync(f.context.file,'utf8'));assert.deepEqual(stored.exclusions,{files:['test/hidden.test.mjs'],deadline:f.deadline});
  executed.push('expiry');
 }
 if(selected===undefined||selected==='set'){
  const f=fixture('set',60),files='[]\n';writeFileSync(f.inventory,files);writeFileSync(f.policyFile,JSON.stringify({...f.policy,inventorySha256:createHash('sha256').update(files).digest('hex')}));f.git(['commit','--quiet','-m','restore inventory','--','test/lift-pending.json','test/lift-pending-policy.json']);
  assert.deepEqual(readLiftPending(f.repo).excluded,[]);assert.equal(readPushProof(f.context,{mode:'full',files:[]}),null,'A changed exclusion set cannot reuse the old proof');
  executed.push('set');
 }
 if(selected===undefined||selected==='deadline'){
  const f=fixture('deadline',60);
  assert.throws(()=>writePushProof({...f.context,exclusions:{...f.context.exclusions,deadline:null}},{mode:'full',files:[]},.01),/exclusion scope changed/u,'A J237 no-time-transition state cannot be forged for a finite legacy deadline');
  writeFileSync(f.policyFile,JSON.stringify({...f.policy,deadline:new Date(Date.parse(f.deadline)+1000).toISOString()}));
  assert.equal(readPushProof(f.context,{mode:'full',files:[]}),null,'Changed or invalid immutable deadline must invalidate the old context');
  executed.push('deadline');
 }
 if(selected==='read-boundary'){
  const f=fixture('read-boundary',4),proof=crossDeadlineDuringGit(f,()=>readPushProof(f.context,{mode:'full',files:[]}));
  assert.equal(proof,null,'A deadline crossed inside real Git validation must invalidate reuse');executed.push('read-boundary');
 }
 if(selected==='write-boundary'){
  const f=fixture('write-boundary',4);assert.throws(()=>crossDeadlineDuringGit(f,()=>writePushProof(f.context,{mode:'full',files:[]},.01)),/exclusion scope changed/u);executed.push('write-boundary');
 }
 console.log(JSON.stringify({cases:executed,actualClockAndGit:true,seconds:(performance.now()-began)/1000}));
}finally{rmSync(work,{recursive:true,force:true});}
