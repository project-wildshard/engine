import type { Scope } from '@wildshard/engine/app/scope';

const residentScopes = new WeakMap<Scope, Scope>();
/** Bind entered resource ownership without importing the runtime lifecycle. */
export function bindResidentWorldScope(entered: Scope, resident: Scope): void {
  residentScopes.set(entered, resident);
  entered.onDispose(() => { residentScopes.delete(entered); });
}
/** Internal resident construction requires a separately bound owner. */
export function boundResidentWorldScope(entered: Scope): Scope | undefined { return residentScopes.get(entered); }
/** Static presentation belongs to the resident, including transitional entered world hooks. */
export function residentWorldScope(context: { readonly scope: Scope }): Scope {
  const owner = boundResidentWorldScope(context.scope) ?? context.scope;
  if (owner.disposed || context.scope.disposed) throw new Error('Missing live resident world');
  return owner;
}
