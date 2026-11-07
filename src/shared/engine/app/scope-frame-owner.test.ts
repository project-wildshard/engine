import { expect, test } from 'vitest';
import { Scope } from './scope';
import { currentOwner } from './ownership';
import { installScopeEnvironment, scopeEnvironment } from './scopeEnvironment';

test('RAF retains its exact callback arguments, owner, refusal and late-retirement fences', () => {
  const native = scopeEnvironment(), frames = new Map<number, FrameRequestCallback>(), scope = new Scope('frame'), outer = new Scope('outer');
  let next = 1, calls = 0, disposed = 0;
  installScopeEnvironment({ ...native, frame: fn => { const id = next++; frames.set(id, fn); return id; }, cancelFrame: id => { frames.delete(id); } });
  try {
    const baseline = scope.census;
    const id = scope.raf(function frame(this: undefined, ...args): void {
      calls++; expect(this).toBeUndefined(); expect(args).toEqual([123.25]);
      expect(currentOwner()).toBe(scope);
      expect(scope.census.rafs).toBe(0);
      currentOwner()?.own({ dispose: () => { disposed++; } });
      throw new Error('original frame refusal');
    });
    const pending = frames.get(id); if (pending === undefined) throw new Error('Missing actual scheduled callback');
    frames.delete(id);
    outer.run(() => {
      expect(() => { pending(123.25); }).toThrow('original frame refusal');
      expect(currentOwner()).toBe(outer);
    });
    expect(scope.census.rafs).toBe(baseline.rafs); expect(scope.census.resources).toBe(1);
    const lateId = scope.raf(() => { calls++; });
    const late = frames.get(lateId); if (late === undefined) throw new Error('Missing late native callback');
    scope.dispose(); expect(frames.size).toBe(0); expect(disposed).toBe(1);
    late(456); expect(calls).toBe(1); expect(scope.census).toEqual(baseline);
    expect(scope.raf(() => { calls++; })).toBe(0);
  } finally { scope.dispose(); outer.dispose(); installScopeEnvironment(native); }
});
