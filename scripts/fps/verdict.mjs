// DF2 / J464. Grade raw drawn frames before rounding. Incomplete evidence takes precedence over a floor miss.
const FLOORS = new Set([30, 60, 120]);

/** @typedef {{seconds:number, frames:number, frameMs:number[]}} Sample */
/** @typedef {{name:string, error?:string|null, samples?:Sample[], nav?:{lostFrames?:number}}} Segment */

/** @param {Sample[]} samples */
export function frameMetrics(samples) {
  // Compensate interval addition: a complete 40 s capture must not become
  // 39.99999999999999 s when hundreds of fractional spans are summed.
  let seconds = 0, remainder = 0;
  for (const sample of samples) {
    const span = sample.seconds - remainder, next = seconds + span;
    remainder = (next - seconds) - span;
    seconds = next;
  }
  const intervals = samples.flatMap(sample => sample.frameMs).sort((a, b) => a - b);
  const frames = samples.reduce((n, sample) => n + sample.frames, 0);
  if (!Number.isFinite(seconds) || seconds <= 0 || frames === 0 || intervals.length !== frames ||
      intervals.some(ms => !Number.isFinite(ms) || ms <= 0)) return null;
  const at = (/** @type {number} */ p) => intervals[Math.floor((intervals.length - 1) * p)];
  const spikes = intervals.filter(ms => ms > 50).length;
  return { seconds, frames, fps: frames / seconds, p50: at(0.5), p95: at(0.95), max: intervals.at(-1) ?? 0,
    spikes, spikesPerMinute: spikes * 60 / seconds };
}

/** @param {NonNullable<ReturnType<typeof frameMetrics>>} metrics @param {number} floor */
function grade(metrics, floor) {
  const budget = 1000 / floor;
  const ceilings = { p50: budget + 0.5, p95: 1.2 * budget, max: floor === 120 ? 50 : 100,
    spikesPerMinute: floor === 120 ? 0 : 1 };
  const misses = metrics.fps < 0.97 * floor ? ['fps'] : [];
  let worst = 0.97 * floor / metrics.fps;
  for (const [metric, limit] of Object.entries(ceilings)) {
    const value = /** @type {Record<string,number>} */ (metrics)[metric];
    if (value > limit) misses.push(metric);
    worst = Math.max(worst, limit === 0 ? 1 + value : value / limit);
  }
  return { metrics, misses, worst };
}

/** @param {Segment[]} legs @param {readonly {name:string,seconds:number}[]} route @param {number} floor */
export function fpsVerdict(legs, route, floor) {
  if (!FLOORS.has(floor)) throw new Error(`Unsupported FPS floor ${floor}`);
  const segments = route.map((expected, index) => {
    const leg = legs[index], metrics = frameMetrics(leg?.samples ?? []);
    const error = leg?.error ?? (leg?.name !== expected.name || metrics === null ||
      metrics.seconds < expected.seconds || (leg?.nav?.lostFrames ?? 0) > 0 ? 'missing frames, waypoint or duration' : null);
    return { name: expected.name, error, result: metrics === null ? null : grade(metrics, floor) };
  });
  const total = frameMetrics(legs.flatMap(leg => leg.samples ?? []));
  const overall = total === null ? null : grade(total, floor);
  const incomplete = segments.find(segment => segment.error !== null);
  const worst = [...segments].sort((a, b) => (b.result?.worst ?? -1) - (a.result?.worst ?? -1))[0];
  const verdict = incomplete || legs.length !== route.length || overall === null ? 'incomplete'
    : overall.misses.length > 0 || segments.some(segment => segment.result?.misses.length) ? 'miss' : 'pass';
  return { verdict, overall, segments, worstSegment: (incomplete ?? worst)?.name ?? null };
}
