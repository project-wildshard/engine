// @vitest-environment happy-dom
// LS3 (J188) at the card's outer edge: its bars move only on real events, never on time.
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { Loading, phaseTenths, type LoadingDownloadSource } from './Loading';
import { currentLoadingTimeline } from '../../../shared/engine/boot/timeline';
import {setDev} from '../core/devMode';
import {setSetting} from './Settings';

let now = 100;
beforeEach(() => {
  vi.useFakeTimers(); now = 100;
  vi.spyOn(performance, 'now').mockImplementation(() => now);
  vi.stubGlobal('PerformanceObserver', class {
    observe(): void { /* no transport here */ }
    disconnect(): void { /* no transport here */ }
    takeRecords(): PerformanceEntry[] { return []; }
  });
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); document.body.replaceChildren(); });

const widths = (loading: Loading): string[] => ['stBar', 'dlBar', 'suBar']
  .map(key => loading.root.querySelector<HTMLElement>(`[data-el="${key}"]`)?.style.width ?? '');

it('holds every bar through 30 quiet seconds, then moves Download on streamed bytes and Load on a finished step', () => {
  const loading = new Loading({ id: 'bar-rule', name: 'Bar rule' });
  let row = { totalBytes: 1000, completedBytes: 0, cachedBytes: 0, filesTotal: 4, filesDone: 0, complete: false, error: null };
  let notify = (): void => undefined;
  const source: LoadingDownloadSource = { ready: new Promise<void>(() => { /* the manifest never closes here */ }), snapshot: () => row,
    subscribe: listener => { notify = listener; listener(); return () => undefined; } };
  void loading.setDownloadSource(source);
  loading.setPath({ id: 'rule', steps: [{ key: 'a', label: 'A', weight: 1 }, { key: 'b', label: 'B', weight: 1 }] });
  loading.endAdmission();
  vi.advanceTimersByTime(300);
  const before = widths(loading);
  for (let second = 0; second < 30; second++) { now += 1000; vi.advanceTimersByTime(1000); }
  expect(widths(loading)).toEqual(before); // no creep: time alone moves nothing
  row = { ...row, completedBytes: 250, filesDone: 1 }; notify();
  expect(Number.parseFloat(widths(loading)[1] ?? '')).toBe(25);
  const timeline = currentLoadingTimeline();
  if (timeline === undefined) throw new Error('Missing timeline');
  timeline.begin('a').end(); timeline.begin('b'); now += 200; vi.advanceTimersByTime(200);
  expect(Number.parseFloat(widths(loading)[2] ?? '')).toBe(50);
  for (let second = 0; second < 10; second++) { now += 1000; vi.advanceTimersByTime(1000); }
  expect(Number.parseFloat(widths(loading)[2] ?? '')).toBe(50);
  loading.scope.dispose();
});

it('LS2: the ready card shows phase times whose tenths add up to its clock', () => {
  // 0.24 + 0.34 + 1.24 s is 1.82 s: rounding each alone shows 0.2 + 0.3 + 1.2 = 1.7, not the clock's 1.8
  const shown = phaseTenths([240, 340, 1240], 1820);
  expect(shown.reduce((sum, value) => sum + value, 0)).toBe(18);
  shown.forEach((value, index) => { expect(Math.abs(value - ([2.4, 3.4, 12.4][index] ?? 0))).toBeLessThan(1); });
  expect(phaseTenths([28_100, 14_000, 40_100], 82_200)).toEqual([281, 140, 401]);
  expect(()=>phaseTenths([0],1000)).toThrow('partition');
});

it.each([{scoped:true,download:false},{scoped:false,download:false},{scoped:true,download:true},{scoped:false,download:true}])(
  'accounts the actual ready card phases (%j)',async({scoped,download})=>{
    const loading=new Loading({id:'phase-accounting',name:'Phase accounting'},{scoped});
    try {
      loading.setPath({id:'accounting',steps:[{key:'work',label:'Work',weight:1}]});
      if(scoped)loading.scopedStep('work','Prepare work');else loading.waiting('Prepare work');
      if(download){
        let row={totalBytes:100,completedBytes:0,cachedBytes:0,filesTotal:1,filesDone:0,complete:false,error:null};
        let notify:()=>void=()=>undefined;
        void loading.setDownloadSource({ready:Promise.resolve(),snapshot:()=>row,subscribe:listener=>{notify=listener;listener();return()=>undefined;}});
        now=500;row={...row,completedBytes:100,filesDone:1,complete:true};notify();
      }
      now=1100;const done=loading.done();void done.catch(()=>undefined); // An assertion failure may retire the pending fade.
      expect(loading.phaseTimes()).toEqual({start:0,download:download?400:0,load:download?600:1000,total:1000});
      expect(loading.root.querySelector('[data-el="clock"]')?.textContent).toBe('00:01.0');
      expect(loading.root.querySelector('[data-el="suFact"]')?.textContent).toBe(`Done · ${download?'0.6':'1.0'} s`);
      if(download)expect(loading.root.querySelector('[data-el="dlFact"]')?.textContent).toBe('Done · 0.4 s');
      expect(loading.diagnosticsText()).toContain(`total 1.0 s · start 0.0 s · download ${download?'0.4':'0.0'} s · load ${download?'0.6':'1.0'} s`);
      await vi.advanceTimersByTimeAsync(317);await done;
    }finally{loading.scope.dispose();}
  });

it('freezes ready accounting and headings at one rounding-boundary instant through the hold',async()=>{
  setDev(true);setSetting('holdLoading',true);
  const loading=new Loading({id:'phase-hold',name:'Phase hold'});
  try{
    loading.waiting('Prepare work');
    const readyClock=vi.spyOn(performance,'now').mockImplementationOnce(()=>1149.99).mockImplementation(()=>1150.01);
    const done=loading.done(),times=loading.phaseTimes();void done.catch(()=>undefined);
    expect(times.total).toBeCloseTo(1049.99);expect(times.download).toBe(0);expect(times.load).toBeCloseTo(times.total);
    expect(loading.root.querySelector('[data-el="clock"]')?.textContent).toBe('00:01.0');
    expect(loading.root.querySelector('[data-el="suFact"]')?.textContent).toBe('Done · 1.0 s');
    readyClock.mockReturnValue(9100);await vi.advanceTimersByTimeAsync(1000);
    expect(loading.phaseTimes()).toEqual(times);expect(loading.root.querySelector('[data-el="clock"]')?.textContent).toBe('00:01.0');
    loading.root.querySelector<HTMLButtonElement>('.ws-load-play')?.click();await vi.advanceTimersByTimeAsync(317);await done;
  }finally{loading.scope.dispose();setSetting('holdLoading',false);setDev(false);}
});

it('copies complete useful timings without exporting private URLs, errors or free text',async()=>{
  const sentinel='PRIVATE_DIAGNOSTIC_SENTINEL',url=`https://user:${sentinel}@private.invalid/asset.bin?token=${sentinel}#${sentinel}`;
  const timing={version:1,build:'a84f050-mw7crm6l',attempt:'100',attemptCount:1,timeOrigin:100,
    entries:[{id:17,realm:'page',operation:'server:world-boot',start:10,end:20,result:'complete',detail:{message:sentinel,url,nested:{private:sentinel},done:3,total:4,phases:[{operation:'sw:cache-open',start:11,end:12,result:'complete',private:sentinel}]}}],
    resources:[{url,initiator:'fetch',realm:'page',startTime:1,responseEnd:2,decodedBodySize:100}],
    realms:{'worker:1':{purpose:sentinel,url,timeOrigin:1,messages:{count:1,first:2,last:3,kinds:{[sentinel]:1}}}},
    counters:{[`download:${url}`]:{loaded:100,total:200,unit:'decoded-body-bytes',at:20,events:1}},
    navigation:{responseEnd:2,name:url},active:[],lifecycle:[],paints:[],overflow:{},largestGap:{before:1,after:2,ms:1,visibility:'visible'},
    serviceWorker:{controller:url,private:sentinel},handoff:{input:{event:sentinel},private:sentinel},
    begin:()=>0,end:()=>undefined,mark:()=>undefined,progress:()=>undefined,finish:()=>undefined,read:():unknown=>timing};
  vi.stubGlobal('__bootTiming',timing);
  let copied='';vi.stubGlobal('navigator',{clipboard:{writeText:(text:string):Promise<void>=>{copied=text;return Promise.resolve();}}});
  const loading=new Loading({id:'private-path',name:sentinel},{scoped:true});
  try{
    void loading.setDownloadSource({ready:Promise.resolve(),snapshot:()=>({totalBytes:100,completedBytes:0,cachedBytes:0,filesTotal:1,filesDone:0,complete:false,error:sentinel}),subscribe:()=>()=>undefined});
    loading.scopedStep('private-step',sentinel);loading.scopedFail(sentinel);
    const button=loading.root.querySelector<HTMLButtonElement>('.ws-load-copy');if(button===null)throw new Error('Missing Copy diagnostics');
    button.click();await vi.advanceTimersByTimeAsync(0);
    expect(copied).not.toContain(sentinel);expect(copied).not.toContain('private.invalid');
    expect(copied).toContain('server:world-boot');
    const raw:unknown=JSON.parse(copied.split('timeline (LS1):\n')[1]??'null');
    expect(raw).toMatchObject({build:'a84f050-mw7crm6l',entries:[{id:17,start:10,end:20,detail:{done:3,total:4,phases:[{operation:'sw:cache-open',start:11,end:12,result:'complete'}]}}],
      resources:[{id:1,url:'resource-1',decodedBodySize:100}],
      counters:{'download:resource-1':{loaded:100,total:200,unit:'decoded-body-bytes'}},
      realms:[{realm:'worker:1',url:'resource-1',messages:{count:1}}],serviceWorker:{controller:'resource-1'}});
    expect(timing.resources[0]?.url).toBe(url);expect(timing.entries[0]?.detail.message).toBe(sentinel);
  }finally{loading.scope.dispose();}
});
