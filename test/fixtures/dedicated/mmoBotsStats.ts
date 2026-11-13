// NET-LAG NL3: how evenly a bot's frames arrive. A server ticking 30 Hz on a clean path reads p95 near 33 ms; bunching (two frames
// together, then a long gap) shows as a low p50 beside a high p95 and max. The driver copies this beside the entry it builds.

/** Frame inter-arrival over the play window, in ms (nearest rank), or null when no two frames arrived. */
export interface InterArrival { readonly gaps: number; readonly p50: number; readonly p95: number; readonly max: number }

export function interArrival(gaps: readonly number[]): InterArrival | null {
  if (gaps.length === 0) return null;
  const sorted = [...gaps].sort((a, b) => a - b), rank = (q: number): number => sorted[Math.max(0, Math.ceil(q * sorted.length) - 1)] ?? 0;
  const tenth = (ms: number): number => Math.round(ms * 10) / 10;
  return { gaps: gaps.length, p50: tenth(rank(.5)), p95: tenth(rank(.95)), max: tenth(sorted[sorted.length - 1] ?? 0) };
}
