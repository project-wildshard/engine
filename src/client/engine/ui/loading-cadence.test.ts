// @vitest-environment happy-dom
import {afterEach,beforeEach,expect,test,vi} from 'vitest';
import {Loading} from './Loading';
import {frameCapAnchor} from '../core/Game';
import {frameCapFps,initializeTier,TIER,frameProbe} from '../core/tier';

const tier=TIER;
beforeEach(()=>{
  vi.useFakeTimers();vi.setSystemTime(0);
  vi.spyOn(performance,'now').mockImplementation(()=>Date.now());
});
afterEach(()=>{frameProbe.uncapped=false;initializeTier(tier);vi.useRealTimers();vi.unstubAllGlobals();document.body.replaceChildren();});

test('the loader clock samples exactly 10 Hz without an animation-frame chain',()=>{
  const frames=vi.spyOn(globalThis,'requestAnimationFrame'),loading=new Loading({id:'clock-cadence',name:'Clock cadence'},{scoped:true});
  const clock=loading.root.querySelector<HTMLElement>('[data-el="clock"]');
  if(clock===null)throw new Error('Missing real loader clock');
  const writes=vi.spyOn(clock,'textContent','set'),reads=vi.spyOn(clock,'textContent','get');
  try{
    vi.advanceTimersByTime(1000);
    expect(reads).toHaveBeenCalledTimes(10);
    expect(clock.textContent).toBe('00:01.0');expect(writes).toHaveBeenCalledTimes(10);
    expect(frames).not.toHaveBeenCalled();
    loading.scope.dispose();vi.advanceTimersByTime(1000);
    expect(writes).toHaveBeenCalledTimes(10);expect(frames).not.toHaveBeenCalled();
  }finally{loading.scope.dispose();}
});

test('completion freezes the clock and retains the original two-frame fade',async()=>{
  const frames=vi.spyOn(globalThis,'requestAnimationFrame'),loading=new Loading({id:'clock-completion',name:'Clock completion'},{scoped:true});
  const clock=loading.root.querySelector<HTMLElement>('[data-el="clock"]');
  if(clock===null)throw new Error('Missing real loader clock');
  try{
    vi.advanceTimersByTime(450);const finished=loading.done(),frozen=clock.textContent;
    await vi.advanceTimersByTimeAsync(1000);await finished;
    expect(clock.textContent).toBe(frozen);expect(frames).toHaveBeenCalledTimes(2);
    expect(loading.scope.disposed).toBe(true);
  }finally{loading.scope.dispose();}
});

test.each([60,120])('G896 keeps the independent phone loop at30 on a %sHz display',hz=>{
  vi.stubGlobal('location',new URL('https://example.invalid/'));
  initializeTier('phone');const cap=frameCapFps();expect(cap).toBe(30);
  let anchor=Number.NEGATIVE_INFINITY,draws=0;
  for(let tick=0;tick<hz*2;tick++){
    const next=frameCapAnchor(anchor,tick*1000/hz,cap);
    if(next!==null){anchor=next;draws++;}
  }
  expect(draws).toBe(60);
});
