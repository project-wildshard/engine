#!/usr/bin/env node
// Meta QA 11-24 row 7 (Jake, 11-24: "whenever theres a new update its a frozen screen for 10 seconds"): the title on an
// update, measured on a real staging release. Seed a profile on the build staging serves now, let the next release's
// alias move, then open the same profile and log every document it shows: when its main screen appeared, its longest
// frame gap, and the idle hand-over (titleHandover.ts) to the new build. Headless Chromium, muted, keychain flags, the
// agent marker in the UA (never `?agent=`). It replaces qa-play's lost tmp/opus-qa-play/local-update.mjs.
//
//   node scripts/title-update-proof.mjs seed <profile dir> cold|warm [origin]   cold: one title load; warm: three loads
//                                                                                and a zone entered, so every cache is warm
//   node scripts/title-update-proof.mjs open <profile dir> [origin] [--seconds=20]
// `open` prints one JSON line per document and a verdict: pass when the first title shows within 2 s and no frame gap
// on a shown title passes 1 s.
import {mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {join, resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {chromium} from './browser-playwright.mjs';
import {KEYCHAIN_ARGS} from './chromium-keychain.mjs';
import {mutedLaunch, silenced} from './browser-silence.mjs';
import {agentUserAgent} from './agent-marker.mjs';

export const TITLE_MS = 2000, FROZEN_MS = 1000;
// The title, muted (`skipintro` would skip it straight into play); the warm seed's zone visit adds the rest.
const QUERY = '?mute=1';

/** Per document: when `.ws-main` first showed (ms from timeOrigin) and the longest rAF gap after it. */
const PROBE = () => {
  const state = {mainAt: -1, maxGap: 0, last: -1, frames: 0};
  Object.defineProperty(window, '__titleProbe', {value: state});
  const frame = (/** @type {number} */ now) => {
    const main = document.querySelector('.ws-main');
    if (state.mainAt < 0 && main !== null && main.getClientRects().length > 0) state.mainAt = now;
    if (state.mainAt >= 0 && state.last >= 0) state.maxGap = Math.max(state.maxGap, now - state.last);
    state.last = now; state.frames++;
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
};

/**
 * The verdict over the documents one `open` saw.
 * @param {{build: string, mainAt: number, maxGap: number}[]} documents
 */
export function verdict(documents) {
  const first = documents[0], shown = documents.filter(row => row.mainAt >= 0);
  const titleMs = first === undefined || first.mainAt < 0 ? null : Math.round(first.mainAt);
  const maxGap = Math.round(Math.max(0, ...shown.map(row => row.maxGap)));
  return {titleMs, maxGap, builds: documents.map(row => row.build), pass: titleMs !== null && titleMs < TITLE_MS && maxGap <= FROZEN_MS};
}

/** @param {string} dir */
async function context(dir) {
  const launch = mutedLaunch({headless: true, args: [...KEYCHAIN_ARGS], viewport: {width: 1280, height: 800}});
  const probe = await chromium.launchPersistentContext(dir, launch);
  const base = await (await probe.newPage()).evaluate(() => navigator.userAgent);
  await probe.close();
  const marked = await chromium.launchPersistentContext(dir, {...launch, userAgent: agentUserAgent(base.replace('HeadlessChrome', 'Chrome'))});
  await silenced(marked);
  return marked;
}

/** @param {import('playwright').Page} page */
const read = page => page.evaluate(() => ({build: String(window.__WS_BUILD_ID__ ?? ''), origin: performance.timeOrigin,
  ...(/** @type {any} */ (window).__titleProbe ?? {mainAt: -1, maxGap: 0, frames: 0})})).catch(() => undefined);

/** @param {string[]} args */
export async function main(args) {
  const [mode, dirArg, third, fourth] = args;
  if (!['seed', 'open'].includes(mode ?? '') || dirArg === undefined) throw new Error('Usage: title-update-proof.mjs seed <dir> cold|warm [origin] | open <dir> [origin] [--seconds=20]');
  const dir = resolve(dirArg), kind = mode === 'seed' ? third : undefined;
  if (mode === 'seed' && kind !== 'cold' && kind !== 'warm') throw new Error('seed takes cold or warm');
  const origin = new URL((mode === 'seed' ? fourth : third?.startsWith('--') ? undefined : third) ?? 'https://staging.wildshard.io/').origin;
  const seconds = Number(args.find(arg => arg.startsWith('--seconds='))?.slice(10) ?? 20);
  mkdirSync(dir, {recursive: true});
  const browser = await context(dir);
  try {
    const page = browser.pages()[0] ?? await browser.newPage();
    await page.addInitScript(PROBE);
    if (mode === 'seed') {
      for (let load = 0; load < (kind === 'warm' ? 3 : 1); load++) {
        await page.goto(`${origin}/${QUERY}`, {waitUntil: 'domcontentloaded', timeout: 60_000});
        await page.waitForFunction(() => (/** @type {any} */ (window).__titleProbe?.mainAt ?? -1) >= 0, undefined, {timeout: 60_000});
        await page.waitForTimeout(5000);
      }
      if (kind === 'warm') {
        await page.goto(`${origin}/${QUERY}&nolock=1&skipintro=1&chunk=driftwood-isle`, {waitUntil: 'domcontentloaded', timeout: 60_000});
        await page.waitForFunction(() => window.__wildshard?.shard?.grid?.state?.()?.live?.live?.gameplayReady === true, undefined, {timeout: 120_000}).catch(() => undefined);
        await page.goto(`${origin}/${QUERY}`, {waitUntil: 'domcontentloaded', timeout: 60_000});
        await page.waitForFunction(() => (/** @type {any} */ (window).__titleProbe?.mainAt ?? -1) >= 0, undefined, {timeout: 60_000});
        await page.waitForTimeout(5000);
      }
      const seeded = {kind, origin, build: (await read(page))?.build, at: new Date().toISOString()};
      writeFileSync(join(dir, 'seed.json'), `${JSON.stringify(seeded)}\n`);
      console.log(JSON.stringify(seeded));
      return;
    }
    const seed = (() => { try { return JSON.parse(readFileSync(join(dir, 'seed.json'), 'utf8')); } catch { return undefined; } })();
    /** @type {Map<number, {build: string, mainAt: number, maxGap: number, frames: number}>} */
    const documents = new Map();
    await page.goto(`${origin}/${QUERY}`, {waitUntil: 'commit', timeout: 60_000});
    for (const stop = Date.now() + seconds * 1000; Date.now() < stop;) {
      const row = await read(page);
      if (row !== undefined) documents.set(row.origin, {build: row.build.slice(0, 8), mainAt: row.mainAt, maxGap: row.maxGap, frames: row.frames});
      await page.waitForTimeout(200);
    }
    const rows = [...documents.values()];
    for (const row of rows) console.log(JSON.stringify(row));
    console.log(JSON.stringify({seeded: seed?.build?.slice(0, 8), kind: seed?.kind, ...verdict(rows)}));
  } finally { await browser.close(); }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) await main(process.argv.slice(2));
