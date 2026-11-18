import {expect,test} from 'vitest';
import {stepCheckpoints,refusal,ledgerByKind,stats,dumpsInOrder,bootURL,bootOf,isServerWorker,webkitLines,PROTOCOL,ladderParts,ledgerTotal,ladderLines,ledgerParity,predictFootprint,categoryRemainder,addCategories} from '../scripts/memory/measure.mjs';

const procs=[{pid:1,role:'webcontent',name:'wc'},{pid:2,role:'gpu',name:'gpu'},{pid:3,role:'networking',name:'net'}];
const sample=(seq:number,t:number,wc:[number,number],gpu:[number,number])=>({seq,t,p:{'1':wc,'2':gpu,'3':[9e9,9e9] as [number,number]}});

test('kernel samples land in the page step by wall-clock time, peaks take the interval high-water',()=>{
  const samples=[sample(0,100,[40,40],[20,20]),sample(1,200,[50,300],[20,25]),sample(2,300,[60,60],[30,30]),sample(3,400,[70,80],[40,40])];
  const steps:[number,string,Record<string,Record<string,number>>|null][]=[[150,'modules',{gpu:{texture:5}}],[350,'control',null]];
  const cps=stepCheckpoints(samples,steps,procs);
  expect(cps.map(c=>c.step)).toEqual(['page','modules','control']);
  expect(cps[0]).toMatchObject({samples:1,peak:{webcontent:40,gpu:20},last:{webcontent:40,gpu:20}});
  // the burst to 300 between the reads at 100 and 200 belongs to modules; networking is never counted
  expect(cps[1]).toMatchObject({samples:2,peak:{webcontent:300,gpu:30},last:{webcontent:60,gpu:30},ledger:{gpu:{texture:5}}});
  expect(cps[2]).toMatchObject({samples:1,peak:{webcontent:80,gpu:40}});
  expect(refusal(cps)).toBeNull();
});

test('a peak before the loading card, or no control, is refused',()=>{
  const samples=[sample(0,100,[900,900],[1,1]),sample(1,200,[50,50],[1,1])];
  expect(refusal(stepCheckpoints(samples,[[150,'modules',null],[180,'control',null]],procs))).toMatch(/before the loading card/u);
  expect(refusal(stepCheckpoints(samples,[[150,'modules',null]],procs))).toMatch(/never reached control/u);
});

test('ledger by kind, stats and the boot URL',()=>{
  expect(ledgerByKind({allocations:[{domain:'gpu',kind:'texture',bytes:2},{domain:'gpu',kind:'texture',bytes:3},{domain:'ram',kind:'wasm',bytes:7}]})).toEqual({gpu:{texture:5},ram:{wasm:7}});
  expect(ledgerByKind(null)).toBeNull();
  expect(stats([100,103,101,99,102])).toEqual({n:5,median:101,min:99,max:103,spreadPct:4});
  const url=new URL(bootURL('http://127.0.0.1:4400/','_template'));
  expect(Object.fromEntries(url.searchParams)).toEqual({chunk:'_template',mute:'1',skipintro:'1',nolock:'1',sw:'0'});
  expect(PROTOCOL).toBe('memory-run/1');
});

test('dumps join to requests by order, not by the returned guid',()=>{
  const dump=(id:string,pid:number,fp:number,alloc:Record<string,number>)=>({ph:'v',id,pid,args:{dumps:{process_totals:{private_footprint_bytes:fp.toString(16)},
    allocators:Object.fromEntries(Object.entries(alloc).map(([k,v])=>[k,{attrs:{size:{units:'bytes',value:v.toString(16)}}}]))}}});
  const events=[{ph:'M',name:'process_name',pid:7,args:{name:'Renderer'}},{ph:'M',name:'process_name',pid:8,args:{name:'GPU Process'}},
    dump('0x2',7,300,{'v8/main':10,'v8/main/heap/old_space/deep':1}),dump('0x1',7,200,{'partition_alloc/partitions/array_buffer':5}),dump('0x1',8,50,{}),dump('0xa',7,400,{})];
  const dumps=dumpsInOrder(events);
  expect(dumps.map(d=>d.id)).toEqual(['0x1','0x2','0xa']);
  expect(dumps[0]!.processes).toEqual([{pid:7,role:'renderer',footprint:200,alloc:{'partition_alloc/partitions/array_buffer':5}},{pid:8,role:'gpu',footprint:50,alloc:{}}]);
  expect(dumps[1]!.processes[0]!.alloc).toEqual({'v8/main':10});
});

test('one line per checkpoint, each number tagged',()=>{
  const run={chunk:'_template',build:'abcdef1234',ready:true,readyMs:13100,loadAverage:3,refused:null,
    checkpoints:[{step:'control',from:0,to:1,samples:1,peak:{webcontent:491e6,gpu:512e6},last:{webcontent:491e6,gpu:355e6},ledger:null}],
    settled:{webcontent:487e6,gpu:355e6},ledger:{totals:{gpu:34e6,ram:33e6},unattributed:{gpu:0,ram:0},byKind:{gpu:{texture:18e6}}}};
  const lines=webkitLines(run as never);
  expect(lines[0]).toMatch(/^\[K\] WebKit _template build abcdef12, instrument full: ready true in 13\.1 s/u);
  expect(lines.some(l=>/control settled .*487 MB \[K\].*\[L\]/u.test(l))).toBe(true);
  expect(lines.at(-1)).toBe('  ledger at control by kind [L]: gpu texture 18.0');
});

test('the ladder parts are medians of per-round differences, checked against the whole',()=>{
  const round=(blank:number,tpl:number,zone:number)=>({blank:{k:blank,l:0},webgl:{k:blank+2,l:0},title:{k:blank+90,l:5},_template:{k:tpl,l:60,peak:tpl+300},z:{k:zone,l:150,peak:zone+400}});
  const {parts,byZone}=ladderParts([round(45,900,1050),round(46,905,1040),round(44,895,1060)],['z']);
  expect(parts.browserFloor.k).toBe(45);
  expect(parts.webglContext.k).toBe(2);
  expect(parts.engineFixed).toEqual({k:855,l:60});
  expect(byZone['z']!.zone).toEqual({k:150,l:90});
  expect(byZone['z']!.transient.k).toBe(400);
  expect(byZone['z']!.closesWithin2Pct).toBe(true);
  expect(ledgerTotal({gpu:{texture:3,buffer:4},ram:{wasm:5}})).toBe(12);
  expect(ledgerTotal(null)).toBe(0);
  const lines=ladderLines({rungs:{blank:{k:stats([45e6]),wc:stats([16e6]),gpu:stats([29e6]),l:stats([0])}},parts,byZone,runs:3});
  expect(lines[2]).toBe('| blank | 16 (16-16) | 29 (29-29) | 45 (45-45) | - | 0 |');
  expect(lines.some(l=>/\| z: floor \+ engine \+ zone vs whole \| .*\(within 2%/u.test(l))).toBe(true);
});

test('EM5 parity sets the ledger WebGL bytes beside ANGLE Metal and the renderer buffer dump',()=>{
 const MiB=1024*1024;
 const checkpoint={ledger:{gpu:{texture:10*1e6,buffer:5*1e6,'drawing-buffer':2*1e6},ram:{}},processes:[
  {role:'gpu',alloc:{'gpu/angle/metal':20*MiB,'gpu/angle':20*MiB}},{role:'renderer',alloc:{'webgl/context_*/buffers':5e6,'webgl/context_*':9e6}}]};
 expect(ledgerParity(checkpoint)).toEqual({ledgerGpu:15,ledgerBuffers:5,angleMetal:20*MiB/1e6,webglBuffers:5});
 expect(ledgerParity({processes:[]})).toBeNull();
});

const MB=1e6;
const HOST={baselineMB:{webcontent:16,gpu:18},kinds:{
  arraybuffer:{slope:1,interceptMB:16,lands:'webcontent'},wasm:{slope:1,interceptMB:16,lands:'webcontent'},worker:{slope:1,interceptMB:19,lands:'webcontent'},
  texrgba:{slope:1.5,interceptMB:58,lands:'gpu'},glbuffer:{slope:1,interceptMB:20,lands:'gpu'},msaa:{slope:1,interceptMB:25,lands:'gpu'},imagebitmap:{slope:1,interceptMB:19,lands:'gpu'},
}};

test('the closure prediction is the floor plus each ledger kind times its weight, in the process its kind lands in',()=>{
  const p=predictFootprint({ram:{'array-buffer':10*MB,'geometry-cpu':4*MB,wasm:2*MB},workers:{'server/wasm':3*MB,'server/wire':1*MB,'decode/isolate':0},gpu:{texture:8*MB,buffer:5*MB}},HOST);
  expect(p.webcontent/MB).toBeCloseTo(16+10+4+2+3+1+2*(19-16));
  expect(p.gpu/MB).toBeCloseTo(18+8*1.5+5+(58-18));
  expect(p.terms.find(t=>t.term==='worker server/wasm')).toMatchObject({process:'webcontent',category:'WebKit Malloc'});
  expect(p.terms.find(t=>t.term==='ram array-buffer')).toMatchObject({process:'webcontent',category:'WebAssembly Memory'});
  expect(p.terms.filter(t=>t.term.endsWith(' isolate')).map(t=>t.term)).toEqual(['worker server isolate','worker decode isolate']);
  expect(p.terms.find(t=>t.term==='gpu texture')).toMatchObject({process:'gpu',category:'graphics'});
  expect(predictFootprint({gpu:{buffer:MB}},HOST).terms.map(t=>t.term)).toEqual(['gpu buffer']);
});

test('the remainder is split by footprint category, Metal-owned categories together as graphics',()=>{
  const measured:Record<string,number>={};
  addCategories(measured,{'WebKit Malloc':{dirty:30*MB,swapped:2*MB},'IOAccelerator (graphics)':{dirty:5*MB},'Owned physical footprint (unmapped) (graphics)':{dirty:20*MB},Stack:{dirty:0}});
  expect(measured).toEqual({'WebKit Malloc':32*MB,'IOAccelerator (graphics)':5*MB,'Owned physical footprint (unmapped) (graphics)':20*MB});
  const terms=[{process:'gpu' as const,term:'gpu texture',category:'graphics',bytes:15*MB},{process:'webcontent' as const,term:'ram array-buffer',category:'WebKit Malloc',bytes:12*MB}];
  expect(categoryRemainder(measured,terms,'gpu')).toEqual([{category:'WebKit Malloc',measured:32*MB,ledger:0,unexplained:32*MB},{category:'graphics',measured:25*MB,ledger:15*MB,unexplained:10*MB}]);
  expect(categoryRemainder(measured,terms,'webcontent')[0]).toMatchObject({category:'WebKit Malloc',ledger:12*MB,unexplained:20*MB});
});

test('STR1: a run names its boot and the in-page server worker by its chunk',()=>{
  expect(bootOf([{boot:'online'},{boot:'online'}])).toBe('online');
  expect(bootOf([{}])).toBe('standalone');
  expect(bootOf([{boot:'standalone'},{boot:'online'}])).toBe('online+standalone');
  expect(isServerWorker('http://127.0.0.1:4400/assets/serverWorker-1a2b3c.js')).toBe(true);
  expect(isServerWorker('http://127.0.0.1:4400/assets/ktx2Zstd-1a2b3c.js')).toBe(false);
  expect(isServerWorker('blob:http://127.0.0.1:4400/0b1c')).toBe(false);
});
