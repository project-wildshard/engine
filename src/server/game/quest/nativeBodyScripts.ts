import { Euler, Quaternion } from 'three';
import * as v from 'valibot';
import { DeclaredBodyOpsSchema } from '@wildshard/format/bodySlots';
import { parseDecisionScripts } from '@wildshard/format/decisionScripts';
import type { Shardfile } from '@wildshard/format/shardSchema';
import type { SimHost } from '@wildshard/engine/sim';
import { publishScriptBody, type ScriptNetView } from '@wildshard/engine/sim/shardRows';
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
  publishDeclaredProps(host, bodies, v.parse(DeclaredBodyOpsSchema, declared).bodies);
}

const HIDDEN: ScriptNetView = { position: { x: 0, y: 0, z: 0 }, euler: { x: 0, y: 0, z: 0 }, enabled: false };
/**
 * Each declared prop's pose on the wire, as its owner's `script:` row (Driftwood's tide barrel is `script:tide-barrel`, its
 * interaction row's id). The server's body is the law: before this the page drew and pushed a barrel of its own that never
 * moved on the grid while the room's barrel, pushed by the room's player, was drawn nowhere and never met plate B (meta
 * QA-FEEDBACK-2026-11-20-mini row 3). The page's barrel follows this row (`Interactables.followBarrel`).
 */
function publishDeclaredProps(host: SimHost, bodies: DeclaredBodyOps, rows: readonly { readonly id: string; readonly kind: string; readonly owner?: { readonly id: string } }[]): void {
  const q = new Quaternion(), euler = new Euler(0, 0, 0, 'YXZ');
  for (const row of rows) {
    if (row.kind !== 'prop' || row.owner === undefined) continue;
    publishScriptBody(host, row.owner.id, () => {
      const body = bodies.body(row.id);
      if (body === null || !body.alive) return HIDDEN;
      const t = body.rb.translation(), r = body.rb.rotation();
      euler.setFromQuaternion(q.set(r.x, r.y, r.z, r.w), 'YXZ');
      return { position: { x: t.x, y: t.y, z: t.z }, euler: { x: euler.x, y: euler.y, z: euler.z }, enabled: true };
    });
  }
}
