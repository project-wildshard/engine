import {expect,test} from 'vitest';
import {allocationSites,CULLER,frameName,routeFor,walkPeak,WALK_ROUTES} from '../src/scripts/memory/walk.mjs';
import {bootZoneEntry,loopbackWorld,MIN_WALK_METRES_PER_SECOND,rigCatalogue,walkSummary,walkSummaryLines} from '../src/scripts/memory/measure.mjs';
// oxlint-disable-next-line import/no-nodejs-modules -- the walk's own sources, read as text
import {readFileSync} from 'node:fs';

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

test('the walk ratchet (BC11): the rate is judged through the verdict and fails only when a re-measure agrees; the bimodal peak is reported',async()=>{
  const {bimodal,compareWalk,parseWalkBaseline,reportedLines,walkMeasures,walkVerdict}=await import('../src/scripts/memory/walkRatchet.mjs');
  const {readCaps}=await import('../src/scripts/budgets/files.mjs');
  const baseline=parseWalkBaseline({version:3,mode:'walk',boot:'online',zone:'nine-dragon-stack',seconds:60,runs:3,source:'abc',
    peak:{value:200e6,spread:300e6,judged:false,why:'bimodal'}});
  const judging=(rate:number,contentKey='nine-dragon-stack@3')=>({contentKey,budgets:{caps:readCaps(),baselines:{schema:1,about:'',baselines:{
    'walk/nine-dragon-stack/rate':{value:rate,contentKey:'nine-dragon-stack@3'}}}}});
  const pinned=judging(7e6);
  const read=(rate:number,peak:number)=>({complete:true,bytesPerSecond:{median:rate,min:rate-1e5,max:rate+1e5,n:3},peakAboveSettled:{median:peak,min:peak-5e7,max:peak+5e7,n:3}});
  // the soft line is the pinned rate plus 10%: 7.7 MB/s
  expect(compareWalk(baseline,read(7.69e6,900e6),pinned)).toBeNull();
  expect(compareWalk(baseline,read(7.8e6,200e6),pinned)).toMatch(/allocation 7\.80 MB\/s > 7\.70 MB\/s \(regressed, pinned 7\.00 MB\/s/u);
  // a slow walk's floor: 5 MB over the 60 s walk, more than 10% of 0.5 MB/s
  expect(compareWalk(baseline,read(0.58e6,1),judging(0.5e6))).toBeNull();
  expect(compareWalk(baseline,read(0.59e6,1),judging(0.5e6))).toMatch(/allocation 0\.59 MB\/s > 0\.58 MB\/s/u);
  // a new Nine revision moves its own line
  expect(compareWalk(baseline,read(20e6,1),judging(7e6,'nine-dragon-stack@4'))).toBeNull();
  expect(walkVerdict(baseline,read(7e6,1),null,pinned).state).toBe('pass');
  expect(walkVerdict(baseline,read(7.8e6,1),read(7.1e6,1),pinned).state).toBe('spike');
  expect(walkVerdict(baseline,read(7.8e6,1),null,pinned).state).toBe('spike');
  expect(walkVerdict(baseline,read(7.8e6,1),read(7.9e6,1),pinned)).toMatchObject({state:'fail',failure:expect.stringMatching(/7\.90 MB\/s/u)});
  // a judged peak fails past its baseline plus max(10%, 5 MB)
  const judged=parseWalkBaseline({...baseline,peak:{value:200e6,spread:10e6,judged:true}});
  expect(compareWalk(judged,read(7e6,219e6),pinned)).toBeNull();
  expect(compareWalk(judged,read(7e6,221e6),pinned)).toMatch(/peak above settled 221 MB > 220 MB/u);
  expect(()=>compareWalk(baseline,{...read(1,1),complete:false},pinned)).toThrow(/completed/u);
  expect(bimodal([21e6,294e6,335e6])).toBe(true); expect(bimodal([150e6,160e6,170e6])).toBe(false);
  expect(reportedLines(baseline,read(7e6,294e6),[21e6,294e6,335e6])[0]).toMatch(/not judged: bimodal.*21, 294, 335 MB \(two modes\)/u);
  expect(reportedLines(judged,read(7e6,1),[1])).toEqual([]);
  // the run's measures, for src/scripts/budgets/cli.mjs record --run
  expect(walkMeasures(baseline,read(6.5e6,300e6),'nine-dragon-stack@3')).toEqual({'walk/nine-dragon-stack/rate':{value:6.5e6,contentKey:'nine-dragon-stack@3'}});
  // a reading not judged says why; the rate's baseline lives in budgets/baselines.json now
  expect(()=>parseWalkBaseline({...baseline,peak:{value:1,spread:5,judged:false}})).toThrow(/says why/u);
  expect(()=>parseWalkBaseline({...baseline,version:2})).toThrow(/Invalid walk ratchet baseline/u);
});

test('the committed walk baseline parses: Nine, online, its rate recorded in budgets/baselines.json',async()=>{
  const {walkBaseline}=await import('../src/scripts/memory/walkRatchet.mjs');
  const {readBaselines}=await import('../src/scripts/budgets/files.mjs');
  const baseline=walkBaseline();
  expect(baseline.zone).toBe('nine-dragon-stack');
  expect(baseline.runs).toBeGreaterThanOrEqual(3);
  expect(readBaselines().baselines[`walk/${baseline.zone}/rate`]).toMatchObject({contentKey:expect.stringMatching(/^nine-dragon-stack@\d+$/u)});
});

// Meta QA 11-26 row 75: Chromium's Local Network Access check denied the online page's cross-origin loopback read of the rig's
// release.json, so every hosted walk sat at loading step `server` until its timeout, and walk-ci only warned. The walk's
// Chromium context grants the page origin `local-network-access` before its page opens, and a walk that never completed fails.
test('QA 11-26 row 75: the online walk grants loopback access before its page, and an incomplete walk is a red',async()=>{
  const grants:[string[],{origin:string}][]=[];
  const context={grantPermissions:async(permissions:string[],options:{origin:string})=>{grants.push([permissions,options]);}};
  await loopbackWorld(context,'http://127.0.0.1:51930/',{release:'http://127.0.0.1:51931/release.json',key:'k'});
  expect(grants).toEqual([[['local-network-access'],{origin:'http://127.0.0.1:51930'}]]);
  await loopbackWorld(context,'http://127.0.0.1:51930/',null);
  expect(grants,'a standalone boot reads nothing cross-origin').toHaveLength(1);
  const measure=readFileSync('src/scripts/memory/measure.mjs','utf8');
  const walk=measure.slice(measure.indexOf('export async function chromiumWalk'));
  expect(walk.indexOf('await loopbackWorld(context, url, world)')).toBeGreaterThan(0);
  expect(walk.indexOf('await loopbackWorld(context, url, world)')).toBeLessThan(walk.indexOf('context.newPage()'));
  const ci=readFileSync('src/scripts/memory/walk-ci.mjs','utf8');
  expect(ci).toMatch(/if \(first === null\) \{[\s\S]{0,400}?process\.exitCode = 1;/u);
  expect(ci).not.toMatch(/::warning title=walk ratchet::\$\{baseline\.zone\} walk did not complete/u);
});

// Meta QA 11-26 row 79: the online boot cut the page's catalogue to the zone's one cell (bootZone), but the rig built its server
// with the checkout's whole grid. A frame names its cell by catalogue order, so the server's frames named Nine cell 7 to a page
// whose only cell is 1: the page never took its owner block, sent no commands, and its player stood still for the whole walk.
// The rig's server now reads the page's one-cell world, and a walk under a metre a second is refused, never judged.
test('QA 11-26 row 79: the online boot\'s server reads the page\'s one-cell world, and a walk that stood still is refused',async()=>{
  // zone-entry.mjs has no declarations: its own test is plain JS
  const entry:string='../src/scripts/zone-entry.mjs';
  const {oneCellPage}=await import(entry) as {oneCellPage:(html:string,zone:string,options:{unplaced:boolean})=>string};
  const cells=['pine-hollow','driftwood-isle','nine-dragon-stack'].map((slug,at)=>({instance:slug,slug,cell:[at,at-1]}));
  const html=`<html><script type="application/json" id="ws-catalogue">${JSON.stringify({version:1,placements:[],grid:{pitch:256,cells}})}</script></html>`;
  const page=oneCellPage(html,'nine-dragon-stack',{unplaced:bootZoneEntry('http://127.0.0.1/','nine-dragon-stack').unplaced});
  const pageCatalogue:unknown=JSON.parse(/id="ws-catalogue">([^<]*)</u.exec(page)?.[1] ?? 'null');
  expect(rigCatalogue(html,'nine-dragon-stack'),'the server\'s cells are the page\'s, in the page\'s order').toEqual(pageCatalogue);
  expect(rigCatalogue(html,'nine-dragon-stack').grid.cells).toEqual([{instance:'nine-dragon-stack',slug:'nine-dragon-stack',cell:[0,0]}]);
  expect(()=>rigCatalogue('<html></html>','nine-dragon-stack')).toThrow(/no ws-catalogue/u);
  const measure=readFileSync('src/scripts/memory/measure.mjs','utf8');
  const boot=measure.slice(measure.indexOf('export async function openOnlineBoot'));
  expect(boot.slice(0,boot.indexOf('\n}\n'))).toMatch(/openRig\(\{[^}]*\bcatalogue \}\)/u);
  expect(readFileSync('src/scripts/online-rig.mjs','utf8')).toMatch(/'src\/scripts\/build-server\.mjs'[^\n]*'--catalogue', absolute\(catalogue\)/u);
  const run=(metres:number)=>({refused:null,walk:{aboveSettled:{webcontent:100,gpu:1},peak:{webcontent:700},route:{metres,stuck:[]}}});
  const sampled=(metres:number)=>({ready:true,bytesPerSecond:10,cullerBytesPerSecond:1,route:{metres,stuck:[]}});
  expect(walkSummary([run(225)],[sampled(249)],60).complete).toBe(true);
  const still=walkSummary([run(0)],[sampled(0)],60);
  expect(still.complete).toBe(false);
  expect(still.short).toEqual([0,0]);
  expect(still.leastMetres).toBe(60*MIN_WALK_METRES_PER_SECOND);
  expect(walkSummaryLines(still).at(-1)).toMatch(/walk SHORT: 0, 0 m, under the 60 m/u);
  expect(walkSummary([run(225)],[sampled(59)],60).short).toEqual([59]);
  expect(measure).toContain('walkSummary(webkit, walks, walk)');
});
