import assert from 'node:assert/strict';
import {afterEach,test,vi} from 'vitest';
import {chmodSync,existsSync,lstatSync,mkdirSync,readFileSync,rmSync,symlinkSync,writeFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {resolve,join} from 'node:path';
import {observerArguments,observerIdentities,runObserver} from '../src/scripts/mmo-release-observer.mjs';
import {observerCommand} from '../src/scripts/mmo-observer-client.mjs';

const cleanups:(()=>void|Promise<void>)[]=[];
afterEach(async()=>{for(const cleanup of cleanups.splice(0).reverse())await cleanup();});
function folder(){
 const root=resolve(process.env['VITEST_TMP_ROOT']??'tmp/vitest',`child-${randomUUID()}`);mkdirSync(root,{recursive:true});
 cleanups.push(()=>rmSync(root,{recursive:true}));return root;
}
test('CLI is staging only, bounded and below its own checkout tmp',()=>{
 const root=resolve('.');
 assert.throws(()=>observerArguments(['production','--work-dir','tmp/lane'],root),/usage/u);
 assert.throws(()=>observerArguments(['staging','--seconds','3601','--work-dir','tmp/lane'],root),/5..3600/u);
 assert.throws(()=>observerArguments(['staging','--work-dir','../elsewhere'],root),/below/u);
 assert.throws(()=>observerArguments(['staging','--work-dir','tmp'],root),/below/u);
 assert.deepEqual(observerArguments(['staging','--seconds','180','--work-dir','tmp/lane'],root),{seconds:180,base:resolve('tmp/lane')});
});
test('scratch symlinks cannot write outside the selected checkout',async()=>{
 const base=folder(),root=join(base,'checkout'),outside=join(base,'outside');
 mkdirSync(join(root,'tmp'),{recursive:true});mkdirSync(outside);symlinkSync(outside,join(root,'tmp/link'));
 await assert.rejects(runObserver(['staging','--work-dir','tmp/link/run'],root),/outside/u);
 assert.equal(existsSync(join(outside,'run')),false);
});
test('a normal owned command closes its log and returns its actual status',async()=>{
 const cwd=folder(),log=join(cwd,'command.log');
 const code=await observerCommand(process.execPath,['--eval',"console.log('native child complete')"],{cwd,signal:new AbortController().signal,log});
 assert.equal(code,0);assert.match(readFileSync(log,'utf8'),/native child complete/u);
});
test('cancellation kills the owned group including a stubborn descendant and clears only its store marker',{timeout:15000},async()=>{
 const cwd=folder(),log=join(cwd,'command.log'),users=join(cwd,'store-users'),pidFile=join(cwd,'pids.json'),ready=join(cwd,'ready');
 mkdirSync(users);writeFileSync(join(users,'foreign.json'),'preserve');
 const old=process.env['WS_STORE_USERS'];process.env['WS_STORE_USERS']=users;
 cleanups.push(()=>{if(old===undefined)delete process.env['WS_STORE_USERS'];else process.env['WS_STORE_USERS']=old;});
 const what=`probe-${randomUUID()}`,controller=new AbortController();
 const descendant="process.on('SIGTERM',()=>{});require('node:fs').writeFileSync("+JSON.stringify(ready)+",'ready');setInterval(()=>{},1000);";
 const script="const fs=require('node:fs');const child=require('node:child_process').spawn(process.execPath,['--eval',"+JSON.stringify(descendant)+"],{stdio:'ignore'});"+
  'fs.writeFileSync('+JSON.stringify(pidFile)+",JSON.stringify({parent:process.pid,descendant:child.pid}));"+
  'fs.writeFileSync('+JSON.stringify(users)+"+'/'+process.pid+'.json',JSON.stringify({pid:process.pid,what:"+JSON.stringify(what)+",at:Date.now()}));setInterval(()=>{},1000);";
 const completed=observerCommand(process.execPath,['--eval',script],{cwd,signal:controller.signal,log,storeUse:what}).then(code=>({code,error:null}),error=>({code:null,error:error as Error}));
 try{
  await vi.waitFor(()=>{assert.ok(existsSync(ready),'Owned child did not become ready');},{timeout:5000});
  const pids=JSON.parse(readFileSync(pidFile,'utf8')) as {parent:number;descendant:number};controller.abort();
  const result=await completed;assert.equal(result.error?.name,'AbortError');
  await new Promise<void>(resolve=>{setTimeout(resolve,50);});
  const observed=spawnSync('ps',['-p',`${pids.parent},${pids.descendant}`,'-o','stat='],{encoding:'utf8'});
  assert.ok(observed.status===0||observed.status===1);const states=observed.stdout.trim();
  assert.ok(states===''||states.split('\n').every(state=>state.trim().startsWith('Z')),states);
  assert.equal(existsSync(join(users,`${pids.parent}.json`)),false);assert.equal(readFileSync(join(users,'foreign.json'),'utf8'),'preserve');
 }finally{controller.abort();await completed;}
});


test('private observer identities survive bounded runs and reject exposed files',()=>{
 const base=folder(),first=observerIdentities(base);
 assert.deepEqual(observerIdentities(base),first);assert.equal(new Set(first).size,2);
 assert.equal(lstatSync(join(base,'identities.json')).mode&0o777,0o600);
 chmodSync(join(base,'identities.json'),0o644);
 assert.throws(()=>observerIdentities(base),/private/u);
});
