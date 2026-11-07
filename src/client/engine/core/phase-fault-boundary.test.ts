import { afterEach, expect, test, vi } from 'vitest';
import { Game } from './Game';
import { TickScheduler } from '../../../shared/engine/app/scheduler';
import { Scope } from '../../../shared/engine/app/scope';
import type { AppState, SystemSpec } from '../app/systems';
import { Events } from '../../../shared/engine/events/events';
import { FAULT_STREAK, loopState, onFault, setLoopState, type Fault, type GameSystem } from '../../../shared/engine/core/faults';

afterEach(() => { vi.restoreAllMocks(); setLoopState('boot'); });

function invoke(host: object, name: string, args: readonly unknown[]): void {
  const method: unknown = Reflect.get(Game.prototype, name);
  if (typeof method !== 'function') throw new Error(`Missing Game method ${name}`);
  Reflect.apply(method, host, args);
}

/** Execute the actual frame/fault/event methods without creating a WebGL context. */
function fixture(systems: readonly SystemSpec[]) {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  const reports: Fault[] = [], stop = onFault(fault => { reports.push(fault); });
  let state: AppState = 'play';
  const app = { scheduler: new TickScheduler(), events: new Events(),
    get state(): AppState { return state; }, setState(next: AppState): void { state = next; },
    systemsByPhase: () => ({ update: systems }),
  };
  const host = { app, faultSystems: new WeakMap<SystemSpec, GameSystem<SystemSpec['run']>>(),
    clock: { elapsedTime: 0 }, frameNo: 0, dead: false,
    fault(this: object, system: GameSystem<unknown>, error: unknown): void { invoke(this, 'fault', [system, error]); },
    flushEvents(this: object, phase: string): void { invoke(this, 'flushEvents', [phase]); },
  };
  setLoopState('running');
  return { app, host, reports, stop, frame: (): void => {
    host.frameNo++; host.clock.elapsedTime += .01; invoke(host, 'runPhase', ['update', .01, host.clock.elapsedTime]);
  } };
}

test('a refused predicate skips only its system, reports once and recovers next frame', () => {
  const error = new Error('predicate refused'), run = vi.fn<(dt: number, t: number) => void>();
  const healthy = vi.fn<(dt: number, t: number) => void>(); let refuse = true;
  const f = fixture([{ id: 'test.predicate', phase: 'update', when: () => {
    if (refuse) throw error; return true;
  }, run }, { id: 'test.healthy', phase: 'update', run: healthy }]);
  try {
    for (let i = 0; i < 4; i++) f.frame();
    expect(run).not.toHaveBeenCalled(); expect(healthy).toHaveBeenCalledTimes(4);
    expect(f.reports).toEqual([{ system: 'test.predicate', error, verdict: 'uncaught' }]);
    expect(f.host.dead).toBe(false); expect(loopState()).toBe('running');
    refuse = false; f.frame();
    expect(run).toHaveBeenCalledExactlyOnceWith(.01, .05); expect(healthy).toHaveBeenCalledTimes(5);
    expect(f.reports).toHaveLength(1);
  } finally { f.stop(); }
});

test('a missing rate preserves its refusal, later systems and an unspent clock', () => {
  const run = vi.fn<(dt: number, t: number) => void>(), healthy = vi.fn<(dt: number, t: number) => void>();
  const f = fixture([{ id: 'test.rate', phase: 'update', tick: 'late-rate', run },
    { id: 'test.healthy', phase: 'update', run: healthy }]);
  try {
    for (let i = 0; i < 4; i++) f.frame();
    expect(run).not.toHaveBeenCalled(); expect(healthy).toHaveBeenCalledTimes(4);
    expect(f.reports).toHaveLength(1); expect(f.reports[0]?.system).toBe('test.rate');
    expect(f.reports[0]?.error).toEqual(new Error('Unknown tick rate: late-rate'));
    expect(f.reports[0]?.verdict).toBe('uncaught'); expect(f.host.dead).toBe(false);
    f.app.scheduler.rate('late-rate', { bands: [{ upTo: Infinity, brainHz: Infinity, body: 'frame' }] });
    f.frame(); expect(run).toHaveBeenCalledExactlyOnceWith(.01, .05);
    expect(healthy).toHaveBeenCalledTimes(5); expect(f.reports).toHaveLength(1);
  } finally { f.stop(); }
});

test('false predicates and paused schedules still skip without reports', () => {
  const run = vi.fn<(dt: number, t: number) => void>(), healthy = vi.fn<(dt: number, t: number) => void>();
  const f = fixture([{ id: 'test.false', phase: 'update', when: () => false, run },
    { id: 'test.sleep', phase: 'update', tick: 'sleep', run }, { id: 'test.healthy', phase: 'update', run: healthy }]);
  try {
    f.app.scheduler.rate('sleep', { bands: [{ upTo: Infinity, brainHz: 'paused', body: 'paused' }] });
    f.frame(); expect(run).not.toHaveBeenCalled(); expect(healthy).toHaveBeenCalledExactlyOnceWith(.01, .01);
    expect(f.reports).toEqual([]); expect(f.host.dead).toBe(false);
  } finally { f.stop(); }
});

test('core predicate failures keep the original fatal streak policy', () => {
  const error = new Error('core predicate refused'), run = vi.fn<(dt: number, t: number) => void>();
  const f = fixture([{ id: 'test.core', phase: 'update', core: true, when: () => { throw error; }, run }]);
  try {
    for (let i = 0; i < FAULT_STREAK; i++) f.frame();
    expect(run).not.toHaveBeenCalled(); expect(f.host.dead).toBe(true); expect(f.app.state).toBe('error');
    expect(f.reports).toEqual([{ system: 'test.core', error, verdict: 'uncaught' }, { system: 'test.core', error, verdict: 'fatal' }]);
  } finally { f.stop(); }
});


test('a refused predicate still flushes healthy queued events at the phase boundary', () => {
  const error = new Error('refused bookkeeping'), owner = new Scope('phase-events');
  const f = fixture([{ id: 'test.refused', phase: 'update', when: () => { throw error; }, run: () => undefined },
    { id: 'test.emit', phase: 'update', run: () => { f.app.events.emit('level.loaded', { id: 'fixture' }); } }]);
  const received: string[] = [];
  f.app.events.on('level.loaded', event => { received.push(event.id); }, owner);
  try {
    f.frame(); f.frame();
    expect(received).toEqual(['fixture', 'fixture']);
    expect(f.reports).toEqual([{ system: 'test.refused', error, verdict: 'uncaught' }]);
    expect(f.host.dead).toBe(false);
  } finally { f.stop(); owner.dispose(); }
});
