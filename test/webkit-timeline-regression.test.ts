import {expect, test, vi} from 'vitest';
import {startScriptProfile} from '../scripts/frame-floor-script-profile.mjs';
import {ensureWebKitPageClock, startWebKitTimeline, timelineLongFrames, type TimelinePort} from '../scripts/frame-floor-webkit-timeline.mjs';
import {createWebKitTimelineSession} from '../scripts/frame-floor-timeline-session';

function fixture(frozen = false) {
  let enabled = false, pageMs = 1000;
  const listeners = new Map<string, (params: unknown) => void>();
  const methods: string[] = [];
  const inspector: TimelinePort = {
    send: method => {
      methods.push(method);
      if (method === 'Page.enable') enabled = true;
      return Promise.resolve({});
    },
    on: (method, receive) => {
      listeners.set(method, receive);
      return () => { listeners.delete(method); };
    },
  };
  const evaluate = (): Promise<unknown> => {
    pageMs += 100;
    listeners.get('Timeline.eventRecorded')?.({record: {type: 'TimeStamp', startTime: enabled && !frozen ? pageMs / 1000 : 0,
      data: {message: `ff-anchor:${pageMs}`}}});
    return Promise.resolve(true);
  };
  return {inspector, evaluate, methods, listening: () => listeners.size > 0, emit: (method: string, params: unknown) => listeners.get(method)?.(params)};
}

test('flushes a final clock point buffered until Timeline.stop on a static page', async () => {
  vi.useFakeTimers();
  try {
    const f = fixture();
    let first = true, buffered = false;
    const inspector: TimelinePort = { ...f.inspector, send: method => {
      if (method === 'Timeline.stop' && buffered)
        f.emit('Timeline.eventRecorded', {record: {type: 'TimeStamp', startTime: 1.2, data: {message: 'ff-anchor:1200'}}});
      return f.inspector.send(method);
    } };
    const evaluate = (): Promise<unknown> => {
      if (first) { first = false; return f.evaluate(); }
      buffered = true;
      return Promise.resolve(true);
    };
    const stop = await startWebKitTimeline(inspector, evaluate);
    const stopped = (async () => { try { return {value: await stop()}; } catch (error) { return {error}; } })();
    await vi.advanceTimersByTimeAsync(5001);
    expect(await stopped).toMatchObject({value: {anchors: [[1.1, 1100], [1.2, 1200]]}});
    expect(f.methods.filter(method => method === 'Timeline.stop')).toHaveLength(1);
    expect(f.listening()).toBe(false);
  } finally { vi.useRealTimers(); }
});

test('starts the real Inspector clock before taking timeline anchors', async () => {
  const f = fixture();
  const stop = await startWebKitTimeline(f.inspector, f.evaluate);
  expect(f.methods.slice(0, 4)).toEqual(['Page.enable', 'Heap.enable', 'Timeline.enable', 'Timeline.start']);
  const first = await stop();
  expect(first.anchors).toEqual([[1.1, 1100], [1.2, 1200]]);
  expect(f.listening()).toBe(false);
  const next = await (await startWebKitTimeline(f.inspector, f.evaluate))();
  expect(next.anchors).toEqual([[1.3, 1300], [1.4, 1400]]);
  expect(f.methods.filter(method => method === 'Page.enable')).toHaveLength(1);
});

test('refuses zero anchors before returning a drive recorder and cleans up', async () => {
  const f = fixture(true);
  await expect(startWebKitTimeline(f.inspector, f.evaluate)).rejects.toThrow('zero or invalid anchor');
  expect(f.methods).toEqual(['Page.enable', 'Heap.enable', 'Timeline.enable', 'Timeline.start', 'Timeline.stop']);
  expect(f.listening()).toBe(false);
  const result = timelineLongFrames({records: [], anchors: [[0, 1000], [0, 2000]]}, [[1100, 200]]);
  expect(result.valid).toBe(false);
  expect(result.frames.every(frame => frame.verdict === 'unproven')).toBe(true);
});

test('waits for the anchor event after the evaluation response', async () => {
  let receive: ((params: unknown) => void) | undefined;
  const inspector: TimelinePort = {
    send: () => Promise.resolve({}),
    on: (method, listener) => {
      if (method !== 'Timeline.eventRecorded') return () => undefined;
      receive = listener; return () => { receive = undefined; };
    },
  };
  let at = 1000;
  const evaluate = (): Promise<unknown> => {
    at += 100;
    const stamp = at;
    setTimeout(() => receive?.({record: {type: 'TimeStamp', startTime: stamp / 1000,
      data: {message: `ff-anchor:${stamp}`}}}), 5);
    return Promise.resolve(true);
  };
  const stop = await startWebKitTimeline(inspector, evaluate);
  expect(receive).toBeDefined();
  const result = await stop();
  expect(result.anchors).toEqual([[1.1, 1100], [1.2, 1200]]);
  expect(receive).toBeUndefined();
});

test('refuses Page setup failures without leaving a listener or starting capture', async () => {
  const f = fixture();
  const calls: string[] = [];
  const inspector: TimelinePort = {...f.inspector, send: method => { calls.push(method); return Promise.reject(new Error('Page refused')); }};
  await expect(startWebKitTimeline(inspector, f.evaluate)).rejects.toThrow('Page refused');
  expect(f.listening()).toBe(false);
  expect(calls).toEqual(['Page.enable']);
});


test('retains passive GC events without requesting GC or snapshots', async () => {
  const f = fixture();
  const stop = await startWebKitTimeline(f.inspector, f.evaluate);
  const collection = {collection: {type: 'partial', startTime: 1.11, endTime: 1.12}};
  f.emit('Heap.garbageCollected', collection);
  const result = await stop();
  expect(result.garbageCollection).toEqual({available: true, events: [collection], dropped: 0});
  expect(f.methods.filter(method => method.startsWith('Heap.'))).toEqual(['Heap.enable']);
  expect(f.listening()).toBe(false);
  const noHeap: TimelinePort = {...f.inspector, send: method => method === 'Heap.enable'
    ? Promise.reject(new Error('unsupported')) : f.inspector.send(method)};
  const unavailable = await (await startWebKitTimeline(noHeap, f.evaluate))();
  expect(unavailable.garbageCollection).toEqual({available: false, events: [], dropped: 0});
});


test('admits known instantaneous events without counting them as busy coverage', () => {
  const duration = {type: 'RenderingFrame', startTime: 1, endTime: 1.01,
    children: [{type: 'FireAnimationFrame', startTime: 1.001, endTime: 1.005}]};
  const points = ['ScheduleStyleRecalculation', 'TimerInstall', 'TimerRemove', 'RequestAnimationFrame']
    .map(type => ({type, startTime: 1.005}));
  const anchors: [number, number][] = [[1, 1000], [1.016, 1016]];
  const base = timelineLongFrames({records: [duration], anchors}, [[1000, 16]]);
  const withPoints = timelineLongFrames({records: [duration, ...points], anchors}, [[1000, 16]]);
  expect(base.valid).toBe(true);
  expect(withPoints.frames).toEqual(base.frames);
  expect(withPoints.valid).toBe(true);
  const unknown = timelineLongFrames({records: [duration, {type: 'Unknown', startTime: 1.005}], anchors}, [[1000, 16]]);
  expect(unknown.valid).toBe(false);
  expect(unknown.invalid).toContain('1 records without a finite positive span');
  const sparse = timelineLongFrames({records: [duration, ...points], anchors: [[1, 1000], [2, 2000]]}, [[1000, 16]]);
  expect(sparse.valid).toBe(false);
  expect(sparse.invalid.some(reason => reason.includes('coverage'))).toBe(true);
});


test.each(['profile-first', 'timeline-first'])('both recorders share one Page clock (%s)', async order => {
  const f = fixture();
  const stopTimeline = order === 'timeline-first' ? await startWebKitTimeline(f.inspector, f.evaluate) : undefined;
  const stopProfile = await startScriptProfile(f.inspector);
  const stop = stopTimeline ?? await startWebKitTimeline(f.inspector, f.evaluate);
  const timeline = await stop();
  expect(timeline.anchors.every(([seconds]) => seconds > 0)).toBe(true);
  expect(f.methods.indexOf('Page.enable')).toBeLessThan(f.methods.indexOf('ScriptProfiler.startTracking'));
  const finishing = stopProfile(), profile = {samples: {stackTraces: []}};
  f.emit('ScriptProfiler.trackingComplete', profile);
  expect(await finishing).toBe(profile);
  expect(f.methods.filter(method => method === 'Page.enable')).toHaveLength(1);
  expect(f.listening()).toBe(false);
});

test('a ScriptProfiler clock refusal starts no recording and leaves no listener', async () => {
  const f = fixture(), calls: string[] = [];
  const inspector: TimelinePort = {...f.inspector, send: method => { calls.push(method); return Promise.reject(new Error('Page refused')); }};
  await expect(startScriptProfile(inspector)).rejects.toThrow('Page refused');
  expect(calls).toEqual(['Page.enable']); expect(f.listening()).toBe(false);
});


test('concurrent recorders await the same clock admission without resetting it', async () => {
  let release = (): void => undefined;
  const pending = new Promise<void>(resolve => { release = resolve; });
  const methods: string[] = [];
  const inspector: TimelinePort = {send: method => { methods.push(method); return pending; }, on: () => () => undefined};
  const first = ensureWebKitPageClock(inspector), second = ensureWebKitPageClock(inspector);
  expect(methods).toEqual(['Page.enable']);
  release(); await Promise.all([first, second]);
  await ensureWebKitPageClock(inspector); expect(methods).toEqual(['Page.enable']);
});

test('a stop timeout retains raw records, clock anchors and its named reason without another stop', async () => {
  const f = fixture(), inspector: TimelinePort = { ...f.inspector, send: method => {
    const sent = f.inspector.send(method);
    return method === 'Timeline.stop' ? Promise.reject(new Error('Web Inspector timed out: Timeline.stop')) : sent;
  } };
  const stop = await startWebKitTimeline(inspector, f.evaluate);
  const capture = await stop();
  expect(capture.anchors).toEqual([[1.1, 1100], [1.2, 1200]]);
  expect(capture.records).toHaveLength(2);
  expect(capture.incomplete).toEqual(['Web Inspector timed out: Timeline.stop']);
  expect(f.methods.filter(method => method === 'Timeline.stop')).toHaveLength(1);
  expect(timelineLongFrames(capture, []).invalid).toContain('Web Inspector timed out: Timeline.stop');
  expect(f.listening()).toBe(false);
});

function changingTarget(name = 'page') {
  let clock = {}, targetId = `${name}-1`, pageMs = 1000;
  const listeners = new Map<string, Set<(value: unknown) => void>>();
  const methods: { method: string; target: string }[] = [];
  const emit = (method: string, value: unknown): void => { for (const listener of listeners.get(method) ?? []) listener(value); };
  let pendingStart: (() => void) | undefined;
  const port: TimelinePort = {
    get clock() { return clock; }, get targetId() { return targetId; },
    send(method) {
      methods.push({method, target: targetId});
      if (method === 'Timeline.start' && pendingStart !== undefined) {
        const notify = pendingStart; pendingStart = undefined; notify();
        return new Promise(() => { /* The removed target never acknowledges this command. */ });
      }
      return Promise.resolve({});
    },
    on(method, listener) {
      const set = listeners.get(method) ?? new Set(); set.add(listener); listeners.set(method, set);
      return () => { set.delete(listener); if (set.size === 0) listeners.delete(method); };
    },
  };
  return {port, methods,
    evaluate: (): Promise<unknown> => {
      pageMs += 100;
      emit('Timeline.eventRecorded', {record: {type: 'TimeStamp', startTime: pageMs / 1000, data: {message: `ff-anchor:${pageMs}`}}});
      return Promise.resolve(true);
    },
    swap: (): void => { const previousTargetId = targetId; targetId = `${name}-2`; clock = {}; emit('Target.changed', {previousTargetId, targetId}); },
    holdNextStart: (): Promise<void> => new Promise(resolve => { pendingStart = resolve; }),
    listening: (): number => listeners.size,
  };
}

test('an actual target swap reattaches recording once and retains separate positive clock segments', async () => {
  const f = changingTarget(), session = createWebKitTimelineSession(); session.attach(f.port, f.evaluate);
  const stop = await session.start(); f.swap();
  const capture = await stop(); session.close();
  expect(capture.segments).toHaveLength(2);
  expect(capture.segments?.map(segment => segment.targetId)).toEqual(['page-1', 'page-2']);
  expect(capture.segments?.[0]?.incomplete).toContain('Inspector target changed');
  expect(capture.segments?.[1]?.anchors).toHaveLength(2);
  expect(capture.segments?.every(segment => segment.anchors.every(([time]) => time > 0))).toBe(true);
  expect(f.methods.filter(row => row.method === 'Page.enable')).toHaveLength(2);
  expect(f.methods.filter(row => row.method === 'Timeline.start')).toHaveLength(2);
  expect(f.methods.filter(row => row.method === 'Timeline.stop').map(row => row.target)).toEqual(['page-2']);
  expect(timelineLongFrames(capture, []).valid).toBe(false);
  expect(f.listening()).toBe(0);
});

test('a replacement Inspector connection keeps the old prefix and starts the new connection clock', async () => {
  const first = changingTarget('first'), second = changingTarget('second'), session = createWebKitTimelineSession();
  session.attach(first.port, first.evaluate); const stop = await session.start();
  session.attach(second.port, second.evaluate);
  const capture = await stop(); session.close();
  expect(capture.segments?.[0]?.incomplete).toContain('Inspector connection replaced');
  expect(capture.segments?.[0]?.anchors).toHaveLength(1);
  expect(capture.segments?.[1]?.anchors).toHaveLength(2);
  expect(first.methods.some(row => row.method === 'Timeline.stop')).toBe(false);
  expect(second.methods.filter(row => row.method === 'Timeline.start')).toHaveLength(1);
  expect(first.listening() + second.listening()).toBe(0);
});

test('a target change interrupts a lost startup command without replaying page work', async () => {
  const f = changingTarget(), reached = f.holdNextStart(), session = createWebKitTimelineSession();
  session.attach(f.port, f.evaluate); const starting = session.start();
  await reached; f.swap();
  const capture = await (await starting)(); session.close();
  expect(capture.segments).toHaveLength(2);
  expect(capture.segments?.[0]?.records).toHaveLength(0);
  expect(capture.segments?.[1]?.anchors).toHaveLength(2);
  expect(f.methods.filter(row => row.method === 'Timeline.start')).toHaveLength(2);
  expect(f.listening()).toBe(0);
});
