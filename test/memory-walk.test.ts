import {expect,test} from 'vitest';
import {allocationSites,CULLER,frameName,routeFor,walkPeak,WALK_ROUTES} from '../scripts/memory/walk.mjs';
import {walkSummary} from '../scripts/memory/measure.mjs';

// MEMORY-STRUCTURE STR18: the walk meter's pure parts. A profile node's self bytes count once, under its own stack; the
// owner is the innermost engine (`src/`) frame, so a three.js leaf is charged to the engine call that reached it.
const frame=(functionName:string,url:string,lineNumber=0)=>({functionName,url,lineNumber,columnNumber:0});
const node=(callFrame:ReturnType<typeof frame>,selfSize:number,children:unknown[]=[])=>({callFrame,selfSize,children});

test('allocation sites: totals, stacks innermost first, engine owners and the culler',()=>{
  const symbol=(f:{functionName:string,url:string,lineNumber:number})=>f.url.startsWith('http')?`${f.functionName} ${f.url.replace(/^https?:\/\/[^/]+\//u,'')}:${String(f.lineNumber+1)}`:null;
  const vec=node(frame('Vector3','http://x/three/build/three.module.js',9),300);
  const level=node(frame('level','http://x/src/client/engine/models/cull.ts',384),500,[vec]);
  const hud=node(frame('paint','http://x/src/client/game/hud/hud.ts',9),200);
  const head=node(frame('(root)',''),0,[node(frame('frame','http://x/src/client/engine/core/Game.ts',99),0,[level,hud])]);
  const sites=allocationSites({head} as never,{symbol,depth:3});
  expect(sites.total).toBe(1000);
  expect(sites.stacks[0]).toEqual({bytes:500,stack:['level src/client/engine/models/cull.ts:385','frame src/client/engine/core/Game.ts:100']});
  expect(sites.stacks[1]?.stack[0]).toBe('Vector3 three/build/three.module.js:10');
  // the three.js leaf is the culler's: its owner is the first src/ frame above it
  expect(sites.owners).toEqual([{site:'level src/client/engine/models/cull.ts:385',bytes:800},{site:'paint src/client/game/hud/hud.ts:10',bytes:200}]);
  expect(sites.allOwners.filter(row=>CULLER.test(row.site)).reduce((t,row)=>t+row.bytes,0)).toBe(800);
  expect(['cullPass src/client/engine/models/place.ts:296','has src/client/game/shardfile/worldScenePlacement.ts:90'].every(site=>CULLER.test(site))).toBe(true);
  expect(['posed src/client/game/shardfile/worldScenePlacement.ts:38','drawInstancedSteps src/client/engine/models/place.ts:618'].some(site=>CULLER.test(site))).toBe(false);
  expect(frameName(frame('','http://x/b/c/chunk-abc.js?v=1',4))).toBe('(anonymous) chunk-abc.js:5:1');
  expect(frameName(frame('step',''))).toBe('step (page script):1:1');
});

test('the walk peak is the walk segment\'s, above settled, per role',()=>{
  const procs=[{pid:1,role:'webcontent'},{pid:2,role:'gpu'},{pid:3,role:'networking'}];
  const segments=[{mark:'settling',samples:3,peak:{'1':900,'2':500,'3':9},last:{'1':800,'2':500,'3':9}},
    {mark:'walk',samples:10,peak:{'1':1100,'2':560,'3':99},last:{'1':950,'2':520,'3':9}}];
  expect(walkPeak(segments,procs,{webcontent:800,gpu:500})).toEqual({peak:{webcontent:1100,gpu:560},last:{webcontent:950,gpu:520},aboveSettled:{webcontent:300,gpu:60},samples:10});
  expect(walkPeak(segments.slice(0,1),procs,{webcontent:800,gpu:500})).toBeNull();
});

test('routes: Nine walks its streets, every other zone spins; a missing reading makes the walk incomplete',()=>{
  expect(routeFor('nine-dragon-stack')).toBe('nine');
  expect(routeFor('pine-hollow')).toBe('spin');
  expect(WALK_ROUTES['spin']).toBeNull();
  expect(WALK_ROUTES['nine']?.points.length).toBeGreaterThan(4);
  const run=(above:number)=>({refused:null,walk:{aboveSettled:{webcontent:above,gpu:1},peak:{webcontent:above+600},route:{stuck:[]}}});
  const sampled=(rate:number)=>({ready:true,bytesPerSecond:rate,cullerBytesPerSecond:rate/10,route:{stuck:[[1,2,3]]}});
  const s=walkSummary([run(100),run(140),run(120)],[sampled(10),sampled(12),sampled(11)]);
  expect(s.complete).toBe(true);
  expect(s.peakAboveSettled.median).toBe(120);
  expect(s.bytesPerSecond.median).toBe(11);
  expect(s.stuck).toEqual([0,0,0,1,1,1]);
  expect(walkSummary([run(100),{refused:'no control'}],[sampled(10)]).complete).toBe(false);
});
