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
import { bindCreatureSenses } from './creatureSenses';
import { declaredHerdGoal, declaredHerdOf, installDeclaredHerdSave, joinDeclaredGroup } from './declaredHerds';

const finite = v.pipe(v.number(), v.finite());
const Saved = v.strictObject({ contract: v.string(), clock: finite, memory: v.unknown(),
  target: v.exactOptional(v.nullable(v.pipe(v.string(), v.minLength(1), v.maxLength(128)))),
  noise: v.strictObject({ seen: v.boolean(), speed: finite, prev: v.tuple([finite, finite, finite]) }),
  sight: v.array(v.nullable(v.boolean())),
  player: v.exactOptional(v.tuple([finite, finite, finite])),
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
    const senses = layer.senses, original = layer.brain.tuning, presentation = layer.presentation;
    // Omnidirectional notice/reveal use the existing native hearing-rate
    // path. Sight, grazing and every noise band keep the native awareness
    // meter, wary multiplier and cadence; no second detector clock appears.
    const omni = senses === undefined ? 0 : Math.max(senses.sight === undefined ? senses.notice : 0, senses.reveal ?? 0);
    const tuning = senses === undefined ? original : { ...original,
      sightRange: senses.sight?.range ?? senses.notice,
      sightRangeGraze: senses.sight?.graze ?? senses.sight?.range ?? senses.notice,
      sightCone: senses.sight?.cone ?? Math.PI,
      hearStill: Math.max(senses.hearing?.still ?? 0, omni), hearCrouch: Math.max(senses.hearing?.crouch ?? 0, omni),
      hearWalk: Math.max(senses.hearing?.walk ?? 0, omni), hearSprint: Math.max(senses.hearing?.sprint ?? 0, omni),
      ...(original.stalk === undefined ? {} : { stalk: { ...original.stalk, detect: 0 } }),
    };
    const legacySpecies = { tuning, ...layer.brain.motion, aggressive: layer.temperament.reaction === 'aggressive',
      ...(presentation?.sounds.call === undefined || presentation.sounds.hurt === undefined ? {} : {
        sounds: { call: presentation.sounds.call, hurt: presentation.sounds.hurt },
      }) };
    const species = { ...legacySpecies, reaction: layer.temperament.reaction, ...(layer.senses === undefined ? {} : { notice: layer.senses.notice }) };
    // Aggressive hunts without authored notice retain the exact released M1 contract.
    const contractSpecies = species.reaction === 'aggressive' && layer.senses === undefined ? legacySpecies : species;
    const perception = senses === undefined ? undefined : bindCreatureSenses(host, actor, senses);
    return [{ spawn, actor, id, species, perception, contract: JSON.stringify({ spawn, species: contractSpecies, temperament: layer.temperament }) }];
  });
  for (const { spawn, actor, id, species, perception, contract } of prepared) {
    const player = new Vector3().copy(host.nearestPlayer(actor.position).position);
    let selected: string | null = null, observed: ReturnType<SimHost['nearestPlayer']> | undefined;
    const observe = () => {
      if (perception === undefined) observed = host.nearestPlayer(actor.position);
      else {
        observed = selected === null ? undefined : host.players.get(selected);
        if (observed === undefined || !observed.health.alive || host.parked.has(observed.id)
          || (actor.state !== 'charge' && actor.state !== 'stalk' && actor.state !== 'flee')) {
          observed = perception.nearest(); selected = observed?.id ?? null;
        }
        if (observed !== undefined) host.focusPlayer(observed.id);
      }
      if (observed !== undefined) player.copy(observed.position);
    };
    const hunt = new StalkerBrain<AnimalSim>({ pattern: 'hunt', config: { rng: host.rng.stream('ai'),
      fight: {}, faunaTuning: () => undefined, species: () => species }, player, sampleTerrain: () => undefined,
      ports: { ground, nav: () => null, reach: (body, target) => canReach(body, target, host.physics),
        // OF23c: a body in a declared herd wanders to the goal the rain shelter gives its herd
        wanderGoal: () => spawn.group === undefined ? null : declaredHerdGoal(host, actor),
        herdOf: () => spawn.group === undefined ? null : declaredHerdOf(host, actor), unaware: () => {
          if (perception === undefined) return !host.nearestPlayer(actor.position).health.alive;
          return observed === undefined || !observed.health.alive || host.parked.has(observed.id);
        },
        now: () => host.clock.now * 1000, sound: () => undefined,
        charge: (body, damage) => { const target = perception === undefined ? host.nearestPlayer(body.position) : observed;
          if (target === undefined || (perception !== undefined && (!target.health.alive || host.parked.has(target.id)))) return;
          host.combat.hit({ source: body.combatActor(), sourceTags: [`creature.${spawn.species}`], target: target.health,
            amount: damage, point: body.position.clone(), dir: new Vector3().subVectors(target.position, body.position).normalize(), cause: { kind: body.kind, label: body.label } }); },
      } });
    hunt.adopt(actor, spawn.at[0], spawn.at[2]);
    if (spawn.group !== undefined) joinDeclaredGroup(host, spawn.group, actor, spawn.at[0], spawn.at[2]);
    const memory = hunt.memory(actor);
    if (memory === undefined) throw new Error(`species \`${spawn.species}\`: missing hunt memory`);
    let clock = 0;
    const noise = { seen: false, prev: new Vector3(), speed: 0 }, sight: (boolean | null)[] = [null];
    const cadence = hunt.bindRoster({ limit: 1, order: 'combined', at: () => actor, actor: body => body, id: body => body.entityId,
      player, noise, sight, reach: (body, target) => canReach(body, target, host.physics), brainDt: (body, urgent) => host.brainDt(body, urgent) });
    host.onStep(id, dt => {
      // OF23c: a body a script adopted (an elite program's declared main) is the script's to drive
      if (!host.bodyPresent(actor.entityId) || actor.scripted) return;
      observe();
      hunt.beginTick(dt); clock += dt; cadence.observe(dt); cadence.decide();
      const bodyDt = host.bodyDt(actor.entityId);
      if (bodyDt > 0 && actor.alive && !actor.stunned && !actor.harnessHold && actor.state === 'charge') hunt.advanceCharge(actor, bodyDt, player);
    }, { snapshot: () => JSON.stringify({ contract, clock, memory: huntMemoryCodec.save(memory),
      ...(perception === undefined ? {} : { target: selected !== null && host.players.has(selected) ? selected : null }),
      noise: { seen: noise.seen, speed: noise.speed, prev: noise.prev.toArray() }, sight, player: player.toArray() }),
    restore: saved => {
      if (typeof saved !== 'string') throw new Error('Invalid layer hunt continuation');
      const state = v.parse(Saved, JSON.parse(saved));
      if (state.contract !== contract || state.sight.length !== 1) throw new Error('Incompatible layer hunt continuation');
      if (perception === undefined ? state.target !== undefined : state.target === undefined || (state.target !== null && !host.players.has(state.target)))
        throw new Error('Incompatible sensed hunt target continuation');
      huntMemoryCodec.restore(memory, state.memory);
      hunt.beginTick(state.clock - clock); clock = state.clock;
      noise.seen = state.noise.seen; noise.speed = state.noise.speed; noise.prev.set(...state.noise.prev); sight[0] = state.sight[0] ?? null;
      selected = state.target ?? null;
      if (state.player !== undefined) player.set(...state.player);
    } });
    host.onStep(`${id}.contact`, () => {
      if (host.bodyDt(actor.entityId) <= 0 || !actor.alive || actor.stunned || actor.harnessHold || actor.state !== 'charge') return;
      observe(); hunt.chargeContact(actor, player);
    }, undefined, 'afterBodies');
    // ONE-FORMAT OF22b2: a swing's item reaction (a held item's sweep asks `item.reaction`) reaches a declared hunt: the
    // blow staggers this body's charge, and an alarm wakes it when it is aggressive or has sensed the player. Every answerer
    // passes the reaction on, so another declared hunt beside it still hears it.
    host.events.answer('item.reaction', reaction => {
      if (reaction.kind === 'alarm') { if (actor.alive && (species.aggressive || hunt.sensed(actor))) cadence.wake(actor); }
      else if (reaction.actor === actor) hunt.staggered(actor, reaction.strength, reaction.running);
      return reaction;
    }, host.scope);
    host.events.on('damage.dealt', ({ req, killed }) => {
      if (req.target !== actor.combatActor()) return;
      if (species.reaction === 'neutral' && (req.source === 'env' || host.players.get(req.source.id)?.health !== req.source)) return;
      if (perception !== undefined) {
        const source = req.source === 'env' ? undefined : host.players.get(req.source.id);
        observed = source !== undefined && source.health === req.source ? source : host.nearestPlayer(actor.position);
        selected = observed.id; player.copy(observed.position);
        if (!host.parked.has(observed.id)) host.focusPlayer(observed.id);
      } else observe();
      cadence.damaged(req.target, killed);
    }, host.scope);
  }
  // OF23c: a declared herd's centre is saved, and (J109) a room's fallen herd body returns, unless it keeps its own timer
  installDeclaredHerdSave(host, new Set(creatures.spawns.flatMap(spawn => spawn.respawn === undefined ? [] : [spawn.id])));
}
