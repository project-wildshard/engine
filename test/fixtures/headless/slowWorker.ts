// oxlint-disable-next-line import/no-nodejs-modules -- Exercise a genuinely blocked synchronous host query in an isolated native Node worker.
import { hrtime } from 'node:process';
import * as v from 'valibot';
import { runTickWorker } from '../../../src/server/host/tickWorkerLoop';
import { ScriptLane } from '../../../src/server/engine/script/lane';
import { DeclaredScriptWorld } from '../../../src/shared/engine/script/state';
import type { HeadlessEffect } from '../../../src/shared/host/tickProtocol';

await runTickWorker(async raw => {
  const payload = v.parse(v.strictObject({ bytes: v.array(v.number()), snapshot: v.optional(v.string()) }), raw);
  let slow = false, tick = 0, effects: HeadlessEffect[] = [];
  const world = new DeclaredScriptWorld({ fields: {}, archetypes: [], events: [], maxEntities: 1 }, [{ id: 1, name: 'Actor', position: [0, 0, 0], fields: {}, frozen: false, interactive: true }], { shared: [], player: [] }, new Map([[1, 'actor.player']]));
  const lane = new ScriptLane({ world, modules: [{ name: 'finite', bytes: Uint8Array.from(payload.bytes), seedLo: 0, seedHi: 0 }], bindings: [{ module: 'finite', entity: 1, actorId: 'actor.player', kind: 'server' }], divisor: 1,
    query: () => {
      effects.push({ kind: 'fact', name: `tick.${tick}`, actorId: 'actor.player' });
      if (slow) { const started = hrtime.bigint(); while (hrtime.bigint() - started < 10_000_000_000n) { /* Deliberately blocks its isolate's event loop. */ } }
      return [];
    },
  });
  if (payload.snapshot !== undefined) { lane.restore(payload.snapshot); tick = lane.host.checkpoint().tick; }
  return { step: commands => {
    effects = []; slow = commands.some(command => command.kind === 'script' && command.value === 1); tick++;
    const calls = lane.step(tick); if (calls.some(call => !call.ok)) throw new Error('Finite query script failed');
  }, commit: () => ({ tick, snapshot: lane.snapshot(), effects }), finish: () => ({ ticks: tick, lanes: 0, steps: 0 }), dispose: () => undefined };
});
