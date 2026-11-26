// J424/J426. armed-zones.json (FORMAT-PRUNE FP27c) is the sole source of which zones this CI arms. A release
// measures the products in its reviewed engine pin set.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { capFor } from '../budgets/files.mjs';
import { pinnedSlugs } from '../pins-catalogue.ts';
import { judgeReads } from './ledgerVerdict.mjs';
import { zoneOverRuns } from './phoneModel.mjs';

const require = createRequire(import.meta.url);
/** The control zone every memory run measures first (J434: Brasscap replaced the legacy Template). */
export const CONTROL_ZONE = 'brasscap-mesa';
/** FORMAT-PRUNE FP27c: the J410 lines are the pinned format's; the zones this CI ledgers, with their golden readings,
 * are engine's own (`armed-zones.json`), since the format keeps no zone list and admission's armed word is the API's. */
const LINES = '@wildshard/format/memory-armed.json';
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
    readings.set(slug, { playingBytes: row.playingBytes, loadingBytes: row.loadingBytes });
  }
  return { lines, zones: new Set(readings.keys()), readings };
}

export function armedMemory() {
  const { lines } = JSON.parse(readFileSync(require.resolve(LINES), 'utf8'));
  const { zones } = JSON.parse(readFileSync(new URL('armed-zones.json', import.meta.url), 'utf8'));
  const policy = parseArmedMemory({ lines, zones });
  const manifest = new URL('../../../test/pins/shardfiles.json', import.meta.url);
  const shipped = new Set(pinnedSlugs(JSON.parse(readFileSync(manifest, 'utf8'))));
  return { ...policy, zones: new Set([...policy.zones].filter(zone => shipped.has(zone))) };
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

/** BUDGET-CAPS BC11 (J445): the two phone lines from budgets/caps.json. Playing is a target (the may-crash card with
 * Play anyway, never a refusal); loading is the one memory refusal.
 * @param {import('../budgets/files.mjs').BudgetCaps} caps @returns {{playingBytes:number,loadingBytes:number}} */
export function footprintLines(caps) {
  const playingBytes = capFor(caps, 'memory/playing/_')?.target, loadingBytes = capFor(caps, 'memory/loading/_')?.hard;
  if (!bytes(playingBytes) || !bytes(loadingBytes)) throw new Error('budgets/caps.json names no playing target or loading cap');
  return { playingBytes, loadingBytes };
}

/** J445: refuse a reading past the loading line; a reading past the playing target returns a report line, else null.
 * @param {{playing:number,loading:number}} reading @param {{playingBytes:number,loadingBytes:number}} lines @returns {string | null} */
export function comparePhoneFootprint({ playing, loading }, lines) {
  if (loading > lines.loadingBytes) throw new Error(`EM11 upper loading ${loading} B (line ${lines.loadingBytes} B), playing ${playing} B`);
  return playing > lines.playingBytes
    ? `EM11 upper playing ${playing} B, past the ${lines.playingBytes} B playing target (J445: the may-crash card with Play anyway, never a refusal)`
    : null;
}

/** BUDGET-CAPS BC11 (J445): a zone's EM11 footprint through the verdict, from one read or three. The keys are
 * memory/playing/<zone> (a target, no hard cap) and memory/loading/<zone> (the 1.5 GB hard cap); the baseline is the zone's
 * own reading on its pinned revision, so a new revision moves its line and only an engine regression on the same one is
 * a fix row.
 * @param {{ zone: string, reads: readonly {playing:number,loading:number}[], contentKey: string,
 *   budgets: Parameters<typeof judgeReads>[0] }} input */
export function judgeFootprint({ zone, reads, contentKey, budgets }) {
  return [
    judgeReads(budgets, `memory/playing/${zone}`, reads.map(read => read.playing), contentKey),
    judgeReads(budgets, `memory/loading/${zone}`, reads.map(read => read.loading), contentKey),
  ];
}
