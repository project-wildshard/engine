#!/usr/bin/env node
// Manual LS2-LS6 proof on real boots. Deliberately outside hooks and the unit-test glob.
// Run through scripts/browser-lane.sh after `pnpm build:ring`:
//   scripts/browser-lane.sh node scripts/loading-card-proof.mjs [--shard=template] [--out=<dir>] [--throttle] [--grid]
// It boots the built product at iPhone portrait size in Chromium and WebKit, records every change of the
// card's bars with the LS1 counters that moved with it, screenshots the card loading and ready, and reports
// each stretch of over 2 s where the bar took less than 1 %, by the stage that held it.
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve as resolvePath, join } from 'node:path';
import { chromium, webkit, devices } from 'playwright';
import { serve } from './parity/serve.mjs';
import { saveFixture, debugSettings } from './debug-settings.mjs';
import { barStalls, untracedChanges } from './loading-bar-rule.mjs';

/** @param {string} name */
const option = name => process.argv.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3);
const root = resolvePath(option('root') ?? '.'), shard = option('shard') ?? 'template';
const out = resolvePath(option('out') ?? 'tmp/loading-card'), throttle = process.argv.includes('--throttle');
const only = option('browser');
// LS6: --arrival='<name>|<art>' seeds the title tap's arrival the way a grid tap with a saved place writes it.
const arrival = option('arrival')?.split('|');
mkdirSync(out, { recursive: true });

/** Browser-side recorder: one row per bar change, with the LS1 counters at that moment. */
function recordBars() {
  /** @type {import('./loading-bar-rule.mjs').BarRow[]} */
  const rows = [];
  Reflect.set(window, '__barLog', rows);
  // Every realm's counters: the worker's boundaries and streamed bytes are real events too.
  const counters = () => {
    const timing = Reflect.get(window, '__bootTiming');
    let bytes = 0, atomic = 0, files = 0;
    for (const [key, row] of Object.entries(timing?.counters ?? {})) {
      if (row.unit === 'decoded-body-bytes') bytes += row.loaded;
      else if (key.endsWith('atomic:completed')) atomic += row.loaded;
      else if (key.endsWith('resource:completed')) files += row.loaded;
    }
    // The card's own receipts are real events too: its download source's bytes read (cache reads have no network
    // chunk) and the Load timeline's finished steps.
    const card = document.querySelector('.ws-load');
    if (card instanceof HTMLElement) bytes += Number(card.dataset.readBytes ?? 0) + Number(card.dataset.streamedBytes ?? 0);
    const steps = card === null ? undefined : Reflect.get(card, Symbol.for('engine.loading.snapshot'));
    /** @type {{rows: {key: string, state: string, detail: string}[], current: string} | undefined} */
    const snapshot = steps;
    if (snapshot !== undefined) atomic += snapshot.rows.filter(step => step.state === 'ok').length;
    // A running step's own reported sub-progress ("Pass 3 / 6") and the download's close are producer events.
    const work = `${snapshot?.rows.find(step => step.key === snapshot.current)?.detail ?? ''}|${card instanceof HTMLElement ? card.dataset.readsClosed ?? '' : ''}`;
    return { atomic, bytes, files, work };
  };
  const watch = () => {
    const card = document.querySelector('.ws-load');
    if (!(card instanceof HTMLElement)) { requestAnimationFrame(watch); return; }
    const seen = new Map();
    let step = '', ready = false;
    const sample = () => {
      const now = card.dataset.step ?? '';
      if (now !== step) { step = now; rows.push({ t: performance.now(), bar: 'step', pct: 0, step, ...counters() }); }
      if (!ready && Object.hasOwn(card.dataset, 'ready')) { ready = true; Reflect.set(window, '__readyAt', performance.now()); }
      for (const fill of card.querySelectorAll('[data-phase-bar]')) { if (!(fill instanceof HTMLElement)) continue;
        const bar = fill.dataset.phaseBar ?? '', pct = Number.parseFloat(fill.style.width || '0');
        if (seen.get(bar) === pct) continue;
        seen.set(bar, pct);
        rows.push({ t: performance.now(), bar, pct, step, ...counters() });
      }
    };
    new MutationObserver(sample).observe(card, { subtree: true, attributes: true, attributeFilter: ['style', 'data-step', 'data-ready'] });
    sample();
  };
  document.addEventListener('DOMContentLoaded', watch, { once: true });
}

const preview = await serve(root, '', true);
const report = [];
try {
  for (const name of ['chromium', 'webkit']) {
    if (only !== undefined && only !== name) continue;
    const engine = name === 'chromium' ? chromium : webkit;
    const browser = await engine.launch({ headless: true, ...(name === 'chromium' ? { args: ['--mute-audio'] } : {}) });
    try {
      const context = await browser.newContext({ ...devices['iPhone 16 Pro'], deviceScaleFactor: 2 });
      await saveFixture(context, { scope: 'device', key: 'devMode', data: true });
      await debugSettings(context, { holdLoading: true });
      await context.addInitScript(recordBars);
      if (arrival !== undefined) await saveFixture(context, { scope: 'session', key: 'titleArrival', once: 'ls6-arrival',
        data: JSON.stringify({ slug: shard, mode: 'enter', at: Date.now(), name: arrival[0], art: arrival[1] ?? '', tier: 'phone' }) });
      const page = await context.newPage();
      /** @type {string[]} */ const faults = [];
      page.on('pageerror', error => faults.push(error.message));
      if (throttle && name === 'chromium') {
        const cdp = await context.newCDPSession(page);
        await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
        await cdp.send('Network.enable');
        await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 150, downloadThroughput: 1.6e6 / 8 * 8, uploadThroughput: 750e3 / 8 });
      }
      const tag = `${name}${throttle ? '-throttled' : ''}${arrival === undefined ? '' : '-arrival'}`;
      await page.goto(`${preview.url}/?chunk=${encodeURIComponent(shard)}&tier=phone&mute=1&nolock=1&sw=0`, { waitUntil: 'commit', timeout: 30000 });
      if (arrival !== undefined) {
        // The first frame: the inline card before any module, then the adopted card must keep the same name and art.
        await page.waitForSelector('.ws-load[data-shell] [data-el="slug"]', { timeout: 30000 });
        await page.screenshot({ path: join(out, `${tag}-first.png`) });
        const first = await page.evaluate(() => ({ name: document.querySelector('[data-el="slug"]')?.textContent, art: document.documentElement.style.getPropertyValue('--ws-load-portrait') }));
        console.log(`${tag}: first frame ${JSON.stringify(first)}`);
        if (first.name !== arrival[0] || !first.art.includes(arrival[1] ?? '')) faults.push(`first frame shows ${JSON.stringify(first)}`);
      }
      await page.waitForFunction(() => document.querySelector('.ws-load:not([data-shell])') !== null, null, { timeout: 60000 });
      await page.screenshot({ path: join(out, `${tag}-loading.png`) });
      await page.waitForSelector('.ws-load[data-ready]', { timeout: 120000 });
      await page.waitForTimeout(300);
      await page.screenshot({ path: join(out, `${tag}-ready.png`) });
      if (arrival !== undefined) {
        const kept = await page.evaluate(() => document.querySelector('[data-el="slug"]')?.textContent);
        if (kept !== arrival[0]) faults.push(`adopted card renamed the destination to ${kept}`);
      }
      // LS4: Copy diagnostics copies the full LS1 timeline.
      const copied = await page.evaluate(async () => {
        /** @type {string[]} */ const texts = [];
        const original = navigator.clipboard.writeText.bind(navigator.clipboard);
        navigator.clipboard.writeText = text => { texts.push(text); return original(text).catch(() => undefined); };
        const button = document.querySelector('.ws-load-copy');
        if (!(button instanceof HTMLElement)) return { ok: false, reason: 'no Copy diagnostics button', label: '' };
        button.click();
        await new Promise(resolve => { setTimeout(resolve, 300); });
        const text = texts[0] ?? '', json = text.slice(text.indexOf('timeline (LS1):\n') + 16);
        const timing = Reflect.get(window, '__bootTiming')?.read();
        const parsed = JSON.parse(json);
        return { ok: parsed.entries.length > 100 && parsed.entries.length <= timing.entries.length && document.querySelector('.ws-load[data-ready]') !== null,
          reason: `${parsed.entries.length} entries copied of ${timing.entries.length}`, label: button.textContent, head: text.split('\n').slice(0, 4).join(' / ') };
      });
      console.log(`${tag}: copy ${copied.ok ? 'ok' : 'FAILED'} · ${copied.reason} · button "${copied.label}" · ${copied.head ?? ''}`);
      if (!copied.ok) faults.push(`copy diagnostics: ${copied.reason}`);
      const log = await page.evaluate(() => Reflect.get(window, '__barLog'));
      const readyAt = await page.evaluate(() => Reflect.get(window, '__readyAt'));
      if (process.argv.includes('--dump')) writeFileSync(join(out, `${tag}-timing.json`), JSON.stringify(await page.evaluate(() => Reflect.get(window, '__bootTiming')?.read()), null, 1));
      report.push({ tag, faults, log, readyAt });
      await context.close();
    } finally { await browser.close(); }
  }
} finally { preview.close(); }
let failed = false;
for (const { tag, faults, log, readyAt } of report) {
  // The rule's window opens when the first card paints a bar, before any module (the inline Start counter).
  const opened = log[0]?.t ?? 0, { stalls, backwards } = barStalls(log, opened, readyAt), untraced = untracedChanges(log);
  console.log(`${tag}: ready ${(readyAt / 1000).toFixed(1)} s, ${log.filter((/** @type {{bar: string}} */ row) => row.bar !== 'step').length} bar changes, `
    + `${stalls.length} stalls over 2 s, ${backwards.length} backwards, ${untraced.length} untraced, faults ${faults.length}${faults.length > 0 ? `: ${faults.join(' | ')}` : ''}`);
  for (const stall of stalls) console.log(`  stall ${(stall.ms / 1000).toFixed(1)} s at ${(stall.from / 1000).toFixed(1)} s: needs finer feedback in ${stall.stages.join(' > ') || 'unnamed'}`);
  for (const row of untraced) console.log(`  untraced ${row.bar} -> ${row.pct}% at ${(row.t / 1000).toFixed(2)} s (${row.step})`);
  writeFileSync(join(out, `${tag}-bars.json`), JSON.stringify({ readyAt, stalls, backwards, untraced, log }));
  failed ||= backwards.length > 0 || untraced.length > 0 || faults.length > 0 || process.argv.includes('--strict') && stalls.length > 0;
}
if (failed) process.exitCode = 1;
console.log(`shots in ${out}`);
