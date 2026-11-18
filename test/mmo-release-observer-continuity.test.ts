import assert from 'node:assert/strict';
import {test} from 'vitest';
import {observeRelease} from './fixtures/dedicated/releaseObserver';
import {releaseObserverFixtures,sourceBuild} from './fixtures/dedicated/releaseObserverFixtures';

const fixture=releaseObserverFixtures();

test('two real native identities redial after signed serial/build change and clean every client',{timeout:120000},async()=>{
 const f=await fixture();const observed=observeRelease({...f.options,durationMs:6000});
 await Promise.race([f.playing,observed.then(result=>{throw Error('No playing baseline: '+JSON.stringify(result));})]);await f.advance();const result=await observed;
 assert.equal(result.status,'inconclusive',JSON.stringify(result));assert.equal(result.reason,'missing-durable-witness');assert.deepEqual(result.from,{serial:1,build:sourceBuild});
 assert.deepEqual(result.to,{serial:2,build:'b'.repeat(40)});assert.equal(result.clientBuild,sourceBuild);
 assert.deepEqual(result.bots.map(bot=>bot.attempts),[2,2]);
 assert.ok(result.bots.every(bot=>bot.closeReason==='restart'&&bot.backToMovingObservedMs!==null&&bot.after!==null&&bot.after.tick!==null));
 assert.equal(result.continuity,'unknown');assert.equal(result.failedSaves,null);assert.equal(result.saveCompletionTime,null);assert.equal(result.peerWorkers.untouchedWorkerEvidence,null);
 assert.deepEqual(f.counts(),{disposed:true,connections:4,closed:4});
});

test('a signed grace restores both durable checkpoints with native progress',{timeout:120000},async()=>{
 const f=await fixture(true),observed=observeRelease(f.options);
 await Promise.race([f.playing,observed.then(result=>{throw Error(JSON.stringify(result));})]);await f.advance();
 const result=await observed;
 assert.equal(result.status,'observed',JSON.stringify(result));assert.equal(result.continuity,'restored');
 assert.ok(result.bots.every(bot=>bot.before?.checkpoint&&bot.after?.checkpoint&&bot.after.coins===bot.before.coins&&bot.backToMovingObservedMs!==null));
 assert.equal(result.failedSaves,null);assert.equal(result.saveCompletionTime,null);
 assert.equal(result.peerWorkers.kind,'whole-release');assert.equal(result.peerWorkers.untouchedWorkerEvidence,null);
});

test('actual loss in a persisted checkpoint fails the signed native observation',{timeout:120000},async()=>{
 const f=await fixture(true,true),observed=observeRelease(f.options);
 await Promise.race([f.playing,observed.then(result=>{throw Error(JSON.stringify(result));})]);await f.advance();
 const result=await observed;assert.equal(result.status,'failed',JSON.stringify(result));assert.equal(result.reason,'checkpoint-progress-lost');
 assert.equal(result.continuity,'lost');assert.deepEqual(f.counts(),{disposed:true,connections:4,closed:4});
});

test('new persistent progress is inconclusive rather than guessed',{timeout:120000},async()=>{
 const f=await fixture(true,false,'blender-template',true),observed=observeRelease(f.options);
 await Promise.race([f.playing,observed.then(result=>{throw Error(JSON.stringify(result));})]);await f.advance();
 const result=await observed;assert.equal(result.status,'inconclusive',JSON.stringify(result));
 assert.equal(result.reason,'checkpoint-progress-changed');assert.equal(result.continuity,'unknown');
});

test('a target without an actual native redial never claims restored continuity',{timeout:120000},async()=>{
 const f=await fixture(true),observed=observeRelease({...f.options,durationMs:3000});
 await Promise.race([f.playing,observed.then(result=>{throw Error(JSON.stringify(result));})]);
 f.announceWithoutRestart();const result=await observed;
 assert.equal(result.status,'inconclusive',JSON.stringify(result));assert.equal(result.continuity,'unknown');
 assert.equal(result.reason,'redial-incomplete');assert.equal(result.to?.serial,2);
 assert.deepEqual(result.bots.map(bot=>bot.attempts),[1,1]);
});

test('a redial without a newer durable checkpoint stays inconclusive',{timeout:120000},async()=>{
 const f=await fixture(true,false,'blender-template',false,true),observed=observeRelease(f.options);
 await Promise.race([f.playing,observed.then(result=>{throw Error(JSON.stringify(result));})]);await f.advance();
 const result=await observed;assert.equal(result.status,'inconclusive',JSON.stringify(result));
 assert.equal(result.reason,'no-drain-checkpoint');assert.equal(result.continuity,'unknown');
});
