// ONE-FORMAT CC60 (C-Q2): a whole-creature WASM brain (`creatures.brains` kind `script`) from any upload. A native
// runtime still brings its own native port; a data-only shard gets this one, built from its own rows, so the guest
// still cannot write positions, spawn or deal damage: it reads the observations below, asks for motion inside its
// declared bounds and requests strikes from its declared list, which run on the engine's strike runner only when the
// attack-permission owner (`ai.mayAttack`) says yes. Fuel is the shared script host's: a module whose `init` runs past a
// call's fuel is refused at admission, and one that later runs over is stopped by the host.
import type { Shardfile } from '@wildshard/format/shardSchema';
import type { SimHost } from '@wildshard/engine/sim';
import type { AnimalSim } from '@wildshard/engine/entities/AnimalSim';
import type { ScriptBrainPorts } from '@wildshard/engine/ai/scriptBrain';
import { bindCreatureSenses } from './creatureSenses';

/** The observation slots a data brain reads after the ten fixed ones (in order): the nearest player's offset x and z,
 *  its distance, whether this creature's senses notice it (1 or 0; 1 when the species has no senses), whether it is
 *  alive (1 or 0), and this creature's own health as a 0 to 1 fraction. */
export const DATA_BRAIN_OBSERVATIONS = ['dx', 'dz', 'distance', 'noticed', 'alive', 'health'] as const;

/** The engine's script-brain port for a data-only shard, or undefined when no spawn runs a script brain. */
export function dataScriptBrains(rows: Shardfile['rows'], spawns: Shardfile['creatures']['spawns'], brains: Shardfile['creatures']['brains']):
  ((host: SimHost) => { ports: ScriptBrainPorts; query?: undefined }) | undefined {
  const scripted = new Map(brains.flatMap(brain => brain.kind === 'script' ? [[brain.id, brain] as const] : []));
  const bound = spawns.flatMap(spawn => { const brain = spawn.brain === null ? undefined : scripted.get(spawn.brain); return brain === undefined ? [] : [{ spawn, brain }]; });
  if (bound.length === 0) return undefined;
  return host => {
    const senses = new Map<string, ReturnType<typeof bindCreatureSenses>>();
    for (const { spawn, brain } of bound) {
      const actor = host.entities.get(spawn.id); if (actor === undefined) throw new Error(`Missing script brain body ${spawn.id}`);
      const named = new Set(brain.strikes.map(row => row.strike));
      host.registerStrikeCatalogue(spawn.id, rows.strikes.filter(row => named.has(row.id)));
      const input = rows.species.find(row => row.id === spawn.species)?.senses;
      if (input !== undefined) senses.set(spawn.id, bindCreatureSenses(host, actor, input));
    }
    const observe = (actor: AnimalSim): readonly number[] => {
      const player = host.nearestPlayer(actor.position), dx = player.position.x - actor.position.x, dz = player.position.z - actor.position.z;
      const noticed = senses.get(actor.entityId)?.notices(player) ?? true;
      return [dx, dz, Math.hypot(dx, dz), noticed ? 1 : 0, player.health.alive ? 1 : 0, actor.maxHp > 0 ? actor.hp / actor.maxHp : 0];
    };
    return { ports: {
      observe,
      mayAttack: actor => host.events.ask('ai.mayAttack', actor),
      strike: (actor, strike) => { host.startDeclaredStrike(actor.entityId, host.nearestPlayer(actor.position).id, strike); },
    } };
  };
}
