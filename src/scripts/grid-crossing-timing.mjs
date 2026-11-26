/** Read the current live-grid timing contract; retired card fields are not a duration source.
 * @param {Pick<import('../client/game/grid/liveSession').LiveGridSessionState,'crossingTiming'|'runtimeTiming'>|null|undefined} live
 * @param {number} since Page performance timestamp at this leg's start. */
export function gridCrossingTiming(live, since) {
  if (!Number.isFinite(since) || live === null || live === undefined
      || !Array.isArray(live.crossingTiming) || !Array.isArray(live.runtimeTiming?.completed)) {
    throw new Error('Live grid crossing timing telemetry is unavailable');
  }
  const crossings = live.crossingTiming.filter(span => span.end >= since).map(span => {
    const times = [span.requestedAt, span.readyAt, span.start, span.checkpointEnd, span.commitEnd, span.end];
    if (!times.every(Number.isFinite) || times.some((at, index) => index > 0 && at < (times[index - 1] ?? at))) {
      throw new Error('Live grid crossing timing telemetry is invalid');
    }
    return { from: span.from, to: span.to, start: span.start, end: span.end, phases: {
      prepare: span.readyAt - span.requestedAt, boundary: span.start - span.readyAt,
      checkpoint: span.checkpointEnd - span.start, commit: span.commitEnd - span.checkpointEnd,
      activate: span.end - span.commitEnd } };
  });
  const hooks = live.runtimeTiming.completed.filter(span => span.end >= since).map(span => {
    if (!Number.isFinite(span.start) || !Number.isFinite(span.end) || span.end < span.start) {
      throw new Error('Live grid runtime timing telemetry is invalid');
    }
    return { instance: span.instance, hook: span.hook, start: span.start, end: span.end,
      ms: span.end - span.start, outcome: span.outcome };
  });
  return { source: 'live-grid', since, crossings, hooks };
}
