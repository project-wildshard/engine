/** Scoped change subscriptions for mutable Three values; no Three prototype edits or frame census. */
// DF11 (mini-df11g): WebKit's full collection pays per live cell, and cellClip watches ~8k fields at the Driftwood dock.
// A slot keeps the prior descriptor's enumerability instead of the descriptor, and holds a sole subscriber in `fast` with no
// Set until a second one arrives; delivery order, snapshots and the getter/setter hot path are unchanged.
interface Slot { value: unknown; readonly initial: unknown; listeners: Set<() => void> | undefined; delivery: readonly (() => void)[] | undefined; fast: (() => void) | undefined; get: () => unknown; readonly priorEnumerable: boolean | undefined }
const FIELDS = Symbol('cell change fields');
interface FieldState { readonly values: Record<string, Slot | undefined>; size: number }
interface FieldOwner { [FIELDS]?: FieldState }
const listening = (slot: Slot, changed: () => void): boolean => slot.listeners === undefined ? slot.fast === changed : slot.listeners.has(changed);
const listenerCount = (slot: Slot): number => slot.listeners === undefined ? slot.fast === undefined ? 0 : 1 : slot.listeners.size;
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
    const priorEnumerable = prior === undefined ? undefined : prior.enumerable === true;
    const made: Slot = { value: initial, initial, listeners: undefined, delivery: undefined, fast: undefined, priorEnumerable, get: () => undefined };
    made.get = () => made.value;
    // An absent key stays out of key walks while it holds nothing: a skinned geometry's watched morphAttributes.position
    // read as a phantom morph (undefined) to Object.keys / for…in readers (the S3.7 census, three's BufferGeometry.copy).
    Object.defineProperty(target, key, { configurable: true, enumerable: priorEnumerable ?? initial !== undefined, get: made.get,
      set(value: unknown): void {
        if (made.value === value) return;
        made.value = value;
        if (priorEnumerable === undefined) Object.defineProperty(target, key, { enumerable: value !== undefined });
        if (made.fast !== undefined) made.fast();
        else if (made.listeners !== undefined) {
          // Membership changes invalidate the memo; this write retains its original
          // snapshot while removals stay live and nested writes see new membership.
          const delivery = made.delivery ??= [...made.listeners];
          for (const notify of delivery) if (made.listeners.has(notify)) notify();
        }
      } });
    fields.values[key] = made; fields.size++; slot = made;
  }
  const table = fields, held = slot;
  if (!listening(held, changed)) {
    held.delivery = undefined;
    if (held.listeners !== undefined) held.listeners.add(changed);
    else if (held.fast === undefined) held.fast = changed;
    else { held.listeners = new Set([held.fast, changed]); held.fast = undefined; }
  }
  if (held.listeners !== undefined) held.fast = held.listeners.size === 1 ? changed : undefined;
  return () => {
    if (held.listeners === undefined) { if (held.fast !== changed) return; held.fast = undefined; }
    else {
      if (!held.listeners.delete(changed)) return;
      held.fast = held.listeners.size === 1 ? held.listeners.values().next().value : undefined;
    }
    held.delivery = undefined;
    if (listenerCount(held) > 0) return;
    if (Object.getOwnPropertyDescriptor(target, key)?.get === held.get) {
      if (held.priorEnumerable === undefined && held.value === held.initial) Reflect.deleteProperty(target, key);
      else Object.defineProperty(target, key, { configurable: true, writable: true, value: held.value, enumerable: held.priorEnumerable ?? held.value !== undefined });
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
