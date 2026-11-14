import {expect, test} from 'vitest';
import {LiveGridSession} from './liveSession';

test('travel facts stay fresh without invoking retained-program and debug readers', () => {
  const value: unknown = Object.create(LiveGridSession.prototype);
  if (!(value instanceof LiveGridSession)) throw new Error('Missing live session prototype');
  let current: string | null = 'home', phase = 'idle', issue: string | null = null, reads = 0;
  const host = {state: () => { reads++; return {current, gameplayReady: current !== null, pending: current === null ? ['next'] : []}; }};
  const crossing = {state: () => ({phase, issue}), timings: () => { throw new Error('Unused crossing history'); }};
  const runtime = {timings: () => ({current: current === null ? {instance: 'next', hook: 'world', start: 10} : null, completed: []})};
  Reflect.set(value, 'live', host); Reflect.set(value, 'crossing', {crossing}); Reflect.set(value, 'hybrid', runtime);
  for (const field of ['page', 'keeper', 'bootPrograms', 'offset', 'leaveTiming']) {
    Object.defineProperty(value, field, {get: () => { throw new Error(`Unused debug field ${field}`); }});
  }
  const first = value.travelState();
  expect(first).toEqual({live: {current: 'home', gameplayReady: true, pending: []}, crossing: {phase: 'idle', issue: null},
    runtimeTiming: {current: null, completed: []}});
  current = null; phase = 'blocked'; issue = 'exact refusal';
  const second = value.travelState();
  expect(second.live).toEqual({current: null, gameplayReady: false, pending: ['next']});
  expect(second.crossing).toEqual({phase: 'blocked', issue: 'exact refusal'});
  expect(second.runtimeTiming.current).toEqual({instance: 'next', hook: 'world', start: 10});
  expect(first.live.current).toBe('home'); expect(first.crossing.phase).toBe('idle');
  expect(second).not.toBe(first); expect(reads).toBe(2);
});

test('GC6: a world built ahead stays unenterable while its entry is deferred or preparing on the road', () => {
  // QA 11-14 row 6: inside the cell its gameplay gate stops the page's frames, and that preparation waits on drawn frames
  const value: unknown = Object.create(LiveGridSession.prototype);
  if (!(value instanceof LiveGridSession)) throw new Error('Missing live session prototype');
  const deferred = new Map<string, unknown>([['nalati', {}]]), preparing: string[] = [];
  const queued = new Set<string>();
  Reflect.set(value, 'deferredEntries', deferred); Reflect.set(value, 'queuedEntries', queued); Reflect.set(value, 'hybrid', {preparing: () => preparing});
  expect(value.entryPending('nalati')).toBe(true);
  deferred.clear(); queued.add('nalati');
  expect(value.entryPending('nalati')).toBe(true); // queued behind another entry's preparation
  queued.clear(); preparing.push('nalati');
  expect(value.entryPending('nalati')).toBe(true);
  preparing.length = 0;
  expect(value.entryPending('nalati')).toBe(false);
  expect(value.entryPending('driftwood')).toBe(false);
});
