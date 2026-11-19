// J424/J426. The shipped format list is the sole source of arming. Engine
// baselines are measurements, including for zones that still report only.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { zoneOverRuns } from './phoneModel.mjs';

const require = createRequire(import.meta.url);
const LIST = '@wildshard/memory-policy/memory-armed.json';
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
/** @param {unknown} value */
const bytes = value => Number.isSafeInteger(value) && value > 0;

/** @param {any} value */
export function parseArmedMemory(value) {
  const { lines, zones } = value ?? {};
  if (!bytes(lines?.playingBytes) || !bytes(lines?.loadingBytes) || lines.playingBytes > lines.loadingBytes
    || !zones || typeof zones !== 'object' || Array.isArray(zones)) throw new Error('Invalid armed memory list');
  /** @type {Map<string, {playingBytes:number,loadingBytes:number}>} */
  const readings = new Map();
  for (const [slug, row] of Object.entries(zones)) {
    if (!SLUG.test(slug) || !row || typeof row !== 'object' || Array.isArray(row)
      || !bytes(row.playingBytes) || !bytes(row.loadingBytes)
      || typeof row.armed !== 'string' || typeof row.by !== 'string' || typeof row.evidence !== 'string') {
      throw new Error(`Invalid armed memory entry: ${slug}`);
    }
    readings.set(slug === 'template' ? '_template' : slug, { playingBytes: row.playingBytes, loadingBytes: row.loadingBytes });
  }
  return { lines, zones: new Set(readings.keys()), readings };
}

export function armedMemory() {
  return parseArmedMemory(JSON.parse(readFileSync(require.resolve(LIST), 'utf8')));
}

/** A pinned zone outside the online grid has its supported standalone
 * boot measured against the same hard lines.
 * @param {string} zone @param {ReadonlySet<string>} armed @param {ReadonlySet<string>} placed */
export function footprintBootFor(zone, armed, placed) {
  return armed.has(zone) && placed.has(zone) ? 'online' : 'standalone';
}

/** Preserve armed coverage when a recording requests a subset.
 * @param {readonly string[]} available @param {ReadonlySet<string>} armed @param {readonly string[]} requested */
export function ledgerZones(available, armed, requested = available) {
  const availableSet = new Set(available);
  const required = [...armed].filter(zone => zone !== 'nine-dragon-stack'); // Nine uses the native WebKit ledger.
  for (const zone of [...required, ...requested]) if (!availableSet.has(zone)) throw new Error(`No ledger preview for ${zone}`);
  return [...new Set([...requested, ...required])].sort();
}

/** A successful comparison always emits a verdict. An armed comparison
 * refuses on a confirmed overage or unavailable reading, including during recording.
 * @param {string} zone @param {ReadonlySet<string>} armed @param {() => Promise<void>} run @param {(line:string) => void} log */
export async function guardZone(zone, armed, run, log) {
  try { await run(); }
  catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    if (armed.has(zone)) throw new Error(`Armed memory gate for ${zone}: ${detail}`, { cause: error });
    log(`Memory report for ${zone}: ${detail}`);
    return;
  }
  log(`Memory ${armed.has(zone) ? 'gate passed' : 'report within the lines'} for ${zone}`);
}

/** Use comparable readings from one boot mode for both EM11 phases.
 * @param {string} zone @param {readonly any[]} runs @param {any} model @param {'standalone'|'online'} boot */
export function phoneFootprint(zone, runs, model, boot) {
  /** @param {any} value */
  const pair = value => bytes(value?.webcontent) && bytes(value?.gpu);
  if (runs.length === 0 || runs.some(run => run.host !== 'webkit' || run.ready !== true || run.refused !== null
    || (run.boot ?? 'standalone') !== boot || run.instrument !== model.instrument || !pair(run.settled) || !Array.isArray(run.checkpoints)
    || !run.checkpoints.some(row => row.step === 'control') || !run.checkpoints.every(row => Number.isFinite(row.peak?.webcontent) && row.peak.webcontent >= 0 && Number.isFinite(row.peak.gpu) && row.peak.gpu >= 0))) {
    throw new Error(`${zone}: missing comparable native WebKit readings`);
  }
  const result = zoneOverRuns(runs, model);
  return { playing: Math.ceil(result.playing.upper), loading: Math.ceil(result.loading.upper) };
}

/** @param {{playing:number,loading:number}} reading @param {{playingBytes:number,loadingBytes:number}} lines
 */
export function comparePhoneFootprint({ playing, loading }, lines) {
  if (playing > lines.playingBytes || loading > lines.loadingBytes) {
    throw new Error(`EM11 upper playing ${playing} B (line ${lines.playingBytes} B), loading ${loading} B (line ${lines.loadingBytes} B)`);
  }
}
