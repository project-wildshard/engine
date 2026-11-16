import {nativeObserverClient} from './fixtures/dedicated/nativeObserverClient';
import assert from 'node:assert/strict';
import {afterAll,afterEach,beforeAll,test} from 'vitest';
import {createServer} from 'node:http';
import {createHash,generateKeyPairSync,sign} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {observeRelease,type PreparedObserver} from './fixtures/dedicated/releaseObserver';
import {observationInputs} from '../scripts/mmo-release-observer-inputs.mjs';
import {roomBench} from './fixtures/dedicated/roomBench';
import {ReleaseWatch} from '../src/server/host/dedicated/releaseFile';
import {memoryPlayerSaves} from '../src/server/host/dedicated/playerSaves';

const sourceBuild=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
let connect:PreparedObserver['connect'],prepared:PreparedObserver;
beforeAll(async()=>{prepared=await nativeObserverClient();connect=prepared.connect;});
afterAll(async()=>{await prepared?.dispose?.();});

const closers:(()=>Promise<void>)[]=[];
afterEach(async()=>{for(const close of closers.splice(0).reverse())await close();});
async function fixture(){
 let restart:()=>void=()=>{throw Error('No promotion installed');};
 const saves=memoryPlayerSaves(),first=await roomBench({build:sourceBuild,saves,workers:1,graceMs:80,restart:()=>{restart();}});
 let current=first,serial=1,firstClosed=false;
 closers.push(async()=>{if(!firstClosed)await first.close();if(current!==first)await current.close();});
 const keys=generateKeyPairSync('ed25519'),bytes=Buffer.from('signed observation fixture artifact');
 const release={channel:'staging' as const,serial:1,saveEpoch:1,engineBuild:sourceBuild,shards:[{slug:'driftwood-isle',revision:1}],
  socket:first.url,bundle:{name:'v0.1.0/server.tar.gz',sha256:createHash('sha256').update(bytes).digest('hex')}};
 const state={signature:null as string|null,healthSerial:null as number|null,hang:false,requested:null as (()=>void)|null};
 const server=createServer((request,response)=>{
  if(state.hang){state.requested?.();return;}
  if(request.url==='/release.json'){
   const body=JSON.stringify(release);response.end(JSON.stringify({body,signature:state.signature??sign(null,Buffer.from(body),keys.privateKey).toString('hex')}));return;
  }
  if(request.url==='/health'){response.end(JSON.stringify({...current.world.health(),serial:state.healthSerial??serial}));return;}
  if(request.url==='/v0.1.0/server.tar.gz'){response.end(bytes);return;}
  response.writeHead(404).end();
 });
 closers.push(async()=>{server.closeAllConnections();await new Promise<void>((resolve,reject)=>{server.close(error=>{if(error)reject(error);else resolve();});});});
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
 const address=server.address();if(address===null||typeof address==='string')throw Error('No fixture port');
 const origin=`http://127.0.0.1:${address.port}`;
 release.socket=`ws://127.0.0.1:${address.port}/`;
 server.on('upgrade',(request,socket,head)=>{current.world.upgrade(request,socket,head);});
 const inputs=observationInputs({publicKey:keys.publicKey.export({format:'der',type:'spki'}).toString('hex'),
  releaseUrl:origin+'/release.json',healthUrl:origin+'/health',bundleOrigin:origin,timeoutMs:2000});
 let disposed=false,connections=0,closed=0;let baselineReady:()=>void=()=>{};
 const playing=new Promise<void>(resolve=>{baselineReady=resolve;});
 const options={read:(signal:AbortSignal)=>inputs.read(signal),prepare:async()=>({sourceBuild,connect:(...args:Parameters<PreparedObserver['connect']>)=>{
  connections++;const bot=connect(...args);return {...bot,close:()=>{closed++;bot.close();}};
 },dispose:async()=>{disposed=true;}}),devices:['device:observer-probe-0','device:observer-probe-1'] as const,durationMs:20000,pollMs:20,
 event:(phase:string)=>{if(phase==='baseline-playing')baselineReady();}};
 let done:()=>void=()=>{},failed:(error:unknown)=>void=()=>{};
 const advanced=new Promise<void>((resolve,reject)=>{done=resolve;failed=reject;});
 restart=()=>{void (async()=>{
  assert.equal(await first.world.drain(),true);await first.close();firstClosed=true;
  current=await roomBench({build:'b'.repeat(40),saves,workers:1});serial=2;
 })().then(done,failed);};
 const watcher=new ReleaseWatch({serving:{...release},everyMs:3600000,
  read:async()=>(await inputs.read()).release,failed:error=>{throw error;},
  changed:async next=>{first.world.beginGrace(next.engineBuild);}});
 closers.push(()=>{watcher.dispose();return Promise.resolve();});
 return {release,state,options,playing,counts:()=>({disposed,connections,closed}),
  async advance(){
   // The signed watch starts the real grace; its expiry drains and boots a new native World.
   Object.assign(release,{serial:2,engineBuild:'b'.repeat(40)});
   await watcher.look();
   await advanced;
  }};
}

test('two real native identities redial after signed serial/build change and clean every client',{timeout:120000},async()=>{
 const f=await fixture();const observed=observeRelease(f.options);
 await Promise.race([f.playing,observed.then(result=>{throw Error('No playing baseline: '+JSON.stringify(result));})]);await f.advance();const result=await observed;
 assert.equal(result.status,'observed',JSON.stringify(result));assert.deepEqual(result.from,{serial:1,build:sourceBuild});
 assert.deepEqual(result.to,{serial:2,build:'b'.repeat(40)});assert.equal(result.clientBuild,sourceBuild);
 assert.deepEqual(result.bots.map(bot=>bot.attempts),[2,2]);
 assert.ok(result.bots.every(bot=>bot.closeReason==='restart'&&bot.backToMovingObservedMs!==null&&bot.after!==null&&bot.after.tick!==null));
 assert.equal(result.continuity,'unknown');assert.equal(result.failedSaves,null);
 assert.deepEqual(f.counts(),{disposed:true,connections:4,closed:4});
});
test('steady native movement without a serial advance is inconclusive',{timeout:120000},async()=>{
 const f=await fixture();
 const result=await observeRelease({...f.options,durationMs:6000});
 assert.equal(result.status,'inconclusive',JSON.stringify(result));assert.equal(result.reason,'no-release-change',JSON.stringify(result));assert.equal(result.to,null);
 assert.deepEqual(f.counts(),{disposed:true,connections:2,closed:2});
});
test('operator cancellation closes both native clients',{timeout:120000},async()=>{
 const f=await fixture(),controller=new AbortController();
 const result=await observeRelease({...f.options,event:(phase:string)=>{if(phase==='baseline-playing')controller.abort();},signal:controller.signal});
 assert.equal(result.status,'cancelled',JSON.stringify(result));assert.equal(result.to,null);
 assert.deepEqual(f.counts(),{disposed:true,connections:2,closed:2});
});
test('a mismatched prepared source refuses before native hellos',{timeout:120000},async()=>{
 const f=await fixture();const result=await observeRelease({...f.options,prepare:async()=>({sourceBuild:'c'.repeat(40),connect(){throw Error('No native hello permitted');}})});
 assert.equal(result.status,'refused');assert.equal(result.reason,'client-source-build');assert.equal(f.counts().connections,0);
});


test('native redial waits for the signed new health identity',{timeout:120000},async()=>{
 const f=await fixture();f.state.healthSerial=1;
 const observed=observeRelease(f.options);
 await Promise.race([f.playing,observed.then(result=>{throw Error(JSON.stringify(result));})]);
 await f.advance();
 await new Promise<void>(resolve=>{setTimeout(resolve,100);});
 assert.equal(f.counts().connections,2,'old health must not construct new native clients');
 f.state.healthSerial=2;
 const result=await observed;assert.equal(result.status,'observed',JSON.stringify(result));
 assert.deepEqual(f.counts(),{disposed:true,connections:4,closed:4});
});
test('a bad signed change refuses while both real native links are owned',{timeout:120000},async()=>{
 const f=await fixture();
 const result=await observeRelease({...f.options,event:phase=>{if(phase==='baseline-playing')f.state.signature='00'.repeat(64);}});
 assert.equal(result.status,'refused');assert.equal(result.reason,'signed-release');
 assert.deepEqual(f.counts(),{disposed:true,connections:2,closed:2});
});
test('cancellation aborts a hung signed-input read and closes the native pair',{timeout:120000},async()=>{
 const f=await fixture(),controller=new AbortController();
 f.state.requested=()=>{controller.abort();};
 const result=await observeRelease({...f.options,signal:controller.signal,event:phase=>{if(phase==='baseline-playing')f.state.hang=true;}});
 assert.equal(result.status,'cancelled',JSON.stringify(result));
 assert.deepEqual(f.counts(),{disposed:true,connections:2,closed:2});
});
