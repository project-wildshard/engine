import * as v from 'valibot';
import { NativeQuestPropsSchema } from '@wildshard/format/questInteractions';
import type { SimHost } from '@wildshard/engine/sim';
import type { DeclaredBodyOps } from '../../../server/game/quest/bodyOps';
import type { ShardDecisions } from '../../../server/game/shardfile/decisions';
import { QuestFlagGates } from './flagGates';

const finite = v.pipe(v.number(), v.finite()), point: v.GenericSchema<BoundedNativePropPointInput, BoundedNativePropPoint> = v.strictObject({ x: finite, y: finite, z: finite });
const savedBody: v.GenericSchema<BoundedNativePropSaveInput, BoundedNativePropSave> = v.nullable(v.strictObject({ handle: v.pipe(finite, v.minValue(0)),
  watch: v.strictObject({ lost: finite, wedge: finite, from: point }), decision: v.exactOptional(v.string()) }));
/** The envelope keeps its shape; the watch clocks live in the body script's own continuation (G566), so they are written at rest. */
const RESTING = { lost: 0, wedge: 0, from: { x: 0, y: 0, z: 0 } };
/** A native world's body scripts (src/server/game/quest/nativeBodyScripts.ts): the declared bodies and the decisions that steer them. */
export interface QuestBodyScripts { readonly bodies: DeclaredBodyOps; readonly decisions: Pick<ShardDecisions, 'snapshot' | 'restore' | 'continueAt'> }
const lent = new WeakMap<SimHost, QuestBodyScripts>();
/** G566: the native body scripts lend themselves to the host's quest props, which carry their bodies' handles and continuation. */
export function lendQuestBodyScripts(host: SimHost, scripts: QuestBodyScripts): void { lent.set(host, scripts); host.scope.onDispose(() => { lent.delete(host); }); }

/** Renderer-free physical props. Authored rows are the entire content API;
 * body services, native handles, flags and ground resolve from the real host. A declared body's decisions (Driftwood's
 * tide barrel watch) are the shard's script; this keeps the walk it reads and its saved handle and continuation. */
export class NativeQuestProps {
  private readonly rows;
  private readonly gates: QuestFlagGates;
  private readonly host: SimHost;
  private readonly scripts: QuestBodyScripts | null;
  private readonly adopt = new Map<string, number | null>();
  private continuation: string | null = null;
  private readonly dropped = new Map<string, v.InferOutput<typeof point> | null>();
  constructor(host: SimHost, input: unknown, restoring: boolean) {
    this.host = host;
    this.rows = v.parse(NativeQuestPropsSchema, input);
    if (new Set(this.rows.drops.map(row => row.id)).size !== this.rows.drops.length
      || new Set(this.rows.bodies.map(row => row.owner)).size !== this.rows.bodies.length
      || this.rows.floors.some(row => row.values.length !== row.width * row.height)) throw new Error('Invalid native quest prop rows');
    const scripts = lent.get(host) ?? null;
    if (this.rows.bodies.length > 0 && scripts === null) throw new Error('Native quest bodies require their declared body authority');
    this.scripts = this.rows.bodies.length === 0 ? null : scripts;
    this.gates = new QuestFlagGates(host, { gates: this.rows.gates.map(row => ({ id: row.flag, opensWhen: { all: [row.flag] }, target: { kind: 'box', box: row.box } })) }, restoring);
    for (const row of this.rows.drops) this.dropped.set(row.id, null);
    if (this.rows.drops.length > 0) host.events.on('actor.died', ({ actor }) => {
      const body = [...host.entities.values()].find(native => native.combatActor() === actor);
      if (body === undefined) return;
      for (const row of this.rows.drops) if (body.kind === row.kind) {
        const { x, z } = body.position; this.dropped.set(row.id, { x, y: this.floorAt(x, z), z });
      }
    }, host.scope);
  }
  /** A defeated native body drops its declared prop on the same captured floor. */
  dropAt(id: string): Readonly<v.InferOutput<typeof point>> | null {
    if (!this.dropped.has(id)) throw new Error('Unknown native quest drop');
    return this.dropped.get(id) ?? null;
  }
  /** The existing quest envelope owns persistence; restore does not replay a death. */
  restoreDrop(id: string, input: unknown): void {
    if (!this.dropped.has(id)) throw new Error('Unknown native quest drop');
    this.dropped.set(id, v.parse(v.nullable(point), input));
  }
  /** Captured platform samples layer over the host's native ground. */
  floorAt(x: number, z: number): number {
    let y = this.host.groundHeightAt(x, z);
    for (const grid of this.rows.floors) {
      const ix = Math.round((x - grid.x) / grid.step), iz = Math.round((z - grid.z) / grid.step);
      if (ix < 0 || iz < 0 || ix >= grid.width || iz >= grid.height) continue;
      const sample = grid.values[iz * grid.width + ix]; if (sample !== null && sample !== undefined) y = Math.max(y, sample);
    }
    return y;
  }
  /** The caller retains the original post-world/pre-interaction phase: the body scripts read this requested walk. */
  step(_dt: number, walk: { readonly x: number; readonly z: number }): void { this.scripts?.bodies.setPlayerIntent(walk); }
  /** Run after flag transitions, so an opened latch releases in the same tick. */
  syncGates(): void {
    this.gates.sync();
  }
  snapshot(id: string): v.InferOutput<typeof savedBody> {
    const row = this.rows.bodies.find(entry => entry.owner === id), body = row === undefined ? null : this.scripts?.bodies.body(row.body) ?? null;
    return this.scripts === null || body === null || !body.alive ? null : { handle: body.rb.handle, watch: RESTING, decision: this.scripts.decisions.snapshot() };
  }
  restore(id: string, input: unknown): void {
    const state = v.parse(savedBody, input), row = this.rows.bodies.find(entry => entry.owner === id);
    if (row === undefined) { if (state !== null) throw new Error('Incompatible native quest prop continuation'); return; }
    this.adopt.set(row.body, state?.handle ?? null);
    // an old save (before G566) carries no script continuation: the scripts start fresh at the restored tick
    if (state?.decision !== undefined) this.continuation = state.decision;
  }
  /** Rebind restored handles without spawning, drawing or replaying flag edges. */
  physicsRestored(): void {
    this.gates.physicsRestored();
    const scripts = this.scripts; if (scripts === null) return;
    scripts.bodies.restoreHandles(Object.fromEntries(this.rows.bodies.map(row => [row.body, this.adopt.get(row.body) ?? null])));
    if (this.continuation === null) scripts.decisions.continueAt(this.host.state.tick); else scripts.decisions.restore(this.continuation);
    this.adopt.clear(); this.continuation = null;
  }
}

/** Complete admitted data, independent of validator implementation metadata. */
type BoundedNativePropPointInput = BoundedNativePropPoint;
interface BoundedNativePropPointFields {
    x: number;
    y: number;
    z: number;
}
type BoundedNativePropPoint = { [Key in keyof BoundedNativePropPointFields]: BoundedNativePropPointFields[Key] };
type BoundedNativePropSaveInput = BoundedNativePropSave;
type BoundedNativePropSave = {
    handle: number;
    watch: {
        lost: number;
        wedge: number;
        from: {
            x: number;
            y: number;
            z: number;
        };
    };
    decision?: string;
} | null;
