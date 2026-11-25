import * as v from 'valibot';
import type { CreatureVolumePose } from '@wildshard/engine/physics/creatureVolumes';
import type { Actor, CombatPipeline } from '@wildshard/engine/combat/pipeline';
import type { Events } from '@wildshard/engine/events/events';
import type { Scope } from '@wildshard/engine/app/scope';

const SavedParts = v.array(v.pipe(v.number(), v.finite(), v.minValue(0)));

/**
 * Part hp (ONE-FORMAT CC31). A volume with `hp` loses the hit's amount (before its multiplier, so a plate at x0 still
 * wears) on every hit that lands on its part (`CombatPipeline.watchParts`); at 0 it breaks, once: `creature.part-broken` fires and the volume is off
 * from then on, so later hits pass to the next volume behind it. The remaining hp are saved state. `onBreak` hears each
 * part as it breaks and again as a broken part is restored (CC30b: a volume's break channel goes to 1). A body that
 * stands again (`pose.whole`, CC36a) has every part back at full hp, and `onWhole` hears each part that was broken.
 */
export class PartHealth {
  readonly pose: CreatureVolumePose;
  private readonly left: number[];
  private readonly index: ReadonlyMap<string, number>;
  private readonly hp: ReadonlyMap<string, number>;
  private readonly actor: Actor;
  private readonly events: Events;
  private readonly onBreak: ((part: string) => void) | undefined;
  private readonly onWhole: ((part: string) => void) | undefined;
  constructor(inner: CreatureVolumePose, hp: ReadonlyMap<string, number>, actor: Actor,
    combat: Pick<CombatPipeline, 'watchParts'>, events: Events, scope: Scope, onBreak?: (part: string) => void,
    onWhole?: (part: string) => void) {
    this.hp = hp; this.actor = actor; this.events = events; this.onBreak = onBreak; this.onWhole = onWhole;
    const parts = inner.volumes.map(row => row.part);
    for (const part of hp.keys()) if (!parts.includes(part)) throw new Error(`Part hp names no volume ${part}`);
    this.index = new Map([...hp.keys()].map(part => [part, parts.indexOf(part)]));
    this.left = inner.volumes.map(row => hp.get(row.part) ?? Infinity);
    const broken = (index: number): boolean => this.left[index] === 0;
    this.pose = {
      volumes: inner.volumes,
      segment: (index, rear, front) => { inner.segment(index, rear, front); },
      off: index => broken(index) || inner.off?.(index) === true,
      ...(inner.joint === undefined ? {} : { joint: inner.joint.bind(inner) }),
      ...(inner.capture === undefined ? {} : { capture: inner.capture.bind(inner) }),
      ...(inner.motorless === true ? { motorless: true } : {}),
      whole: () => { inner.whole?.(); this.whole(); },
    };
    combat.watchParts(actor, (part, amount) => { this.wear(part, amount); }, scope);
  }
  /** The part's remaining hp (Infinity for a part without hp). */
  remaining(part: string): number { const index = this.index.get(part); return index === undefined ? Infinity : this.left[index] ?? Infinity; }
  snapshot(): number[] { return [...this.index.values()].map(index => this.left[index] ?? 0); }
  restore(input: unknown): void {
    const saved = v.parse(SavedParts, input), slots = [...this.index.entries()];
    if (saved.length !== slots.length) throw new Error('Incompatible part hp continuation');
    slots.forEach(([part, index], slot) => { const value = saved[slot] ?? 0; if (value > (this.hp.get(part) ?? 0)) throw new Error('Incompatible part hp continuation'); this.left[index] = value; if (value === 0) this.onBreak?.(part); });
  }
  /** Every part back at its full hp; each one that was broken is heard by `onWhole`. */
  private whole(): void {
    for (const [part, index] of this.index) {
      const was = this.left[index]; this.left[index] = this.hp.get(part) ?? Infinity;
      if (was === 0) this.onWhole?.(part);
    }
  }
  private wear(part: string, amount: number): void {
    const index = this.index.get(part); if (index === undefined || !Number.isFinite(amount) || amount <= 0) return;
    const before = this.left[index] ?? 0; if (before === 0) return;
    const after = Math.max(0, before - amount); this.left[index] = after;
    if (after === 0) { this.onBreak?.(part); this.events.emit('creature.part-broken', { actor: this.actor, part, index }); }
  }
}
