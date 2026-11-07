import { parseDecisionScripts } from '@wildshard/format/decisionScripts';
import type { Shardfile } from '@wildshard/format/shardSchema';
import type { SimHost } from '@wildshard/engine/sim';
import { DeclaredBodyOps } from './bodyOps';
import { lendQuestBodyScripts } from '../../../shared/game/quest/nativeProps';
import { focusPlayer, ShardDecisions, type DecisionRuntime } from '../shardfile/decisions';
import { outputDescriptor } from '../../../shared/game/shardfile/outputDescriptor';

/** G566: a native world's shard-bound body scripts (sim/scripts rows over sim/bodies, Driftwood's tide barrel watch) on
 *  its own fixed step. They add no snapshot adapter, so old saves keep their exact adapter set: the quest props envelope
 *  carries each body's native handle and the scripts' continuation. Install before the quest props. */
export function installNativeBodyScripts(host: SimHost, shard: Shardfile, assets: ReadonlyMap<string, Uint8Array>, restoring: boolean,
  sections: ReadonlyMap<string, unknown> = outputDescriptor(shard)?.sections ?? new Map()): void {
  const declared = sections.get('sim/bodies');
  const rows = parseDecisionScripts(sections.get('sim/scripts') ?? []).filter(row => 'shard' in row.binding && Object.keys(row.bodies ?? {}).length > 0);
  if (declared === undefined || rows.length === 0) return;
  const bodies = DeclaredBodyOps.native(host, declared), before: (() => void)[] = [], after: (() => void)[] = [];
  const runtime: DecisionRuntime = { scope: host.scope, events: host.events, get physics() { return host.physics; }, groundHeightAt: (x, z) => host.groundHeightAt(x, z),
    flags: host.flags, player: focusPlayer(host), state: host.state, slots: host.slots, entities: new Map(), strikes: new Map(),
    registerStrikeCatalogue: () => { throw new Error('Body scripts own no strikes'); }, startDeclaredStrike: () => false,
    onStep: (_id, run, _adapter, phase) => { const callbacks = phase === 'afterBodies' ? after : before; callbacks.push(run);
      return () => { const index = callbacks.indexOf(run); if (index !== -1) callbacks.splice(index, 1); }; } };
  const admitted = new Map(sections); admitted.set('sim/scripts', rows);
  const decisions = new ShardDecisions(runtime, shard, assets, admitted, new Map(), undefined, undefined, undefined, restoring, undefined, undefined, bodies);
  // body post, then the decision commit, then body pre: the order bindShardfileSim gives a declared shard
  host.onStep('bodies.scripts', dt => { bodies.post(dt); for (const run of before) run(); bodies.pre(dt); });
  host.onStep('bodies.observe', () => { for (const run of after) run(); }, undefined, 'afterBodies');
  lendQuestBodyScripts(host, { bodies, decisions });
}
