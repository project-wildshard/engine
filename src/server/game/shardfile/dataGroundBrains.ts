import { Vector3 } from 'three';
import { StrikeRunner, type StrikeSpec } from '@wildshard/engine/ai/strikes';
import { canReach } from '@wildshard/engine/ai/reach';
import type { AnimalSim } from '@wildshard/engine/entities/AnimalSim';
import type { SimHost } from '@wildshard/engine/sim';
import type { ShardRows } from '@wildshard/format/rows';
import type { ShardCreatures } from '@wildshard/format/creatures';
import { createMemoryActionBrain } from '../plugin/brain';
import type { DeclaredBrainPorts } from './brainRuntime';

/** Plain grounded recipes borrow original actor clocks, memory and contact. */
export function dataGroundBrains(host: SimHost, rows: ShardRows, spawns: ShardCreatures['spawns']): DeclaredBrainPorts {
  const byId = new Map(spawns.map(row => [row.id, row]));
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
  return { skirmisher: (actor, _host, declaration) => {
    if (declaration === undefined) throw new Error('Missing parsed data-host skirmisher policy');
    const spawn = byId.get(actor.entityId), strike = spawn?.strike === null ? undefined : strikes.get(spawn?.strike ?? '');
    if (strike === undefined) throw new Error('Missing declared data-host skirmisher strike');
    if (strike.windup >= declaration.attackDuration) throw new Error('Skirmisher contact must fit its body attack clock');
    const from = new Vector3(), point = new Vector3(), direction = new Vector3();
    const target = () => host.nearestPlayer(actor.position);
    const packet = { actor, target: target().position,
      canReach: () => canReach(actor, target().position, host.physics),
      hit: (selected: StrikeSpec) => {
        const player = target();
        if (!actor.alive || !player.health.alive) return;
        point.copy(player.position); point.y += 1.2;
        from.copy(actor.position); from.y += actor.dims.bodyY * actor.scale;
        direction.subVectors(point, from).normalize();
        host.combat.hit({ source: actor.combatActor(), sourceTags: selected.tags, target: player.health,
          amount: selected.damage, point, dir: direction, from, moveId: selected.id });
      } };
    const herd = herdOf(spawn?.group);
    const observation = { dt: 0, player: target().position, calm: false, rng: host.rng.stream('ai'), herd,
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
      const player = target(); observation.dt = dt; observation.player = player.position; observation.calm = !player.health.alive;
      return observation;
    };
    const action = createMemoryActionBrain(actor, { stateKey: 'st', states: ['idle', 'sidestep', 'attack', 'flee'],
      actions: [{ state: 2, phase: strike.windup / declaration.attackDuration,
        effect: 'contact', once: { key: 'hit', value: 1, test: 'falsy' } }] },
    { decide: () => undefined, effects: new Map([['contact', () => {
      packet.target = target().position; contact.contact(strike, packet);
    }]]) });
    return { observe, body: dt => { action.act(observe(dt)); } };
  } };
}
