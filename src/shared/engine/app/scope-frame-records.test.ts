// oxlint-disable-next-line import/no-nodejs-modules -- Prove callback collection in an isolated native GC child.
import { execFileSync } from 'node:child_process';
// oxlint-disable-next-line import/no-nodejs-modules -- Own only this focused child configuration under repository tmp.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Resolve the canonical temporary-run wrapper and literal child fixture.
import { resolve as resolvePath } from 'node:path';
import { BufferGeometry, Float32BufferAttribute } from 'three';
import { expect, test } from 'vitest';
import { Scope, scopeRegistrations } from './scope';
import { currentOwner } from './ownership';
import { installScopeEnvironment, scopeEnvironment } from './scopeEnvironment';

function environment() {
  const native = scopeEnvironment(), queued = new Map<number, FrameRequestCallback>(), cancelled: number[] = [];
  let next = 0;
  const manual = { ...native, sharedFrames: false, frame: (fn: FrameRequestCallback): number => { const id = next++; queued.set(id, fn); return id; },
    cancelFrame: (id: number): void => { cancelled.push(id); queued.delete(id); } };
  installScopeEnvironment(manual);
  const fire = (id: number, at: number): void => {
    const fn = queued.get(id); if (fn === undefined) throw new Error('Missing pending native callback');
    queued.delete(id); fn(at);
  };
  return { native, manual, queued, cancelled, fire };
}

test('recursive frames preserve one pending census, exact timestamps, ownership and registration order', () => {
  const f = environment(), scope = new Scope('recursive-frame'), events: string[] = [], callbacks = new Set<FrameRequestCallback>();
  let id = -1, frames = 0;
  const run = (time: number): void => {
    expect(currentOwner()).toBe(scope); expect(time).toBe(frames + .25); frames++;
    expect(scope.census.rafs).toBe(0); expect(scopeRegistrations(owner => owner === scope).timers.raf).toBe(0);
    if (frames < 1000) id = scope.raf(run);
  };
  try {
    scope.onDispose(() => { events.push('first'); }); id = scope.raf(run);
    for (let frame = 0; frame < 1000; frame++) {
      expect(f.queued.size).toBe(1); expect(scope.census.rafs).toBe(1);
      expect(scopeRegistrations(owner => owner === scope).timers.raf).toBe(1);
      const native = f.queued.get(id); if (native === undefined) throw new Error('Missing frame callback'); callbacks.add(native);
      f.fire(id, frame + .25);
    }
    expect(callbacks.size).toBeLessThanOrEqual(2); expect(scope.census.rafs).toBe(0); expect(f.queued.size).toBe(0);
    scope.raf(() => { events.push('unexpected'); }); scope.onDispose(() => { events.push('last'); }); scope.dispose();
    expect(events).toEqual(['last', 'first']); expect(f.queued.size).toBe(0);
    expect(scopeRegistrations(owner => owner === scope).timers.raf).toBe(0);
  } finally { scope.dispose(); installScopeEnvironment(f.native); }
});

test('multiple equal callbacks retain independent ids, cancellation and already-dispatched callback values', () => {
  const f = environment(), scope = new Scope('multiple-frames'), seen: string[] = [];
  try {
    const fn = (time: number): void => { seen.push(`shared:${String(time)}`); };
    const first = scope.raf(fn), second = scope.raf(fn), cancelled = scope.raf(() => { seen.push('cancelled-original'); });
    const dispatched = f.queued.get(cancelled); if (dispatched === undefined) throw new Error('Missing dispatched callback');
    scope.cancelRaf(cancelled); scope.cancelRaf(cancelled);
    const newer = scope.raf(() => { seen.push('newer'); });
    expect(scope.census.rafs).toBe(3); expect(f.cancelled).toEqual([cancelled]);
    dispatched(10); expect(seen).toEqual(['cancelled-original']); expect(scope.census.rafs).toBe(3);
    f.fire(second, 2); f.fire(first, 1); f.fire(newer, 3);
    expect(seen).toEqual(['cancelled-original', 'shared:2', 'shared:1', 'newer']); expect(scope.census.rafs).toBe(0);
  } finally { scope.dispose(); installScopeEnvironment(f.native); }
});

test('callback failures leave recursive requests tracked and owners restored for sliced teardown', () => {
  const f = environment(), scope = new Scope('throwing-frame'), outer = new Scope('outside-frame'); let next = -1;
  try {
    const id = scope.raf(() => { next = scope.raf(() => { throw new Error('Must retire this request'); }); throw new Error('original callback failure'); });
    outer.run(() => { expect(() => { f.fire(id, 0); }).toThrow('original callback failure'); expect(currentOwner()).toBe(outer); });
    expect(scope.census.rafs).toBe(1); expect(f.queued.has(next)).toBe(true);
    expect([...scope.disposeSteps()].map(step => step.kind)).toEqual(['rafs']); expect(f.queued.size).toBe(0);
    expect(scopeRegistrations(owner => owner === scope).timers.raf).toBe(0); expect(scope.raf(() => undefined)).toBe(0);
  } finally { scope.dispose(); outer.dispose(); installScopeEnvironment(f.native); }
});

test('pending callbacks cancel through their original scheduler after an environment rebind', () => {
  const f = environment(), scope = new Scope('rebound-frame'), otherCancelled: number[] = [];
  try {
    const id = scope.raf(() => undefined);
    installScopeEnvironment({ ...f.manual, cancelFrame: value => { otherCancelled.push(value); } });
    scope.cancelRaf(id); expect(f.cancelled).toEqual([id]); expect(otherCancelled).toEqual([]); expect(scope.census.rafs).toBe(0);
    const completed = scope.raf(() => undefined); f.fire(completed, 0);
    installScopeEnvironment(f.manual); const fresh = scope.raf(() => undefined); scope.cancelRaf(fresh);
    expect(f.cancelled).toEqual([id, fresh]); expect(otherCancelled).toEqual([]);
  } finally { scope.dispose(); installScopeEnvironment(f.native); }
});

test('native scheduling failure and original injected synchronous-host behavior stay exact', () => {
  const f = environment(), scope = new Scope('failed-frame');
  try {
    installScopeEnvironment({ ...f.manual, frame: () => { throw new Error('original native refusal'); } });
    expect(() => scope.raf(() => undefined)).toThrow('original native refusal');
    expect(scope.census.rafs).toBe(0); expect(scopeRegistrations(owner => owner === scope).timers.raf).toBe(0);
    installScopeEnvironment({ ...f.manual, frame: fn => { fn(0); return 1; } });
    let calls = 0;
    const synchronous = scope.raf(() => { calls++; expect(scope.census.rafs).toBe(0); expect(currentOwner()).toBe(scope); });
    expect(calls).toBe(1); expect(scope.census.rafs).toBe(1);
    expect(() => scope.raf(() => undefined)).toThrow(ReferenceError);
    expect(scope.census.rafs).toBe(1); scope.cancelRaf(synchronous);
    expect(scope.census.rafs).toBe(0); expect(scopeRegistrations(owner => owner === scope).timers.raf).toBe(0);
    installScopeEnvironment(f.manual); const id = scope.raf(() => undefined); f.fire(id, 0); expect(scope.census.rafs).toBe(0);
  } finally { scope.dispose(); installScopeEnvironment(f.native); }
});


test('completed callbacks release their real targets while the scope and empty frame cache stay live', async () => {
  const gc: unknown = Reflect.get(globalThis, 'gc');
  if (typeof gc !== 'function') {
    if (process.env['WS_FRAME_RECORD_GC'] === '1') throw new Error('Frame collection requires native exposed GC');
    mkdirSync('tmp', { recursive: true }); const directory = mkdtempSync(resolvePath('tmp/frame-record-gc-'));
    try {
      const config = resolvePath(directory, 'vitest.config.mjs');
      writeFileSync(config, `export default {root:${JSON.stringify(resolvePath('.'))},test:{include:['src/shared/engine/app/scope-frame-records.test.ts'],testNamePattern:'completed callbacks release',setupFiles:[],pool:'forks',maxWorkers:1,execArgv:['--expose-gc']}};`);
      const result = execFileSync(process.execPath, ['--expose-gc', resolvePath('scripts/vitest-tmp.ts'), 'run', 'src/shared/engine/app/scope-frame-records.test.ts', '--config', config],
        { env: { ...process.env, WS_FRAME_RECORD_GC: '1', NO_COLOR: '1' }, encoding: 'utf8', timeout: 30000 });
      expect(result).toContain('1 passed');
    } finally { rmSync(directory, { recursive: true, force: true }); }
    return;
  }
  const f = environment(), scope = new Scope('live-empty-frame-cache'), refs: WeakRef<BufferGeometry>[] = [];
  let observed = 0;
  const submit = (): number => {
    const target = new BufferGeometry(); target.setAttribute('position', new Float32BufferAttribute(new Float32Array(1026), 3));
    refs.push(new WeakRef(target));
    return scope.raf(() => { observed += target.getAttribute('position').array.byteLength; target.dispose(); });
  };
  try {
    const first = submit();
    await new Promise<void>(resolve => { setTimeout(resolve, 0); }); Reflect.apply(gc, globalThis, []);
    expect(refs[0]?.deref()).not.toBeUndefined(); expect(scope.census.rafs).toBe(1);
    expect(scopeRegistrations(owner => owner === scope).timers.raf).toBe(1);
    f.fire(first, 0);
    for (let frame = 1; frame < 20; frame++) f.fire(submit(), frame);
    expect(observed).toBe(82080); expect(scope.disposed).toBe(false); expect(scope.census.rafs).toBe(0); expect(f.queued.size).toBe(0);
    for (let turn = 0; turn < 30; turn++) {
      await new Promise<void>(resolve => { setTimeout(resolve, 0); }); Reflect.apply(gc, globalThis, []);
      if (refs.every(ref => ref.deref() === undefined)) break;
    }
    expect(refs.every(ref => ref.deref() === undefined)).toBe(true);
    const cancelled = submit(); scope.cancelRaf(cancelled);
    for (let turn = 0; turn < 30; turn++) {
      await new Promise<void>(resolve => { setTimeout(resolve, 0); }); Reflect.apply(gc, globalThis, []);
      if (refs.every(ref => ref.deref() === undefined)) break;
    }
    expect(refs.every(ref => ref.deref() === undefined)).toBe(true);
    const errors: unknown[] = [];
    // A successful callback can also leave a lazy Error stack behind. Its
    // driver function must not strongly own a later request's target.
    const noted = scope.raf(() => { errors.push(new Error('Retained successful frame note')); });
    f.fire(noted, 20);
    const later = submit(); scope.cancelRaf(later);
    const throwing = scope.raf(() => { const next = submit(); scope.cancelRaf(next); throw new Error('Retained native callback error'); });
    try { f.fire(throwing, 21); } catch (error) { errors.push(error); }
    expect(errors).toHaveLength(2);
    // Keep the Error's lazy stack alive while its callback's later cancelled
    // target collects: completed driver records must not alias that target.
    for (let turn = 0; turn < 30; turn++) {
      await new Promise<void>(resolve => { setTimeout(resolve, 0); }); Reflect.apply(gc, globalThis, []);
      if (refs.every(ref => ref.deref() === undefined)) break;
    }
    expect(refs.every(ref => ref.deref() === undefined)).toBe(true); expect(errors).toHaveLength(2);
    f.fire(submit(), 22); expect(observed).toBe(86184); expect(scope.census.rafs).toBe(0);
  } finally { scope.dispose(); installScopeEnvironment(f.native); }
});


test('the empty-record retention bound never limits concurrent native requests', () => {
  const f = environment(), scope = new Scope('many-native-frames'), seen: number[] = [];
  try {
    for (let round = 0; round < 3; round++) {
      const ids = Array.from({ length: 20 }, (_, index) => scope.raf(() => { seen.push(round * 20 + index); }));
      expect(scope.census.rafs).toBe(20); expect(scopeRegistrations(owner => owner === scope).timers.raf).toBe(20);
      for (const id of ids) f.fire(id, round);
      expect(scope.census.rafs).toBe(0); expect(f.queued.size).toBe(0);
    }
    expect(seen).toEqual(Array.from({ length: 60 }, (_, index) => index));
  } finally { scope.dispose(); installScopeEnvironment(f.native); }
});


test('a frame completing inside sliced retirement retains the captured native cancellation', () => {
  const f = environment(), scope = new Scope('retiring-frame'); let called = false;
  try {
    const id = scope.raf(() => { called = true; });
    scope.onDispose(() => undefined);
    const retiring = scope.disposeSteps(); expect(retiring.next().done).toBe(false);
    f.fire(id, 0); expect(called).toBe(false); expect(f.cancelled).toEqual([]);
    expect(retiring.next().done).toBe(false); expect(f.cancelled).toEqual([id]);
    expect(retiring.next().done).toBe(true); expect(scope.census.rafs).toBe(0);
  } finally { scope.dispose(); installScopeEnvironment(f.native); }
});

test.each([7, Number.NaN, -0])('duplicate injected id %s retains native Map cancellation semantics', id => {
  const native = scopeEnvironment(), scope = new Scope('duplicate-frame-id'), callbacks: FrameRequestCallback[] = [], cancelled: number[] = [], seen: string[] = [];
  installScopeEnvironment({ ...native, frame: fn => { callbacks.push(fn); return id; }, cancelFrame: value => { cancelled.push(value); } });
  const key = Object.is(id, -0) ? 0 : id;
  try {
    scope.raf(() => { seen.push('first'); scope.raf(() => { seen.push('third'); }); });
    scope.raf(() => { seen.push('second'); });
    scope.cancelRaf(key); expect(cancelled).toEqual([id]); expect(scope.census.rafs).toBe(1);
    const first = callbacks[0], second = callbacks[1];
    if (first === undefined || second === undefined) throw new Error('Missing independently dispatched frames');
    first(1); second(2); // a previously dispatched cancelled callback still removes its native id
    expect(seen).toEqual(['first', 'second']); expect(scope.census.rafs).toBe(1);
    scope.cancelRaf(key); expect(cancelled).toEqual([id]);
    scope.dispose(); expect(cancelled).toEqual([id, id]); expect(scope.census.rafs).toBe(0);
  } finally { scope.dispose(); installScopeEnvironment(native); }
});

test('reused direct and spilled identifiers cancel the latest registration without changing disposal order', () => {
  const native = scopeEnvironment(), scope = new Scope('spilled-frame-id'), ids = [1, 2, 1, 2], cancelled: number[] = [];
  let cursor = 0;
  installScopeEnvironment({ ...native, frame: () => ids[cursor++] ?? 0, cancelFrame: id => { cancelled.push(id); } });
  try {
    for (let index = 0; index < 4; index++) scope.raf(() => undefined);
    scope.cancelRaf(2); scope.cancelRaf(1);
    expect(cancelled).toEqual([2, 1]); expect(scope.census.rafs).toBe(2);
    scope.dispose(); expect(cancelled).toEqual([2, 1, 2, 1]); expect(scope.census.rafs).toBe(0);
  } finally { scope.dispose(); installScopeEnvironment(native); }
});

test('a synchronous injected scheduler retains the first-call and later id-initialization refusal', () => {
  const native = scopeEnvironment(), scope = new Scope('synchronous-frame'), cancelled: number[] = [];
  let calls = 0;
  installScopeEnvironment({ ...native, frame: fn => { fn(.25); return 0; }, cancelFrame: id => { cancelled.push(id); } });
  try {
    expect(scope.raf(time => { expect(time).toBe(.25); calls++; })).toBe(0);
    expect(scope.census.rafs).toBe(1);
    expect(() => scope.raf(() => { calls++; })).toThrow(ReferenceError);
    expect(calls).toBe(1); scope.dispose(); expect(cancelled).toEqual([0]); expect(scope.census.rafs).toBe(0);
  } finally { scope.dispose(); installScopeEnvironment(native); }
});
