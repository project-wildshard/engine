import { expect, test, vi } from 'vitest';
import { Scope } from '../../../shared/engine/app/scope';
import { EncounterRegistry } from '../../../shared/engine/ai/encounters';

test('the original registry admits an ordered lease without publishing or retiring a prefix', () => {
  const scope = new Scope('registry.fixture'), registry = new EncounterRegistry(() => scope), order: string[] = [];
  const a = { despawn: () => { order.push('a'); } }, b = { despawn: () => { order.push('b'); } };
  const rows = [{ id: 'a', brain: a }, { id: 'b', brain: b }], lease = registry.prepareElites(rows, scope);
  expect(registry.runtime('a')).toBeUndefined(); expect(order).toEqual([]);
  lease.commit(); expect(registry.runtime('a') === a).toBe(true); expect(registry.runtime('b') === b).toBe(true);
  expect(() => lease.commit()).toThrow('already committed'); expect(() => registry.preflightElite(['c', 'b'], scope)).toThrow('occupied');
  lease.release(); lease.release(); expect(order).toEqual(['b', 'a']); expect(registry.runtime('a')).toBeUndefined();
  scope.dispose(); expect(order).toEqual(['b', 'a']);
});

test('bad suffix, replaced method and sliced ancestor retirement refuse before publishing any row', () => {
  for (const change of ['suffix', 'method', 'retire']) {
    const root = new Scope('registry.fixture'), scope = root.child('runtime'), registry = new EncounterRegistry(() => scope), dispose = vi.fn<() => void>(() => undefined);
    const rows = [{ id: 'a', brain: { despawn: dispose } }, { id: 'b', brain: { despawn: dispose } }];
    const lease = registry.prepareElites(rows, scope);
    try {
      if (change === 'suffix') registry.elite('b', { despawn: () => undefined }, scope);
      else if (change === 'method') { const first = rows[0]; if (first === undefined) throw new Error('Missing first controller'); first.brain.despawn = vi.fn(() => undefined); }
      else { root.onDispose(() => undefined); const steps = root.disposeSteps(); expect(steps.next().done).toBe(false); expect(scope.disposing).toBe(true); for (const _step of steps) { /* Finish original disposal. */ } }
      expect(() => lease.commit()).toThrow(); expect(registry.runtime('a')).toBeUndefined(); expect(dispose).not.toHaveBeenCalled(); lease.release();
    } finally { root.dispose(); }
  }
});

test('release retires every original controller in reverse order despite one throwing disposal', () => {
  const scope = new Scope('registry.fixture'), registry = new EncounterRegistry(() => scope), order: string[] = [];
  const lease = registry.prepareElites([{ id: 'a', brain: { despawn: () => { order.push('a'); } } }, { id: 'b', brain: { despawn: () => { order.push('b'); throw new Error('Body release failed'); } } }], scope);
  lease.commit(); expect(() => lease.release()).toThrow('release failed'); expect(order).toEqual(['b', 'a']);
  expect(registry.runtime('a')).toBeUndefined(); expect(registry.runtime('b')).toBeUndefined(); lease.release(); scope.dispose();
});
