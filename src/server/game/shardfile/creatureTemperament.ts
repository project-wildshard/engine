import type { CreatureTemperament } from '@wildshard/format/creatureLayers';
import type { AnimalSim } from '@wildshard/engine/entities/AnimalSim';
import type { SimHost, SimStateAdapter } from '@wildshard/engine/sim';

interface Position { readonly x: number; readonly y: number; readonly z: number }
/** An existing controller retains its own decisions and continuation. */
export interface TemperamentBrain { readonly run: (dt: number) => void; readonly adapter: SimStateAdapter }

/** Layer-owned home/engagement policy; the existing brain, body, strike and host remain their sole owners. */
export function bindCreatureTemperament(host: SimHost, actor: AnimalSim, at: readonly [number, number, number],
  temperament: CreatureTemperament, source: TemperamentBrain, target: () => Position | undefined): TemperamentBrain {
  const [x, y, z] = at, leash = temperament.leash, speed = temperament.home.speed, stop = temperament.home.stop;
  const contract = JSON.stringify({ at, temperament }), initial = source.adapter.snapshot();
  let returning = false;
  return { run: dt => {
    if (!actor.alive) { source.run(dt); return; }
    const distance = Math.hypot(actor.position.x - x, actor.position.y - y, actor.position.z - z), foe = target();
    if (distance > leash || (foe !== undefined && Math.hypot(foe.x - x, foe.y - y, foe.z - z) > leash)) returning = true;
    if (returning) {
      host.strikes.get(actor.entityId)?.cancel(); actor.cancelAttack();
      if (distance <= stop) {
        source.adapter.restore(initial); actor.hp = actor.maxHp; returning = false; actor.state = 'idle';
        actor.setMotion(actor.yaw, 0, 3); return;
      }
      // Leave the native motor room to brake and turn into the authored home stop.
      actor.state = 'wander'; actor.setMotion(Math.atan2(x - actor.position.x, z - actor.position.z), Math.min(speed, distance * 2), 4); return;
    }
    source.run(dt);
  }, adapter: { snapshot: () => [contract, returning, source.adapter.snapshot()], restore: saved => {
    if (!Array.isArray(saved) || saved.length !== 3 || saved[0] !== contract || typeof saved[1] !== 'boolean' || saved[2] === undefined) {
      throw new Error('Incompatible creature temperament continuation');
    }
    source.adapter.restore(saved[2]); returning = saved[1];
  } } };
}
