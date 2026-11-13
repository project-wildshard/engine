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
/** OF3, OF5b: whether the grid catalogue (`src/shared/game/grid/singleplayer.json`, its `grid.cells`) places a shard, so a world
 *  build may enter it. Thin Ice is a draft with no cell: a world build answers "Not in this world yet" for it.
 * @param {string} slug @param {{ grid?: { cells?: readonly { slug?: unknown }[] } }} catalogue */
export const gridPlaces = (slug, catalogue) => (catalogue.grid?.cells ?? []).some(cell => cell.slug === slug);
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
/** @typedef {'play' | 'seat-wait' | 'title' | 'stalled' | 'error' | 'no-resume' | 'outside-world'} Outcome */

/** OF5b: what counts as the screen changing, for the seat wait (10 s still at LOAD `server`) and the stall (45 s still). The card's
 *  own state and its progress counters, never its free text: the card's clock and time-left tick every frame, and on a shard whose
 *  HUD has no quest lines (Template, Brasscap, Pastel Plain, Ink & Cel, the Open Plots) they fall inside any text prefix, so the
 *  screen never held still and those shards ran to the time limit instead of reaching the seat wait (buddy-engine's run, OF5b).
 * @param {{ phase: string, step: string, error: string, failCard: string, title: boolean, player: boolean, progress: string }} screen */
export const screenKey = screen => JSON.stringify([screen.phase, screen.step, screen.error, screen.failCard, screen.title, screen.player, screen.progress]);

/** A request that may fail without the run going red (OF5: telemetry, `/version.json` and the release read). Telemetry is
 *  `/api/telemetry` and the error report `/api/errors`; the release read is the CDN's `/releases/<channel>.json` or the proof's
 *  own copy of it (`/__offline-proof/<channel>.json`).
 * @param {string} url */
export function mayFail(url) {
  const { pathname, host } = new URL(url);
  return pathname === '/version.json' || /\/(?:releases|__offline-proof)\/[\w-]+\.json$/u.test(pathname) || pathname === '/api/telemetry' || pathname === '/api/errors'
    || host === 'api.wildshard.io' || host.endsWith('.sentry.io') || host.endsWith('.ingest.sentry.io');
}

/** OF17: a texture's name in either form, `/assets/<name>.<webp|jpg|png>` (the image) or `/assets/gpu/<name>-<hash8>.ktx2`
 *  (its KTX2 stand-in), or undefined for any other path. @param {string} path
 *  @returns {{ name: string, form: 'img' | 'ktx2' } | undefined} */
export function textureForm(path) {
  const ktx2 = /^\/assets\/gpu\/(.+)-[0-9a-f]{8}\.ktx2$/u.exec(path);
  if (ktx2?.[1] !== undefined) return { name: ktx2[1], form: 'ktx2' };
  const image = /^\/assets\/(?!gpu\/)(.+)\.(?:webp|jpe?g|png)$/u.exec(path);
  return image?.[1] === undefined ? undefined : { name: image[1], form: 'img' };
}

/** A URL's path, the key the warm visit's read set holds. @param {string} url */
export const pathOf = url => new URL(url).pathname;

/** @param {RequestRow} row */
const failed = row => (row.servedBy === 'failed' && row.fail !== 'net::ERR_ABORTED') || row.status >= 400;

/**
 * The red rules of one entry. `warm` is the paths the warm visit read (undefined for the warm visit itself).
 * @param {{ shard: string, channel: 'staging' | 'preview', mode: string, entry: string, rows: readonly RequestRow[],
 *   samples: readonly ScreenSample[], outcome: Outcome, warm?: ReadonlySet<string>, layout?: boolean, walkthrough?: boolean,
 *   requireWorld?: boolean, proofError?: string, leaks?: number, placed?: boolean }} run
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
  if (run.requireWorld === true && run.outcome !== 'play' && !(run.outcome === 'outside-world' && run.placed === false)) out.push({ shard, rule: 'not-in-world', detail: run.outcome });
  // OF3: a world build never enters a shard its grid doesn't place (a draft such as Thin Ice): the title's "Not in this world yet"
  // is the right end there, and wrong for a placed shard or a build with no world (preview opens every shard).
  if (run.outcome === 'outside-world' && !(channel === 'staging' && run.placed === false))
    out.push({ shard, rule: 'outside-world', detail: channel === 'staging' ? 'the grid places this shard, yet the page said it is not in this world' : 'a build with no world opens every shard' });
  // 6. A load that never finished with nothing else to blame.
  if (run.outcome === 'stalled' && out.length === 0) {
    const last = samples.at(-1);
    out.push({ shard, rule: 'stalled', detail: `${last?.phase ?? '?'}/${last?.step ?? '?'}` });
  }
  // 7. OF20: an offline entry reads the grid layout from the cache, and reads it at all (a shard the world doesn't open loads none).
  if (run.layout === true && run.outcome !== 'outside-world') {
    const layout = rows.filter(row => row.origin === 'page' && GRID_LAYOUT.test(pathOf(row.url)));
    if (layout.length === 0) out.push({ shard, rule: 'grid-layout-not-read', detail: 'the entry read no grid layout (a one-shard route, or none)' });
    for (const row of layout) if (row.servedBy !== 'service-worker') out.push({ shard, rule: 'grid-layout-not-cached', url: row.url, detail: row.servedBy });
  }
  // 8. Jake's walk-through (OF21): in the world offline, then the connection card.
  if (run.walkthrough === true) {
    if (run.outcome !== 'play') out.push({ shard, rule: 'walkthrough-not-in-world', detail: run.outcome });
    if (!samples.some(sample => sample.player && sample.failCard !== '')) out.push({ shard, rule: 'walkthrough-no-connection-card' });
  }
  // 9. OF17: one texture form per device and tier. An image the warm visit read only as its KTX2 stand-in is never held.
  if (warm !== undefined) {
    /** @type {Record<'img' | 'ktx2', Set<string>>} */
    const read = { img: new Set(), ktx2: new Set() };
    for (const path of warm) { const texture = textureForm(path); if (texture !== undefined) read[texture.form].add(texture.name); }
    for (const row of rows) {
      const texture = row.origin === 'page' ? textureForm(pathOf(row.url)) : undefined;
      if (texture?.form === 'img' && read.ktx2.has(texture.name) && !read.img.has(texture.name))
        out.push({ shard, rule: 'texture-form-not-warm', url: row.url, detail: `${row.phase}/${row.step}: the warm visit read its KTX2 stand-in` });
    }
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
