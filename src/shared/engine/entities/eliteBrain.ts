import type { Vector3 } from 'three';
import type { Animal } from '../../../client/engine/entities/AnimalView';
import type { ThinkCtx } from './species/registry';
import type { Scope } from '../app/scope';

interface Binding<T> { readonly scope: Scope | null; readonly value: T }
type Think = (a: Animal, c: ThinkCtx) => void;
type Damage = (a: Animal, p: Vector3, d: Vector3) => number;
const brains = new WeakMap<Animal, Binding<Think>>(), acts = new WeakMap<Animal, Binding<Think>>(), damage = new WeakMap<Animal, Binding<Damage>>();
function bind<T>(book: WeakMap<Animal, Binding<T>>, actor: Animal, value: T, scope: Scope | undefined): () => void {
  if (scope?.disposed === true || scope?.disposing === true) throw new Error('Retired elite body binding');
  const binding = { scope: scope ?? null, value }; book.set(actor, binding);
  let forget = (): void => undefined;
  const release = (): void => { if (book.get(actor) === binding) book.delete(actor); forget(); };
  if (scope !== undefined) forget = scope.capture('disposers', release);
  return release;
}
function current<T>(book: WeakMap<Animal, Binding<T>>, actor: Animal): T | undefined {
  const binding = book.get(actor);
  return binding === undefined || binding.scope?.disposed === true || binding.scope?.disposing === true ? undefined : binding.value;
}
/** Native species retain their original decision/body/damage slots. The
 * two-argument setters preserve legacy unscoped behavior. Explicit scopes own
 * only their exact binding, and ancestor retirement makes callbacks inert. */
export function setEliteBrain(a: Animal, fn: Think): void;
export function setEliteBrain(a: Animal, fn: Think, scope: Scope): () => void;
export function setEliteBrain(a: Animal, fn: Think, scope?: Scope): void | (() => void) { const release = bind(brains, a, fn, scope); if (scope !== undefined) return release; }
export function setEliteAct(a: Animal, fn: Think): void;
export function setEliteAct(a: Animal, fn: Think, scope: Scope): () => void;
export function setEliteAct(a: Animal, fn: Think, scope?: Scope): void | (() => void) { const release = bind(acts, a, fn, scope); if (scope !== undefined) return release; }
export function setEliteDamage(a: Animal, fn: Damage): void;
export function setEliteDamage(a: Animal, fn: Damage, scope: Scope): () => void;
export function setEliteDamage(a: Animal, fn: Damage, scope?: Scope): void | (() => void) { const release = bind(damage, a, fn, scope); if (scope !== undefined) return release; }
export function eliteThink(a: Animal, c: ThinkCtx): void { current(brains, a)?.(a, c); }
export function eliteAct(a: Animal, c: ThinkCtx): void { current(acts, a)?.(a, c); }
export function eliteDamageMul(a: Animal, p: Vector3, d: Vector3): number { return current(damage, a)?.(a, p, d) ?? 1; }
