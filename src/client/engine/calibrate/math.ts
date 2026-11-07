export interface Point { n: number; ms: number }
export interface Fit { slope: number; intercept: number; r2: number }
export function median(values: readonly number[]): number {
  const a = [...values].sort((x, y) => x - y);
  return a[Math.floor(a.length / 2)] ?? 0;
}
/** Median pairwise slope; refuse flat, negative or nonlinear observations rather than publish noise. */
export function fit(points: readonly Point[]): Fit {
  const fail = (): never => { throw new Error(`Calibration slope is unresolved: ${JSON.stringify(points)}`); };
  if (points.length < 2 || points.some((p) => !Number.isFinite(p.n) || !Number.isFinite(p.ms))) fail();
  const slopes: number[] = [];
  for (const [i, a] of points.entries()) for (const b of points.slice(i + 1)) if (a.n !== b.n) slopes.push((b.ms - a.ms) / (b.n - a.n));
  const result = median(slopes);
  if (!Number.isFinite(result) || result <= 0) fail();
  const intercept = median(points.map((p) => p.ms - result * p.n));
  const mean = points.reduce((sum, p) => sum + p.ms, 0) / points.length;
  const total = points.reduce((sum, p) => sum + (p.ms - mean) ** 2, 0);
  const residual = points.reduce((sum, p) => sum + (p.ms - intercept - result * p.n) ** 2, 0);
  const r2 = total > 0 ? 1 - residual / total : 0;
  if (!Number.isFinite(r2) || r2 < 0.9) fail();
  return { slope: result, intercept, r2 };
}
export function slope(points: readonly Point[]): number { return fit(points).slope; }
