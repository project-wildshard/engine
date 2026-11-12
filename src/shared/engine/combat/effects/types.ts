import type { Actor, CombatTag } from '../pipeline';

/** Numeric attributes stay live at the simulation ports; modifiers retain a separate base. */
export type AttributeSet = Record<string, number | undefined>;
export type EffectId = `effect.${string}`;
export type CueId = `cue.${string}`;
export interface EffectTarget { readonly attributes: AttributeSet; effectTags?: readonly CombatTag[] }
export interface EffectDef {
  id: EffectId; tags: readonly CombatTag[];
  kind: 'instant' | 'timed' | 'permanent'; duration?: number; period?: number;
  /** Damage per periodic tick; the content binding routes this through combat.hit. */
  tickDamage?: number;
  modifiers: readonly { attr: string; op: 'add' | 'mul' | 'override'; value: number }[];
  stacking: 'none' | 'refresh' | { max: number };
  cue?: CueId; icon?: string; blockedBy?: readonly CombatTag[]; grants?: readonly CombatTag[];
  /** Exclusive cosmetics and upgrades replace their predecessor without multiplying both. */
  group?: string; removes?: readonly EffectId[];
}
/** Harm is derived from periodic damage, status/debuff tags or an attribute lowered from its unmodified base. */
export function harmfulEffect(def: EffectDef, bases: AttributeSet = {}): boolean {
  return (def.tickDamage ?? 0) > 0 || def.tags.some((tag) => tag.startsWith('status.') || tag.startsWith('debuff.'))
    || def.modifiers.some((modifier) => {
      const base = bases[modifier.attr] ?? 0;
      const value = modifier.op === 'add' ? base + modifier.value : modifier.op === 'mul' ? base * modifier.value : modifier.value;
      return value < base;
    });
}
export interface ActiveEffect { readonly def: EffectDef; stacks: number; remaining: number; elapsed: number; source: Actor | undefined; sourceTags: readonly CombatTag[] }
export interface SourceMulDef {
  id: string;
  when: { sourceTags?: readonly CombatTag[]; targetTags?: readonly CombatTag[]; weaponTags?: readonly CombatTag[]; targetState?: readonly CombatTag[] };
  mul: number;
}
export const matchesTag = (tags: readonly CombatTag[], pattern: CombatTag): boolean =>
  pattern.endsWith('.*') ? tags.some((tag) => tag.startsWith(pattern.slice(0, -1))) : tags.includes(pattern);
const anyTag = (tags: readonly CombatTag[], patterns?: readonly CombatTag[]): boolean =>
  patterns === undefined || patterns.some((pattern) => matchesTag(tags, pattern));
/** Sources call this inside their own rounding expression, never as a later damage rule. */
export function sourceMultiplier(rows: readonly SourceMulDef[], input: {
  sourceTags?: readonly CombatTag[]; targetTags?: readonly CombatTag[]; weaponTags?: readonly CombatTag[]; targetState?: readonly CombatTag[];
}): number {
  let mul = 1;
  for (const row of rows) if (anyTag(input.sourceTags ?? [], row.when.sourceTags)
    && anyTag(input.targetTags ?? [], row.when.targetTags) && anyTag(input.weaponTags ?? [], row.when.weaponTags)
    && anyTag(input.targetState ?? [], row.when.targetState)) mul *= row.mul;
  return mul;
}
