import type { CreatureTemperament } from '@wildshard/format/creatureLayers';
import type { AnimalSim } from '@wildshard/engine/entities/AnimalSim';
import type { SimHost, SimStateAdapter } from '@wildshard/engine/sim';
import type { Actor } from '@wildshard/engine/combat/pipeline';

interface Position { readonly x: number; readonly y: number; readonly z: number }
/** An existing controller retains its own decisions and continuation. */
export interface TemperamentBrain { readonly run: (dt: number, acquire?: boolean) => void; readonly adapter: SimStateAdapter; readonly provoke?: (target: string) => void; readonly reset?: () => void; readonly notice?: number; readonly escapeSpeed?: number; readonly crowd?: number; readonly install?: () => () => void }
/** Social membership shares identities, never a second decision controller. */
export interface CreatureSocialGroup { readonly id: string; readonly members: ReadonlySet<Actor> }

/** Layer-owned home/engagement policy; the existing brain, body, strike and host remain their sole owners. */
export function bindCreatureTemperament(host: SimHost, actor: AnimalSim, at: readonly [number, number, number],
  temperament: CreatureTemperament, source: TemperamentBrain, target: () => Position | undefined, group?: CreatureSocialGroup): TemperamentBrain {
  const [x, y, z] = at, territory = temperament.territorial, leash = Math.min(temperament.leash, territory ?? temperament.leash);
  const speed = temperament.home.speed, stop = temperament.home.stop;
  const contract = JSON.stringify({ at, temperament, ...(group === undefined ? {} : { group: group.id, members: [...group.members].map(member => member.id).sort() }) });
  const initial = source.adapter.snapshot(), reaction = temperament.reaction, pack = temperament.pack === true, assist = temperament.assist;
  const passive = reaction === 'passive' || reaction === 'skittish', flee = temperament.flee;
  let returning = false, installed = false, ambushing = temperament.ambush === true, frightened = false;
  return { install: () => {
    if (installed) throw new Error('Creature temperament already installed');
    installed = true;
    const scope = host.scope.child(`creature.temperament.${actor.entityId}`);
    host.events.on('damage.dealt', ({ req }) => {
      if (!actor.alive) return;
      if (req.target === actor.combatActor() && passive) { frightened = true; ambushing = false; return; }
      if (req.source === 'env') return;
      const player = host.players.get(req.source.id);
      if (player?.health !== req.source || !player.health.alive) return;
      if (req.target !== actor.combatActor()) {
        const damaged = host.entities.get(req.target.id);
        if (!pack || group?.members.has(req.target) !== true || damaged === undefined || damaged.combatActor() !== req.target
          || damaged.position.distanceToSquared(actor.position) > assist * assist) return;
      }
      ambushing = false;
      if (passive) frightened = true; else source.provoke?.(player.id);
    }, scope);
    if (territory !== undefined) {
      const previous = actor.motionConstraint;
      const constrain: NonNullable<AnimalSim['motionConstraint']> = (from, to) => {
        previous?.(from, to);
        const dx = to.x - x, dz = to.z - z, distance = Math.hypot(dx, dz);
        if (distance > territory) { to.x = x + dx * territory / distance; to.z = z + dz * territory / distance; }
      };
      actor.motionConstraint = constrain;
      scope.onDispose(() => { if (actor.motionConstraint === constrain) actor.motionConstraint = previous; });
    }
    return () => { scope.dispose(); };
  }, run: dt => {
    if (!actor.alive) { returning = false; frightened = false; ambushing = temperament.ambush === true; source.run(dt); return; }
    const player = host.nearestPlayer(actor.position), fromPlayer = actor.position.distanceToSquared(player.position);
    const distance = Math.hypot(actor.position.x - x, actor.position.y - y, actor.position.z - z), foe = target();
    if (distance > leash || (foe !== undefined && Math.hypot(foe.x - x, foe.y - y, foe.z - z) > leash)) returning = true;
    if (reaction === 'skittish' && player.health.alive && fromPlayer < (source.notice ?? 0) ** 2) frightened = true;
    if (!returning && (frightened || (flee !== undefined && actor.hp <= actor.maxHp * flee))) {
      if (player.health.alive && fromPlayer <= leash * leash) {
        host.strikes.get(actor.entityId)?.cancel(); actor.cancelAttack(); actor.state = 'flee';
        actor.setMotion(Math.atan2(actor.position.x - player.position.x, actor.position.z - player.position.z), source.escapeSpeed ?? speed, 4); return;
      }
      returning = true;
    }
    if (ambushing && !returning) {
      if (!player.health.alive || actor.position.distanceToSquared(player.position) > (source.notice ?? 0) ** 2) {
        host.strikes.get(actor.entityId)?.cancel(); actor.cancelAttack(); actor.state = 'hide'; actor.setMotion(actor.yaw, 0, 3); return;
      }
      ambushing = false;
      if (reaction === 'aggressive') source.provoke?.(player.id);
    }
    if (returning) {
      host.strikes.get(actor.entityId)?.cancel(); actor.cancelAttack();
      if (distance <= stop) {
        if (source.reset === undefined) source.adapter.restore(initial); else source.reset();
        actor.hp = actor.maxHp; returning = false; frightened = false; ambushing = temperament.ambush === true; actor.state = ambushing ? 'hide' : 'idle';
        actor.setMotion(actor.yaw, 0, 3); return;
      }
      // Leave the native motor room to brake and turn into the authored home stop.
      actor.state = 'wander'; actor.setMotion(Math.atan2(x - actor.position.x, z - actor.position.z), Math.min(speed, distance * 2), 4); return;
    }
    if (passive) { host.strikes.get(actor.entityId)?.cancel(); actor.cancelAttack(); source.run(dt, false); return; }
    if (reaction === 'neutral' && foe === undefined) {
      if (player.health.alive && fromPlayer < (source.crowd ?? stop) ** 2) source.provoke?.(player.id);
      else { source.run(dt, false); return; }
    }
    source.run(dt);
  }, adapter: { snapshot: () => [contract, returning, ambushing, frightened, source.adapter.snapshot()], restore: saved => {
    if (!Array.isArray(saved) && group === undefined && temperament.pack !== true && temperament.ambush !== true
      && temperament.territorial === undefined && flee === undefined) {
      // The released M1 pursuit owns this exact base contract; it predates layer state.
      source.adapter.restore(saved); returning = false; ambushing = false; frightened = false; return;
    }
    if (!Array.isArray(saved) || saved.length !== 5 || saved[0] !== contract || typeof saved[1] !== 'boolean' || typeof saved[2] !== 'boolean' || typeof saved[3] !== 'boolean' || saved[4] === undefined) {
      throw new Error('Incompatible creature temperament continuation');
    }
    source.adapter.restore(saved[4]); returning = saved[1]; ambushing = saved[2]; frightened = saved[3];
  } } };
}
