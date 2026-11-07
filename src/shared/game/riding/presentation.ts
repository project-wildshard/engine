import type { AnimalRigContext } from '@wildshard/engine/entities/animalRig';

/** Purely numeric presentation envelopes, independent of a species or rig. */
export interface RidingPresentationRows {
  alive: string; smooth: readonly { source: string; target: string; rate: number; low: number; high: number }[];
  decay: readonly { source: string; target: string; rate: number }[];
  graze: { target: string; rate: number; speed: number };
  base: { bone: string; target: string }; wind: { x: string; z: string; strength: string };
}
/** Native joints and client rigs consume the same declared envelopes before their
 * existing numeric pose program. This advances presentation only. */
export function poseRidingEnvelopes(context: AnimalRigContext, rows: RidingPresentationRows, wind: { x: number; z: number; strength: number }): void {
  const memory = context.mem;
  memory[rows.alive] = Number(context.alive);
  for (const row of rows.smooth) {
    const target = context.alive ? Math.min(row.high, Math.max(row.low, memory[row.source] ?? 0)) : 0;
    memory[row.target] = (memory[row.target] ?? 0) + (target - (memory[row.target] ?? 0)) * Math.min(1, context.dt * row.rate);
  }
  for (const row of rows.decay) {
    const value = memory[row.source] ?? 0; memory[row.target] = value;
    if (value > 0) memory[row.source] = Math.max(0, value - context.dt * row.rate);
  }
  const graze = context.alive && context.state === 'graze' && context.speed < rows.graze.speed ? 1 : 0;
  memory[rows.graze.target] = (memory[rows.graze.target] ?? 0) + (graze - (memory[rows.graze.target] ?? 0)) * Math.min(1, context.dt * rows.graze.rate);
  memory[rows.base.target] ??= context.bones[rows.base.bone]?.position.z ?? 0;
  memory[rows.wind.x] = wind.x; memory[rows.wind.z] = wind.z; memory[rows.wind.strength] = wind.strength;
}
