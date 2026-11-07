// @vitest-environment happy-dom
import {afterEach,beforeEach,expect,test,vi} from 'vitest';
import {Scope,scopeRegistrations,setScopeTimersActive} from '../../../../shared/engine/app/scope';
import {installPageActivity} from './pageActivity';
import {installBrowserScopeEnvironment,setBrowserFramesActive} from './scopeEnvironment';

class Page extends EventTarget {visibilityState:DocumentVisibilityState='visible';}
const owners:Scope[]=[],nativeFrames=new Map<number,FrameRequestCallback>();
let nextFrame=0;
const present=():void=>{const batch=[...nativeFrames.values()];nativeFrames.clear();for(const render of batch)render(performance.now());};
beforeEach(()=>{
  vi.useFakeTimers();vi.setSystemTime(0);vi.spyOn(performance,'now').mockImplementation(()=>Date.now());
  nativeFrames.clear();nextFrame=0;
  vi.stubGlobal('requestAnimationFrame',(render:FrameRequestCallback):number=>{const id=++nextFrame;nativeFrames.set(id,render);return id;});
  vi.stubGlobal('cancelAnimationFrame',(id:number):void=>{nativeFrames.delete(id);});installBrowserScopeEnvironment();
});
afterEach(()=>{for(const scope of owners.splice(0))scope.dispose();setScopeTimersActive(true);setBrowserFramesActive(true);vi.useRealTimers();vi.unstubAllGlobals();});
const own=():Scope=>{const scope=new Scope('page-activity-test');owners.push(scope);return scope;};

test('hide removes every native owned timer/carrier; show resumes the same owners once',()=>{
  const page=new Page(),root=own(),child=root.child('work'),timeout=vi.fn<()=>void>(),interval=vi.fn<()=>void>(),frame=vi.fn<()=>void>();
  installPageActivity(root,page);child.timeout(100,timeout);child.interval(50,interval);child.raf(frame);
  page.visibilityState='hidden';page.dispatchEvent(new Event('visibilitychange'));
  expect(vi.getTimerCount()).toBe(0);expect(nativeFrames.size).toBe(0);expect(scopeRegistrations(scope=>scope===child).timers).toEqual({timeouts:0,intervals:0,raf:0});
  vi.advanceTimersByTime(10000);expect(timeout).not.toHaveBeenCalled();expect(interval).not.toHaveBeenCalled();expect(frame).not.toHaveBeenCalled();
  page.visibilityState='visible';page.dispatchEvent(new Event('visibilitychange'));vi.advanceTimersByTime(100);present();
  expect(timeout).toHaveBeenCalledOnce();expect(interval).toHaveBeenCalledTimes(2);expect(frame).toHaveBeenCalledOnce();
});

test('two logical scope frames keep one native carrier registration and independent cancellation',()=>{
  const page=new Page(),root=own(),first=own(),second=own(),a=vi.fn<()=>void>(),b=vi.fn<()=>void>();installPageActivity(root,page);
  first.raf(a);const id=second.raf(b);
  expect(nativeFrames.size).toBe(1);expect(scopeRegistrations(scope=>scope===first||scope===second).timers.raf).toBe(1);
  second.cancelRaf(id);present();expect(a).toHaveBeenCalledOnce();expect(b).not.toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(0);expect(nativeFrames.size).toBe(0);
});
