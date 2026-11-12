// SERVER-PARITY HS5: status effects on the server. Before the flip the page's EffectService was their only owner, so a room
// landed the template whip's heavy and dropped its poison (engine 59737ce9). The room now runs that same shared service over
// the shared starter rows: an effect applies, ticks its row's damage once a period through the host's combat, and expires.
// The page only ever ticked its own player's damage (bindPlayerEffects), so its poisoned creature kept its health; HS5's
// done-when asks for the row's damage on any target, so a creature takes it here.
// Stun's and slow's attribute modifiers land on the actor, but no server motor reads them yet: only their tags act.
// A creature's health reaches every page on its row; a player's own statuses reach its page as owned lines (`statusLine`).
// A save holds no statuses: a continuation restores with none running, as a page reload did.
import { Vector3 } from 'three';
import type { SimHost } from '@wildshard/engine/sim';
import { publishOwned } from '@wildshard/engine/sim/shardRows';
import type { Actor } from '@wildshard/engine/combat/pipeline';
import { EffectService } from '@wildshard/engine/combat/effects/EffectService';
import type { ActiveEffect, EffectId, EffectTarget } from '@wildshard/engine/combat/effects/types';
import { STARTER_EFFECTS, statusLine } from '../../../shared/game/systems/effects/starterEffects';

/** A line moves ten times a second, not sixty. */
const TENTHS = 10;

/** The room's one status owner. */
export interface StatusEffects {
  /** Put `id` on `target`, from `source`. False: no row declares it, and nothing happens. */
  readonly apply: (target: Actor, id: EffectId, source: Actor) => boolean;
  readonly active: (target: Actor) => readonly ActiveEffect[];
}
const owners = new WeakMap<SimHost, StatusEffects>();

/** Install `host`'s status owner, once; a second call hands back the first. Install it before the owners that apply
 *  statuses step, so a status ticks a full period after the blow that put it on. */
export function installStatusEffects(host: SimHost): StatusEffects {
  const known = owners.get(host); if (known !== undefined) return known;
  const ids = new Set(STARTER_EFFECTS.map(def => def.id)), held = new Set<Actor>();
  /** Where a tick lands: the player's feet, as the page's player binding hits, or a creature's body. Null: it left the world. */
  const pointOf = (target: Actor): Vector3 | null => {
    const player = host.players.get(target.id);
    if (player?.health === target) return player.position.clone();
    const body = host.entities.get(target.id);
    if (body?.combatActor() === target) return new Vector3(body.position.x, body.position.y + body.dims.bodyY * body.scale, body.position.z);
    return null;
  };
  const actorOf = (recipient: EffectTarget): Actor | undefined => held.has(recipient as Actor) ? recipient as Actor : undefined;
  // The page's player tick (bindPlayerEffects), for any target: the row's damage times its stacks, through walls.
  const service = new EffectService(STARTER_EFFECTS, host.scope, undefined, (recipient, effect) => {
    const target = actorOf(recipient), amount = effect.def.tickDamage;
    if (target === undefined || amount === undefined || !target.alive) return;
    const point = pointOf(target); if (point === null) return;
    host.combat.hit({ source: effect.source ?? 'env', sourceTags: [...effect.sourceTags, effect.def.id, 'dmg.effect', 'through.walls'],
      target, amount: amount * effect.stacks, point, dir: new Vector3(), throughWalls: true });
  });
  host.onStep('combat.status-effects', dt => {
    service.update(dt);
    // A body that died or left takes its statuses with it, as the page clears a dead player's.
    for (const target of held) if (!target.alive || pointOf(target) === null || service.active(target).length === 0) { service.clear(target); held.delete(target); }
  });
  publishOwned(host, 'combat.status-effects', (id, out) => {
    const health = host.players.get(id)?.health; if (health === undefined) return;
    for (const effect of service.active(health)) if (Number.isFinite(effect.remaining) && effect.def.tags.some(tag => tag.startsWith('status.')))
      out.set(statusLine(effect.def.id), Math.max(1, Math.round(effect.remaining * TENTHS)) / TENTHS);
  });
  const owner: StatusEffects = {
    apply: (target, id, source) => {
      if (!ids.has(id) || !target.alive) return false;
      held.add(target); service.apply(target, id, source); return true;
    },
    active: target => service.active(target),
  };
  owners.set(host, owner); return owner;
}
