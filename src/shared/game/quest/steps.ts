import * as v from 'valibot';
import { parseQuestStepRows, type QuestStepRows } from '@wildshard/format/questSteps';
import { emitFault } from '@wildshard/engine/core/faults';

/** Completions are data from the existing dialogue, actor, item or traversal owner. */
export interface QuestStepSignal {
  readonly kind: 'talk' | 'kill' | 'collect' | 'deliver' | 'lead' | 'follow' | 'interact';
  readonly target: string;
}
/** A read-only fact frame. The runner accepts no owners, callbacks, services or reflected methods. */
export interface QuestStepFrame {
  readonly flags: readonly string[];
  readonly position?: { readonly x: number; readonly z: number };
  readonly inventory?: Readonly<Record<string, number>>;
  readonly actors?: readonly { readonly kind: string; readonly alive: boolean }[];
}
/** Ordered commands for the native owners. Script commands use Script ABI event ids and an admitted script id. */
export type QuestStepEffect = QuestStepRows['steps'][number]['effects'][number]
  | { readonly kind: 'take'; readonly item: string; readonly count: number };
interface Frame { flags: Set<string>; inventory: Record<string, number> | undefined; readonly source: QuestStepFrame }
/** Bounded, renderer-free quest evaluator. State in and ordered commands out are plain data.
 * The existing owner commits effects synchronously in order. Script effects route only to the named admitted
 * Script ABI lane; the evaluator never invokes shard code, opens UI, mutates a pack or installs a scheduler.
 */
export class QuestStepRunner {
  readonly rows: QuestStepRows;
  private readonly waits = new Map<string, number>();
  private readonly pendingWaits = new Map<string, number>();
  private reportedFrame = false;
  constructor(input: unknown) {
    this.rows = parseQuestStepRows(input);
    for (const row of this.rows.steps) if (row.kind === 'wait') this.waits.set(row.id, 0);
  }
  private frame(source: QuestStepFrame): Frame {
    return { source, flags: new Set(source.flags), inventory: source.inventory === undefined ? undefined : { ...source.inventory } };
  }
  private enabled(row: QuestStepRows['steps'][number], frame: Frame): boolean {
    const when = row.when;
    return (row.once === undefined || !frame.flags.has(row.once))
      && (when?.all ?? []).every(flag => frame.flags.has(flag))
      && (when?.any === undefined || when.any.some(flag => frame.flags.has(flag)))
      && (when?.none ?? []).every(flag => !frame.flags.has(flag));
  }
  private run(row: QuestStepRows['steps'][number], frame: Frame, output: QuestStepEffect[]): void {
    const effects: QuestStepEffect[] = row.once === undefined ? [...row.effects] : [{ kind: 'flag', flag: row.once }, ...row.effects];
    if (effects.some(effect => effect.kind === 'item') && frame.inventory === undefined) throw new Error('Quest item effects require inventory facts');
    for (const effect of effects) {
      if (effect.kind === 'flag') { if (effect.value === false) frame.flags.delete(effect.flag); else frame.flags.add(effect.flag); }
      else if (effect.kind === 'item' && frame.inventory !== undefined) frame.inventory[effect.item] = (frame.inventory[effect.item] ?? 0) + effect.count;
      output.push(effect);
    }
  }
  /** Every flag these rows may raise or clear on the player they run for. */
  get writes(): string[] {
    return this.rows.steps.flatMap(row => [...row.once === undefined ? [] : [row.once], ...row.effects.flatMap(effect => effect.kind === 'flag' ? [effect.flag] : [])]);
  }
  /** Evaluate completed signals once. Delivery takes precede all grants and cannot partially consume a stack. */
  signal(signal: QuestStepSignal, source: QuestStepFrame): readonly QuestStepEffect[] {
    const frame = this.frame(source), output: QuestStepEffect[] = [];
    for (const row of this.rows.steps) {
      if (row.kind !== signal.kind || row.target !== undefined && row.target !== signal.target || !this.enabled(row, frame)) continue;
      if (row.kind === 'deliver') {
        if (frame.inventory === undefined) throw new Error('Quest delivery requires inventory facts');
        const held = frame.inventory[row.item] ?? 0;
        if (held < row.count) continue;
        frame.inventory[row.item] = held - row.count; output.push({ kind: 'take', item: row.item, count: row.count });
      }
      this.run(row, frame, output);
    }
    return output;
  }
  /** The caller supplies the current roster as data on every read; old death flags only cover an absent roster. */
  guard(id: string, source: QuestStepFrame): string | null {
    const row = this.rows.guards.find(entry => entry.id === id);
    if (row === undefined) throw new Error(`Unknown quest guard ${id}`);
    return source.actors === undefined ? row.absentUnless !== undefined && source.flags.includes(row.absentUnless) ? null : row.message
      : source.actors.some(actor => actor.kind === row.actor && actor.alive) ? row.message : null;
  }
  /** The existing clock supplies dt. False gates pause waits; no owner callback is called during evaluation. */
  update(dt: number, source: QuestStepFrame): readonly QuestStepEffect[] {
    this.pendingWaits.clear();
    try {
      const output = this.updateFrame(dt, source);
      for (const [id, elapsed] of this.pendingWaits) this.waits.set(id, elapsed);
      return output;
    } catch (error) {
      if (!this.reportedFrame) { this.reportedFrame = true; emitFault({system: 'quest.steps', error, verdict: 'retry'}); }
      return [];
    } finally { this.pendingWaits.clear(); }
  }
  /** Pure commands and staged clock writes publish together, only after all facts pass. */
  private updateFrame(dt: number, source: QuestStepFrame): readonly QuestStepEffect[] {
    if (!Number.isFinite(dt) || dt < 0) throw new RangeError('Invalid quest step delta');
    const frame = this.frame(source), output: QuestStepEffect[] = [];
    for (const row of this.rows.steps) {
      if (!this.enabled(row, frame)) continue;
      if (row.kind === 'go-to') {
        const point = source.position;
        if (point === undefined) throw new Error('Quest go-to requires position facts');
        if (Math.hypot(point.x - row.at.x, point.z - row.at.z) < row.radius) this.run(row, frame, output);
      } else if (row.kind === 'wait') {
        const elapsed = (this.waits.get(row.id) ?? 0) + dt;
        if (elapsed >= row.seconds) this.run(row, frame, output);
        this.pendingWaits.set(row.id, elapsed);
      }
    }
    return output;
  }
  /** Only authored waits add an envelope; legacy users with none retain their existing flags and save bytes. */
  snapshot(): Record<string, number> { return Object.fromEntries(this.waits); }
  restore(value: unknown): void {
    const saved = v.parse(v.record(v.string(), v.pipe(v.number(), v.finite(), v.minValue(0))), value);
    if (Object.keys(saved).length !== this.waits.size || Object.keys(saved).some(id => !this.waits.has(id))) throw new Error('Invalid quest wait continuation');
    for (const [id, elapsed] of Object.entries(saved)) this.waits.set(id, elapsed);
  }
}
