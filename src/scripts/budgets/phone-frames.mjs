// J444: the same headless phone-Low spawn workload for every pinned revision, and phone High's programs beside it
// (meta QA-FEEDBACK-2026-11-24 row 57: High linked 39 programs after control at Driftwood's dock until 2cac25df5 gave it
// the pixel-neutral DF cuts, and nothing measured High).
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { devices } from '../browser-playwright.mjs';
import { developerSettings, harnessPins, NAME_ASKED, saveFixture } from '../debug-settings.mjs';
import { bootURL } from '../memory/measure.mjs';
import { enterZone } from '../zone-entry.mjs';
import { browserPool } from '../parity/pool.mjs';
import { serve } from '../parity/serve.mjs';
import { pinnedContentKeys } from '../shard-size-gate.mjs';

export const PHONE_LOW = Object.freeze({ width: 402, height: 874, deviceDpr: 3, renderDpr: 1 });
const VIEWS = [0, Math.PI * 2 / 3, -Math.PI * 2 / 3];
const SAMPLE_COUNT = 3;
const READY_MS = 235_000;
// Meta QA 11-25 row 55: a frame wait is a hang guard, never a budget (J437). On the CI runner's swiftshader Nine r11
// drew a phone Low frame in about 30 s and a High one (renderDpr 2) in longer, so 30 s failed the whole sweep and no
// soft line could be recorded. A frame slower than half the guard warns first (slowFrame), before it can fail.
export const FRAME_MS = 180_000;
const METRICS = /** @type {const} */ (['triangles', 'draws', 'programs']);
/** What each phone graphics setting records: Low every counter, High its programs (row 57). */
export const PHONE_GRAPHICS = Object.freeze({
  low: Object.freeze({ low: true, name: 'phone Low', metrics: METRICS }),
  high: Object.freeze({ low: false, name: 'phone High', metrics: /** @type {readonly Metric[]} */ (['programs']) }),
});
/** The warning for a capture whose slowest frame took `ms`, once it passes half the frame guard; else undefined.
 * @param {string} slug @param {string} name @param {number} ms */
export function slowFrame(slug, name, ms) {
  if (ms <= FRAME_MS / 2) return undefined;
  return `::warning::${slug} ${name}: a frame took ${(ms / 1000).toFixed(1)} s of the ${FRAME_MS / 1000} s frame guard (meta QA 11-25 row 55)`;
}
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
    const url = new URL(bootURL(base));
    url.searchParams.set('tier', 'phone');
    url.searchParams.set('touch', '1');
    // J522 (4), QA 11-25 row 99: a measuring tool enters its zone alone, as a one-cell world. CP17's tap entered the zone's
    // grid cell with its neighbours, where the running level is the grid's (`platform.grid`), never the zone, so this wait
    // never settled and budgets run 45755470720 timed out every capture. A pinned zone with no cell (MZ26) is seated.
    await enterZone(page, { zone: slug, base: url.origin, flags: url.searchParams.toString(), alone: true, unplaced: true, waitUntil: 'domcontentloaded', timeout: READY_MS });
    const ready = await page.waitForFunction(zone => {
      const error = document.querySelector('.ws-load-error, #wserr');
      if (error !== null) return error.textContent?.trim() || 'Load error';
      const shard = window.__wildshard, world = shard?.world;
      // A one-cell world plays the grid's level (`platform.grid`): its zone is the cell the grid stands in (seat-hold-proof's read)
      const grid = /** @type {{ state?: () => { inside: string | null; cells: { instance: string; slug: string }[] } } | undefined} */ (Reflect.get(Reflect.get(shard ?? {}, 'shard') ?? {}, 'grid'))?.state?.();
      const here = world?.game.level.id === zone || grid?.cells.some(cell => cell.instance === grid.inside && cell.slug.replace(/^_/u, '') === zone) === true;
      return here && world !== undefined && world.game.frameCount > 0
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
    let slowest = 0;
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
        const started = Date.now();
        const handle = await page.waitForFunction(({ zone, frame }) => {
          const shard = window.__wildshard, world = shard?.world;
          const grid = /** @type {{ state?: () => { inside: string | null; cells: { instance: string; slug: string }[] } } | undefined} */ (Reflect.get(Reflect.get(shard ?? {}, 'shard') ?? {}, 'grid'))?.state?.();
          const here = world?.game.level.id === zone || grid?.cells.some(cell => cell.instance === grid.inside && cell.slug.replace(/^_/u, '') === zone) === true;
          if (!world || !here || world.hud.paused || !world.game.frameGate()) return false;
          const game = world.game;
          if (game.frameCount <= frame) return false;
          return { frame: game.frameCount, triangles: game.lastFrame.triangles, draws: game.lastFrame.calls, programs: game.renderer.info.programs?.length ?? 0 };
        }, { zone: slug, frame: after }, { timeout: FRAME_MS, polling: 'raf' });
        const reading = /** @type {Frame} */ (await handle.jsonValue());
        await handle.dispose();
        readings.push(reading);
        slowest = Math.max(slowest, Date.now() - started);
        after = reading.frame;
      }
      views.push(readings);
    }
    const warning = slowFrame(slug, PHONE_GRAPHICS[graphics].name, slowest);
    console.log(warning ?? `${slug} ${graphics} slowest frame ${(slowest / 1000).toFixed(1)} s`);
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
