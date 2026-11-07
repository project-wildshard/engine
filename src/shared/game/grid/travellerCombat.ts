import type { Scope } from '@wildshard/engine/app/scope';
import type { Events } from '@wildshard/engine/events/events';
import type { Actor } from '@wildshard/engine/combat/pipeline';
import type { GridPoint } from './assembly';
import { gridZone } from './rules';

/**
 * Hit-delivery permission for one authoritative world. The traveller's geometric cell owns combat, independently
 * of the motor's 6/10 m frame hysteresis. Legacy env weapon requests carry actor.player; ordinary environmental
 * damage to the traveller uses the same gate. Terminal CombatPipeline.fall deliberately has its separate G129 path.
 * Regional actor objects (not repeated ids) provide local provenance; neighbours cannot damage another world's actors.
 */
export function installGridTravellerCombat(events: Events, scope: Scope, traveller: Actor, instance: string | (() => string | null),
  cellAtTraveller: () => string | null, actors?: ReadonlyMap<Actor, Readonly<GridPoint>> | (() => ReadonlyMap<Actor, Readonly<GridPoint>> | undefined)): void {
  if (scope.disposed) return;
  events.answer('damage.admit', request => {
    if (request === null) return null;
    const source = request.source === traveller || (request.source === 'env' && request.sourceTags.includes('actor.player'));
    const target = request.target === traveller;
    const local = typeof actors === 'function' ? actors() : actors;
    if (!source && !target && local === undefined) return request; // Preserve the page's independent local combat.
    const expected = typeof instance === 'function' ? instance() : instance;
    if (expected === null || cellAtTraveller() !== expected) return null;
    if (local !== undefined) {
      const localTarget = target ? undefined : local.get(request.target);
      if (!target && (localTarget === undefined || gridZone(localTarget) !== 'shard')) return null;
      if (!source && request.source !== 'env') {
        const localSource = local.get(request.source);
        if (localSource === undefined || gridZone(localSource) !== 'shard') return null;
      }
    }
    return request;
  }, scope);
}
