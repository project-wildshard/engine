import * as v from 'valibot';
import { NativeReturnRowsSchema, type RespawnEntry } from '@wildshard/format/populationRespawn';
import type { SimHost } from '@wildshard/engine/sim';
import type { HuntBody } from '@wildshard/engine/ai/hunt';
import type { StalkerBrain } from '@wildshard/engine/ai/stalker';
import { RespawnQueue } from '../../../shared/game/population/respawn';
import { ReturnProgram } from '../../../shared/game/population/returnProgram';
import { REFILL_WAIT, nearestPosition, roomRefillRate } from '@wildshard/engine/entities/creatureRefill';

const finite = v.pipe(v.number(), v.finite());
const savedEntry: v.GenericSchema<BoundedNativeReturnSaveInput, BoundedNativeReturnSave> = v.strictObject({ kind: v.string(), variant: v.string(), herd: finite,
  x: finite, z: finite, due: finite, night: v.boolean(), id: v.string() });
interface ReturnBody { readonly id: string; readonly kind: string; readonly variant: string; readonly herd: number; readonly actor: HuntBody | null }
type ReturnEntry = v.InferOutput<typeof savedEntry>;
/** J109: in a room a kind no author timed still comes back. Declared rules stay on their own clock. */
const ROOM_RULE = { delay: { min: REFILL_WAIT, max: REFILL_WAIT } };

/** Built-in roster child. Only createNativeCreatureRoster constructs it with
 * its actual body map and hunt; shard callers supply declaration rows only.
 * Queue ownership is independent of policy binding and body materialization. */
export class NativeReturns {
  private readonly rows;
  private readonly queue;
  private readonly predecessors = new Map<RespawnEntry, string>();
  private readonly idle: RespawnEntry[] = [];
  private now = 0;
  private check = 0;
  private readonly host: SimHost;
  /** `reserved`: a body its owner brings back itself (a wake fight's captain, SC10), never owed as a roster body. */
  constructor(host: SimHost, bodies: ReadonlyMap<string, ReturnBody>, hunt: StalkerBrain<HuntBody>, input: unknown, reserved: (id: string) => boolean = () => false) {
    this.host = host;
    this.rows = v.parse(NativeReturnRowsSchema, input);
    this.queue = new RespawnQueue(this.rows.rules, this.rows.outOfSight,
      { order: 'reverse', limit: this.rows.limit, result: 'reuse' }, ReturnProgram.native(host, this.rows.program));
    const owe = (kind: string, variant: string, herd: number, x: number, z: number, id: string): void => {
      if (this.queue.pending.length >= this.rows.limit) return; // a full queue forgives the spot: the world is not short of bodies
      const entry = this.queue.add(kind, variant, herd, x, z, this.now, host.rng.stream('spawn').next(), ROOM_RULE);
      if (entry !== null) this.predecessors.set(entry, id);
    };
    host.events.on('actor.died', ({ actor }) => {
      const body = [...bodies.values()].find(row => row.actor?.combatActor() === actor), native = body?.actor;
      if (body === undefined || native === null || native === undefined || reserved(body.id) || !(this.queue.accepts(body.kind) || host.players.size > 1 || host.respawn.served)) return;
      const herd = hunt.herds[body.herd];
      owe(body.kind, body.variant, body.herd, herd?.cx ?? native.position.x, herd?.cz ?? native.position.z, body.id);
    }, host.scope);
    // SC10: a cell asleep with nobody in it: what is owed comes due as if the clock had run, and nobody near brings it sooner
    host.events.on('world.slept', ({ seconds }) => { this.now += seconds; this.check += seconds; }, host.scope);
    // J108: a tame leaves its spot empty on this roster too. Only a room owes it: one player's world stays as it was.
    host.events.on('creature.tamed', ({ kind, variant, herd, x, z, id }) => {
      if ((host.players.size > 1 || host.respawn.served) && bodies.has(id)) owe(kind, variant, herd, x, z, id);
    }, host.scope);
  }
  /** At most one bounded queue scan per declared interval; retry entries keep
   * their predecessor and consume only the program's borrowed spawn draws. */
  take(dt: number): readonly RespawnEntry[] {
    this.now += dt;
    if (this.now - this.check < this.rows.interval) return this.idle;
    const elapsed = this.now - this.check, { players } = this.host;
    this.check = this.now;
    // J109: more players near an entry bring its deadline forward by the time they saved; one player moves nothing
    if (players.size > 1) for (const entry of this.queue.pending) entry.due -= (roomRefillRate(players, entry.x, entry.z, this.host.parked) - 1) * elapsed;
    const first = this.host.nearestPlayer({ x: 0, y: 0, z: 0 }).position;
    return this.queue.take(this.now, first.x, first.z, this.host.dayClock?.night ?? 0, (x, z) => nearestPosition(players.values(), x, z, first));
  }
  /** Resolve one due entry at the caller's spawn boundary, preserving random
   * draw interleaving between placement and each body's materialization. */
  place(entry: RespawnEntry): ReturnEntry | null {
    const id = this.predecessors.get(entry);
    if (id === undefined) throw new Error('Foreign native return entry');
    const at = this.queue.place(entry, this.now, this.rows.water, this.rows.fixed.includes(entry.kind), this.host.rng.stream('spawn'));
    if (at === null) return null;
    this.predecessors.delete(entry);
    return { ...entry, ...at, variant: entry.variant ?? '', id };
  }
  /** The established native ecology wire, including its exact death order. */
  snapshot(): { now: number; check: number; pending: ReturnEntry[] } {
    return { now: this.now, check: this.check, pending: this.queue.pending.map(entry => ({
      ...entry, variant: entry.variant ?? '', id: this.predecessors.get(entry) ?? '',
    })) };
  }
  /** Quiet restore neither calls the guest nor draws or spawns a body. */
  restore(value: unknown): void {
    const state = v.parse(v.strictObject({ now: finite, check: finite,
      pending: v.pipe(v.array(savedEntry), v.maxLength(this.rows.limit)) }), value);
    this.now = state.now; this.check = state.check; this.queue.pending.length = 0; this.predecessors.clear();
    for (const { id, ...entry } of state.pending) { this.queue.pending.push(entry); this.predecessors.set(entry, id); }
  }
}

/** Complete admitted data, independent of validator implementation metadata. */
type BoundedNativeReturnSaveInput = BoundedNativeReturnSave;
interface BoundedNativeReturnSaveFields {
    kind: string;
    variant: string;
    herd: number;
    x: number;
    z: number;
    due: number;
    night: boolean;
    id: string;
}
type BoundedNativeReturnSave = { [Key in keyof BoundedNativeReturnSaveFields]: BoundedNativeReturnSaveFields[Key] };
