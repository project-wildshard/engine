import {afterEach,beforeEach,expect,test,vi} from 'vitest';
import {Scope,scopeRegistrations,setScopeTimersActive} from './scope';

const owners:Scope[]=[];
const own=():Scope=>{const scope=new Scope('activity-test');owners.push(scope);return scope;};
beforeEach(()=>{vi.useFakeTimers();vi.setSystemTime(0);vi.spyOn(performance,'now').mockImplementation(()=>Date.now());});
afterEach(()=>{for(const owner of owners.splice(0))owner.dispose();setScopeTimersActive(true);vi.useRealTimers();});

test('hidden owners have no native timer callbacks and overdue timeouts resume once',()=>{
  const owner=own(),run=vi.fn<()=>void>();owner.timeout(100,run);
  vi.advanceTimersByTime(25);setScopeTimersActive(false);
  expect(vi.getTimerCount()).toBe(0);expect(scopeRegistrations(scope=>scope===owner).timers.timeouts).toBe(0);
  vi.advanceTimersByTime(1000);expect(run).not.toHaveBeenCalled();
  setScopeTimersActive(true);vi.advanceTimersByTime(0);expect(run).toHaveBeenCalledOnce();
  expect(vi.getTimerCount()).toBe(0);
});

test('intervals stop natively and resume without catching up hidden ticks',()=>{
  const owner=own(),run=vi.fn<()=>void>();owner.interval(100,run);
  vi.advanceTimersByTime(200);expect(run).toHaveBeenCalledTimes(2);
  setScopeTimersActive(false);vi.advanceTimersByTime(10000);expect(vi.getTimerCount()).toBe(0);expect(run).toHaveBeenCalledTimes(2);
  setScopeTimersActive(true);vi.advanceTimersByTime(100);expect(run).toHaveBeenCalledTimes(3);
  setScopeTimersActive(true);vi.advanceTimersByTime(100);expect(run).toHaveBeenCalledTimes(4);expect(vi.getTimerCount()).toBe(1);
});

test('work registered while hidden remains owned without a native timer',()=>{
  const owner=own(),run=vi.fn<()=>void>();setScopeTimersActive(false);
  owner.timeout(50,run);owner.interval(100,run);
  expect(vi.getTimerCount()).toBe(0);expect(owner.census.timers).toBe(2);
  setScopeTimersActive(true);vi.advanceTimersByTime(100);expect(run).toHaveBeenCalledTimes(2);
});

test('the original cancellation handle survives a hide/show reschedule',()=>{
  const owner=own(),run=vi.fn<()=>void>(),id=owner.interval(100,run);
  setScopeTimersActive(false);setScopeTimersActive(true);owner.cancelTimer(id);
  vi.advanceTimersByTime(1000);expect(run).not.toHaveBeenCalled();expect(vi.getTimerCount()).toBe(0);expect(owner.census.timers).toBe(0);
});

test('retirement while hidden cannot revive callbacks on show',()=>{
  const owner=own(),run=vi.fn<()=>void>();owner.timeout(10,run);owner.interval(20,run);
  setScopeTimersActive(false);owner.dispose();setScopeTimersActive(true);vi.advanceTimersByTime(1000);
  expect(run).not.toHaveBeenCalled();expect(vi.getTimerCount()).toBe(0);expect(owner.census.timers).toBe(0);
});

test('a hidden interval callback cannot arm running child work',()=>{
  const owner=own(),later=vi.fn<()=>void>();
  owner.interval(100,()=>{setScopeTimersActive(false);owner.timeout(50,later);});
  vi.advanceTimersByTime(100);expect(vi.getTimerCount()).toBe(0);vi.advanceTimersByTime(1000);expect(later).not.toHaveBeenCalled();
  setScopeTimersActive(true);vi.advanceTimersByTime(0);expect(later).toHaveBeenCalledOnce();
});
