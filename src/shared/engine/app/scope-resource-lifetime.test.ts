import { expect, test } from 'vitest';
import { BufferGeometry } from 'three';
import { Scope, dispatchRebind } from './scope';
import { realGc } from '@wildshard/engine/test/realGc';

function retireDuringRebind(geometry: BufferGeometry): WeakRef<Scope> {
  const owner = new Scope('cached hull world');
  const retire = (): void => {
    geometry.removeEventListener('dispose', retire);
    owner.dispose();
  };
  geometry.addEventListener('dispose', retire);
  owner.own(geometry);
  const ref = new WeakRef(owner);
  dispatchRebind(geometry);
  expect(owner.disposed).toBe(true);
  return ref;
}

test('a cached geometry releases an owner retired during a binding refresh', async () => {
  await realGc('src/shared/engine/app/scope-resource-lifetime.test.ts', 'a cached geometry releases an owner retired during a binding refresh', async collect => {
    const geometry = new BufferGeometry(), retired = retireDuringRebind(geometry);
    await collect(retired);
    let disposals = 0;
    geometry.addEventListener('dispose', () => { disposals++; });
    geometry.dispose();
    expect(disposals).toBe(1);
  });
});

function lateGeometry(geometry: BufferGeometry): WeakRef<Scope> {
  const owner = new Scope('late cached hull');
  owner.dispose(); owner.own(geometry);
  expect(owner.owns(geometry)).toBe(false);
  return new WeakRef(owner);
}

test('a cached geometry arriving after retirement never keeps the closed Scope', async () => {
  await realGc('src/shared/engine/app/scope-resource-lifetime.test.ts', 'a cached geometry arriving after retirement never keeps the closed Scope', async collect => {
    const geometry = new BufferGeometry();
    let disposals = 0;
    geometry.addEventListener('dispose', () => { disposals++; });
    await collect(lateGeometry(geometry));
    expect(disposals).toBe(1);
    geometry.dispose(); expect(disposals).toBe(2);
  });
});

test('an existing resource is not disposed early or twice during sliced retirement', () => {
  const owner = new Scope('sliced hull'), geometry = new BufferGeometry();
  let disposals = 0;
  geometry.addEventListener('dispose', () => { disposals++; });
  owner.own(geometry); owner.onDispose(() => undefined);
  const steps = owner.disposeSteps(); steps.next();
  owner.own(geometry); expect(disposals).toBe(0);
  while (steps.next().done !== true) { /* Drain the original cleanup order. */ }
  expect(disposals).toBe(1); expect(owner.owns(geometry)).toBe(false);
});

test('listener removal failures still dispose the resource', () => {
  const owner = new Scope('refused listener removal'); let disposals = 0;
  owner.own({ addEventListener: () => undefined,
    removeEventListener: () => { throw new Error('refused removal'); },
    dispose: () => { disposals++; } });
  expect(() => owner.dispose()).toThrow('refused removal');
  expect(disposals).toBe(1);
});
