import {Material} from 'three';
import {Scope, isRebinding} from '../../../shared/engine/app/scope';

interface Entry<V> { readonly ref: WeakRef<object>; value: V | null; lifetime: Scope | null }
/**
 * CSM's material-to-shader map: keys and entry lifetimes stay weak. A real retirement
 * drops the shader payload, so refits skip its uniforms; keep the weak key for CSM's
 * final hook/define cleanup. A later compilation replaces the payload and watches
 * retirement again. Binding-only rebinds keep the live payload.
 *
 * The shader and its listener scope belong ONLY to the material-keyed WeakMap:
 * either can reach the material, so storing them beside refs would retain it.
 */
export class WeakShaderMap<V> {
  private readonly refs = new Set<WeakRef<object>>();
  private readonly entries = new WeakMap<object, Entry<V>>();
  get size(): number { return this.refs.size; }
  set(material: object, value: V | null): this {
    const entry = this.entries.get(material);
    if (entry !== undefined) {
      entry.value = value;
      if (entry.lifetime === null || entry.lifetime.disposed) entry.lifetime = this.watch(material);
      return this;
    }
    const ref = new WeakRef(material), next: Entry<V> = {ref, value, lifetime: null};
    this.entries.set(material, next); this.refs.add(ref); next.lifetime = this.watch(material);
    return this;
  }
  get(material: object): V | null | undefined { return this.entries.get(material)?.value; }
  has(material: object): boolean { return this.entries.has(material); }
  delete(material: object): boolean {
    const entry = this.entries.get(material);
    if (entry === undefined) return false;
    this.entries.delete(material); this.refs.delete(entry.ref); entry.lifetime?.dispose();
    return true;
  }
  clear(): void {
    for (const ref of this.refs) { const material = ref.deref(); if (material !== undefined) this.delete(material); }
    this.refs.clear();
  }
  /** Map.forEach's contract, thisArg included: CSM uses null for uncompiled/retired payloads. */
  forEach(fn: (this: unknown, value: V | null, material: object, map: this) => void, thisArg?: unknown): void {
    for (const ref of this.refs) {
      const material = ref.deref(), entry = material === undefined ? undefined : this.entries.get(material);
      if (material === undefined || entry === undefined) this.refs.delete(ref); else fn.call(thisArg, entry.value, material, this);
    }
  }
  private watch(material: object): Scope | null {
    if (!(material instanceof Material)) return null;
    const lifetime = new Scope('csm.shader');
    lifetime.listenEmitter(material, 'dispose', () => {
      if (isRebinding(material)) return;
      const entry = this.entries.get(material);
      if (entry !== undefined) { entry.value = null; entry.lifetime?.dispose(); }
    });
    return lifetime;
  }
}
