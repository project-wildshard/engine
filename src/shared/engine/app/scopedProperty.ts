interface Binding { readonly get: () => unknown; releaseValue: () => void }
interface Slot { readonly previous: PropertyDescriptor | undefined; readonly bindings: Binding[] }
const slots = new WeakMap<object, Map<PropertyKey, Slot>>();

/** Internal descriptor stack; released values are severed even when a newer owner still publishes the same key. */
export function scopedProperty(target: object, key: PropertyKey, initial: unknown): () => void {
  let properties = slots.get(target);
  if (properties === undefined) { properties = new Map(); slots.set(target, properties); }
  let slot = properties.get(key);
  if (slot === undefined) {
    const previous = Object.getOwnPropertyDescriptor(target, key);
    if (previous?.configurable === false) throw new TypeError('Scoped property must be configurable');
    slot = { previous, bindings: [] }; properties.set(key, slot);
  }
  let value = initial;
  const binding: Binding = { get: () => value, releaseValue: () => { value = undefined; } };
  slot.bindings.push(binding);
  Object.defineProperty(target, key, { configurable: true, enumerable: slot.previous?.enumerable ?? true, get: binding.get });
  const ownedSlot = slot, ownedProperties = properties;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    binding.releaseValue();
    const index = ownedSlot.bindings.indexOf(binding);
    if (index !== -1) ownedSlot.bindings.splice(index, 1);
    if (Object.getOwnPropertyDescriptor(target, key)?.get === binding.get) {
      const next = ownedSlot.bindings.at(-1);
      if (next !== undefined) Object.defineProperty(target, key, { configurable: true, enumerable: ownedSlot.previous?.enumerable ?? true, get: next.get });
      else if (ownedSlot.previous === undefined) Reflect.deleteProperty(target, key);
      else Object.defineProperty(target, key, ownedSlot.previous);
    }
    if (ownedSlot.bindings.length === 0) {
      ownedProperties.delete(key);
      if (ownedProperties.size === 0) slots.delete(target);
    }
  };
}
