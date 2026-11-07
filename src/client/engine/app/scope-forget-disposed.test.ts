import { expect, test, vi } from 'vitest';
import { BufferGeometry, MeshBasicMaterial } from 'three';
import { Scope } from '../../../shared/engine/app/scope';
import { installScopeEnvironment, scopeEnvironment } from '../../../shared/engine/app/scopeEnvironment';
import { rebindGeometry } from './cachedAssets';
import { ownSceneResource } from './sceneOwnership';

test('O18 a scope forgets a resource disposed by anyone else, and never disposes it twice', () => {
  const page = new Scope('page'), material = new MeshBasicMaterial(), dispose = vi.spyOn(material, 'dispose');
  page.own(material);
  expect(page.owns(material)).toBe(true);
  material.dispose();
  expect(page.owns(material)).toBe(false);
  expect(page.census.materials).toBe(0);
  page.dispose();
  expect(dispose).toHaveBeenCalledTimes(1);
});

test('O18 a binding-only rebind keeps the geometry owned', () => {
  const scope = new Scope('cell'), geometry = new BufferGeometry(), dispose = vi.spyOn(geometry, 'dispose');
  scope.own(geometry);
  rebindGeometry(geometry);
  expect(scope.owns(geometry)).toBe(true);
  scope.dispose();
  expect(dispose).toHaveBeenCalledTimes(2);
});

test('O18 a live owner owns a disposed resource again when it is used again', () => {
  const cell = new Scope('cell'), geometry = new BufferGeometry(), dispose = vi.spyOn(geometry, 'dispose');
  ownSceneResource(geometry, cell);
  geometry.dispose();
  expect(cell.owns(geometry)).toBe(false);
  ownSceneResource(geometry, cell);
  expect(cell.owns(geometry)).toBe(true);
  cell.dispose();
  expect(dispose).toHaveBeenCalledTimes(2);
});

test('an initially empty scope acquires, cancels and retires its first registrations normally', () => {
  vi.useFakeTimers();
  const scope = new Scope('construction'), target = new EventTarget(), events: string[] = [];
  const native = scopeEnvironment(), frames = new Map<number, FrameRequestCallback>(); let next = 1;
  installScopeEnvironment({...native,frame: fn => { const id = next++; frames.set(id,fn); return id; },cancelFrame: id => { frames.delete(id); }});
  const baseline = scope.census, listener = (): void => { events.push('event'); };
  try {
    expect(scope.owns(target)).toBe(false);
    scope.unlisten(target, 'change', listener); scope.cancelTimer(0); scope.cancelRaf(123);
    expect(scope.census).toEqual(baseline);
    const unlisten = scope.listen(target, 'change', listener);
    expect(scope.listen(target, 'change', listener)).toBe(unlisten);
    target.dispatchEvent(new Event('change'));
    scope.unlisten(target, 'change', listener); target.dispatchEvent(new Event('change'));
    const cancelled = scope.timeout(1, () => { events.push('cancelled'); }); scope.cancelTimer(cancelled);
    scope.timeout(1, () => { events.push('timeout'); });
    vi.advanceTimersByTime(1);
    const interval = scope.interval(1, () => { events.push('interval'); });
    vi.advanceTimersByTime(1); scope.cancelTimer(interval);
    const cancelledFrame = scope.raf(() => { events.push('cancelled frame'); }); scope.cancelRaf(cancelledFrame);
    expect(frames.size).toBe(0);
    scope.raf(() => { events.push('disposed frame'); });
    const child = scope.child('piece');
    child.own({dispose: () => { events.push('piece'); }});
    scope.onDispose(() => { events.push('parent'); });
    expect(scope.census.resources).toBe(1);
    expect([...scope.disposeSteps()].map(step => step.scope)).toEqual(['construction','piece','construction']);
    expect(child.disposed).toBe(true);
    expect(frames.size).toBe(0);
    vi.advanceTimersByTime(5); target.dispatchEvent(new Event('change'));
    expect(events).toEqual(['event','timeout','interval','parent','piece']);
    expect(scope.census).toEqual(baseline);
  } finally { scope.dispose(); installScopeEnvironment(native); vi.useRealTimers(); }
});
