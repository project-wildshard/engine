import assert from 'node:assert/strict';
import {afterAll,afterEach,beforeAll,test} from 'vitest';
import {createServer} from 'node:http';
import {createHash,generateKeyPairSync,sign} from 'node:crypto';
import {build} from 'rolldown';
import {execFileSync} from 'node:child_process';
import {mkdirSync,rmSync} from 'node:fs';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {observeRelease,type PreparedObserver} from './fixtures/dedicated/releaseObserver';
import {observationInputs} from '../scripts/mmo-release-observer-inputs.mjs';
import {roomBench} from './fixtures/dedicated/roomBench';
import {memoryPlayerSaves} from '../src/server/host/dedicated/playerSaves';

const sourceBuild=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim();
const output=resolve('tmp/codex-netlag/native-observer-client');
let connect:PreparedObserver['connect'];
beforeAll(async()=>{
 mkdirSync(output,{recursive:true});
 const require=createRequire(resolve('package.json'));
 const file=resolve(output,'client.mjs');
 await build({input:resolve('test/fixtures/dedicated/releaseObserverBot.ts'),platform:'node',
  plugins:[{name:'observer-native-client',resolveId(source){
   if(/^\.\/rapier_wasm3d(\.js)?$/u.test(source))return resolve('src/server/engine/physics/rapierBindings.ts');
   if(source==='@dimforge/rapier3d-simd')return require.resolve('@dimforge/rapier3d-simd/rapier.js');
   return null;
  }}],transform:{target:'node24',define:{__BUILD_ID__:JSON.stringify(sourceBuild)}},
  output:{file,format:'esm',codeSplitting:false}});
 const native=await import(pathToFileURL(file).href) as PreparedObserver;
 assert.equal(native.sourceBuild,sourceBuild);connect=native.connect;
});
afterAll(()=>{rmSync(output,{recursive:true,force:true});});

const closers:(()=>Promise<void>)[]=[];
afterEach(async()=>{for(const close of closers.splice(0).reverse())await close();});
async function fixture(){
 const saves=memoryPlayerSaves(),first=await roomBench({build:sourceBuild,saves,workers:1});
 let current=first,serial=1,firstClosed=false;
 closers.push(async()=>{if(!firstClosed)await first.close();if(current!==first)await current.close();});
 const keys=generateKeyPairSync('ed25519'),bytes=Buffer.from('signed observation fixture artifact');
 const release={channel:'staging',serial:1,saveEpoch:1,engineBuild:sourceBuild,shards:[{slug:'driftwood-isle',revision:1}],
  socket:first.url,bundle:{name:'v0.1.0/server.tar.gz',sha256:createHash('sha256').update(bytes).digest('hex')}};
 const server=createServer((request,response)=>{
  if(request.url==='/release.json'){
   const body=JSON.stringify(release);response.end(JSON.stringify({body,signature:sign(null,Buffer.from(body),keys.privateKey).toString('hex')}));return;
  }
  if(request.url==='/health'){response.end(JSON.stringify({...current.world.health(),serial}));return;}
  if(request.url==='/v0.1.0/server.tar.gz'){response.end(bytes);return;}
  response.writeHead(404).end();
 });
 closers.push(async()=>{server.closeAllConnections();await new Promise<void>((resolve,reject)=>{server.close(error=>{if(error)reject(error);else resolve();});});});
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
 const address=server.address();if(address===null||typeof address==='string')throw Error('No fixture port');
 const origin=`http://127.0.0.1:${address.port}`;
 const inputs=observationInputs({publicKey:keys.publicKey.export({format:'der',type:'spki'}).toString('hex'),
  releaseUrl:origin+'/release.json',healthUrl:origin+'/health',bundleOrigin:origin,timeoutMs:2000});
 let disposed=false,connections=0,closed=0;let baselineReady:()=>void=()=>{};
 const playing=new Promise<void>(resolve=>{baselineReady=resolve;});
 const options={read:(signal:AbortSignal)=>inputs.read(signal),prepare:async()=>({sourceBuild,connect:(...args:Parameters<PreparedObserver['connect']>)=>{
  connections++;const bot=connect(...args);return {...bot,close:()=>{closed++;bot.close();}};
 },dispose:async()=>{disposed=true;}}),devices:['device:observer-probe-0','device:observer-probe-1'] as const,durationMs:20000,pollMs:20,
 event:(phase:string)=>{if(phase==='baseline-playing')baselineReady();}};
 return {release,options,playing,counts:()=>({disposed,connections,closed}),
  async advance(){
   // Native state-machine control only: ordinary signed release/grace integration is b.3.
   await first.world.drain();await first.close();firstClosed=true;
   current=await roomBench({build:'b'.repeat(40),saves,workers:1});serial=2;
   Object.assign(release,{serial:2,engineBuild:'b'.repeat(40),socket:current.url});
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
