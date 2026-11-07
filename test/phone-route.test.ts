// @vitest-environment node
import { expect, test } from 'vitest';
import { Window } from 'happy-dom';
// oxlint-disable-next-line import/no-nodejs-modules -- Execute the real generated bootstrap against isolated storage.
import { runInNewContext, createContext, runInContext } from 'node:vm';
import { phoneEngine } from '../scripts/parity/phone-route-runner.mjs';
import { capturePhoneFailure, waitPhoneCondition, enterPhoneGrid, phoneRouteFailures, phoneRoutePlans, type PhoneReceipt, type PhoneObservation, type PhoneDocument } from '../scripts/parity/phone-route.mjs';
import { phoneTouchButton, phoneWallTarget, phoneLoadingObservation, phoneGridEntryCondition, installPhoneTitlePaint } from '../scripts/parity/phone-route-page.mjs';
import { phoneBootstrap, phoneDocumentMatches, phonePageTarget, followNativePhoneDocument } from '../scripts/parity/phone-route-browser.mjs';

// Exercise the serialized page observer without a browser or extra downloads.
test.each(['load', 'error'] as const)('title phase evidence preserves the original %s witness', mode => {
  let clock = 0, visible = false, images = 0;
  const frames: (()=>void)[] = [];
  const probes: Probe[] = [];
  class Probe {
    onload: (()=>void) | undefined;
    onerror: (()=>void) | undefined;
    src = '';
    constructor() { images++; probes.push(this); }
  }
  const url = 'http://fixture.test/hero.jpg';
  const resource = { name: url, initiatorType: 'link', startTime: 10, responseStart: 20, responseEnd: 30,
    transferSize: 0, encodedBodySize: 0, decodedBodySize: 0 };
  const paint = { name: 'first-contentful-paint', startTime: 5 };
  const context = createContext({window:{addEventListener:()=>undefined},
    document:{querySelectorAll:()=>visible?[{getClientRects:()=>[{}]}]:[]},
    MutationObserver:class {observe() {return undefined;}},
    requestAnimationFrame:(next:()=>void)=>{frames.push(next);},
    getComputedStyle:()=>({backgroundImage:'url("/hero.jpg")'}),
    Image:Probe,URL,location:{href:'http://fixture.test/'},
    performance:{now:()=>clock,setResourceTimingBufferSize:()=>undefined,
      getEntriesByType:(kind:string)=>kind==='paint'?[paint]:[resource,{...resource,name:'http://fixture.test/other.jpg'}]}});
  const read = ()=>runInContext('window.__phoneRoutePaint',context) as PhoneReceipt['paint'];
  const frame = (at:number)=>{clock=at;const next=frames.shift();if(next===undefined)throw new Error('Missing original frame callback');next();};
  runInContext(`(${installPhoneTitlePaint.toString()})()`,context);
  frame(10);expect(images).toBe(0);expect(read().heroMs).toBeNull();
  visible=true;frame(40);
  const probe = probes[0];
  expect(images).toBe(1);expect(probe?.src).toBe(url);
  expect(read().phases?.visibleMs).toBe(40);expect(read().phases?.probeStartedMs).toBe(40);
  clock=70;
  if(probe===undefined)throw new Error('Missing original Image probe');
  if(mode==='error') {
    probe.onerror?.();expect(read().heroMs).toBe(-1);expect(frames).toHaveLength(0);
    expect(read().phases?.probeLoadedMs).toBeNull();return;
  }
  probe.onload?.();expect(read().heroMs).toBeNull();
  frame(80);expect(read().heroMs).toBeNull();frame(90);
  expect(read().heroMs).toBe(90);expect(read().fcpMs).toBe(paint.startTime);
  expect(read().phases?.probeLoadedMs).toBe(70);expect(read().phases?.firstFrameMs).toBe(80);
  expect(read().phases?.resources).toHaveLength(1);
  expect(read().phases?.resources[0]?.responseEnd).toBe(resource.responseEnd);
  expect(read().phases?.resources[0]?.transferBytes).toBe(0);
  expect(read().phases?.resources[0]).not.toBe(resource);
  expect(images).toBe(1);expect(frames).toHaveLength(0);
});

test('GRID waiting keeps fresh readiness but reads the full census once per owner',()=>{
  let full=0,travel=0,ready=false,inside:string|null='home',drawn=true;
  const grid={state:()=>{full++;return {home:'home'};},travelState:()=>{travel++;return {inside,live:{live:{gameplayReady:ready}}};}};
  const api={world:{},shard:{grid},requireWorld:()=>({game:{frameGate:()=>drawn}})};
  const context=createContext({window:{__wildshard:api},document:{querySelector:()=>null}});
  runInContext(`globalThis.ready=(${phoneGridEntryCondition.toString()})()`,context);
  for(let frame=0;frame<1000;frame++)expect(runInContext('ready()',context)).toBe(false);
  expect(full).toBe(1);expect(travel).toBe(1000);
  ready=true;inside='road';expect(runInContext('ready()',context)).toBe(false);
  inside='home';drawn=false;expect(runInContext('ready()',context)).toBe(false);
  drawn=true;expect(runInContext('ready()',context)).toBe(true);expect(full).toBe(1);
  const next={state:()=>{full++;return {home:'next'};},travelState:()=>{travel++;return {inside,live:{live:{gameplayReady:ready}}};}};
  api.shard.grid=next;expect(runInContext('ready()',context)).toBe(false);
  inside='next';expect(runInContext('ready()',context)).toBe(true);expect(full).toBe(2);
});

test('the inherited grid bootstrap keeps fatal collection without polling a title hero',()=>{
  const listeners=new Map<string,(event:{message?:string;reason?:string})=>void>();
  let observers=0;
  const window={addEventListener:(name:string,run:(event:{message?:string;reason?:string})=>void)=>{listeners.set(name,run);}};
  runInNewContext(`(${installPhoneTitlePaint.toString()})('http://fixture.test/?tier=phone')`,{
    window,location:{href:'http://fixture.test/?chunk=coast'},document:{},
    performance:{setResourceTimingBufferSize:()=>undefined},
    MutationObserver:class{observe(){observers++;}},
    requestAnimationFrame:()=>{throw new Error('Grid document polled a title hero');}});
  expect(observers).toBe(1);
  listeners.get('error')?.({message:'early grid error'});
  listeners.get('unhandledrejection')?.({reason:'early grid rejection'});
  expect(Reflect.get(window,'__phoneRouteFaults')).toEqual(['early grid error','early grid rejection']);
  expect(Reflect.get(window,'__phoneRouteObserver')).toMatchObject({heroPolls:0,heroMs:0});
});

test('GRID waiting retains the real reveal input and never substitutes it for readiness',async()=>{
  const dom=new Window();
  try {
    dom.document.body.innerHTML='<button class="ws-grid-reveal">Enter</button>';
    let inputs=0;dom.document.querySelector('button')?.addEventListener('pointerdown',()=>{inputs++;});
    const context=createContext({window:{__wildshard:{world:{},shard:{grid:{}},requireWorld:()=>{throw new Error('No ready world');}}},
      document:dom.document,PointerEvent:dom.PointerEvent});
    runInContext(`globalThis.ready=(${phoneGridEntryCondition.toString()})()`,context);
    expect(runInContext('ready()',context)).toBe(false);expect(inputs).toBe(1);
  }finally{await dom.happyDOM.close();}
});

test('condition factories keep one subscription and the existing deadline and fatal checks',async()=>{
  let clock=0;
  const page={faults:[] as string[],evaluate:(expression:string)=>Promise.resolve(runInNewContext(expression,{
    performance:{now:()=>clock},requestAnimationFrame:(next:()=>void)=>{clock++;next();}}))};
  await waitPhoneCondition(page,()=>{let polls=0;return()=>++polls===3;},'fixture',Date.now()+1000);
  expect(clock).toBe(2);
  await expect(waitPhoneCondition(page,()=>()=>false,'fixture',Date.now()-1)).rejects.toThrow('Phone route deadline: fixture');
  page.faults.push('native fault');
  await expect(waitPhoneCondition(page,()=>()=>true,'fixture',Date.now()+1000)).rejects.toThrow('native fault');
});

test('a pre-world failure preserves loading rows and native timings without mutating the page',async()=>{
  const dom=new Window({url:'https://example.com/'});
  try {
    dom.document.body.innerHTML='<section class="ws-load" data-step="warm.links"><span data-el="clock">01:02.0</span><span data-el="dlFact">Spawn view complete</span><span data-el="suFact">Spawn program links</span><span data-el="foot">Read product data section</span></section>';
    const root=dom.document.querySelector('.ws-load');if(root===null)throw new Error('Missing loading fixture');
    const timeline={current:'warm.links',rows:[{key:'modules',ms:13400},{key:'home',ms:22200}]};
    Reflect.set(root,Symbol.for('engine.loading.snapshot'),timeline);
    const before=dom.document.body.innerHTML;
    const resources=[{name:'https://example.com/code.js',initiatorType:'script',startTime:10,duration:200,responseStart:20,responseEnd:210,transferSize:100,encodedBodySize:80,decodedBodySize:160}];
    const performance={now:()=>62000,getEntriesByType:(kind:string)=>kind==='resource'?resources:[{name:'modules',startTime:0,duration:13400}]};
    const window={__phoneRouteObserver:{batches:12,records:20,scans:12,scanMs:3,heroPolls:9,heroMs:2}};
    const result:unknown=runInNewContext(`(${phoneLoadingObservation.toString()})()`,{window,document:dom.document,location:dom.location,performance});
    expect(result).toMatchObject({at:62000,url:'https://example.com/',loading:{step:'warm.links',clock:'01:02.0',timeline},
      resources:[{kind:'script',duration:200,transferBytes:100,encodedBytes:80,decodedBytes:160}],measures:[{name:'modules',duration:13400}]});
    expect(result).toMatchObject({waits:null});
    expect(result).toMatchObject({observer:window.__phoneRouteObserver});
    let retries=0;
    const row={id:1,label:'Read Product data',kind:'file',step:'home',owner:Symbol('existing loader'),
      startedAt:61000,progressAt:61500,loadedBytes:7,totalBytes:null,resource:'https://example.com/product.bin',
      retry:()=>{retries++;},progress:'',inline:false};
    const pending=new Map([[row.id,row]]);
    Reflect.set(dom.document,Symbol.for('engine.loading.waits.v1'),{version:1,pending});
    const active:unknown=runInNewContext(`(${phoneLoadingObservation.toString()})()`,{window,document:dom.document,location:dom.location,performance});
    expect(active).toMatchObject({waits:[{resource:row.resource,ageMs:1000,progressAgeMs:500,loadedBytes:7,totalBytes:null}]});
    const serial=JSON.stringify(active);
    expect(serial).not.toContain('retry');expect(serial).not.toContain('existing loader');
    expect(retries).toBe(0);expect(pending.get(row.id)).toBe(row);
    expect(dom.document.body.innerHTML).toBe(before);
  } finally { await dom.happyDOM.abort(); }
});

test('phone bootstrap persists numeric mute after a caller replaces settings',()=>{
  const stored=new Map<string,string>();
  const localStorage={getItem:(key:string)=>stored.get(key)??null,setItem:(key:string,value:string)=>{stored.set(key,value);}};
  runInNewContext(phoneBootstrap('localStorage.setItem("wildshard.save.v2@1.global",JSON.stringify({keys:{settings:{v:1,data:{tier:"phone",volume:0.8}}}}));'),{window:{},location:{href:'http://localhost/'},localStorage,crypto:{randomUUID:()=> 'new-document'}});
  const saved:unknown=JSON.parse(stored.get('wildshard.save.v2@1.global')??'null');
  expect(saved).toMatchObject({keys:{settings:{data:{tier:'phone',volume:0}}}});
});

const priorDocument: PhoneDocument = {url:'http://localhost/?tier=phone',visit:'owned-visit',document:'old-title',boot:'http://localhost/?tier=phone'};
test('GRID reconnect accepts only the owned fresh entry document at the exact final URL',()=>{
  const current={url:'http://localhost/',visit:'owned-visit',document:'new-grid',boot:'http://localhost/?chunk=coast'};
  expect(phoneDocumentMatches(current,'http://localhost/',priorDocument)).toBe(true);
  for(const rejected of [priorDocument,{...current,document:'old-title'},{...current,visit:'another-visit'},
    {...current,url:'http://localhost/version.json'},{...current,boot:'http://elsewhere/?chunk=coast'},
    {...current,boot:'http://localhost/'},{...current,document:''},null])
    expect(phoneDocumentMatches(rejected,'http://localhost/',priorDocument)).toBe(false);
});

test('native GRID follows provisional targets on its existing bootstrap connection',async()=>{
  const current={url:'http://localhost/',visit:'owned-visit',document:'new-grid',boot:'http://localhost/?chunk=coast'};
  const replies:unknown[]=[priorDocument,{...current,document:'old-title'},{...current,visit:'foreign'},current];
  let closed=false,reads=0;
  const inspector={close:()=>{closed=true;},send:(method:string)=>{
    expect(method).toBe('Runtime.evaluate');expect(closed).toBe(false);reads++;
    return Promise.resolve({result:{value:replies.shift()}});
  }};
  await followNativePhoneDocument(inspector,current.url,priorDocument,Date.now()+5000);
  expect(reads).toBe(4);expect(closed).toBe(false);
});

test('native GRID does not accept a stale document after its original navigation deadline',async()=>{
  const inspector={send:()=>Promise.resolve({result:{value:priorDocument}})};
  await expect(followNativePhoneDocument(inspector,'http://localhost/',priorDocument,Date.now()-1))
    .rejects.toThrow('did not reach its owned document');
});

test('GRID follows the real title click before establishing readiness in the new document',async()=>{
  const calls:string[]=[];const deadline=123456;
  await enterPhoneGrid({evaluate:()=>Promise.resolve(priorDocument),click:selector=>{calls.push(selector);return Promise.resolve();},
    followNavigation:(url,previous,received)=>{expect(calls).toEqual(['.ws-main-grid']);expect(url).toBe('http://localhost/');
      expect(previous).toEqual(priorDocument);expect(received).toBe(deadline);calls.push('fresh-document');return Promise.resolve();}},'http://localhost/',deadline);
  expect(calls).toEqual(['.ws-main-grid','fresh-document']);
});

test('a missing owned title document refuses before the GRID action',async()=>{
  let clicked=false;
  await expect(enterPhoneGrid({evaluate:()=>Promise.resolve(null),click:()=>{clicked=true;return Promise.resolve();},
    followNavigation:()=>Promise.resolve()},'http://localhost/',123456)).rejects.toThrow('no owned title document');
  expect(clicked).toBe(false);
});

test('a failed diagnostic screenshot cannot replace the primary route failure',async()=>{
  const failures=['Phone route evaluation lost its document'];
  for(const screenshot of [()=>{throw new Error('xcrun ETIMEDOUT');},()=>Promise.reject(new Error('capture rejected'))]) {
    await expect(capturePhoneFailure({screenshot},'failure.jpg')).resolves.toBeUndefined();
    expect(failures).toEqual(['Phone route evaluation lost its document']);
  }
});

test('native route selects its exact document instead of the older version probe',()=>{
  const base='http://127.0.0.1:4403/',probe={url:`${base}version.json`,webSocketDebuggerUrl:'ws://localhost:9232/probe'},game={url:base,webSocketDebuggerUrl:'ws://localhost:9232/game'};
  expect(phonePageTarget([probe,game],base)).toEqual(game);
  expect(phonePageTarget([game,probe],probe.url)).toEqual(probe);
  expect(phonePageTarget([probe],base)).toBeUndefined();
  expect(phonePageTarget([{url:base,webSocketDebuggerUrl:7}],base)).toBeUndefined();
  expect(phonePageTarget(null,base)).toBeUndefined();
});

test('wall locator admits the real steep plinth bevel but refuses walkable or disconnected upper surfaces',()=>{
  let upperNormal=.4735059772376924,upperDistance=5.598276735510306;
  const collider={handle:1,collisionGroups:()=>123};
  const physics={R:{Ray:class{constructor(public origin:{x:number,y:number,z:number},public dir:{x:number,y:number,z:number}){}},QueryFilterFlags:{EXCLUDE_SENSORS:8}},
    colliderTag:()=>({material:'ground'}),world:{castRayAndGetNormal:(ray:{origin:{y:number},dir:{x:number}},length:number,solid:boolean,flags:number,groups:number,excluded:object)=>{
      expect([length,solid,flags,groups,excluded]).toEqual([120,true,8,123,collider]);
      if(ray.dir.x!==-1)return null;
      return {collider,timeOfImpact:ray.origin.y>1.5?upperDistance:5.35779004651275,normal:{x:1,y:ray.origin.y>1.5?upperNormal:.020440399304344017,z:0}};
    }}};
  const world={player:{position:{x:.0016,y:.0201,z:-1.2503},motor:{collider,opts:{maxClimbDeg:40}}},physics};
  const previous=Object.getOwnPropertyDescriptor(globalThis,'window');
  Object.defineProperty(globalThis,'window',{configurable:true,value:{__wildshard:{requireWorld:()=>world,shard:{grid:{state:()=>({live:{live:{worldFeet:{x:-562.4984,z:561.2497}}}})}}}}});
  try{
    expect(phoneWallTarget()).toMatchObject({direction:{x:-1,z:0},collider:1,material:'ground',surface:{width:2,height:1.2}});
    upperNormal=.9;expect(()=>phoneWallTarget()).toThrow('No real building wall');
    upperNormal=.4735059772376924;upperDistance=50;expect(()=>phoneWallTarget()).toThrow('No real building wall');
  }finally{if(previous===undefined)Reflect.deleteProperty(globalThis,'window');else Object.defineProperty(globalThis,'window',previous);}
});

test('native touch sends the HOVER pointerdown handler and ordinary menu click without changing game state',async()=>{
  const dom=new Window(), button=dom.document.createElement('button'), events:string[]=[];
  button.className='ws-touch-hover';dom.document.body.append(button);
  Object.defineProperty(button,'getClientRects',{value:()=>[{x:0,y:0,width:50,height:50}]});
  button.addEventListener('pointerdown',event=>{events.push('hover');event.preventDefault();});
  button.addEventListener('pointerup',()=>{events.push('up');});
  button.addEventListener('click',()=>{events.push('menu-click');});
  const replacements={document:dom.document,HTMLButtonElement:dom.HTMLButtonElement,PointerEvent:dom.PointerEvent};
  const previous=new Map(Object.keys(replacements).map(key=>[key,Object.getOwnPropertyDescriptor(globalThis,key)]));
  for(const [key,value] of Object.entries(replacements))Object.defineProperty(globalThis,key,{value,configurable:true,writable:true});
  try{
    expect(phoneTouchButton('.ws-touch-hover')).toBe(true);
    expect(events).toEqual(['hover','up','menu-click']);
    button.disabled=true;expect(()=>phoneTouchButton('.ws-touch-hover')).toThrow('Unavailable');
    expect(events).toEqual(['hover','up','menu-click']);
  }finally{
    for(const [key,descriptor] of previous){if(descriptor===undefined)Reflect.deleteProperty(globalThis,key);else Object.defineProperty(globalThis,key,descriptor);}
    await dom.happyDOM.close();
  }
});

function observation(): PhoneObservation {
  return { at: 1000, frame: 100, frameAt: 1000, ready: true, current: 'home', inside: 'home', home: 'home', pitch:562.5,
    feet:{x:0,y:.5,z:0}, cells:[
      {instance:'home',slug:'driftwood-isle',cell:[0,0],shows:'playing',drawn:{far:false,near:false,l0:15,l1:16}},
      {instance:'market',slug:'open-plot-night-market',cell:[-1,1],shows:'tiles',drawn:{far:false,near:false,l0:15,l1:16}},
      {instance:'outer-market',slug:'open-plot-night-market',cell:[-1,-2],shows:'far proxy',drawn:{far:true,near:false,l0:0,l1:0}},
    ], grain:0,frameAvailable:true,hover:false,fps:30,pill:'30 fps',fatal:[],contextLost:false };
}
function receipt(): PhoneReceipt {
  const state=observation(), market=state.cells[1];
  if(market===undefined)throw new Error('Missing fixture market');
  return {protocol:'jake-phone-route/1',sha:'a'.repeat(40),version:{build:'aaaaaaa-fixture'},engine:'webkit-iphone',
    steps:['title','SHARD SELECT','grid','Driftwood','road','Night Market','road return','Driftwood return'],
    paint:{heroMs:420,fcpMs:300,heroURL:'/assets/title/main-crossroads-square.jpg'},
    entry:{at:1000,frame:100,inside:'market',current:'market',ready:true,cell:{...market,shows:'playing'},grain:0},
    wall:{from:{x:-93.75,y:.45,z:-218.75},wallDistance:11,direction:{x:1,z:0},collider:1,material:'stone',surface:{width:2,height:1.2,normal:{x:-1,y:0,z:0}},elapsedMs:4000,startedFrame:0,finalFrame:120,
      final:{x:-83.15,y:.45,z:-218.75},hover:true,previous:{yaw:0,hover:false},
      samples:Array.from({length:120},(_,i)=>({ms:(i+1)*1000/30,x:i<80?-93.75+10.6*i/80:-83.15,z:-218.75,hover:true,frame:i+1}))},
    fps:['Driftwood','road','Night Market'].map(label=>({label,elapsedMs:10000,frames:300,worstMs:34,pillFps:30,pill:'30 fps'})),
    observations:Array.from({length:6},()=>observation()),frames:Array.from({length:7},(_,i)=>({label:String(i),width:192,height:400,darkShare:.1})),faults:[],routes:[],failures:[]};
}

test('only an available iOS runtime selects Simulator; unavailable runtime records the WebKit equivalent',()=>{
  expect(phoneEngine({runtimes:[{identifier:'com.apple.CoreSimulator.SimRuntime.iOS-26-0',isAvailable:true}]})).toBe('simulator');
  expect(phoneEngine({runtimes:[{identifier:'com.apple.CoreSimulator.SimRuntime.iOS-26-0',isAvailable:false}]})).toBe('webkit');
  expect(phoneEngine({runtimes:[{identifier:'com.apple.CoreSimulator.SimRuntime.tvOS-26-0',isAvailable:true}]})).toBe('webkit');
  expect(()=>phoneEngine({})).toThrow('Invalid Simulator');
});

test('route follows the served lattice and uses held input for all four actual crossings without a pose seed',()=>{
  const {market,plans}=phoneRoutePlans(observation());
  expect(market).toBe('market');
  expect(plans.map(p=>[p.from,p.to])).toEqual([['home',null],[null,'market'],['market',null],[null,'home']]);
  expect(plans.every(p=>p.start===undefined&&p.finishOnArrival!==true)).toBe(true);
  expect(plans[0]?.waypoints).toEqual([{x:0,z:-281.25}]);
  expect(plans[1]?.waypoints).toEqual([{x:-281.25,z:-281.25},{x:-281.25,z:281.25},{x:-562.5,z:281.25},{x:-562.5,z:562.5}]);
  expect(plans[2]?.waypoints[0]).toEqual({x:-562.5,z:562.5});
  expect(plans[1]?.waypoints.at(-2)?.x).toBe(-observation().pitch);
  const invalid=observation();invalid.cells=[];expect(()=>phoneRoutePlans(invalid)).toThrow('unambiguous');
});

test('complete receipt passes, while a near proxy, zero tiles or late readiness fails the first-entry gate',()=>{
  expect(phoneRouteFailures(receipt())).toEqual([]);
  for(const mode of ['proxy','empty','unready','missing'] as const){
    const r=receipt();if(r.entry?.cell===undefined)throw new Error('Missing fixture entry');
    if(mode==='proxy')r.entry.cell={...r.entry.cell,drawn:{...r.entry.cell.drawn,far:true,l0:0}};
    if(mode==='empty')r.entry.cell={...r.entry.cell,drawn:{...r.entry.cell.drawn,l0:0,l1:0}};
    if(mode==='unready')r.entry.ready=false;
    if(mode==='missing')r.entry=null;
    expect(phoneRouteFailures(r)).toContain('Night Market near tiles absent on first geometric entry');
  }
});

test('wall gate refuses a board crossing, no collider, no movement, or a nonsettling endpoint',()=>{
  for(const mode of ['cross','no-collider','no-movement','no-frames','unmounted','not-a-wall','short-contact','platform-edge'] as const){
    const r=receipt();if(r.wall===null)throw new Error('Missing fixture wall');
    if(mode==='cross')r.wall.samples.push({ms:4000,x:-80,z:-218.75,hover:true,frame:121});
    if(mode==='no-collider')r.wall.collider=Number.NaN;
    if(mode==='no-movement')r.wall.final.x=r.wall.from.x;
    if(mode==='no-frames')r.wall.finalFrame=1;
    if(mode==='unmounted')r.wall.hover=false;
    if(mode==='not-a-wall')r.wall.surface={width:.1,height:.2,normal:{x:0,y:1,z:0}};
    if(mode==='short-contact')r.wall.elapsedMs=500;
    if(mode==='platform-edge')r.wall.material='edge';
    expect(phoneRouteFailures(r).some(row=>row.startsWith('Board'))).toBe(true);
  }
  const west=receipt();if(west.wall===null)throw new Error('Missing wall');
  const wall=west.wall;wall.direction={x:-1,z:0};wall.final.x=2*wall.from.x-wall.final.x;
  wall.samples=wall.samples.map(row=>({...row,x:2*wall.from.x-row.x}));
  expect(phoneRouteFailures(west)).toEqual([]);
  wall.samples.push({ms:4000,x:wall.from.x-12,z:wall.from.z,hover:true,frame:121});
  expect(phoneRouteFailures(west)).toContain('Board did not remain blocked outside the real wall');
  const mesh=receipt();if(mesh.wall===null)throw new Error('Missing mesh wall');
  // installBakedMeshColliders tags the entire structural collision mesh ground.
  mesh.wall.material='ground';expect(phoneRouteFailures(mesh)).toEqual([]);
  mesh.wall.surface.normal={x:0,y:1,z:0};
  expect(phoneRouteFailures(mesh)).toContain('Board did not remain blocked outside the real wall');
});

test('wall-clock freezes, missing pill, slow hero, missing return, grain, black frames and wrong SHA remain red',()=>{
  const modes=['freeze','pill','hero','return','grain','black','sha','fatal'] as const;
  for(const mode of modes){
    const r=receipt();
    if(mode==='freeze')r.fps=[{label:'road',frames:1,elapsedMs:10000,worstMs:9999,pillFps:1,pill:'1 fps'}];
    if(mode==='pill'&&r.fps[0])r.fps[0].pillFps=Number.NaN;
    if(mode==='hero')r.paint.heroMs=501;
    if(mode==='return')r.steps.pop();
    if(mode==='grain'&&r.observations[1])r.observations[1].grain=.12;
    if(mode==='black'&&r.frames[0])r.frames[0].darkShare=.95;
    if(mode==='sha')r.version.build='bbbbbbb-fixture';
    if(mode==='fatal')r.faults.push('runtime refusal');
    expect(phoneRouteFailures(r),mode).not.toEqual([]);
  }
});


test('short native entry route retains tile, wall, draw and exact-document gates',()=>{
  const r=receipt();r.protocol='jake-phone-route/2';r.route='entry';r.steps=r.steps.slice(0,6);
  expect(phoneRouteFailures(r)).toEqual([]);
  r.steps.pop();expect(phoneRouteFailures(r)).toContain('Incomplete phone route');
  r.steps.push('Night Market');
  if(r.entry?.cell===undefined)throw new Error('Missing entry');
  r.entry.cell={...r.entry.cell,drawn:{...r.entry.cell.drawn,far:true,l0:0}};
  expect(phoneRouteFailures(r)).toContain('Night Market near tiles absent on first geometric entry');
  r.route='full';expect(phoneRouteFailures(r)).toContain('Incomplete phone route');
});


test('native condition waits subscribe once and finish only when the actual predicate changes',async()=>{
  let clock=0,calls=0;const frames:((time:number)=>void)[]=[];
  const state={ready:false};
  const page={faults:[],evaluate:(expression:string)=>{
    calls++;return Promise.resolve(runInNewContext(expression,{state,performance:{now:()=>clock},requestAnimationFrame:(run:(time:number)=>void)=>{frames.push(run);}}));
  }};
  const done=waitPhoneCondition(page,'state.ready','ready',Date.now()+1000);
  expect(calls).toBe(1);expect(frames).toHaveLength(1);
  clock=50;frames.shift()?.(clock);await Promise.resolve();expect(frames).toHaveLength(1);
  state.ready=true;frames.shift()?.(clock);await done;expect(calls).toBe(1);
  await expect(waitPhoneCondition(page,'false','missing',Date.now()-1)).rejects.toThrow('deadline: missing');
});


test('partial far masks coexist with entered fine tiles, but coarse-only residency is not entry',()=>{
  const r=receipt();if(r.entry?.cell===undefined)throw new Error('Missing entry');
  r.entry.cell={...r.entry.cell,drawn:{far:true,near:false,l0:9,l1:14}};
  expect(phoneRouteFailures(r)).toEqual([]);
  r.entry.cell={...r.entry.cell,drawn:{...r.entry.cell.drawn,l0:0}};
  expect(phoneRouteFailures(r)).toContain('Night Market near tiles absent on first geometric entry');
  r.entry.cell={...r.entry.cell,shows:'far proxy',drawn:{...r.entry.cell.drawn,l0:9}};
  expect(phoneRouteFailures(r)).toContain('Night Market near tiles absent on first geometric entry');
});
