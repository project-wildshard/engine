// @vitest-environment happy-dom
import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {Loading} from '../src/client/engine/ui/Loading';
import {loadingPath} from '../src/client/game/boot/loadingPaths';
import {currentLoadingTimeline} from '../src/shared/engine/boot/timeline';
import type {BootTiming} from '../src/shared/engine/boot/timing';
let now=100;
beforeEach(()=>{vi.useFakeTimers();vi.spyOn(performance,'now').mockImplementation(()=>now);});
afterEach(()=>{vi.useRealTimers();vi.unstubAllGlobals();document.body.replaceChildren();});

it('NB15/NB14: copies a full grid boot below 6 KB with its real build and slowest work',()=>{
  const build='ad3996fc139265a6c38f2c583bb11d0d0d0d0d0d';
  const timing:BootTiming={version:1,build,attempt:'1',attemptCount:1,timeOrigin:0,
    entries:Array.from({length:220},(_,index)=>({id:index,build,attempt:'1',realm:'page',operation:'game-stage:props',start:index*40,end:index*40+20,result:'complete',detail:{private:'PRIVATE'}})),
    resources:Array.from({length:705},(_,index)=>({realm:'page',url:`${location.origin}/b/${build}/chunk-${index}.js?token=PRIVATE`,startTime:index*40,responseEnd:index*40+20,duration:20,transferSize:index%2===0?1100:0,encodedBodySize:1000})),
    counters:{},active:[],begin:()=>1,end:()=>undefined,mark:()=>undefined,progress:()=>undefined,finish:()=>undefined,read:()=>timing};
  timing.entries.push({id:221,build,attempt:'1',realm:'page',operation:'game-stage:home',start:23100,end:53100,result:'complete',detail:{}});
  timing.resources.push({realm:'page',url:`${location.origin}/b/${build}/slowest-stretch.js`,startTime:30000,responseEnd:35000,duration:5000,transferSize:4096,encodedBodySize:4000});
  vi.stubGlobal('__bootTiming',timing);
  const loading=new Loading({id:'compact-grid',name:'Grid'});
  const path=loadingPath('grid');loading.setPath(path);
  const timeline=currentLoadingTimeline();if(timeline===undefined)throw new Error('Missing grid timeline');
  for(const step of path.steps){const active=timeline.begin(step.key);now+=100;active.end();}
  now=53100;
  try{
    const report=loading.diagnosticsText();
    expect(new TextEncoder().encode(report).byteLength).toBeLessThan(6000);
    expect(report).toContain(`build ${build}`);
    expect(report).toContain('game-stage:home [page] 23.10 + 30.00');
    expect(report).toContain('slowest-stretch.js 4096 B 5.00 s network');
    expect(report).toContain('221 spans (221 complete), 706 resources');
    expect(report).toContain('network 354 / 392396 B; cache 352 / 352000 B');
    expect(report).toContain('35+18.1');
    expect(report).not.toContain('30+5'); // the outstanding request covers this interval
    expect(report).toContain('load rows:');
    expect(path.steps.length).toBeGreaterThan(20);
    expect(report.match(/^  \d+\./gmu)).toHaveLength(path.steps.length);
    expect(report).toContain('scene textures');
    expect(report).not.toContain('PRIVATE');
    expect(report).not.toContain('"entries"');
    expect(report.split('longest spans (start s + duration s):\n')[1]?.split('slowest resources')[0]?.trim().split('\n')).toHaveLength(15);
    expect(report.split('slowest resources (bytes, duration s, source):\n')[1]?.split('request-free')[0]?.trim().split('\n')).toHaveLength(10);
    // A long boot with hundreds of separated requests keeps all idle gaps,
    // represented as an exact repeated run rather than an unbounded list.
    timing.resources=Array.from({length:706},(_,index)=>({realm:'page',url:`${location.origin}/assets/chunk-${index}.js`,startTime:index*1200,responseEnd:index*1200+200,duration:200,transferSize:1000,encodedBodySize:900}));
    timing.entries.push({id:222,build,attempt:'1',realm:'page',operation:'app:control-ready',start:847200,end:847200,result:'observed',detail:{}});
    const sparse=loading.diagnosticsText();
    expect(new TextEncoder().encode(sparse).byteLength).toBeLessThan(6000);
    expect(sparse).toContain('0.2+1 every 1.2 x706');
  }finally{loading.scope.dispose();}
});
