import type { Scope } from '@wildshard/engine/app/scope';
import type { Vector3 } from 'three';

/** Each page's chapter guides by quest, as `installChapterLead` raises them. */
export const leadActors: WeakMap<Scope, Map<string, { actor: { readonly position: Vector3 } | null }>> = new WeakMap<Scope, Map<string, { actor: { readonly position: Vector3 } | null }>>();
/** Native observation of the actual guide body, including its hidden lifetime. */
export function chapterLeadPosition(scope: Scope, quest: string): Vector3 | null {
  if (scope.disposed) return null;
  return leadActors.get(scope)?.get(quest)?.actor?.position ?? null;
}
