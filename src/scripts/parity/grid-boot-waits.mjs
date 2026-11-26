/** Copy bounded scalar evidence from the smoke's existing observation, never a scene or resource. */
/** @param {unknown} value @returns {value is Record<string, unknown>} */
const isRecord = value => typeof value === 'object' && value !== null && !Array.isArray(value);
/** @param {unknown} value */
const record = value => isRecord(value) ? value : {};
/** @param {unknown} value */
const number = value => typeof value === 'number' && Number.isFinite(value) ? value : null;
/** @param {unknown} value */
const string = value => typeof value === 'string' ? value.slice(0, 256) : null;
/** @param {unknown} value */
const boolean = value => typeof value === 'boolean' ? value : null;
/** @param {unknown} value */
const rows = value => Array.isArray(value) ? value.slice(0, 32).map(record) : [];

/** Retain one second of existing polls per sample, plus every pending-stage transition.
 * The last 64 samples survive either success or refusal; no timer, request, retry or readiness decision is added. */
export function gridBootWaitHistory() {
  /** @type {import('./grid-boot-waits.mjs').GridBootWaitSample[]} */
  const samples = [];
  let previous = '', lastAt = -Infinity;
  return {
    samples,
    /** @param {string} label @param {number} at @param {unknown} observation */
    observe(label, at, observation) {
      const value = record(observation), grid = record(value.grid);
      if (Object.keys(grid).length === 0) return;
      const waits = record(grid.ringsWait), io = record(waits.waits), rings = record(grid.rings);
      const cells = rows(waits.cells).map(row => ({ instance: string(row.instance), far: string(row.far) }));
      const preparation = rows(waits.preparation).map(row => ({ instance: string(row.instance), phase: string(row.phase),
        ageMs: number(row.ageMs), phaseAgeMs: number(row.phaseAgeMs) }));
      const oldest = rows(io.oldest).slice(0, 16).map(row => ({ label: string(row.label), kind: string(row.kind), ageMs: number(row.ageMs) }));
      const signature = JSON.stringify({ label, ready: boolean(value.ready), ringsReady: boolean(grid.ringsReady), cells,
        preparation: preparation.map(({ instance, phase }) => ({ instance, phase })), oldest: oldest.map(({ label: waitingOn, kind }) => ({ label: waitingOn, kind })) });
      if (signature === previous && at - lastAt < 1000) return;
      previous = signature; lastAt = at;
      samples.push({ label, at, frame: number(value.frame), drawnFrame: number(value.drawnFrame), ready: boolean(value.ready),
        visibility: string(value.visibility), clockPaused: boolean(value.clockPaused), ringsReady: boolean(grid.ringsReady),
        inFlight: number(rings.inFlight), queued: number(rings.queued), refused: number(rings.refused), cells, preparation,
        waits: { count: number(io.count), oldest } });
      if (samples.length > 64) samples.shift();
    },
  };
}
