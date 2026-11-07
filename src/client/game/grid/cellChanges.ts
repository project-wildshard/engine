/** Scoped change subscriptions for mutable Three values; no Three prototype edits or frame census. */
interface Slot { value: unknown; readonly initial: unknown; readonly listeners: Set<() => void>; delivery: readonly (() => void)[] | undefined; fast: (() => void) | undefined; get: () => unknown; readonly prior: PropertyDescriptor | undefined }
const FIELDS = Symbol('cell change fields');
interface FieldState { readonly values: Record<string, Slot | undefined>; size: number }
interface FieldOwner { [FIELDS]?: FieldState }
/** Observe an own data field. The getter reads its slot directly;
 * a sole subscriber delivers without allocating an array on each change. */
export function onCellField(target: object, key: string, changed: () => void): () => void {
  const owner: FieldOwner = target;
  let fields = owner[FIELDS];
  if (fields === undefined) {
    const values: Record<string, Slot | undefined> = {}; Reflect.setPrototypeOf(values, null);
    fields = { values, size: 0 }; Object.defineProperty(owner, FIELDS, { configurable: true, value: fields });
  }
  let slot = fields.values[key];
  if (slot === undefined) {
    const prior = Object.getOwnPropertyDescriptor(target, key);
    if (prior !== undefined && (prior.configurable !== true || !('value' in prior))) throw new Error(`Cell change field is not writable data: ${key}`);
    const initial: unknown = prior === undefined ? Reflect.get(target, key) : prior.value;
    const made: Slot = { value: initial, initial, listeners: new Set(), delivery: undefined, fast: undefined, prior, get: () => undefined };
    made.get = () => made.value;
    // An absent key stays out of key walks while it holds nothing: a skinned geometry's watched morphAttributes.position
    // read as a phantom morph (undefined) to Object.keys / for…in readers (the S3.7 census, three's BufferGeometry.copy).
    Object.defineProperty(target, key, { configurable: true, enumerable: prior?.enumerable ?? initial !== undefined, get: made.get,
      set(value: unknown): void {
        if (made.value === value) return;
        made.value = value;
        if (prior === undefined) Object.defineProperty(target, key, { enumerable: value !== undefined });
        if (made.fast !== undefined) made.fast();
        else {
          // Membership changes invalidate the memo; this write retains its original
          // snapshot while removals stay live and nested writes see new membership.
          const delivery = made.delivery ??= [...made.listeners];
          for (const notify of delivery) if (made.listeners.has(notify)) notify();
        }
      } });
    fields.values[key] = made; fields.size++; slot = made;
  }
  const table = fields, held = slot;
  if (!held.listeners.has(changed)) held.delivery = undefined;
  held.listeners.add(changed); held.fast = held.listeners.size === 1 ? changed : undefined;
  return () => {
    if (!held.listeners.delete(changed)) return;
    held.delivery = undefined;
    held.fast = held.listeners.size === 1 ? held.listeners.values().next().value : undefined;
    if (held.listeners.size > 0) return;
    if (Object.getOwnPropertyDescriptor(target, key)?.get === held.get) {
      if (held.prior === undefined && held.value === held.initial) Reflect.deleteProperty(target, key);
      else Object.defineProperty(target, key, { ...held.prior, configurable: true, writable: true, value: held.value, enumerable: held.prior?.enumerable ?? held.value !== undefined });
    }
    delete table.values[key]; table.size--;
    if (table.size === 0) Reflect.deleteProperty(owner, FIELDS);
  };
}

type MethodListener = (...args: readonly unknown[]) => void;
interface MethodListeners { readonly values: Set<MethodListener>; slots: number }
interface MethodSlot { readonly key: string; readonly prior: PropertyDescriptor | undefined; readonly call: (...args: unknown[]) => unknown; listeners: MethodListeners }
// Retained wrappers must release their callbacks even while untouched siblings share them.
const emptyMethodListeners: MethodListeners = { values: new Set(), slots: 0 };
const methods = new WeakMap<object, Map<string, MethodSlot>>();
// Detach before live iteration or an independent edit. Reentrant subscriptions
// then mutate the exact Set being delivered, including removals and re-additions.
function ownMethodListeners(slot: MethodSlot): Set<MethodListener> {
  const listeners = slot.listeners;
  if (listeners.slots <= 1) return listeners.values;
  listeners.slots--;
  const values = new Set(listeners.values);
  slot.listeners = { values, slots: 1 };
  return values;
}
/** Explicit matrix/collection mutations emit once after their native operation completes.
 * One cleanup restores the registered slots in order, without a closure per method. */
export function onCellMethods(target: object, keys: readonly string[], changed: (...args: readonly unknown[]) => void): () => void {
  let entries = methods.get(target);
  if (entries === undefined) { entries = new Map(); methods.set(target, entries); }
  const held: MethodSlot[] = [];
  // Share only until a method runs or its subscriber membership diverges.
  let initial: MethodListeners | undefined;
  for (const key of keys) {
    let slot = entries.get(key);
    if (slot === undefined) {
      const original: unknown = Reflect.get(target, key);
      if (typeof original !== 'function') continue;
      const made: MethodSlot = { key, prior: Object.getOwnPropertyDescriptor(target, key), listeners: emptyMethodListeners,
        call: (...args: unknown[]): unknown => { const value: unknown = Reflect.apply(original, target, args); for (const notify of ownMethodListeners(made)) notify(...args); return value; } };
      Object.defineProperty(target, key, { configurable: true, writable: true, value: made.call });
      initial ??= { values: new Set<MethodListener>().add(changed), slots: 0 };
      initial.slots++; made.listeners = initial;
      entries.set(key, made); slot = made;
    }
    if (!slot.listeners.values.has(changed)) ownMethodListeners(slot).add(changed);
    held.push(slot);
  }
  return () => {
    for (const slot of held) {
      const listeners = slot.listeners;
      if (!listeners.values.has(changed)) continue;
      if (listeners.values.size > 1) { ownMethodListeners(slot).delete(changed); continue; }
      if (listeners.slots === 1) listeners.values.delete(changed);
      listeners.slots--; slot.listeners = emptyMethodListeners;
      if (Reflect.get(target, slot.key) === slot.call) { if (slot.prior === undefined) Reflect.deleteProperty(target, slot.key); else Object.defineProperty(target, slot.key, slot.prior); }
      entries.delete(slot.key); if (entries.size === 0) methods.delete(target);
    }
  };
}
