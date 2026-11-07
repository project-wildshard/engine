import type { Scope } from '@wildshard/engine/app/scope';

type EnteredServices = (install: (scope: Scope) => void) => void;

/** The contexts that retain their home resources while entered services are independently scoped, with each one's
 * service registration. retainedHooks.ts fills it; a shared reader only asks whether a context is here. */
export const enteredServices: WeakMap<object, EnteredServices> = new WeakMap<object, EnteredServices>();

/** Install a transient service for each home entry; ordinary staged contexts keep their original level scope. */
export function installEnteredService(context: { readonly scope: Scope }, install: (scope: Scope) => void): void {
  if (context.scope.disposed) throw new Error('Trusted runtime is disposed');
  const entered = enteredServices.get(context);
  if (entered === undefined) install(context.scope); else entered(install);
}
