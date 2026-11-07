import type { Scope } from '@wildshard/engine/app/scope';
import type { ShardContext } from '../../../client/game/plugin/context';
import type { PageWildlifeView } from '../../../client/game/population/wildlifeFeature';

/** A scope's population, which the wildlife feature fills when its animal stage has built one. */
export interface WildlifeOwner { wildlife: PageWildlifeView | null }
const clientPopulations = new WeakMap<Scope, WildlifeOwner>();
/** Publish the entered owner; the feature retires it with its scope. */
export function adoptClientWildlife(scope: Scope, owner: WildlifeOwner): void { clientPopulations.set(scope, owner); }
export function clientWildlifeLent(scope: Scope): boolean { return clientPopulations.has(scope); }
export function retireClientWildlife(scope: Scope): void { clientPopulations.delete(scope); }
/** Borrow the actual population assembled by the declared animal stage. */
export function clientWildlifeState(ctx: Pick<ShardContext, 'scope'>): { readonly wildlife: PageWildlifeView | null } {
  if (ctx.scope.disposed) throw new Error('Wildlife owner is disposed');
  const owner = clientPopulations.get(ctx.scope);
  if (owner === undefined) throw new Error('Wildlife feature is not installed');
  return owner;
}
/** The original population, null until its native animal stage completes. */
export function clientWildlife(ctx: Pick<ShardContext, 'scope'>): PageWildlifeView | null { return clientWildlifeState(ctx).wildlife; }
