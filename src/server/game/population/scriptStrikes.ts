import * as v from 'valibot';
import { SpawnCombatSchema, type SpawnCombat } from '@wildshard/format/spawnCombat';
import { StrikeRunner, type StrikeSpec, type BrainPoint, type StrikePhase } from '@wildshard/engine/ai/strikes';
import { strikeFromData } from '@wildshard/engine/ai/strikeRows';
import { readStrikeState } from '@wildshard/engine/ai/strikeState';
import type { AnimalSim } from '@wildshard/engine/entities/AnimalSim';

const natural = v.pipe(v.number(), v.safeInteger(), v.minValue(1));
const Saved = v.array(v.strictObject({ actor: natural, id: natural, runner: v.unknown(), windup: v.exactOptional(v.pipe(v.number(), v.finite(), v.minValue(0), v.maxValue(60))) }));
const NO_STRIKE: ScriptStrikeFrame = Object.freeze({ hit: null, cues: Object.freeze([]), done: false });
const NO_PRESENTATION: readonly never[] = Object.freeze([]);
interface Active { readonly id: number; readonly runner: StrikeRunner; readonly windup?: number }
export interface ScriptStrikeHit { readonly damage: number; readonly tags: StrikeSpec['tags']; readonly stun: number; readonly trauma: number; readonly throughWalls: boolean }
export interface ScriptStrikeFrame { readonly hit: ScriptStrikeHit | null; readonly cues: readonly string[]; readonly done: boolean }
/** Internal contact owner. Numeric actor/strike handles resolve only in the enclosing built-in spawn owner. */
export class ScriptStrikes {
  readonly rows: SpawnCombat;
  private readonly specs: readonly StrikeSpec[];
  private active = new Map<number, Active>();
  constructor(input: unknown) { this.rows = v.parse(SpawnCombatSchema, input); this.specs = this.rows.map(row => strikeFromData(row.row)); }
  private row(id: number): SpawnCombat[number] { const row = this.rows[id - 1]; if (row === undefined) throw new Error('Missing scripted strike'); return row; }
  private spec(id: number): StrikeSpec { const row = this.specs[id - 1]; if (row === undefined) throw new Error('Missing scripted contact'); return row; }
  start(actor: number, id: number, body: AnimalSim, target: BrainPoint): readonly string[] {
    const row = this.row(id), runner = new StrikeRunner(); runner.start(this.spec(id), body, target);
    this.active.set(actor, { id, runner }); return row.startCue === undefined ? [] : [row.startCue];
  }
  cancel(actor: number, body?: AnimalSim): void { this.active.get(actor)?.runner.cancel(); this.active.delete(actor); body?.cancelAttack(); }
  state(actor: number): StrikePhase { return this.active.get(actor)?.runner.state ?? 'idle'; }
  time(actor: number): number { return this.active.get(actor)?.runner.time ?? 0; }
  /** `reach` is the contact frame's line of sight, asked only when a strike lands (FC: no raycast for an idle actor) */
  advance(actor: number, dt: number, body: AnimalSim, target: BrainPoint, reach: () => boolean): ScriptStrikeFrame {
    const current = this.active.get(actor); if (current === undefined) return NO_STRIKE;
    const row = this.row(current.id), before = current.runner.state, cues: string[] = [];
    let hit: ScriptStrikeHit | null = null;
    current.runner.update(dt, { actor: body, target, canReach: reach,
      hit: spec => { hit = { damage: spec.damage, tags: spec.tags, stun: row.stun, trauma: row.trauma, throughWalls: spec.tags.includes('cover.exempt') }; } });
    if (before !== 'active' && current.runner.state === 'active' && row.activeCue !== undefined) cues.push(row.activeCue);
    const done = current.runner.state === 'idle';
    if (done) { this.active.delete(actor); if (row.doneCue !== undefined) cues.push(row.doneCue); }
    return { hit, cues, done };
  }
  snapshot(): { actor: number; id: number; runner: ReturnType<StrikeRunner['snapshot']>; windup?: number }[] {
    const states: { actor: number; id: number; runner: ReturnType<StrikeRunner['snapshot']>; windup?: number }[] = [];
    for (const [actor, active] of this.active) states.push({ actor, id: active.id, runner: active.runner.snapshot(),
      ...(active.windup === undefined ? {} : { windup: active.windup }) });
    return states;
  }
  /** Validate every strike against its admitted row before changing a live runner or body. */
  prepareRestore(input: unknown, actors: ReadonlySet<number>): () => void {
    const saved = v.parse(Saved, input), active = new Map<number, Active>();
    for (const row of saved) {
      const base = this.spec(row.id), spec = row.windup === undefined ? base : { ...base, windup: row.windup }, state = readStrikeState(row.runner, [spec]);
      if (!actors.has(row.actor) || active.has(row.actor) || state.currentId !== spec.id) throw new Error('Incompatible scripted strike actor');
      const runner = new StrikeRunner(); runner.restore(state, [spec]); active.set(row.actor, { id: row.id, runner, ...(row.windup === undefined ? {} : { windup: row.windup }) });
    }
    return () => { this.active = active; };
  }
  /** Read-only presentation of the actual contact owner, including its locked lane. */
  presentation(): readonly { actor: number; id: number; phase: StrikePhase; time: number; windup: number; tell: 'lane' | 'ring' | undefined; radius: number; width: number; x0: number; z0: number; x1: number; z1: number }[] {
    if (this.active.size === 0) return NO_PRESENTATION;
    return [...this.active].map(([actor, active]) => {
      const runner = active.runner, spec = this.spec(active.id);
      return { actor, id: active.id, phase: runner.state, time: runner.time, windup: active.windup ?? spec.windup, tell: this.row(active.id).tell, radius: spec.shape.kind === 'point' ? spec.shape.radius : 0,
        width: spec.shape.kind === 'lane' ? spec.shape.width : 0, x0: runner.x0, z0: runner.z0, x1: runner.x1, z1: runner.z1 };
    });
  }
}
