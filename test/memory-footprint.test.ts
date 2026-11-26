import {expect,test} from 'vitest';
import {parseFootprintStream,markSegments,pickWebkitProcesses,pickSimulatorProcesses,roleSum,webkitRole,readFootprints,startSampler} from '../src/scripts/memory/footprint.mjs';

const line=(o:object)=>JSON.stringify(o);

test('the stream keeps its order, and a partial or foreign line is skipped',()=>{
  const text=[line({t:1,p:{'7':[10,12]}}),'{"t":2,"p":{"7":[1','not json',line({t:2,mark:'title'}),line({t:2,p:{'7':[20,25]}}),line({x:1}),''].join('\n');
  const stream=parseFootprintStream(text);
  expect(stream.samples.map(s=>s.seq)).toEqual([0,2]);
  expect(stream.marks).toEqual([{seq:1,t:2,mark:'title'}]);
});

test('marks split by stream order; the peak takes the kernel high-water between samples',()=>{
  const text=[
    line({t:0,p:{'7':[100,100],'8':[50,50]}}),
    line({t:10,p:{'7':[110,400],'8':[50,60]}}), // a burst to 400 between the two reads
    line({t:20,mark:'title'}),
    line({t:20,p:{'7':[120,130],'8':null}}),   // same clock as the mark, after it: the mark's segment; 8 has exited
    line({t:30,p:{'7':[90,125]}}),
    line({t:40,mark:'control'}),
  ].join('\n');
  const [start,title,control]=markSegments(parseFootprintStream(text));
  expect(start).toMatchObject({mark:'start',samples:2,peak:{'7':400,'8':60},last:{'7':110,'8':50}});
  expect(title).toMatchObject({mark:'title',from:20,to:30,samples:2,peak:{'7':130},last:{'7':90}});
  expect(title!.peak['8']).toBeUndefined();
  expect(control).toMatchObject({mark:'control',samples:0,peak:{}});
  expect(roleSum(start!.peak,[{pid:7,role:'webcontent',name:''},{pid:8,role:'gpu',name:''},{pid:9,role:'webcontent',name:''}],'webcontent')).toBe(400);
});

const pw='/Users/x/Library/Caches/ms-playwright/webkit-2388';
const rows=[
  {pid:100,ppid:1,rpid:100,name:'node',path:'/bin/node'},
  {pid:101,ppid:100,rpid:100,name:'pw_run.sh',path:'/bin/bash'},
  {pid:102,ppid:101,rpid:102,name:'Playwright',path:`${pw}/Playwright.app/Contents/MacOS/Playwright`},
  {pid:103,ppid:1,rpid:102,name:'com.apple.WebKit.WebContent.Development',path:`${pw}/com.apple.WebKit.WebContent.xpc/Contents/MacOS/com.apple.WebKit.WebContent.Development`},
  {pid:104,ppid:1,rpid:102,name:'com.apple.WebKit.GPU.Development',path:`${pw}/com.apple.WebKit.GPU.xpc/Contents/MacOS/com.apple.WebKit.GPU.Development`},
  {pid:105,ppid:1,rpid:102,name:'com.apple.WebKit.Networking.Development',path:`${pw}/com.apple.WebKit.Networking.xpc/Contents/MacOS/com.apple.WebKit.Networking.Development`},
  // another lane's WebKit, and the system's own Safari WebContent
  {pid:200,ppid:1,rpid:200,name:'node',path:'/bin/node'},
  {pid:202,ppid:200,rpid:202,name:'Playwright',path:`${pw}/Playwright.app/Contents/MacOS/Playwright`},
  {pid:203,ppid:1,rpid:202,name:'com.apple.WebKit.WebContent.Development',path:`${pw}/x`},
  {pid:300,ppid:1,rpid:301,name:'com.apple.WebKit.WebContent',path:'/System/Library/Frameworks/WebKit.framework/x'},
];

test('WebKit processes are found by the kernel responsible pid of this process tree only',()=>{
  expect(pickWebkitProcesses(rows,100).map(p=>[p.pid,p.role])).toEqual([[102,'ui'],[103,'webcontent'],[104,'gpu'],[105,'networking']]);
  expect(pickWebkitProcesses(rows,200).map(p=>p.pid)).toEqual([202,203]);
  expect(pickWebkitProcesses(rows,999)).toEqual([]);
  expect(webkitRole('com.apple.WebKit.GPU')).toBe('gpu');
});

test('on a hosted runner the runner is responsible for the app and its services; the app\'s own bundle claims them (EM12)',()=>{
  const hosted=[
    {pid:50,ppid:1,rpid:50,name:'Runner.Worker',path:'/runner/Runner.Worker'},
    {pid:100,ppid:50,rpid:50,name:'node',path:'/bin/node'},
    {pid:102,ppid:100,rpid:50,name:'Playwright',path:`${pw}/Playwright.app/Contents/MacOS/Playwright`},
    {pid:103,ppid:1,rpid:50,name:'com.apple.WebKit.WebContent.Development',path:`${pw}/com.apple.WebKit.WebContent.xpc/Contents/MacOS/com.apple.WebKit.WebContent.Development`},
    {pid:104,ppid:1,rpid:50,name:'com.apple.WebKit.GPU.Development',path:`${pw}/com.apple.WebKit.GPU.xpc/Contents/MacOS/com.apple.WebKit.GPU.Development`},
    // started before this app: not ours
    {pid:90,ppid:1,rpid:50,name:'com.apple.WebKit.WebContent.Development',path:`${pw}/com.apple.WebKit.WebContent.xpc/Contents/MacOS/com.apple.WebKit.WebContent.Development`},
  ];
  expect(pickWebkitProcesses(hosted,100).map(p=>[p.pid,p.role])).toEqual([[102,'ui'],[103,'webcontent'],[104,'gpu']]);
  // the shared-Mac case is unchanged: the other lane's app is its own responsible process
  expect(pickWebkitProcesses(rows,100).map(p=>p.pid)).toEqual([102,103,104,105]);
});

test('Simulator processes are those under the device launchd, plus the host graphics helpers',()=>{
  const sim=[
    {pid:500,ppid:1,rpid:500,name:'launchd_sim',path:'/x/launchd_sim'},
    {pid:501,ppid:500,rpid:501,name:'com.apple.WebKit.WebContent',path:'/sim/WebContent'},
    {pid:502,ppid:500,rpid:502,name:'com.apple.WebKit.GPU',path:'/sim/GPU'},
    {pid:510,ppid:1,rpid:510,name:'SimMetalHost',path:'/x/SimMetalHost'},
    {pid:511,ppid:1,rpid:511,name:'SimRenderServer',path:'/x/SimRenderServer'},
    ...rows,
  ];
  expect(pickSimulatorProcesses(sim,500).map(p=>[p.pid,p.role])).toEqual([[501,'webcontent'],[502,'gpu'],[510,'simmetalhost'],[511,'simrenderserver']]);
});

test.skipIf(process.platform!=='darwin')('the kernel reads this process, and the sampler marks segments',async()=>{
  const own=readFootprints([process.pid])[String(process.pid)]!;
  expect('error' in own).toBe(false);
  if(!('error' in own)) expect(own.physicalFootprintBytes).toBeGreaterThan(1e6);
  const sampler=startSampler([process.pid],{everyMs:10});
  await new Promise(r=>{setTimeout(r,80);});
  sampler.mark('held');
  const keep=new Uint8Array(64e6).fill(1);
  await new Promise(r=>{setTimeout(r,80);});
  const {segments}=await sampler.stop();
  expect(segments.map(s=>s.mark)).toEqual(['start','held']);
  expect(segments[1]!.peak[String(process.pid)]!-segments[0]!.peak[String(process.pid)]!).toBeGreaterThan(60e6);
  expect(keep[1]).toBe(1);
});
