// OFFLINE OF1 (meta docs/plans/OFFLINE-PLAN.md, J298): the pass and fail rules of scripts/offline-proof.mjs, on a saved
// request log and the card samples, so a unit test (test/offline-proof-rules.test.ts) pins them without a browser.

/** The catalogue shards the proof enters from Shard select, by their deck card's name. */
export const DECK_SHARDS = Object.freeze([
  { slug: 'driftwood-isle', card: 'Driftwood Isle' }, { slug: 'nalati-grasslands', card: 'Nalati Grasslands' },
  { slug: 'pine-hollow', card: 'Pine Hollow' }, { slug: 'far-reach', card: 'Sky Reach' },
  { slug: 'nine-dragon-stack', card: 'Nine Dragon Stack' }, { slug: 'sunscar-dunes', card: 'Signal Dunes' },
  { slug: 'blender-template', card: 'Brasscap Mesa' }, { slug: '_template', card: 'Template shard' },
  { slug: 'pastel-plain', card: 'Pastel Plain' }, { slug: 'ink-cel-valley', card: 'Ink & Cel Valley' },
]);
/** Open Plots have no deck card (the open-plots audit): a player reaches them by a deep link with Developer on, or a resume. */
export const OPEN_PLOTS = Object.freeze(['open-plot-thin-ice', 'open-plot-night-market', 'open-plot-mosslight-ruins']);
/** Every shard the proof covers, in run order. */
export const ALL_SHARDS = Object.freeze([...DECK_SHARDS.map(shard => shard.slug), ...OPEN_PLOTS]);

/** The in-page solo server's files (J298: a world build never reads them). */
export const SOLO_ONLY = /serverWorker|serverRuntime|\/assets\/spawn\/server\//u;
/** A one-shard page's spawn manifest. */
export const CLIENT_MANIFEST = /\/assets\/spawn\/[^/]+-client-[^/]+\.json$/u;
/** The grid layout a grid page reads (OF20): its spawn manifest, the seam plans and the strip page. */
export const GRID_LAYOUT = /\/assets\/spawn\/[^/]+-grid-[^/]+\.json$|\/assets\/grid-(?:seam-plans|strip-page)-[^/]+\.json$/u;
/** Screen text that is a raw failure, never an FM screen. */
export const RAW_STRINGS = Object.freeze(['Failed to fetch', 'Level load and cleanup failed']);
/** The card phases that are the critical path: START, DOWNLOAD, LOAD, and a card with no phase lit yet. */
export const CRITICAL_PHASES = Object.freeze(['start', 'download', 'load', 'none']);

/** One request the proof saw: when, which card phase and step, and what served it.
 * @typedef {{ n: number, t: number, url: string, type: string, origin: 'page' | 'sw', phase: string, step: string,
 *   servedBy: 'service-worker' | 'network' | 'failed' | 'pending', status: number, fail: string }} RequestRow */
/** One poll of the screen.
 * @typedef {{ t: number, phase: string, step: string, card: boolean, title: boolean, player: boolean, failCard: string,
 *   text: string }} ScreenSample */
/** One reason a run is red.
 * @typedef {{ shard: string, rule: string, url?: string, detail?: string }} Failure */
/** @typedef {'play' | 'seat-wait' | 'title' | 'stalled' | 'error' | 'no-resume'} Outcome */

/** A request that may fail without the run going red (OF5: telemetry, `/version.json` and the release read). Telemetry is
 *  `/api/telemetry` and the error report `/api/errors`; the release read is the CDN's `/releases/<channel>.json` or the proof's
 *  own copy of it (`/__offline-proof/<channel>.json`).
 * @param {string} url */
export function mayFail(url) {
  const { pathname, host } = new URL(url);
  return pathname === '/version.json' || /\/(?:releases|__offline-proof)\/[\w-]+\.json$/u.test(pathname) || pathname === '/api/telemetry' || pathname === '/api/errors'
    || host === 'api.wildshard.io' || host.endsWith('.sentry.io') || host.endsWith('.ingest.sentry.io');
}

/** A URL's path, the key the warm visit's read set holds. @param {string} url */
export const pathOf = url => new URL(url).pathname;

/** @param {RequestRow} row */
const failed = row => (row.servedBy === 'failed' && row.fail !== 'net::ERR_ABORTED') || row.status >= 400;

/**
 * The red rules of one entry. `warm` is the paths the warm visit read (undefined for the warm visit itself).
 * @param {{ shard: string, channel: 'staging' | 'preview', mode: string, entry: string, rows: readonly RequestRow[],
 *   samples: readonly ScreenSample[], outcome: Outcome, warm?: ReadonlySet<string>, layout?: boolean, walkthrough?: boolean,
 *   requireWorld?: boolean, proofError?: string, leaks?: number }} run
 * @returns {Failure[]}
 */
export function judge(run) {
  const { shard, channel, rows, samples, warm } = run;
  /** @type {Failure[]} */
  const out = [];
  // 1. A page or worker read on the critical path failed (the service worker's own reads are its business).
  for (const row of rows) {
    if (row.origin !== 'page' || !CRITICAL_PHASES.includes(row.phase) || !failed(row) || mayFail(row.url)) continue;
    out.push({ shard, rule: 'critical-request-failed', url: row.url, detail: `${row.phase}/${row.step} ${row.fail || String(row.status)}` });
  }
  // 2. A drop to the title after the card showed.
  const firstCard = samples.findIndex(sample => sample.card);
  const dropped = firstCard === -1 ? undefined : samples.slice(firstCard).find(sample => sample.title && !sample.card);
  if (dropped !== undefined || run.outcome === 'title') out.push({ shard, rule: 'title-drop', detail: `at ${String(dropped?.t ?? '?')} ms` });
  // 3. Raw failure strings on screen.
  for (const text of RAW_STRINGS) {
    const seen = samples.find(sample => sample.text.includes(text));
    if (seen !== undefined) out.push({ shard, rule: 'raw-string', detail: `"${text}" at ${String(seen.t)} ms` });
  }
  // 4. A world build reading the solo route's files, or a one-shard manifest the warm visit didn't read.
  if (channel === 'staging') {
    for (const row of rows) {
      if (row.origin !== 'page') continue;
      if (SOLO_ONLY.test(row.url)) out.push({ shard, rule: 'solo-file-on-world-build', url: row.url, detail: `${row.phase}/${row.step}` });
      else if (warm !== undefined && CLIENT_MANIFEST.test(pathOf(row.url)) && !warm.has(pathOf(row.url)))
        out.push({ shard, rule: 'client-manifest-not-warm', url: row.url, detail: `${row.phase}/${row.step}` });
    }
  }
  // 5. The load's own failure screen, the proof's own failure (the title never showing, no deck card), a resume the site never
  //    offered, an offline entry that reached this Mac's server (the emulation leaked), and with --require-world (OF5, OF9) any
  //    end but the world.
  if (run.outcome === 'error') {
    const proof = run.proofError !== undefined && run.proofError !== '';
    out.push({ shard, rule: proof ? 'proof-error' : 'load-error-screen', detail: proof ? run.proofError : samples.at(-1)?.text.slice(0, 200) ?? '' });
  }
  if (run.outcome === 'no-resume') out.push({ shard, rule: 'no-resume', detail: 'reopening the page showed the title, not the shard' });
  if ((run.leaks ?? 0) > 0) out.push({ shard, rule: 'offline-leak', detail: `${String(run.leaks)} reads reached the server while offline (the URLs are in the run's screens log)` });
  if (run.requireWorld === true && run.outcome !== 'play') out.push({ shard, rule: 'not-in-world', detail: run.outcome });
  // 6. A load that never finished with nothing else to blame.
  if (run.outcome === 'stalled' && out.length === 0) {
    const last = samples.at(-1);
    out.push({ shard, rule: 'stalled', detail: `${last?.phase ?? '?'}/${last?.step ?? '?'}` });
  }
  // 7. OF20: an offline entry reads the grid layout from the cache, and reads it at all.
  if (run.layout === true) {
    const layout = rows.filter(row => row.origin === 'page' && GRID_LAYOUT.test(pathOf(row.url)));
    if (layout.length === 0) out.push({ shard, rule: 'grid-layout-not-read', detail: 'the entry read no grid layout (a one-shard route, or none)' });
    for (const row of layout) if (row.servedBy !== 'service-worker') out.push({ shard, rule: 'grid-layout-not-cached', url: row.url, detail: row.servedBy });
  }
  // 8. Jake's walk-through (OF21): in the world offline, then the connection card.
  if (run.walkthrough === true) {
    if (run.outcome !== 'play') out.push({ shard, rule: 'walkthrough-not-in-world', detail: run.outcome });
    if (!samples.some(sample => sample.player && sample.failCard !== '')) out.push({ shard, rule: 'walkthrough-no-connection-card' });
  }
  return out;
}

/** What served each read, counted, for the receipt. @param {readonly RequestRow[]} rows */
export function servedCounts(rows) {
  /** @type {Record<string, number>} */
  const counts = {};
  for (const row of rows) if (row.origin === 'page') counts[row.servedBy] = (counts[row.servedBy] ?? 0) + 1;
  return counts;
}
