import assert from 'node:assert/strict';
import {afterEach,test} from 'vitest';
import {createServer} from 'node:http';
import {createHash,generateKeyPairSync,sign} from 'node:crypto';
import {observationInputs,ObservationRefusedError} from '../src/scripts/mmo-release-observer-inputs.mjs';

const closes:(()=>Promise<void>)[]=[];
afterEach(async()=>{for(const close of closes.splice(0).reverse())await close();});
async function fixture(){
 const {publicKey,privateKey}=generateKeyPairSync('ed25519'),bytes=Buffer.from('actual signed server artifact');
 const release={channel:'staging',serial:1,saveEpoch:1,engineBuild:'a'.repeat(40),shards:[{slug:'driftwood-isle',revision:1}],
  socket:'ws://127.0.0.1:37900/',bundle:{name:'v0.1.0/server.tar.gz',sha256:createHash('sha256').update(bytes).digest('hex')}};
 const state={release,health:{build:release.engineBuild,serial:1,players:0,cells:1,workers:2},bytes,signature:null as string|null,
  bundleReads:0,healthReads:0,redirectReads:0,redirect:null as string|null,chunked:false,requested:null as (()=>void)|null,unavailable:false};
 const server=createServer((request,response)=>{
  if(request.url===state.redirect){response.writeHead(302,{location:'/redirect-target'}).end();return;}
  if(request.url==='/redirect-target'){state.redirectReads++;response.end(JSON.stringify(state.health));return;}
  if(request.url==='/hang'){state.requested?.();return;}
  if(request.url==='/release.json'){
   if(state.unavailable){response.writeHead(503).end();return;}
   const body=JSON.stringify(state.release);
   response.end(JSON.stringify({body,signature:state.signature??sign(null,Buffer.from(body),privateKey).toString('hex')}));return;
  }
  if(request.url==='/health'){state.healthReads++;response.end(JSON.stringify(state.health));return;}
  if(request.url==='/v0.1.0/server.tar.gz'){
   state.bundleReads++;
   if(state.chunked){response.write(state.bytes.subarray(0,8));response.end(state.bytes.subarray(8));}
   else response.end(state.bytes);
   return;
  }
  response.writeHead(404).end();
 });
 closes.push(async()=>{server.closeAllConnections();await new Promise<void>((resolve,reject)=>{server.close(error=>{if(error)reject(error);else resolve();});});});
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
 const address=server.address();if(address===null||typeof address==='string')throw Error('No fixture port');
 const origin=`http://127.0.0.1:${address.port}`;
 const options={publicKey:publicKey.export({format:'der',type:'spki'}).toString('hex'),releaseUrl:origin+'/release.json',healthUrl:origin+'/health',bundleOrigin:origin,timeoutMs:2000};
 return {state,options};
}
const refused=(code:string)=>(error:unknown)=>error instanceof ObservationRefusedError&&error.code===code;

test('real signed HTTP inputs match health and cache only verified immutable bundle identities',async()=>{
 const {state,options}=await fixture(),input=observationInputs(options);
 const first=await input.read(),second=await input.read();
 assert.equal(first.ready,true);assert.equal(second.verifiedBundle,true);
 assert.equal(first.release.engineBuild,state.health.build);assert.equal(state.bundleReads,1);assert.equal(state.healthReads,2);
 state.release={...state.release,engineBuild:'b'.repeat(40)};
 assert.equal((await input.read()).reason,'health-build');assert.equal(state.bundleReads,2);
});
test('a signed serial advance ahead of health is pending',async()=>{
 const {state,options}=await fixture();state.release.serial=2;
 const next=await observationInputs(options).read();assert.equal(next.ready,false);assert.equal(next.reason,'health-serial');
});
test('bad signatures refuse before artifact or health reads',async()=>{
 const {state,options}=await fixture();state.signature='00'.repeat(64);
 await assert.rejects(observationInputs(options).read(),refused('signed-release'));
 assert.equal(state.bundleReads,0);assert.equal(state.healthReads,0);
});
test('bad artifact bytes refuse and never enter the verified cache',async()=>{
 const {state,options}=await fixture();state.bytes=Buffer.from('wrong artifact');
 const input=observationInputs(options);
 await assert.rejects(input.read(),refused('bundle-hash'));await assert.rejects(input.read(),refused('bundle-hash'));
 assert.equal(state.bundleReads,2);assert.equal(state.healthReads,0);
});
test('production socket metadata refuses before a native hello or artifact read',async()=>{
 const {state,options}=await fixture();state.release.socket='wss://rooms.wildshard.io';
 await assert.rejects(observationInputs(options).read(),refused('socket-target'));
 assert.equal(state.bundleReads,0);assert.equal(state.healthReads,0);
});
test('signed traversal bundle paths refuse',async()=>{
 const {state,options}=await fixture();state.release.bundle.name='../server.tar.gz';
 await assert.rejects(observationInputs(options).read(),refused('bundle-path'));assert.equal(state.bundleReads,0);
});
test('stream byte bounds hold without Content-Length',async()=>{
 const {state,options}=await fixture();state.chunked=true;
 await assert.rejects(observationInputs({...options,maxArtifactBytes:4}).read(),refused('input-bytes'));
});
test('Content-Length is bounded before consuming the artifact',async()=>{
 const {options}=await fixture();
 await assert.rejects(observationInputs({...options,maxArtifactBytes:4}).read(),refused('input-bytes'));
});
test('a hung metadata response obeys the deadline',async()=>{
 const {options}=await fixture();options.releaseUrl=options.releaseUrl.replace('release.json','hang');
 await assert.rejects(observationInputs({...options,timeoutMs:50}).read(),(error:unknown)=>error instanceof Error&&error.name==='TimeoutError');
});
test('caller cancellation reaches a request already in flight',async()=>{
 const {state,options}=await fixture(),controller=new AbortController();
 options.releaseUrl=options.releaseUrl.replace('release.json','hang');
 const requested=new Promise<void>(resolve=>{state.requested=resolve;});
 const read=observationInputs(options).read(controller.signal);const refused=assert.rejects(read,(error:unknown)=>error instanceof Error&&error.name==='AbortError');
 await requested;controller.abort();await refused;
});
test('headroom excludes four human seats and prevents a full admission',async()=>{
 const {state,options}=await fixture();state.health.players=11;
 assert.equal((await observationInputs(options).read()).reason,'seats');
 state.health.players=10;assert.equal((await observationInputs(options).read()).ready,true);
});
test('malformed health is fatal rather than a claimed binding',async()=>{
 const {state,options}=await fixture();state.health.players=-1;
 await assert.rejects(observationInputs(options).read(),refused('health-metadata'));
});
test('a temporarily drained or booting world is pending, never ready or malformed',async()=>{
 const {state,options}=await fixture();state.health.workers=0;
 const input=observationInputs(options);assert.equal((await input.read()).reason,'health-starting');
 state.health.workers=2;state.health.cells=0;assert.equal((await input.read()).ready,false);
});
test('an ordinary endpoint outage remains distinguishable from authenticated refusal',async()=>{
 const {state,options}=await fixture();state.unavailable=true;
 await assert.rejects(observationInputs(options).read(),(error:unknown)=>error instanceof Error&&!(error instanceof ObservationRefusedError)&&/503/u.test(error.message));
});
test('remote overrides cannot select production or unrelated observation hosts',()=>{
 assert.throws(()=>observationInputs({publicKey:'00',releaseUrl:'https://packs.wildshard.io/releases/production.json'}),/staging only/u);
 assert.throws(()=>observationInputs({publicKey:'00',healthUrl:'https://example.test/health'}),/staging only/u);
});


for(const path of ['/release.json','/health'])test(`unsigned redirect from ${path} never reaches its destination`,async()=>{
 const {state,options}=await fixture();state.redirect=path;
 await assert.rejects(observationInputs(options).read());assert.equal(state.redirectReads,0);
});


test('seat headroom subtracts only native observers already playing on this serial',async()=>{
 const {state,options}=await fixture(),input=observationInputs(options);state.health.players=12;
 assert.equal((await input.read()).reason,'seats');
 assert.equal((await input.read(undefined,[1,1])).ready,true);
 assert.equal((await input.read(undefined,[2,2])).reason,'seats');
 state.health.players=13;assert.equal((await input.read(undefined,[1,1])).reason,'seats');
 await assert.rejects(input.read(undefined,[1,1,1]),/generations/u);
});
