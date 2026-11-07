import { Vector3 } from 'three';
import * as v from 'valibot';
import { canReach } from '@wildshard/engine/ai/reach';
import { lineOfSight } from '@wildshard/engine/physics/query';
import { CharacterMotor } from '@wildshard/engine/physics/CharacterMotor';
import type { AnimalSim } from '@wildshard/engine/entities/AnimalSim';
import type { SimHost } from '@wildshard/engine/sim';
import type { StrikeSpec } from '@wildshard/engine/ai/strikes';
import { UpdraftModeSchema, type UpdraftMode, type TraverseMode } from '@wildshard/format/modes';
import type { ShardCreatures } from '@wildshard/format/creatures';
import type { ShardRows } from '@wildshard/format/rows';
import type { DeclaredBrainPorts } from '../../../server/game/shardfile/brainRuntime';
import type { DeclaredGroupPorts, DeclaredPackRecipe } from '../../../server/game/shardfile/groupRuntime';

const finite = v.pipe(v.number(), v.finite());
const paceSchema = { x: finite, z: finite, speed: v.pipe(finite, v.minValue(0)) };
/** The first player's pace is the save as it always was; the rest ride beside it, only with company. */
const motionSchema = v.strictObject({ ...paceSchema, others: v.exactOptional(v.record(v.string(), v.strictObject(paceSchema))) });
/** Bind bounded player impulses to the real owner without a host, phase or clock.
 * Directed hits preserve their yaw/speed projection; column callbacks read feet and
 * board state in the caller's existing fixed phase. Each binding owns one vector. */
export function bindPlayerImpulse(apply: (velocity: Vector3) => void): {
  directed: (yaw: number, speed: number, lift: number) => void;
  column: (input: UpdraftMode, feet: () => Readonly<{ x: number; y: number; z: number }>, enabled: () => boolean) => (dt: number) => void;
  columns: (input: readonly TraverseMode[], feet: () => Readonly<{ x: number; y: number; z: number }>, enabled: () => boolean,
    register: (id: string, run: (dt: number) => void) => void) => void;
} {
  const impulse = new Vector3();
  return {
    directed: (yaw, speed, lift) => {
      if (![yaw, speed, lift].every(Number.isFinite)) throw new Error('Invalid directed player impulse');
      apply(impulse.set(Math.sin(yaw) * speed, lift, Math.cos(yaw) * speed));
    },
    column: (input, feet, enabled) => {
      const row = v.parse(UpdraftModeSchema, input);
      return dt => {
        if (!Number.isFinite(dt) || dt < 0 || dt > 1) throw new Error('Invalid column impulse step');
        if (!enabled()) return;
        const p = feet(), ux = row.to.x - row.from.x, uz = row.to.z - row.from.z, len = Math.hypot(ux, uz);
        const along = ((p.x - row.from.x) * ux + (p.z - row.from.z) * uz) / len;
        const across = Math.abs((p.x - row.from.x) * uz - (p.z - row.from.z) * ux) / len;
        if (across < row.width / 2 + row.margin && along > 0 && along < len && p.y < row.to.y + row.margin) {
          impulse.set(0, 0, 0); impulse.y += row.lift * dt;
          if (impulse.y !== 0) apply(impulse);
        }
      };
    },
    columns(input, feet, enabled, register) {
      if (input.length > 64) throw new Error('Too many player impulse routes');
      const rows = input.filter(row => row.kind === 'updraft').map(row => v.parse(UpdraftModeSchema, row));
      if (new Set(rows.map(row => row.id)).size !== rows.length) throw new Error('Duplicate player impulse route');
      for (const row of rows) register(row.id, this.column(row, feet, enabled));
    },
  };
}

/** Every player in the world rises in a column of air, each read in the column's own fixed step (P1-E3.10). */
export function bindPlayerColumns(host: Pick<SimHost, 'players' | 'parked' | 'focusedPlayer' | 'onStep'>, rows: readonly TraverseMode[]): void {
  let rider = host.focusedPlayer;
  bindPlayerImpulse(velocity => { rider.addImpulse(velocity); }).columns(rows, () => rider.position, () => rider.board.on, (id, run) => {
    host.onStep(id, dt => { for (const player of host.players.values()) { if (host.parked.has(player.id)) continue; rider = player; run(dt); } });
  });
}

/** Default data-only herd and diver recipes over one real host; injected trusted recipes remain separate. */
export function dataCreaturePorts(host: SimHost, rows: ShardRows, spawns: ShardCreatures['spawns'] = [], borrowedImpulse?: (velocity: Vector3) => void): {
  brains: DeclaredBrainPorts; groups: DeclaredGroupPorts; install: () => void;
} {
  let used = false;
  const homes = new Map(spawns.map(row => [row.id, row.home === undefined ? undefined : { ...row.home }]));
  const directors = new Map<AnimalSim, Parameters<DeclaredPackRecipe['ports']['register']>[1]>();
  const phases = new Map(spawns.map(row => [row.id, row.phaseOffset]));
  const impulse = borrowedImpulse ?? (host.embedded ? undefined : (velocity: Vector3) => { host.focusedPlayer.addImpulse(velocity); });
  const forces = impulse === undefined ? undefined : bindPlayerImpulse(impulse);
  const start = host.focusedPlayer.position, motion = { x: start.x, z: start.z, speed: 0 };
  /** Every other player's pace: a body's reading is its own foe's, not the first player's. */
  const company = new Map<string, typeof motion>();
  const from = new Vector3(), to = new Vector3(), direction = new Vector3(), point = new Vector3();
  const strikes = new Map<string, StrikeSpec>(rows.strikes.map(({ weight, speed, ...row }) =>
    [row.id, { ...row, motion: { speed }, weight: () => weight }]));
  const foe = (actor: AnimalSim): ReturnType<SimHost['nearestPlayer']> => host.nearestPlayer(actor.position);
  const speedOf = (actor: AnimalSim): number => company.get(foe(actor).id)?.speed ?? motion.speed;
  const calm = (actor: AnimalSim): boolean => !foe(actor).health.alive;
  const reach = (actor: AnimalSim): boolean => canReach(actor, foe(actor).position, host.physics);
  const hurt = (actor: AnimalSim, damage: number, tags: StrikeSpec['tags'], moveId: string): void => {
    const target = foe(actor);
    if (!actor.alive || !target.health.alive) return;
    point.copy(target.position); point.y += 1.2;
    from.copy(actor.position); from.y += actor.dims.bodyY * actor.scale;
    direction.subVectors(point, from).normalize();
    host.combat.hit({ source: actor.combatActor(), sourceTags: tags, target: target.health,
      amount: damage, point, dir: direction, from, moveId });
  };
  const inBounds = (x: number, z: number, margin: number): boolean => Math.abs(x) <= 250 - margin && Math.abs(z) <= 250 - margin;
  const normalY = (x: number, z: number): number => {
    const dx = host.groundHeightAt(x + 0.25, z) - host.groundHeightAt(x - 0.25, z);
    const dz = host.groundHeightAt(x, z + 0.25) - host.groundHeightAt(x, z - 0.25);
    return 0.5 / Math.hypot(dx, dz, 0.5);
  };
  const confine = (actor: AnimalSim): void => {
    // The body motor owns obstacles. Reject outward steering at the cell's native bounds, without teleporting.
    if (!inBounds(actor.position.x + Math.sin(actor.desiredYaw) * 2,
      actor.position.z + Math.cos(actor.desiredYaw) * 2, 1)) actor.setMotion(Math.atan2(-actor.position.x, -actor.position.z), 0, 3);
  };
  const diver = (actor: AnimalSim, id: string) => {
    used = true;
    const strike = strikes.get(id);
    if (strike === undefined) throw new Error('Unresolved data-host diver strike');
    return { strike, observe: (dt: number) => ({ dt, player: foe(actor).position, calm: calm(actor),
      mayAttack: (body: AnimalSim) => host.events.ask('ai.mayAttack', body),
      claim: (body: AnimalSim) => host.events.ask('ai.claim', body), reach,
      hurt: (damage: number) => { hurt(actor, damage, strike.tags, strike.id); },
      flight: { steer: (body: AnimalSim, yaw: number, speed: number, altitude: number, turn: number) => { body.fly(yaw, speed, altitude, turn); } },
    }), body: () => { confine(actor); } };
  };
  return {
    brains: { ramGrazer: (actor, row) => {
      const home = homes.get(actor.entityId), strike = strikes.get(row.strike);
      if (home === undefined) throw new Error('Missing authored data-host ram home');
      if (strike === undefined) throw new Error('Unresolved data-host ram strike');
      used = true;
      return { strike, observe: dt => ({ dt, home, player: foe(actor).position, calm: calm(actor),
        rng: host.rng.stream('ai'), reach, claim: body => host.events.ask('ai.claim', body),
        hurt: damage => { hurt(actor, damage, strike.tags, strike.id); },
        strikeHit: selected => { hurt(actor, selected.damage, selected.tags, selected.id); },
      }), body: () => undefined };
    }, challengeGrazer: (actor, row) => {
      const phaseOffset = phases.get(actor.entityId), charge = strikes.get(row.charge), close = strikes.get(row.close);
      if (phaseOffset === undefined) throw new Error('Missing authored data-host circle phase');
      if (charge === undefined || close === undefined) throw new Error('Unresolved data-host challenge strikes');
      used = true;
      return { charge, close, observe: dt => ({ dt, t: host.clock.now, phaseOffset, player: foe(actor).position,
        calm: calm(actor), reach, claim: body => host.events.ask('ai.claim', body),
        hurt: () => { throw new Error('Missing selected data-host challenge strike'); },
        strikeHit: selected => { hurt(actor, selected.damage, selected.tags, selected.id); },
        steer: (body, yaw, speed, turn) => { body.setMotion(yaw, speed, turn); },
      }), body: () => undefined };
    }, burstFlyer: (actor, row) => {
      if (forces === undefined) throw new Error('Missing borrowed data-host player impulse');
      const recipe = diver(actor, row.strike);
      return { strike: recipe.strike, body: recipe.body, observe: dt => ({ ...recipe.observe(dt),
        shove: forces.directed,
      }) };
    }, orbitDiver: (actor, row) => diver(actor, row.strike), patrolDiver: (actor, row) => diver(actor, row.strike) },
    groups: { pack: (group, members) => {
      used = true;
      const memberSet = new Set(members);
      return { ports: {
        sharedRng: () => host.rng.stream('ai'),
        environment: () => {
          const player = host.focusedPlayer;
          return { playerFwdX: Math.sin(player.yaw), playerFwdZ: Math.cos(player.yaw),
            playerMounted: player.mode === 'ride',
            playerHealth01: player.health.attributes.health / player.health.attributes.maxHealth,
            // Data-only rows declare no grass/scent field or animal-prey binding.
            grassHeightAt: () => 0 };
        },
        visibility: (x, z, player) => {
          from.set(x, host.groundHeightAt(x, z) + 1.2, z); to.copy(player); to.y += 1.2;
          return lineOfSight(host.physics, from, to) ? 1 : 0;
        },
        hearing: (radii, _player, speed) => radii[speed < 0.4 ? 0 : speed <= 2.6 ? 1 : speed < 5.2 ? 2 : 3],
        downwind: () => false, inBounds, normalY,
        register: (actor, director) => {
          if (!memberSet.has(actor) || host.entities.get(actor.entityId) !== actor) throw new Error('Unresolved data-host pack actor');
          directors.set(actor, director);
        },
        bite: (actor, _context, radius) => {
          if (Math.hypot(actor.position.x - foe(actor).position.x, actor.position.z - foe(actor).position.z) < radius && reach(actor))
            hurt(actor, actor.mods.chargeDamage, ['animal.pack', 'feel.blow'], group.id);
        },
        // The stock group has only its actual player target; injected recipes own animal prey.
        preyIdentity: () => { throw new Error('Undeclared data-host pack prey'); }, resolvePrey: () => null,
      }, observe: (body, dt) => ({ dt, t: host.clock.now, player: foe(body).position,
        playerSpeed: speedOf(body), calm: calm(body), rng: host.rng.stream('ai'),
        sound: () => undefined,
        claim: actor => host.events.ask('ai.claim', actor) && (directors.get(actor)?.take(actor) ?? false),
        steer: (actor, yaw, speed, turn) => { actor.setMotion(yaw, speed, turn); },
        pathYaw: (actor, x, z) => {
          from.copy(actor.position); from.y += actor.dims.bodyY * actor.scale;
          to.set(x, host.groundHeightAt(x, z) + actor.dims.bodyY * actor.scale, z);
          return lineOfSight(host.physics, from, to) ? Math.atan2(x - actor.position.x, z - actor.position.z) : actor.yaw + Math.PI / 2;
        },
      }), confine };
    }, herd: (group, _members) => {
      used = true;
      return { ports: {
        sharedRng: () => host.rng.stream('ai'),
        environment: () => ({ playerMounted: host.focusedPlayer.mode === 'ride', playerCrouched: false }),
        visibility: (x, z, player) => {
          from.set(x, host.groundHeightAt(x, z) + 1.2, z); to.copy(player); to.y += 1.2;
          return lineOfSight(host.physics, from, to) ? 1 : 0;
        },
        hearing: (radii, _player, speed) => radii[speed < 0.4 ? 0 : speed <= 2.6 ? 1 : speed < 5.2 ? 2 : 3],
        // Data-only rows declare no wind/scent field. Absence does not grant the smell observation.
        downwind: () => false, inBounds, normalY,
        passThrough: (actor, through) => {
          const motor = actor.motor;
          if (motor instanceof CharacterMotor) motor.passThrough(through ? ['PLAYER'] : []);
        },
        chargeContact: (actor, _context, radius) => {
          if (actor.position.distanceTo(foe(actor).position) < radius && reach(actor))
            hurt(actor, actor.mods.chargeDamage, ['animal.charge', 'feel.blow'], group.id);
        },
        // No declared pack owner is installed by this herd-only recipe.
        scarePack: () => false, resolveActor: id => host.entities.get(id) ?? null,
      }, observe: (actor, dt) => ({ dt, t: host.clock.now, player: foe(actor).position, playerSpeed: speedOf(actor),
        calm: calm(actor), rng: host.rng.stream('ai'),
        // Cues are presentation-only; this owner has no audio callback, reward or event grant.
        sound: () => undefined, hurt: (damage: number) => { hurt(actor, damage, ['animal.herd', 'feel.blow'], group.id); },
        steer: (body, yaw, speed, turn) => { body.setMotion(yaw, speed, turn); },
        pathYaw: (body, x, z) => {
          from.copy(body.position); from.y += body.dims.bodyY * body.scale;
          to.set(x, host.groundHeightAt(x, z) + body.dims.bodyY * body.scale, z);
          return lineOfSight(host.physics, from, to) ? Math.atan2(x - body.position.x, z - body.position.z) : body.yaw + Math.PI / 2;
        }, confine,
      }) };
    } },
    install: () => {
      if (!used) return;
      host.onStep('creatures.data-motion', dt => {
        for (const id of company.keys()) if (!host.players.has(id)) company.delete(id);
        let first = true;
        for (const player of host.players.values()) {
          const { x, z } = player.position;
          const pace = first ? motion : company.get(player.id) ?? { x, z, speed: 0 };
          if (!first) company.set(player.id, pace);
          first = false;
          pace.speed = Math.hypot(x - pace.x, z - pace.z) / dt; pace.x = x; pace.z = z;
        }
      }, { snapshot: () => company.size === 0 ? { ...motion } : { ...motion, others: Object.fromEntries([...company].map(([id, pace]) => [id, { ...pace }])) },
      restore: value => {
        const { others = {}, ...own } = v.parse(motionSchema, value);
        Object.assign(motion, own); company.clear();
        for (const [id, pace] of Object.entries(others)) company.set(id, { ...pace });
      } });
    },
  };
}
