import type { Scope } from '@wildshard/engine/app/scope';
import type { ShardRuntime } from '../../../shared/game/shard/runtime';

const bound = new WeakMap<ShardRuntime, Scope>();
function read(object: object, key: PropertyKey): unknown { const value: unknown = Reflect.get(object, key); return value; }

/** Retain a trusted home's handoff while unbinding every page slot during its road visits. */
export interface ScopedRuntimeBinding {
  /** The retained home state; inactive writes never reach the parent. */
  readonly runtime: ShardRuntime;
  /** Publish this retained handoff only after its cell has entered. */
  readonly activate: () => void;
  /** Restore every borrowed parent descriptor without losing local state. */
  readonly deactivate: () => void;
  /** Whether the parent currently exposes this handoff. */
  readonly active: () => boolean;
}

/** Prepare a local handoff without publishing it; each activation restores the descriptors it borrowed on leave. */
export function createScopedRuntimeBinding(parent: ShardRuntime, scope: Scope): ScopedRuntimeBinding {
  if (scope.disposed) throw new Error('Cannot bind a disposed runtime scope');
  const local: ShardRuntime = { ...parent, hooks: { ...parent.hooks }, objects: { ...parent.objects },
    interactables: [...parent.interactables], overhead: [...parent.overhead] };
  for (const key of Reflect.ownKeys(parent)) if (!Object.hasOwn(local, key)) Object.defineProperty(local, key, {
    configurable: true, enumerable: Reflect.getOwnPropertyDescriptor(parent, key)?.enumerable ?? false,
    writable: true, value: read(parent, key),
  });
  // The staged shell fills these borrowed services after world/kit. Its writes must remain visible on entry and exit;
  // a trusted hook's writes stay private to its local handoff instead of replacing the shell's current services.
  const borrowed = new Set<PropertyKey>(['world', 'step', 'play', 'viewer', 'horizonVeil']);
  const overrides = new Map<PropertyKey, unknown>();
  for (const key of borrowed) Object.defineProperty(local, key, { configurable: true, enumerable: true,
    get: () => overrides.has(key) ? overrides.get(key) : read(parent, key),
    set: (value: unknown) => { overrides.set(key, value); },
  });
  const keys = new Set([...Reflect.ownKeys(parent).filter((key) => !borrowed.has(key)), 'buildEquipment', 'menu']);
  let descriptors = new Map<PropertyKey, PropertyDescriptor | undefined>(), active = false;
  const deactivate = (): void => {
    if (!active) return;
    active = false; bound.delete(parent);
    for (const key of keys) {
      const descriptor = descriptors.get(key);
      if (descriptor === undefined) Reflect.deleteProperty(parent, key); else Object.defineProperty(parent, key, descriptor);
    }
    descriptors.clear();
  };
  scope.onDispose(deactivate);
  return { runtime: local, active: () => active, deactivate, activate: () => {
    if (scope.disposed) throw new Error('Cannot bind a disposed runtime scope');
    if (active) return;
    if (bound.has(parent)) throw new Error('Leave the previous runtime scope before binding another');
    const current = new Map([...keys].map((key) => [key, Reflect.getOwnPropertyDescriptor(parent, key)]));
    for (const [key, descriptor] of current) if (descriptor?.configurable === false) {
      throw new Error(`Runtime slot ${String(key)} must be scope-bindable`);
    }
    descriptors = current;
    for (const key of keys) Object.defineProperty(parent, key, { configurable: true, enumerable: true,
      get: () => read(local, key), set: (value: unknown) => { Reflect.set(local, key, value); },
    });
    active = true; bound.set(parent, scope);
  } };
}

/** Bind every staged runtime slot to this play scope, retaining the resident world's previous handoff on exit. */
export function bindScopedRuntime(parent: ShardRuntime, scope: Scope): ShardRuntime {
  if (bound.has(parent)) throw new Error('Leave the previous runtime scope before binding another');
  const binding = createScopedRuntimeBinding(parent, scope); binding.activate(); return binding.runtime;
}
