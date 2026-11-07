/** Native wake shell over the existing world. Public inputs are rows and
 * placement values; the body is resolved by the row's declared kind. */
import * as v from 'valibot';
import { Vector3 } from 'three';
import { BossContenders } from '@wildshard/engine/ai/bossContenders';
import { nearestOnGround } from '@wildshard/engine/sim/nearPlayer';
import type { SimHost } from '@wildshard/engine/sim';
import { WakeBossEncounter, type WakeBossObservation } from '../../../shared/game/boss/wake';
import { parseWakeEncounter } from '@wildshard/format/bossEncounter';

const finite = v.pipe(v.number(), v.finite());
const Encounter = v.strictObject({ attempt: v.boolean(), waitForReturn: v.boolean(), engaged: v.exactOptional(finite),
  boss: v.strictObject({ state: v.picklist(['dormant', 'armed', 'intro', 'fight', 'beat', 'victory']), phase: finite, checkpoint: finite, attempts: finite, t: finite, skipT: finite, short: v.boolean(),
    saved: v.strictObject({ defeated: v.boolean(), rewardTaken: v.boolean(), kills: finite }) }) });

/** Install from data. Spawn remains the existing AS director/roster command,
 * rather than an arbitrary callback lent to the encounter. */
export function installWakeBoss(host: SimHost, input: unknown, placement: { pool: { x: number; z: number }; arena: number }): { encounter: WakeBossEncounter; publish: (event: string) => void } {
  const row = parseWakeEncounter(input), { pool, arena } = placement;
  const encounter = new WakeBossEncounter(row, pool);
  const body = () => Array.from(host.entities.values()).find(actor => actor.kind === row.kind) ?? null;
  // J104, J107: whom the fight deals with is the living player nearest the pool, so it runs while anyone is in the arena. Those
  // there when it wakes set its curves. A lone player runs the one-player encounter, unread.
  const near = (point: { readonly x: number; readonly z: number }): boolean => Math.hypot(point.x - pool.x, point.z - pool.z) < row.arena.radius;
  const party = new BossContenders(host.players, near, () => undefined);
  const contended = { get engaged() { return encounter.state === 'fight'; }, script: { respawnPoint: () => ({ pos: new Vector3(pool.x, 0, pool.z), yaw: 0 }) },
    disarm: () => undefined, arm: () => undefined, onPlayerDeath: () => false };
  const observation = (): WakeBossObservation => ({ player: nearestOnGround(host.players, pool.x, pool.z).position, animal: body(), wake: host.flags.has(row.wakeFlag), dead: host.flags.has(row.deadFlag) });
  const flush = (): void => { for (const effect of encounter.takeEffects()) if (effect.kind === 'outcome') host.events.emit('boss.attempt', { boss: row.id, level: row.level, outcome: effect.outcome }); };
  host.events.on('damage.dealt', ({ req, killed }) => {
    const actor = body(); if (killed && actor !== null && req.target === actor.combatActor()) host.flags.set(row.deadFlag);
  }, host.scope);
  host.events.on('damage.dealt', ({ req }) => { const actor = body(); if (actor !== null && party.owns(req, actor, undefined)) party.echo(req, actor, host.combat); }, host.scope);
  host.events.answer('damage.modify', request => { const actor = body(); return request !== null && actor !== null && request.target === actor.combatActor() ? party.scaled(request) : request; }, host.scope);
  host.events.on('player.died', ({ actor }) => {
    // A room's fight outlives a fall while anyone else stands in the arena; the fallen one goes to their checkpoint as ever.
    for (const [id, player] of host.players) if (id !== actor.id && player.health.alive && near(player.position)) return;
    encounter.onPlayerDeath(host.players.get(actor.id)?.position ?? host.playerFocus); flush();
  }, host.scope);
  host.onStep(row.step, () => { party.observe(contended); encounter.update(observation()); flush(); }, {
    snapshot: () => { const { engaged } = party; return JSON.stringify({ ...encounter.encounterSnapshot(), ...(engaged === 0 ? {} : { engaged }) }); },
    restore: value => { const saved = v.parse(Encounter, JSON.parse(v.parse(v.string(), value))); encounter.encounterRestore(saved); party.restoreEngaged(saved.engaged ?? 0); },
  });
  return { encounter, publish: event => {
    if (event !== row.events.restore && event !== row.events.wake) throw new Error('Unknown boss event');
    const actor = body(); if (actor === null) throw new Error('Boss director did not materialize its declared body');
    actor.herd = -1; actor.mem[row.fields.poolX] = pool.x; actor.mem[row.fields.poolZ] = pool.z; actor.mem[row.fields.arena] = arena;
    if (event === row.events.wake) encounter.wake(observation()); flush();
  } };
}
