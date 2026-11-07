import { PageReturnRowsSchema } from '@wildshard/format/namedJsonContracts';
import type { ShardContext } from '../plugin/context';
import { app } from '@wildshard/engine/app/runtime';
import { ReturnProgram } from '../../../shared/game/population/returnProgram';
import { RespawnQueue } from '../../../shared/game/population/respawn';
import * as v from 'valibot';

/** Page actor returns over the real manager. The declared guest owns delay,
 * visibility/night eligibility and terrain retry law. The host owns deaths,
 * traversal, herd membership, the named spawn stream and body construction. */
export function installPageReturns(ctx: ShardContext, input: unknown): RespawnQueue {
  const rows = v.parse(PageReturnRowsSchema, input), runtime = ctx.game.runtime, animals = runtime?.play?.animals, world = runtime?.world;
  if (animals === undefined || world === undefined || world === null) throw new Error('Actor returns require the page population');
  const program = ReturnProgram.page(rows.program, ctx.scope);
  const queue = new RespawnQueue(rows.rules, rows.outOfSight, { order: 'reverse', limit: null, result: 'fresh' }, program);
  let now = 0, check = 0;
  ctx.on('actor.died', ({ actor }) => {
    const body = animals.animals.find(candidate => candidate.combatActor() === actor);
    if (body === undefined || !queue.accepts(body.kind)) return;
    const herd = body.herd >= 0 ? animals.herds[body.herd] : undefined;
    queue.add(body.kind, body.variant, body.herd, herd?.cx ?? body.position.x, herd?.cz ?? body.position.z, now, app.rng.stream('spawn').next());
  }, { order: 20 });
  ctx.system({ id: rows.step, phase: 'update', before: ['game.loot', 'body-shadow', 'keepsakes', 'last place', 'first hints', 'main.world'], run: dt => {
    now += dt; if (now - check < 1) return; check = now;
    if (queue.pending.length === 0) return;
    for (const entry of queue.take(now, world.player.position.x, world.player.position.z, world.sky.dayNight?.night ?? 0)) {
      const at = queue.place(entry, now, rows.water, rows.fixed.includes(entry.kind), app.rng.stream('spawn'));
      if (at === null) continue;
      const body = animals.spawn(entry.kind, at.x, at.z, app.rng.stream('spawn').next() * Math.PI * 2, entry.variant);
      body.herd = entry.herd;
      if (entry.herd >= 0) animals.herds[entry.herd]?.members.push(body);
    }
  } });
  return queue;
}
