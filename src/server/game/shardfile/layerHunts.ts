import { Vector3 } from 'three';
import * as v from 'valibot';
import { StalkerBrain } from '@wildshard/engine/ai/stalker';
import { huntMemoryCodec, type HuntGround } from '@wildshard/engine/ai/huntPattern';
import { canReach } from '@wildshard/engine/ai/reach';
import type { AnimalSim } from '@wildshard/engine/entities/AnimalSim';
import type { SimHost } from '@wildshard/engine/sim';
import type { ShardRows } from '@wildshard/format/rows';
import type { ShardCreatures } from '@wildshard/format/creatures';
import { resolveCreatureLayers } from './creatureLayers';

const finite = v.pipe(v.number(), v.finite());
const Saved = v.strictObject({ contract: v.string(), clock: finite, memory: v.unknown(),
  noise: v.strictObject({ seen: v.boolean(), speed: finite, prev: v.tuple([finite, finite, finite]) }),
  sight: v.array(v.nullable(v.boolean())),
});

/** Layer-owned hunts reuse the existing controller, cadence and memory codec over actual host bodies. */
export function installLayerHunts(host: SimHost, rows: ShardRows, creatures: ShardCreatures): void {
  const layers = resolveCreatureLayers(rows, creatures.brains);
  const ground: HuntGround = {
    heightAt: (x, z) => host.groundHeightAt(x, z),
    normalY: (x, z) => 0.5 / Math.hypot(host.groundHeightAt(x + 0.25, z) - host.groundHeightAt(x - 0.25, z),
      host.groundHeightAt(x, z + 0.25) - host.groundHeightAt(x, z - 0.25), 0.5),
    inChunk: (x, z, margin) => Math.abs(x) <= 250 - margin && Math.abs(z) <= 250 - margin,
    trailDistance: () => Infinity, cabinMask: () => 0, streamAt: () => null, waterLevel: () => -Infinity,
    pond: () => null, sea: () => false, wetAt: (x, z) => {
      const surface = host.water?.surfaceAt(x, z);
      return surface !== null && surface !== undefined && host.groundHeightAt(x, z) <= surface + 0.25;
    },
    trees: () => [], treeless: () => true, terrain: () => true, chunkHalf: 250,
  };
  const prepared = creatures.spawns.flatMap(spawn => {
    const layer = layers.get(spawn.species);
    if (layer?.brain.kind !== 'hunt') return [];
    const actor = host.entities.get(spawn.id), id = `brain.${spawn.id}`;
    if (actor === undefined || host.adapters.has(id) || spawn.brain !== null) throw new Error(`species \`${spawn.species}\`: competing or missing hunt body`);
    const tuning = layer.brain.tuning, presentation = layer.presentation;
    const species = { tuning, ...layer.brain.motion, aggressive: layer.temperament.reaction === 'aggressive',
      ...(presentation?.sounds.call === undefined || presentation.sounds.hurt === undefined ? {} : {
        sounds: { call: presentation.sounds.call, hurt: presentation.sounds.hurt },
      }) };
    return [{ spawn, actor, id, species, contract: JSON.stringify({ spawn, species, temperament: layer.temperament }) }];
  });
  for (const { spawn, actor, id, species, contract } of prepared) {
    const player = new Vector3().copy(host.nearestPlayer(actor.position).position);
    const hunt = new StalkerBrain<AnimalSim>({ pattern: 'hunt', config: { rng: host.rng.stream('ai'),
      fight: {}, faunaTuning: () => undefined, species: () => species }, player, sampleTerrain: () => undefined,
      ports: { ground, nav: () => null, reach: (body, target) => canReach(body, target, host.physics),
        wanderGoal: () => null, unaware: () => !host.nearestPlayer(actor.position).health.alive,
        now: () => host.clock.now * 1000, sound: () => undefined,
        charge: (body, damage) => { const target = host.nearestPlayer(body.position);
          host.combat.hit({ source: body.combatActor(), sourceTags: [`creature.${spawn.species}`], target: target.health,
            amount: damage, point: body.position.clone(), dir: new Vector3().subVectors(target.position, body.position).normalize(), cause: { kind: body.kind, label: body.label } }); },
      } });
    hunt.adopt(actor, spawn.at[0], spawn.at[2]);
    const memory = hunt.memory(actor);
    if (memory === undefined) throw new Error(`species \`${spawn.species}\`: missing hunt memory`);
    let clock = 0;
    const noise = { seen: false, prev: new Vector3(), speed: 0 }, sight: (boolean | null)[] = [null];
    const cadence = hunt.bindRoster({ limit: 1, order: 'combined', at: () => actor, actor: body => body, id: body => body.entityId,
      player, noise, sight, reach: (body, target) => canReach(body, target, host.physics), brainDt: (body, urgent) => host.brainDt(body, urgent) });
    host.onStep(id, dt => {
      player.copy(host.nearestPlayer(actor.position).position);
      hunt.beginTick(dt); clock += dt; cadence.observe(dt); cadence.decide();
    }, { snapshot: () => JSON.stringify({ contract, clock, memory: huntMemoryCodec.save(memory),
      noise: { seen: noise.seen, speed: noise.speed, prev: noise.prev.toArray() }, sight }),
    restore: saved => {
      if (typeof saved !== 'string') throw new Error('Invalid layer hunt continuation');
      const state = v.parse(Saved, JSON.parse(saved));
      if (state.contract !== contract || state.sight.length !== 1) throw new Error('Incompatible layer hunt continuation');
      huntMemoryCodec.restore(memory, state.memory);
      hunt.beginTick(state.clock - clock); clock = state.clock;
      noise.seen = state.noise.seen; noise.speed = state.noise.speed; noise.prev.set(...state.noise.prev); sight[0] = state.sight[0] ?? null;
    } });
    host.events.on('damage.dealt', ({ req, killed }) => {
      if (req.target !== actor.combatActor()) return;
      player.copy(host.nearestPlayer(actor.position).position); cadence.damaged(req.target, killed);
    }, host.scope);
  }
}
