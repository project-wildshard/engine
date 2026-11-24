// J444: the same headless phone-Low spawn workload for every pinned revision, and phone High's programs beside it
// (meta QA-FEEDBACK-2026-11-24 row 57: High linked 39 programs after control at Driftwood's dock until 2cac25df5 gave it
// the pixel-neutral DF cuts, and nothing measured High).
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { devices } from '../browser-playwright.mjs';
import { developerSettings, harnessPins, NAME_ASKED, saveFixture } from '../debug-settings.mjs';
import { bootURL } from '../memory/measure.mjs';
import { browserPool } from '../parity/pool.mjs';
import { serve } from '../parity/serve.mjs';
import { pinnedContentKeys } from '../shard-size-gate.mjs';

export const PHONE_LOW = Object.freeze({ width: 402, height: 874, deviceDpr: 3, renderDpr: 1 });
const VIEWS = [0, Math.PI * 2 / 3, -Math.PI * 2 / 3];
const SAMPLE_COUNT = 3;
const READY_MS = 235_000;
const FRAME_MS = 30_000;
const METRICS = /** @type {const} */ (['triangles', 'draws', 'programs']);
/** What each phone graphics setting records: Low every counter, High its programs (row 57). */
export const PHONE_GRAPHICS = Object.freeze({
  low: Object.freeze({ low: true, name: 'phone Low', metrics: METRICS }),
  high: Object.freeze({ low: false, name: 'phone High', metrics: /** @type {readonly Metric[]} */ (['programs']) }),
});
/** @typedef {(typeof METRICS)[number]} Metric */
/** @typedef {keyof typeof PHONE_GRAPHICS} Graphics */

/** @typedef {{frame:number, triangles:number, draws:number, programs:number}} Frame */
/** @typedef {{slug:string, graphics?:Graphics, tier:string, low:boolean, deviceDpr:number, renderDpr:number, views:Frame[][]}} ZoneFrames */

/** Full builds must expose the exact catalogue pinned by the source checkout.
 * @param {Record<string,string>} pins @param {readonly string[]} built */
export function expectPinnedZones(pins, built) {
  const expected = Object.keys(pins).sort();
  if (expected.length === 0 || JSON.stringify(expected) !== JSON.stringify([...built].sort())) {
    throw new Error('Frame budget build must contain every pinned zone');
  }
  return expected;
}

/** A pinned zone with no placement or cell (a staging-only shard's first pin, meta MZ26) boots only from a cell, so the
 * page's inlined catalogue gets a measuring cell (the nearest free one within the grid's bound of 3), as `wildshard dev` gives its one shard; a placed zone's
 * page is unchanged. @param {string} html @param {string} slug */
export function measuringCatalogue(html, slug) {
  return html.replace(/(<script type="application\/json" id="ws-catalogue">)([^<]*)(<\/script>)/u, (all, open, json, close) => {
    const catalogue = JSON.parse(json), bare = (/** @type {{slug:string}} */ row) => row.slug.replace(/^_/u, '');
    if ([...catalogue.placements, ...catalogue.grid.cells].some(row => bare(row) === slug)) return all;
    // the grid admits cells within 3 of the centre: the nearest free one, east first
    const taken = new Set(catalogue.grid.cells.map((/** @type {{cell:number[]}} */ row) => row.cell.join(',')));
    const free = [0, 1, 2, 3].flatMap(r => [-3, -2, -1, 0, 1, 2, 3].flatMap(z => [3, 2, 1, 0, -1, -2, -3].map(x => [x, z])
      .filter(cell => Math.max(...cell.map(Math.abs)) === r))).find(cell => !taken.has(cell.join(',')));
    if (free === undefined) throw new Error(`No free grid cell to measure ${slug} in`);
    catalogue.grid.cells.push({ instance: slug, slug, cell: free });
    return open + JSON.stringify(catalogue).replaceAll('<', String.raw`<`) + close;
  });
}

/** Median frames at each fixed view, then the heaviest view for each counter. Low readings must cover every pin; High
 * readings, when there are any, must too.
 * @param {Record<string,string>} pins @param {readonly ZoneFrames[]} readings @param {string} [commit] */
export function phoneFrameMeasures(pins, readings, commit) {
  /** @type {import('./cli.mjs').BudgetMeasures['measures']} */
  const measures = {};
  for (const graphics of /** @type {Graphics[]} */ (Object.keys(PHONE_GRAPHICS))) {
    const setting = PHONE_GRAPHICS[graphics];
    const rows = readings.filter(row => (row.graphics ?? 'low') === graphics);
    if (graphics !== 'low' && rows.length === 0) continue;
    const expected = expectPinnedZones(pins, rows.map(row => row.slug));
    const bySlug = new Map(rows.map(row => [row.slug, row]));
    for (const slug of expected) {
      const row = bySlug.get(slug);
      if (row?.tier !== 'phone' || row.low !== setting.low || row.deviceDpr !== PHONE_LOW.deviceDpr
          || (setting.low ? row.renderDpr !== PHONE_LOW.renderDpr : !(row.renderDpr > 0))) {
        throw new Error(setting.low ? `${slug}: expected phone Low at 1 drawing pixel per CSS pixel` : `${slug}: expected ${setting.name}`);
      }
      const frames = row.views.flat();
      if (row.views.length !== VIEWS.length || row.views.some(view => view.length !== SAMPLE_COUNT)
          || frames.some((frame, index) => !Number.isSafeInteger(frame.frame) || frame.frame <= (frames[index - 1]?.frame ?? 0)
            || setting.metrics.some(metric => !Number.isSafeInteger(frame[metric]) || frame[metric] <= 0))) {
        throw new Error(`${slug}: incomplete renderer frame samples`);
      }
      for (const metric of setting.metrics) {
        const medians = row.views.map(view => view.map(frame => frame[metric]).sort((a, b) => a - b)[1]);
        measures[`render/phone-${graphics}/${metric}/${slug}`] = { value: Math.max(...medians), contentKey: pins[slug] };
      }
    }
  }
  return { ...(commit === undefined ? {} : { commit }), measures };
}

/** Proof from the actual renderer, before or between samples. */
function renderedPhone() {
  const game = window.__wildshard?.world?.game;
  if (game === undefined) throw new Error('Missing live renderer');
  return { tier: game.tier, low: Reflect.get(game, 'qualityLow') === true, deviceDpr: devicePixelRatio, renderDpr: game.renderer.getPixelRatio() };
}

/** @param {import('playwright').Browser} browser @param {string} base @param {string} slug @param {Graphics} [graphics]
 * @returns {Promise<ZoneFrames>} */
export async function readPhoneFrames(browser, base, slug, graphics = 'low') {
  const viewport = { width: PHONE_LOW.width, height: PHONE_LOW.height };
  const context = await browser.newContext({ ...devices['iPhone 16 Pro'], viewport, screen: viewport, deviceScaleFactor: PHONE_LOW.deviceDpr });
  try {
    await developerSettings(context, { tier: 'phone', volume: 0 });
    await saveFixture(context, NAME_ASKED);
    await saveFixture(context, { scope: 'device', key: 'firstPlayDone', data: true });
    await saveFixture(context, { scope: 'device', key: 'graphics', data: graphics });
    // Hold the phone density against the software renderer's adaptive scale.
    await saveFixture(context, { scope: 'device', key: 'devPixels', data: { screen: 1, density: 2 } });
    await harnessPins(context, { seed: 357 });
    const page = await context.newPage();
    /** @type {string[]} */
    const faults = [];
    page.on('pageerror', error => faults.push(error.message));
    const url = new URL(bootURL(base, slug));
    url.searchParams.set('tier', 'phone');
    url.searchParams.set('touch', '1');
    await page.route(target => target.origin === url.origin && target.pathname === url.pathname, async route => {
      const response = await route.fetch();
      await route.fulfill({ response, body: measuringCatalogue(await response.text(), slug) });
    });
    await page.goto(url.href, { waitUntil: 'domcontentloaded', timeout: READY_MS });
    const ready = await page.waitForFunction(zone => {
      const error = document.querySelector('.ws-load-error, #wserr');
      if (error !== null) return error.textContent?.trim() || 'Load error';
      const world = window.__wildshard?.world;
      return world?.game.level.id === zone && world.game.frameCount > 0
        && world.hud.entered && !world.hud.paused && world.game.frameGate() && !document.querySelector('.ws-load');
    }, slug, { timeout: READY_MS, polling: 200 });
    const result = await ready.jsonValue();
    await ready.dispose();
    if (typeof result === 'string') throw new Error(result);
    await page.evaluate(low => {
      const game = window.__wildshard?.world?.game;
      if (game === undefined) throw new Error('Missing live renderer');
      if ((Reflect.get(game, 'qualityLow') === true) !== low) game.applyQuality();
      game.app.clock.setCapture(30);
    }, PHONE_GRAPHICS[graphics].low);
    const proof = await page.evaluate(renderedPhone);
    console.log(`${slug} ${graphics} control`, JSON.stringify(proof));
    /** @type {Frame[][]} */
    const views = [];
    for (const offset of VIEWS) {
      let after = await page.evaluate(async yaw => {
        const world = window.__wildshard?.world, spawn = world?.game.level.spawn;
        if (!world || !spawn) throw new Error('Missing spawn pose');
        await window.__wildshard?.pose({ x: spawn.x, z: spawn.z, yaw: (spawn.yaw ?? 0) + yaw, pitch: -0.1 });
        return world.game.frameCount + 1;
      }, offset);
      /** @type {Frame[]} */
      const readings = [];
      for (let sample = 0; sample < SAMPLE_COUNT; sample++) {
        const handle = await page.waitForFunction(({ zone, frame }) => {
          const world = window.__wildshard?.world;
          if (!world || world.game.level.id !== zone || world.hud.paused || !world.game.frameGate()) return false;
          const game = world.game;
          if (game.frameCount <= frame) return false;
          return { frame: game.frameCount, triangles: game.lastFrame.triangles, draws: game.lastFrame.calls, programs: game.renderer.info.programs?.length ?? 0 };
        }, { zone: slug, frame: after }, { timeout: FRAME_MS, polling: 'raf' });
        const reading = /** @type {Frame} */ (await handle.jsonValue());
        await handle.dispose();
        readings.push(reading);
        after = reading.frame;
      }
      views.push(readings);
    }
    const final = await page.evaluate(renderedPhone);
    if (JSON.stringify(final) !== JSON.stringify(proof)) throw new Error(`Renderer settings changed: ${JSON.stringify(proof)} -> ${JSON.stringify(final)}`);
    if (faults.length > 0) throw new Error(faults.join('\n'));
    return { slug, graphics, ...proof, views };
  } finally {
    await context.close();
  }
}

/** @param {string[]} args */
async function main([previewRoot, output, commit, only]) {
  if (!previewRoot || !output || (commit !== undefined && !/^[a-f0-9]{8,40}$/u.test(commit))) {
    throw new Error('Usage: phone-frames.mjs <preview root> <measures.json> [commit] [local zone]');
  }
  const version = JSON.parse(readFileSync(join(previewRoot, 'dist', 'version.json'), 'utf8'));
  const build = typeof version.build === 'string' ? version.build.split('-')[0] : '';
  if (commit !== undefined && (!/^[a-f0-9]{7,40}$/u.test(build)
      || (!commit.startsWith(build) && !build.startsWith(commit)))) {
    throw new Error('The frame budget client belongs to a different source commit');
  }
  const pins = pinnedContentKeys();
  const built = readdirSync(join(previewRoot, 'dist', 'shardfiles'), { withFileTypes: true })
    .filter(entry => entry.isDirectory()).map(entry => entry.name);
  const zones = expectPinnedZones(pins, built);
  if (only !== undefined && !zones.includes(only)) throw new Error(`Unknown pinned zone ${only}`);
  const selected = only === undefined ? zones : [only];
  mkdirSync(dirname(output), { recursive: true });
  const preview = await serve(resolve(previewRoot), '', true);
  const pool = browserPool(process.cwd(), 1, 'swiftshader');
  const readings = [];
  const failures = [];
  try {
    const browser = await pool.browser(0);
    for (const slug of selected) {
      /** @type {ZoneFrames[]} */
      const zone = [];
      for (const graphics of /** @type {Graphics[]} */ (Object.keys(PHONE_GRAPHICS))) {
        try {
          zone.push(await readPhoneFrames(browser, preview.url, slug, graphics));
        } catch (error) {
          failures.push(new Error(`${slug}: ${PHONE_GRAPHICS[graphics].name} workload capture failed`, { cause: error }));
          console.error(failures.at(-1));
        }
      }
      if (zone.length !== Object.keys(PHONE_GRAPHICS).length) continue;
      const point = phoneFrameMeasures({ [slug]: pins[slug] }, zone, commit);
      readings.push(...zone);
      writeFileSync(`${output}.frames.json`, `${JSON.stringify(readings, null, 2)}\n`);
      console.log(slug, pins[slug], JSON.stringify(Object.fromEntries(Object.entries(point.measures).map(([key, row]) => [key.split('/').slice(1, 3).join('/'), row.value]))));
    }
    if (failures.length > 0) throw new AggregateError(failures, 'Incomplete phone workload sweep');
    const content = Object.fromEntries(selected.map(slug => [slug, pins[slug]]));
    writeFileSync(output, `${JSON.stringify(phoneFrameMeasures(content, readings, commit), null, 2)}\n`);
  } finally {
    try { await pool.close(); } finally { preview.close(); await preview.closed; }
  }
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  await main(process.argv.slice(2));
}
