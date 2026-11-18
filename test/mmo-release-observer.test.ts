import assert from 'node:assert/strict';
import {test} from 'vitest';
import {observeRelease} from './fixtures/dedicated/releaseObserver';
import {releaseObserverFixtures} from './fixtures/dedicated/releaseObserverFixtures';

const fixture=releaseObserverFixtures();

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
 const observed=observeRelease({...f.options,durationMs:6000});
 await Promise.race([f.playing,observed.then(result=>{throw Error(JSON.stringify(result));})]);
 await f.advance();
 await new Promise<void>(resolve=>{setTimeout(resolve,100);});
 assert.equal(f.counts().connections,2,'old health must not construct new native clients');
 f.state.healthSerial=2;
 const result=await observed;assert.equal(result.status,'inconclusive',JSON.stringify(result));assert.equal(result.reason,'missing-durable-witness');
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

test('cleanup failure preserves a failed report after attempting every native close',{timeout:120000},async()=>{
 const f=await fixture(),controller=new AbortController();
 const result=await observeRelease({...f.options,signal:controller.signal,
  prepare:async()=>({...await f.options.prepare(),dispose:async()=>{throw Error('Controlled cleanup failure');}}),
  event:phase=>{if(phase==='baseline-playing')controller.abort();}});
 assert.equal(result.status,'failed');assert.equal(result.reason,'cleanup-failed');assert.equal(result.continuity,'unknown');
 assert.equal(f.counts().closed,2);assert.ok(result.faults.includes('cleanup-failed'));
});
