import assert from 'node:assert/strict';
import {afterEach,test,vi} from 'vitest';
import {chmodSync,existsSync,lstatSync,mkdirSync,readFileSync,rmSync,symlinkSync,writeFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {resolve,join} from 'node:path';
import {observerArguments,observerIdentities,runObserver} from '../src/scripts/mmo-release-observer.mjs';
import {observerCommand,prepareObserverClient} from '../src/scripts/mmo-observer-client.mjs';

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

// QA 11-25 row 120: staging's baseline is the build it serves, which can predate the lean layout (f928fdae2). From
// v0.1.94 on, prepare ran src/scripts/build-server.mjs inside v0.1.93's source, which keeps it in the old folder, so the
// observer refused with client-prepare and never armed. Both layouts must build a native client.
function sourceRepo(){
 const root=folder(),git=(...args:string[])=>{const result=spawnSync('git',args,{cwd:root,encoding:'utf8'});assert.equal(result.status,0,result.stderr);return result.stdout.trim();};
 const write=(path:string,body:string)=>{mkdirSync(resolve(root,path,'..'),{recursive:true});writeFileSync(resolve(root,path),body);};
 git('init','--quiet');git('config','user.email','observer@example.invalid');git('config','user.name','observer');git('config','commit.gpgsign','false');
 write('package.json','{"name":"observer-source","private":true}\n');
 write('src/scripts/.kit/worktree.mjs','export function withStoreUse(_env,_what,run){return run();}\n');
 for(const name of ['roomBot.ts','mmoBotsGuard.ts','releaseObserverBot.ts'])write(`test/fixtures/dedicated/${name}`,'export {};\n');
 const builder=["import {mkdirSync,writeFileSync} from 'node:fs';import {parseArgs} from 'node:util';",
  "const {values}=parseArgs({options:{build:{type:'string'},out:{type:'string'},entry:{type:'string',multiple:true}}});",
  "mkdirSync(values.out,{recursive:true});",
  "writeFileSync(values.out+'/releaseObserverBot.mjs','export const sourceBuild='+JSON.stringify(values.build)+';export function connect(){}\\n');"].join('\n');
 const commit=(path:string)=>{write(path,builder);git('add','-A');git('commit','--quiet','--no-verify','-m',path);return git('rev-parse','HEAD');};
 // script-paths: a made-up pre-lean source tree in a scratch repo
 const preLean=commit('scripts/build-server.mjs'); // script-paths: the pre-lean builder
 git('rm','--quiet','scripts/build-server.mjs'); // script-paths: the pre-lean builder
 const lean=commit('src/scripts/build-server.mjs');
 git('rm','--quiet','src/scripts/build-server.mjs');write('README','no builder\n');git('add','-A');git('commit','--quiet','--no-verify','-m','none');
 return {root,preLean,lean,none:git('rev-parse','HEAD')};
}
test('the observer builds a native client from a pre-lean and a lean baseline, and refuses one with no builder',{timeout:60000},async()=>{
 const {root,preLean,lean,none}=sourceRepo(),signal=new AbortController().signal;
 for(const build of [preLean,lean]){
  const work=resolve(root,'tmp',build);mkdirSync(work,{recursive:true});
  const client=await prepareObserverClient({release:{engineBuild:build}} as Parameters<typeof prepareObserverClient>[0],signal,{root,work});
  assert.equal(client.sourceBuild,build);assert.equal(typeof client.connect,'function');
  await client.dispose?.();
 }
 const work=resolve(root,'tmp',none);mkdirSync(work,{recursive:true});
 await assert.rejects(prepareObserverClient({release:{engineBuild:none}} as Parameters<typeof prepareObserverClient>[0],signal,{root,work}),/no build-server\.mjs/u);
});
