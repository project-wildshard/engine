import { Vector3 } from 'three';
import { StrikeRunner, type StrikeSpec } from '@wildshard/engine/ai/strikes';
import { canReach } from '@wildshard/engine/ai/reach';
import type { AnimalSim } from '@wildshard/engine/entities/AnimalSim';
import type { SimHost } from '@wildshard/engine/sim';
import type { ShardRows } from '@wildshard/format/rows';
import type { ShardCreatures } from '@wildshard/format/creatures';
import { stepCreatureLift } from '../../../shared/game/plugin/animation';
import { createMemoryActionBrain } from '../plugin/brain';
import type { DeclaredBrainPorts } from './brainRuntime';
import { bindCreatureSenses } from './creatureSenses';

/** Plain grounded recipes borrow original actor clocks, memory and contact. */
export function dataGroundBrains(host: SimHost, rows: ShardRows, spawns: ShardCreatures['spawns']): DeclaredBrainPorts {
  const byId = new Map(spawns.map(row => [row.id, row]));
  const species = new Map(rows.species.map(row => [row.id, row]));
  let memberships: Map<string, AnimalSim[]> | undefined;
  const herdOf = (id: string | undefined): readonly AnimalSim[] | null => {
    if (id === undefined) return null;
    if (memberships === undefined) {
      memberships = new Map();
      for (const row of spawns) {
        if (row.group === undefined) continue;
        const body = host.entities.get(row.id);
        if (body === undefined) throw new Error('Unresolved social skirmisher body');
        let members = memberships.get(row.group);
        if (members === undefined) { members = []; memberships.set(row.group, members); }
        members.push(body);
      }
    }
    return memberships.get(id) ?? null;
  };
  const strikes = new Map<string, StrikeSpec>(rows.strikes.map(({ weight, speed, ...row }) =>
    [row.id, { ...row, motion: { speed }, weight: () => weight }]));
  const contact = new StrikeRunner();
  const bindContact = (actor: AnimalSim, id: string | null | undefined, duration: number, label: 'Skirmisher' | 'Guardian') => {
    const strike = id === null ? undefined : strikes.get(id ?? '');
    if (strike === undefined) throw new Error(`Missing declared data-host ${label.toLowerCase()} strike`);
    if (!Number.isFinite(duration) || duration <= 0 || strike.windup >= duration)
      throw new Error(`${label} contact must fit its body attack clock`);
    const from = new Vector3(), point = new Vector3(), direction = new Vector3();
    let readSelected: (() => ReturnType<SimHost['nearestPlayer']> | undefined) | undefined;
    const spawn = byId.get(actor.entityId);
    const origin = label === 'Guardian' ? { get x() { return actor.position.x; }, get y() { return actor.position.y - actor.yOffset; }, get z() { return actor.position.z; } } : actor.position;
    const senses = bindCreatureSenses(host, actor, spawn === undefined ? undefined : species.get(spawn.species)?.senses, origin);
    const target = () => readSelected === undefined ? senses.nearest() : readSelected();
    const packet = { actor, target: actor.position,
      canReach: () => { const player = target(); return player !== undefined && canReach(actor, player.position, host.physics); },
      hit: (selected: StrikeSpec) => {
        const player = target();
        if (!actor.alive || player === undefined || !player.health.alive || host.parked.has(player.id)) return;
        point.copy(player.position); point.y += 1.2;
        from.copy(actor.position); from.y += actor.dims.bodyY * actor.scale;
        direction.subVectors(point, from).normalize();
        host.combat.hit({ source: actor.combatActor(), sourceTags: selected.tags, target: player.health,
          amount: selected.damage, point, dir: direction, from, moveId: selected.id });
      } };
    return { phase: strike.windup / duration, target, nearest: senses.nearest,
      bindTarget: (read: () => ReturnType<SimHost['nearestPlayer']> | undefined) => { readSelected = read; }, hit: () => {
      const player = target();
      if (player === undefined || !player.health.alive || host.parked.has(player.id)) return;
      packet.target = player.position; contact.contact(strike, packet);
    } };
  };
  return { skirmisher: (actor, _host, declaration) => {
    if (declaration === undefined) throw new Error('Missing parsed data-host skirmisher policy');
    const spawn = byId.get(actor.entityId);
    const binding = bindContact(actor, spawn?.strike, declaration.attackDuration, 'Skirmisher'), target = binding.target;
    const herd = herdOf(spawn?.group);
    const observation = { dt: 0, player: actor.position, calm: false, rng: host.rng.stream('ai'), herd,
      retainAttackCooldownOnHit: spawn !== undefined && species.get(spawn.species)?.temperament !== undefined,
      sound: (_cue: string) => undefined,
      steer: (body: AnimalSim, yaw: number, speed: number, turn: number) => { body.setMotion(yaw, speed, turn); },
      confine: (body: AnimalSim) => {
        if (Math.abs(body.position.x + Math.sin(body.desiredYaw) * 2) > 249
          || Math.abs(body.position.z + Math.cos(body.desiredYaw) * 2) > 249)
          body.setMotion(Math.atan2(-body.position.x, -body.position.z), 0, 3);
      },
      claim: (body: AnimalSim) => host.events.ask('ai.claim', body),
      mayAttack: (body: AnimalSim) => host.events.ask('ai.mayAttack', body) };
    const observe = (dt: number) => {
      const player = target(); observation.dt = dt; observation.player = player?.position ?? actor.position;
      observation.calm = player === undefined || !player.health.alive || host.parked.has(player.id);
      if (player !== undefined && !host.parked.has(player.id)) host.focusPlayer(player.id);
      return observation;
    };
    const action = createMemoryActionBrain(actor, { stateKey: 'st', states: ['idle', 'sidestep', 'attack', 'flee'],
      actions: [{ state: 2, phase: binding.phase,
        effect: 'contact', once: { key: 'hit', value: 1, test: 'falsy' } }] },
    { decide: () => undefined, effects: new Map([['contact', binding.hit]]) });
    return { observe, nearest: binding.nearest, bindTarget: binding.bindTarget, body: dt => { action.act(observe(dt)); } };
  }, guardian: (actor, _host, declaration) => {
    if (declaration === undefined) throw new Error('Missing parsed data-host guardian policy');
    const spawn = byId.get(actor.entityId);
    if (spawn === undefined) throw new Error('Missing declared data-host guardian home');
    const binding = bindContact(actor, spawn.strike, declaration.swingDuration, 'Guardian');
    const target = binding.target;
    const context = { dt: 0, player: actor.position, calm: false,
      rng: host.rng.stream('ai'),
      world: { hold: { x: spawn.at[0], z: spawn.at[2], r: declaration.wakeRadius,
        guardR: declaration.guardRadius, floorAt: (x: number, z: number) => host.groundHeightAt(x, z) } },
      heightAt: (x: number, z: number) => host.groundHeightAt(x, z),
      sound: (_cue: string) => undefined,
      reach: (body: AnimalSim) => { const player = target(); return player !== undefined && canReach(body, player.position, host.physics); },
      claim: (body: AnimalSim) => host.events.ask('ai.claim', body),
      mayAttack: (body: AnimalSim) => host.events.ask('ai.mayAttack', body) };
    const observe = (dt: number) => {
      const player = target(); context.dt = dt; context.player = player?.position ?? actor.position;
      context.calm = player === undefined || !player.health.alive || host.parked.has(player.id);
      if (player !== undefined && !host.parked.has(player.id)) host.focusPlayer(player.id);
      return context;
    };
    const action = createMemoryActionBrain(actor, { stateKey: 'st', states: ['hide', 'rise', 'attack', 'guard', 'sink'],
      actions: [{ state: 2, phase: binding.phase, effect: 'contact', once: { key: 'hit', value: 1, test: 'falsy' } }] },
    { decide: () => undefined, effects: new Map([['contact', binding.hit]]) });
    return { observe, nearest: binding.nearest, bindTarget: binding.bindTarget, body: dt => {
      stepCreatureLift(actor, dt, 1.5, 1.5, declaration.hideOffset, 6, actor.state === 'flee' ? 'up' : undefined);
      action.act(observe(dt));
    } };
  } };
}
