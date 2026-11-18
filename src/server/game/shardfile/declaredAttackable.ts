import { attackableBy } from '@wildshard/format/creatureLayers';
import type { Shardfile } from '@wildshard/format/shardSchema';
import type { SimHost } from '@wildshard/engine/sim';
import type { DamageRequest } from '@wildshard/engine/combat/pipeline';

/** ONE-FORMAT OF38b (J420 (2), Jake 2026-11-18: *"creatures themselves should define whether they can be attacked or
 * not"*): the held primitives read each creature's own `attackable` declaration (shard-format OF38a). A player's blow
 * on a creature whose species says that weapon class may not hit it is refused before any rule sees it, so a strike or a
 * shot passes through. A hit is `ranged` when its weapon row shoots (a `ranged` policy, or a bow or firearm profile),
 * else `melee`. A species without the declaration takes every hit, as before; creatures' and the world's blows are never
 * refused. There is no aim list: no weapon carries targets (Nalati's `combat.targets` goes at OF38c). */
export function installDeclaredAttackable(host: SimHost, shard: Pick<Shardfile, 'rows' | 'items'>): boolean {
  const declared = new Map(shard.rows.species.flatMap(row => row.attackable === undefined ? [] : [[row.id, row.attackable] as const]));
  if (declared.size === 0) return false;
  const ranged = new Set<string>(shard.items.rows.flatMap(row => row.kind === 'weapon'
    && (row.ranged !== undefined || row.profile?.family === 'bow' || row.profile?.family === 'firearm') ? [row.id] : []));
  const classOf = (request: DamageRequest): 'melee' | 'ranged' => request.weaponId !== undefined && ranged.has(request.weaponId) ? 'ranged' : 'melee';
  // Resolve the live body on every request: creatures spawn, respawn and leave after installation.
  const creature = (actor: DamageRequest['target']) => {
    const body = host.entities.get(actor.id);
    return body?.combatActor() === actor ? body : undefined;
  };
  host.events.answer('damage.admit', request => {
    if (request === null || request.source === 'env' || creature(request.source) !== undefined) return request;
    const body = creature(request.target);
    if (body === undefined) return request;
    return attackableBy(declared.get(body.species), classOf(request), body.mem) ? request : null;
  }, host.scope);
  return true;
}
