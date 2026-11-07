import type { StrikeContext, StrikeSpec } from './strikes';

/** Deterministic score data. Horizontal distance uses the shipping Math.hypot subtraction and strict > boundary. */
export type StrikeWeight =
  | { kind: 'constant'; value: number }
  | { kind: 'horizontal-distance'; above: number; far: number; near: number };
/** A serializable strike. A null range explicitly means no range limit; all other numbers remain finite. */
export type StrikeData = Omit<StrikeSpec, 'weight' | 'range'> & { range: number | null; weight: StrikeWeight };
/** Evaluate an admitted score without allocating or consulting rendering, time, random state or actor memory. */
export function strikeWeight(row: StrikeWeight, ctx: StrikeContext): number {
  return row.kind === 'constant' ? row.value
    : Math.hypot(ctx.target.x - ctx.actor.position.x, ctx.target.z - ctx.actor.position.z) > row.above ? row.far : row.near;
}
/** Bind admitted data to the existing runner. Row order, tie-breaking, contact and continuation stay runner-owned. */
export function strikeFromData(row: StrikeData): StrikeSpec {
  return { ...row, range: row.range ?? Infinity, weight: ctx => strikeWeight(row.weight, ctx) };
}
