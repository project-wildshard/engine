// P1-E3.2 (J33, J47, E5-REPLICATION §4.3): what the server settled, as events for the wire. The pipeline's own `damage.dealt`
// and `actor.died` settle hits/ragdolls; health's `player.died` supplies the resolved checkpoint and cause.
import type { SimHost } from '../sim';
import { landedBy } from '../combat/damageBook';
import type { NetView } from '../../../shared/engine/net/messages';
import type { DeathCause } from '../../../shared/engine/combat/pipeline';

/** A settled hit or death in world terms, before the room turns ids into a client's handles. */
export type CombatEvent =
  | { readonly kind: 'hit'; readonly tick: number; readonly target: string; readonly amount: number; readonly at: readonly [number, number, number];
    readonly head: boolean; readonly killed: boolean; readonly by: string | null;
    /** The command seq of the swing or shot that landed it, 0 for none. */
    readonly seq: number;
    /** Where its shooter saw the contact, on a rewound hit: `at` is where it landed on the body now. */
    readonly seen?: readonly [number, number, number] }
  | { readonly kind: 'died'; readonly tick: number; readonly id: string; readonly by: string | null;
    readonly dir: readonly [number, number, number]; readonly impulse: number }
  | { readonly kind: 'reward'; readonly tick: number; readonly player: string; readonly coins: number; readonly body: string; readonly item?: string }
  | { readonly kind: 'player-died'; readonly tick: number; readonly id: string; readonly checkpoint: boolean; readonly cause?: DeathCause }
  | NetView;


/** Listens on a host for its lifetime and hands over each tick's settled combat. */
export class CombatWire {
  private rows: CombatEvent[] = [];
  constructor(host: SimHost) {
    host.events.on('damage.dealt', ({ req, dealt, killed }) => {
      // A blow that dealt nothing has nothing to show: a real shard's zero-damage host probe lands beside its weapon.
      if (dealt <= 0 && !killed) return;
      const { point: p, seen: s } = req;
      this.rows.push({ kind: 'hit', tick: host.state.tick, target: req.target.id, amount: dealt, at: [p.x, p.y, p.z], head: req.headshot ?? false, killed, by: landedBy(req, host.players), seq: req.attackSeq ?? 0, ...(s === undefined ? {} : { seen: [s.x, s.y, s.z] as const }) });
    }, host.scope);
    host.events.on('actor.died', ({ actor, req }) => {
      const by = req.source !== 'env' ? req.source.id : landedBy(req, host.players), { dir: d } = req;
      // The ragdoll's throw grows with the blow, as AnimalView.startRagdoll's does: each client simulates its own (J33).
      this.rows.push({ kind: 'died', tick: host.state.tick, id: actor.id, by, dir: [d.x, d.y, d.z], impulse: req.amount });
    }, host.scope);
    host.events.on('reward.granted', event => { this.rows.push({ kind: 'reward', tick: host.state.tick, ...event }); }, host.scope);
    host.events.on('player.died', ({ actor, checkpoint, cause }) => {
      this.rows.push({ kind: 'player-died', tick: host.state.tick, id: actor.id, checkpoint, ...(cause === undefined ? {} : { cause: { ...cause } }) });
    }, host.scope);
  }
  /** Everything settled since the last call, in the order it happened. */
  drain(): readonly CombatEvent[] {
    if (this.rows.length === 0) return [];
    const rows = this.rows; this.rows = [];
    return rows;
  }
}
