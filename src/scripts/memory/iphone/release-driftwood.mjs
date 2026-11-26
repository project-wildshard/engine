// DW5 reads the DW1 route-bench output alongside IP26's boot and walk captures.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { median } from '../calibration.mjs';
import { routeFor } from './route.mjs';

export const DRIFTWOOD = 'driftwood-isle';
export const DRIFTWOOD_CAPS = [30, 60];
const names = routeFor(DRIFTWOOD).map(leg => leg.name);

/** @typedef {{fps: number, over50: number}} FrameReading */
/** @typedef {{name: string, cap: number, error?: string | null, summary?: FrameReading | null}} Leg */
/** @typedef {{cap: number, ab?: boolean | null, error?: string | null,
 * boot?: {build?: string | null, outcome?: string, error?: string | null}, legs?: Leg[]}} RouteTrial */
/** @typedef {{median: number, min: number, max: number}} Spread */
/** @typedef {{cap: number, name: string, runs: number, fps: Spread, over50: Spread}} Segment */
/** @typedef {{build: string | null, segments: Segment[], issue?: string}} DriftwoodReading */

/** @param {number[]} values @returns {Spread} */
function spread(values) {
  return { median: median(values), min: Math.min(...values), max: Math.max(...values) };
}

/** @param {Leg} leg @param {number} cap @param {number} index */
function measuredLeg(leg, cap, index) {
  const frames = leg?.summary;
  return leg?.name === names[index] && leg.cap === cap && !leg.error && frames !== null && frames !== undefined
    && Number.isFinite(frames.fps) && frames.fps > 0 && Number.isSafeInteger(frames.over50) && frames.over50 >= 0;
}

/** @param {string} directory @param {readonly string[]} suiteBuilds @returns {DriftwoodReading} */
export function readDriftwood(directory, suiteBuilds) {
  /** @type {RouteTrial[]} */
  let trials;
  try {
    const parsed = JSON.parse(readFileSync(join(directory, 'route.json'), 'utf8'));
    if (!Array.isArray(parsed)) throw new Error('Expected route trial array');
    trials = parsed;
  } catch (error) {
    const missing = /** @type {NodeJS.ErrnoException} */ (error).code === 'ENOENT';
    return { build: null, segments: [], issue: missing ? 'No route capture' : 'Could not read route.json' };
  }
  const builds = new Set(trials.flatMap(row => {
    const build = row?.boot?.build;
    return typeof build === 'string' && build.trim() !== '' ? [build] : [];
  }));
  const build = builds.size === 1 ? [...builds][0] ?? null : null;
  if (build === null) {
    return { build, segments: [], issue: builds.size > 1 ? 'Several route builds observed' : 'Route build unconfirmed' };
  }
  if (suiteBuilds.some(suiteBuild => suiteBuild !== build)) {
    return { build, segments: [], issue: 'Route build differs from the release suite' };
  }
  const segments = DRIFTWOOD_CAPS.flatMap(cap => {
    const complete = trials.filter(row => row?.cap === cap && (row.ab === null || row.ab === undefined) && !row.error
      && row.boot?.outcome === 'control' && row.boot.build === build && !row.boot.error
      && Array.isArray(row.legs) && row.legs.length === names.length
      && row.legs.every((leg, index) => measuredLeg(leg, cap, index)));
    if (complete.length === 0) return [];
    return names.map((name, index) => {
      const readings = complete.map(row => /** @type {FrameReading} */ (row.legs?.[index]?.summary));
      return { cap, name, runs: complete.length, fps: spread(readings.map(row => row.fps)),
        over50: spread(readings.map(row => row.over50)) };
    });
  });
  return { build, segments };
}

/** @param {Spread} sample @param {number} digits */
function spreadText(sample, digits) {
  return `${sample.median.toFixed(digits)} (${sample.min.toFixed(digits)}–${sample.max.toFixed(digits)})`;
}

/** @param {DriftwoodReading} reading @param {DriftwoodReading | undefined} previous */
export function driftwoodTable(reading, previous) {
  const lines = ['', `Driftwood Isle route (report only). Build ${reading.build ?? 'unconfirmed'}.`];
  if (reading.issue !== undefined) return [...lines, `${reading.issue}.`];
  if (reading.segments.length === 0) return [...lines, 'No complete route runs.'];
  lines.push('| Cap | Segment | Runs | FPS median (range) | Frames >50 ms median (range) | FPS change | Verdict |',
    '|---:|---|---:|---:|---:|---:|---|');
  for (const cap of DRIFTWOOD_CAPS) {
    const segments = reading.segments.filter(segment => segment.cap === cap);
    if (segments.length === 0) lines.push(`| ${cap} | No complete route runs | 0 | — | — | — | unavailable |`);
    for (const segment of segments) {
      const old = previous?.segments.find(before => before.cap === cap && before.name === segment.name);
      // Leg FPS has one decimal. A median of two middle readings can have two, so compare in hundredths.
      const currentFps = Math.round(segment.fps.median * 100);
      const oldFps = old === undefined ? null : Math.round(old.fps.median * 100);
      const change = oldFps === null ? null : 100 * (currentFps - oldFps) / oldFps;
      const verdict = oldFps === null ? 'no previous reading'
        : currentFps * 10 < oldFps * 9 ? 'FLAG: FPS down more than 10%' : 'reported';
      const delta = change === null ? '—' : `${change > 0 ? '+' : ''}${change.toFixed(2)}%`;
      lines.push(`| ${cap} | ${segment.name} | ${segment.runs} | ${spreadText(segment.fps, 2)} | ${spreadText(segment.over50, 1)} | ${delta} | ${verdict} |`);
    }
  }
  return lines;
}
