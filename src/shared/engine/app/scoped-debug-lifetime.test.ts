import { expect, test } from 'vitest';
import { Scope } from './scope';
import { realGc } from '@wildshard/engine/test/realGc';

function savedGetter(target: object, key: string): () => unknown {
  const descriptor = Object.getOwnPropertyDescriptor(target, key);
  const get: unknown = descriptor === undefined ? undefined : Reflect.get(descriptor, 'get');
  if (typeof get !== 'function') throw new Error('Missing scoped getter');
  return () => { const value: unknown = Reflect.apply(get, target, []); return value; };
}

function retiredDebug(target: object, active: Scope): { ref: WeakRef<Scope>; getters: (() => unknown)[] } {
  const owner = new Scope('retired Pine diagnostics');
  owner.expose(target, '__perfHud', { owner });
  owner.expose(target, '__hf', () => owner.name);
  const getters = ['__perfHud', '__hf'].map(key => savedGetter(target, key));
  active.expose(target, '__perfHud', 'current HUD');
  active.expose(target, '__hf', 'current heightfield');
  const ref = new WeakRef(owner); owner.dispose(); return { ref, getters };
}

test('live debug globals and saved getters release an older retired Scope', async () => {
  await realGc('src/shared/engine/app/scoped-debug-lifetime.test.ts', 'live debug globals and saved getters release an older retired Scope', async collect => {
    const target = {}, active = new Scope('current diagnostics'), { ref, getters } = retiredDebug(target, active);
    try {
      await collect(ref);
      expect(getters.map(get => get())).toEqual([undefined, undefined]);
      expect(Reflect.get(target, '__perfHud')).toBe('current HUD');
      expect(Reflect.get(target, '__hf')).toBe('current heightfield');
    } finally { active.dispose(); }
    expect(Object.hasOwn(target, '__perfHud')).toBe(false);
    expect(Object.hasOwn(target, '__hf')).toBe(false);
  });
});
