
// Historical contract oracle; production consumers use the data-driven owners.
const swingValues = (values: readonly number[], size: number): boolean => values.length === size && values.every(Number.isFinite);

const swingWindow = (w: readonly [number, number]): boolean => swingValues(w, 2) && w[0] >= 0 && w[1] <= 1 && w[0] < w[1];

const swingEase = (phase: number, w: readonly [number, number]): number => { const t = Math.max(0, Math.min(1, (phase - w[0]) / (w[1] - w[0]))); return t * t * (3 - 2 * t); };

/** Bounded smooth wind, impact and recovery windows; each channel is [rest, wind, impact]. */
export interface CreatureSwingSpec<K extends string> {
  readonly wind: readonly [number, number]; readonly cut: readonly [number, number]; readonly recover: readonly [number, number];
  readonly channels: Readonly<Record<K, readonly [number, number, number]>>;
}

/** Sample a layered strike into caller-owned scratch. Preflight is quiet; no clock, state or random draw is owned. */
export function sampleCreatureSwing<K extends string>(phase: number, spec: CreatureSwingSpec<K>, output: Record<K, number>): void {
  if (!Number.isFinite(phase) || !swingWindow(spec.wind) || !swingWindow(spec.cut) || !swingWindow(spec.recover)) throw new RangeError('Invalid creature swing window');
  let count = 0;
  for (const key in spec.channels) {
    if (Object.hasOwn(spec.channels, key)) {
      if (!Object.hasOwn(output, key) || key === '__proto__' || key === 'prototype' || key === 'constructor'
        || ++count > 32 || !swingValues(spec.channels[key], 3)) throw new RangeError('Invalid creature swing channel');
    } else throw new RangeError('Inherited creature swing channel');
  }
  if (count === 0) throw new RangeError('Empty creature swing');
  const wind = swingEase(phase, spec.wind), cut = swingEase(phase, spec.cut), recover = swingEase(phase, spec.recover), hold = 1 - recover;
  for (const key in spec.channels) {
    if (Object.hasOwn(spec.channels, key)) {
      const [rest, raised, impact] = spec.channels[key];
      const lift = (1 - wind) * rest + wind * raised;
      output[key] = phase < 0 ? rest : ((1 - cut) * lift + cut * impact) * hold + rest * recover;
    }
  }
}
