#!/usr/bin/env node
// hud-worst — the worst-case HUD (A14, Jake 2026-11-10: "Imagine a virtual union shard, all the HUD stuff. What's the worst-case
// behaviour of the HUD? I just want a script that generates that screenshot"). One built page, Driftwood Isle (the grid, the MMO
// page Jake plays on staging, in Developer mode; the shard's own page with it off, as a player starts), with every HUD element
// any of the seven shards can show turned on at once: the touch layer's every disc and tab (LOCK, USE, SWAP, HORSE, GUST,
// SPRINT), the status column's rows (VITALS, BOLTS, STEED, HIDDEN, coins), the quest chip, toasts, the kill feed, the pickup
// card, the hit marker and aim line, the weather chip and GET LOW, the boss bar, the online chat row with its voice mic, players
// and tip, and in Developer mode the dock (fps pill, memory card), the hover BOOST and a Developer alert. Writes one screenshot
// per browser × size × Developer mode, then checks the layout (below) and lists what overlaps.
//
//   scripts/serve-build.sh                                       # prints the build's URL
//   scripts/browser-lane.sh node scripts/hud-worst.mjs --base=http://127.0.0.1:4401/ [--out=<dir>] [--label=after]
//        [--browsers=chromium,webkit] [--sizes=402x874,402x654,874x402,1440x900] [--dev=off,on] [--menu] [--check] [--chat-rev=<rev>]
//   --chat-rev draws the chat row from that commit's modules (a before shot against an older build).
//
// The layout check (exit 1 with --check): no Developer surface (the dock's chips, a panel that shows unasked, BOOST, an alert)
// overlaps the quest chip, PAUSE, the minimap, the crosshair, the chat or a touch control; the chat (its row, lines, voice tip and
// players) overlaps none of those; and the point at the mic's centre is the mic (elementFromPoint), so a phone's only way into voice can be tapped.
// --menu also opens the BAG on phones and checks the chat row and the mic are gone while it is up and back when it closes (QA
// row 15). Every other overlap between HUD elements is listed, not failed: the union draws pieces no one shard draws at once.
// Headless only (J148, Jake 2026-11-10); Chromium launches with the keychain flags. Our own build on localhost only.
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium, devices, webkit } from 'playwright';
import { build } from 'vite';
import { saveFixture } from './debug-settings.mjs';
import { KEYCHAIN_ARGS } from './chromium-keychain.mjs';

/** @param {string} key @param {string} fallback */
const arg = (key, fallback) => process.argv.find(value => value.startsWith(`--${key}=`))?.slice(key.length + 3) ?? fallback;
const base = arg('base', '');
if (base === '') throw new Error('Requires --base=<a served build> (scripts/serve-build.sh prints one)');
if (!/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?\//u.test(base)) throw new Error('hud-worst drives our own local build only (J148)');
const label = arg('label', 'shot'), out = resolve(arg('out', join(homedir(), '.cache/wildshard/hud-worst')));
const browsers = arg('browsers', 'chromium,webkit').split(','), sizes = arg('sizes', '402x874,402x654,874x402,1440x900').split(',');
const modes = arg('dev', 'off,on').split(','), check = process.argv.includes('--check'), menu = process.argv.includes('--menu');
const chatRev = arg('chat-rev', '');
mkdirSync(out, { recursive: true });

/** @typedef {{ name: string, left: number, top: number, right: number, bottom: number }} Box */
/** @typedef {{ guarded: Box[], chat: Box[], developer: Box[], rest: Box[], mic: { ok: boolean, at: string | null } | null, chatShown: boolean }} Boxes */

/** The chat row's real modules over a stub link, as one script for the page (from `rev`'s modules when given).
 * @param {string} rev @returns {Promise<string>} */
async function chatBundle(rev) {
  const dir = resolve('tmp/hud-worst-chat');
  let entry = resolve('scripts/hud-worst/chat.ts');
  if (rev !== '') {
    mkdirSync(join(dir, 'src'), { recursive: true });
    for (const file of ['chatLines.ts', 'voiceUi.ts', 'voice.ts']) writeFileSync(join(dir, 'src', file), execFileSync('git', ['show', `${rev}:src/client/host/online/${file}`]));
    const text = readFileSync(entry, 'utf8').replaceAll('../../src/client/host/online/', './src/').replace('../../src/shared/engine/app/scope.ts', resolve('src/shared/engine/app/scope.ts'));
    entry = join(dir, 'chat.ts'); writeFileSync(entry, text);
  }
  /** @type {any} */
  const result = await build({ configFile: false, logLevel: 'warn', publicDir: false, define: { __BUILD_ID__: '"hud-worst"' },
    build: { outDir: join(dir, 'out'), emptyOutDir: true, write: false, minify: false, target: 'es2022',
      lib: { entry, formats: ['iife'], name: 'hudWorstChat', fileName: () => 'chat.js' } } });
  /** @type {{ type: string, code?: string }[]} */
  const output = [result].flat().flatMap((/** @type {any} */ r) => r.output ?? []);
  const code = output.find(o => o.type === 'chunk')?.code;
  if (code === undefined) throw new Error('hud-worst: the chat bundle is empty');
  return code;
}

/** In the page: every HUD element on at once. Returns what it turned on, and what it could not.
 * @param {boolean} dev @returns {{ on: string[], missed: string[] }} */
function union(dev) {
  /** @type {string[]} */ const on = [];
  /** @type {string[]} */ const missed = [];
  /** @type {any} */ const page = window;
  const W = page.__wildshard, H = W.world.hud, app = W.world.game?.app ?? W.app;
  const S = app?.ui?.hud, A = app?.levelAdapters?.hud, layer = document.querySelector('.ws-touch');
  const svg = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="7"/></svg>';
  /** @param {string} name @param {() => boolean | void} fn */
  const step = (name, fn) => { try { if (fn() === false) missed.push(name); else on.push(name); } catch (error) { missed.push(`${name} (${String(error instanceof Error ? error.message : error).slice(0, 80)})`); } };
  /** @param {string} sel @param {string} [cls] */
  const show = (sel, cls = 'show') => { const el = document.querySelector(sel); if (!(el instanceof HTMLElement)) return false; el.hidden = false; el.style.visibility = ''; el.classList.add(cls); return true; };
  // the touch layer: a lock-on sword's discs, the edge column, the thumb arc, USE and SPRINT
  step('touch: lock-on sword (LOCK)', () => {
    if (layer === null) return false;
    // TouchControls re-reads the held weapon every frame: keep a sword with a target in reach (no weapon raises LOCK and AIM at once)
    const keep = () => { layer.classList.add('lockable', 'melee'); layer.classList.remove('lock-idle'); requestAnimationFrame(keep); };
    keep(); return show('.ws-touch-disc.lock');
  });
  step('touch: SPRINT', () => { document.querySelector('.ws-touch-stick')?.classList.add('sprint'); return layer !== null; });
  step('touch: SWAP', () => layer !== null && show('.ws-touch-swap'));
  step('touch: HORSE (edge tab)', () => { if (A?.disc === undefined || layer === null) return false; A.disc({ cls: 'ws-ride-horse', icon: svg, label: 'Horse', spot: 'edge-l' }).button.classList.add('show'); return true; });
  step('touch: GUST (Sky Reach verb)', () => { if (A?.verb === undefined || layer === null) return false; A.verb('verb.1', { icon: svg, label: 'Gust', press: () => undefined }); return true; });
  step('prompt + touch USE', () => { const p = document.querySelector('.ws-game-prompt'); if (p === null) return false; p.innerHTML = '<b>E</b>Talk · Castaway'; p.classList.add('show'); return true; });
  // the status column: VITALS, BOLTS, a shard's rows (STEED, HIDDEN), the pills
  step('VITALS', () => { const v = document.querySelector('.ws-game-vitals'); if (v === null) return false; v.classList.remove('hp-fade', 'hp-gone'); return true; });
  step('BOLTS', () => show('.ws-game-bolts', 'on'));
  step('rows: STEED, HIDDEN', () => {
    if (S?.statusRow === undefined) return false;
    for (const [cls, text, order] of /** @type {const} */ ([['ws-ride-steed', 'STEED · 82%', 2], ['ws-stealth-hidden', 'HIDDEN · GRASS', 3]])) { const el = document.createElement('div'); el.className = cls; el.textContent = text; S.statusRow(el, order); }
    return true;
  });
  step('pills: NOTE, JOURNAL', () => show('.ws-fb-disc') && show('.ws-cmp-disc'));
  // the world's moments: toasts, the kill feed, the pickup card, the hit marker and aim line, weather, the boss and elite bars
  step('toasts', () => { H.toast('Glyph shard recovered · 1 / 3'); H.toast('Storm coming · find cover', 'warn'); });
  step('kill feed', () => { H.killFeed('Boar · headshot'); });
  step('pickup card', () => { H.pickupCard({ name: 'Sea glass', detail: 'Charm · 5', icon: svg }); });
  step('hit marker + aim line', () => { H.showHitMarker(true, true); H.setAimInfo({ kind: 'BOAR', distance: 15 }); });
  step('weather + GET LOW', () => { H.setWeather({ chip: { title: 'Storm 2:10', sub: 'Wind 22 m/s', tone: 'storm' }, getLow: true }); });
  step('boss bar', () => show('.ws-boss-bar'));
  step('elite banner', () => show('.ws-elite-banner'));
  // the online page's chat row, its mic, the players on voice and four lines
  step('chat + voice', () => { page.__hudWorstChat([['Maren', 'anyone at the pier?'], ['You', 'on my way'], ['Kai', 'boss is up at the shrine, bring the sword'], ['Maren', 'ok']], 'on', ['Maren', 'Kai', 'Tomo']); });
  if (dev) {
    step('dev: BOOST', () => show('.ws-touch-boost'));
    step('dev: alert', () => { H.devAlert('quest/fire.ts disabled: TypeError: castaway.flags is undefined'); });
  }
  // play.ts rewrites the prompt, the aim line and the hit marker every frame: hold them for the shot
  const hold = document.createElement('style'); hold.id = 'hud-worst-hold';
  hold.textContent = '.ws-game-prompt,.ws-touch-use,.ws-game-aim,.ws-game-hitring{opacity:1!important;visibility:visible!important}.ws-touch-use{display:flex!important}';
  document.head.append(hold);
  return { on, missed };
}

/** In the page: the HUD's boxes by role, for the layout check. @returns {Boxes} */
function boxes() {
  /** @param {Element} el */
  const seen = el => { const r = el.getBoundingClientRect(), s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none' && Number(s.opacity) > 0.05 && el.closest('[hidden]') === null; };
  /** @param {Element} el @param {string} name @returns {Box} */
  const rect = (el, name) => { const r = el.getBoundingClientRect(); return { name, left: r.left, top: r.top, right: r.right, bottom: r.bottom }; };
  /** @param {string} sel @param {string} [name] */
  const all = (sel, name) => [...document.querySelectorAll(sel)].filter(seen).map((el, i) => rect(el, `${name ?? sel}${i === 0 ? '' : `#${String(i)}`}`));
  const cx = innerWidth / 2, cy = innerHeight / 2;
  const guarded = [
    ...all('.ws-touch-pause', 'PAUSE'), ...all('.ws-quest-obj.show', 'quest chip'), ...all('.ws-minimap', 'minimap'),
    { name: 'crosshair', left: cx - 20, top: cy - 20, right: cx + 20, bottom: cy + 20 },
    ...all('.ws-touch button:not(.ws-touch-boost):not(.ws-touch-pause)', 'touch control'), ...all('.ws-touch-bar', 'touch bar'), ...all('.ws-touch-swap', 'SWAP'),
  ];
  // what the chat box clips (its oldest lines, past its height) is not on screen
  const clip = document.getElementById('ws-chat')?.getBoundingClientRect();
  /** @param {Box} b */
  const clipped = b => clip === undefined ? b : { ...b, top: Math.max(b.top, clip.top), bottom: Math.min(b.bottom, clip.bottom) };
  const chat = [...all('#ws-chat form', 'chat row'), ...all('#ws-chat > [data-lines] > *', 'chat line'), ...all('#ws-voice-peers', 'voice players'), ...all('#ws-voice-tip', 'voice tip')]
    .map(clipped).filter(b => b.bottom - b.top > 1);
  const developer = [...all('.ws-perf-dock > *', 'dock chip'), ...all('.ws-touch-boost', 'BOOST'), ...all('.ws-perf-panel', 'Developer panel'),
    ...all('.ws-grid-budget-detail', 'memory panel'), ...all('.ws-game-dev-alert, .ws-game-developer, .ws-memory-warning, .ws-game-boundary.show', 'Developer alert')];
  const rest = ['.ws-touch-status > *', '.ws-loot-chip', '.ws-game-toast', '.ws-game-feed-item', '.ws-icard-pop', '.ws-game-weather', '.ws-game-getlow', '.ws-boss-bar', '.ws-elite-banner', '.ws-game-aim', '.ws-touch-use.show', '.ws-hint-tag.show', '.ws-touch-sprint']
    .flatMap(sel => all(sel));
  const mic = document.getElementById('ws-voice'), box = document.getElementById('ws-chat');
  let micHit = null;
  if (mic !== null && seen(mic)) {
    const r = mic.getBoundingClientRect(), at = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    micHit = { ok: at !== null && (at === mic || mic.contains(at)), at: at === null ? null : `${at.tagName.toLowerCase()}${at.id === '' ? '' : `#${at.id}`}.${(at.getAttribute('class') ?? '').split(' ').join('.')}` };
  }
  return { guarded, chat, developer, rest, mic: micHit, chatShown: box !== null && seen(box) };
}

/** @param {Box} a @param {Box} b */
const hit = (a, b) => a.left < b.right - 0.5 && a.right > b.left + 0.5 && a.top < b.bottom - 0.5 && a.bottom > b.top + 0.5;
/** @param {Box[]} as @param {Box[]} bs */
const pairs = (as, bs) => as.flatMap(a => bs.filter(b => b !== a && hit(a, b)).map(b => `${a.name} × ${b.name}`));

/** Into play: the grid in Developer mode (its card is Developer-only), the shard's own page without.
 * @param {import('playwright').Page} page @param {boolean} dev */
async function enter(page, dev) {
  if (dev) {
    await page.goto(new URL('/?mute=1&nolock=1&sw=0', base).href, { waitUntil: 'load' });
    await page.waitForSelector('.ws-main-grid', { state: 'attached', timeout: 120_000 });
    // the title's own tap (a landscape phone's rotate gate lies over the card and would take a pointer)
    await page.evaluate(() => { /** @type {HTMLElement} */ (document.querySelector('.ws-main-grid')).click(); });
    await page.waitForFunction(() => /** @type {any} */ (window).__wildshard?.shard?.grid?.state().live?.live?.gameplayReady, undefined, { timeout: 180_000 });
  } else {
    await page.goto(new URL('/?chunk=driftwood-isle&mute=1&nolock=1&sw=0', base).href, { waitUntil: 'load' });
    await page.waitForFunction(() => /** @type {any} */ (window).__wildshard?.world?.player !== undefined, undefined, { timeout: 180_000 });
  }
  await page.evaluate('(window.__wildshard.world.hud.enterNow(), true)');
}

/** @param {import('playwright').Page} page */
const openBag = page => page.evaluate(() => { /** @type {any} */ (window).__wildshard.world.hud.menu.open('inventory'); });
/** @param {import('playwright').Page} page */
const closeBag = page => page.evaluate(() => { /** @type {any} */ (window).__wildshard.world.hud.menu.close(); });

const chatCode = await chatBundle(chatRev);
/** @type {string[]} */ const failures = [];
/** @type {string[]} */ const written = [];
for (const kind of browsers) {
  const engine = kind === 'webkit' ? webkit : chromium;
  const browser = await engine.launch(kind === 'webkit' ? {} : { args: [...KEYCHAIN_ARGS, '--mute-audio', '--use-angle=metal', '--ignore-gpu-blocklist'] });
  try {
    for (const size of sizes) {
      const [width = 0, height = 0] = size.split('x').map(Number), phone = Math.min(width, height) <= 500;
      for (const mode of modes) {
        const dev = mode === 'on', name = `${label}-${kind}-${size}-dev-${mode}`;
        const context = await browser.newContext(phone ? { ...devices['iPhone 15'], viewport: { width, height }, deviceScaleFactor: 2 } : { viewport: { width, height } });
        try {
          if (dev) { await saveFixture(context, { scope: 'device', key: 'devMode', data: true }); await saveFixture(context, { scope: 'device', key: 'debug.workerClient', data: 'on' }); }
          const page = await context.newPage();
          /** @type {string[]} */ const errors = [];
          page.on('pageerror', error => { errors.push(error.message.slice(0, 160)); });
          await enter(page, dev);
          await page.waitForTimeout(6000); // the quest chip, the minimap and the dock settle; the first hints run their course
          await page.addScriptTag({ content: chatCode });
          const made = await page.evaluate(union, dev);
          await page.waitForTimeout(700);
          const file = join(out, `${name}.png`);
          await page.screenshot({ path: file }); written.push(file);
          const b = await page.evaluate(boxes);
          // a phone held sideways: the game is portrait-only there, and its rotate gate covers the page (RotateGate.ts)
          const gated = await page.evaluate(() => { const gate = document.querySelector('.ws-rotate'); return gate !== null && getComputedStyle(gate).display !== 'none' && gate.getBoundingClientRect().width > 0; });
          const problems = gated ? [] : [...pairs(b.developer, [...b.guarded, ...b.chat]), ...pairs(b.chat, b.guarded)];
          if (gated) { /* nothing to lay out under the gate */ } else if (b.mic === null) problems.push('the mic is not on screen');
          else if (!b.mic.ok) problems.push(`the mic's centre is covered by ${String(b.mic.at)}`);
          if (gated) console.log(`  ${name}: the rotate gate is up (portrait-only on phones); no layout check`);
          if (menu && phone && !gated) {
            await openBag(page); await page.waitForTimeout(500);
            const open = await page.evaluate(boxes), shot = join(out, `${name}-bag-open.png`);
            await page.screenshot({ path: shot }); written.push(shot);
            if (open.chatShown || open.mic !== null) problems.push('the chat row or the mic shows over the open BAG');
            await closeBag(page); await page.waitForTimeout(500);
            const closed = await page.evaluate(boxes), after = join(out, `${name}-bag-closed.png`);
            await page.screenshot({ path: after }); written.push(after);
            if (!closed.chatShown || closed.mic?.ok !== true) problems.push('the chat row and the mic did not come back when the BAG closed');
          }
          const every = [...b.rest, ...b.guarded, ...b.chat], others = [...new Set(pairs(every, every))];
          console.log(`${problems.length === 0 ? 'PASS' : 'FAIL'}  ${name}  ${file}`);
          console.log(`  on: ${made.on.join(' · ')}`);
          if (made.missed.length > 0) console.log(`  not on: ${made.missed.join(' · ')}`);
          for (const problem of problems) console.log(`  OVERLAP ${problem}`);
          if (others.length > 0) console.log(`  (union, not failed) ${others.slice(0, 24).join(' · ')}${others.length > 24 ? ` … +${String(others.length - 24)}` : ''}`);
          if (errors.length > 0) console.log(`  page errors: ${errors.slice(0, 3).join(' | ')}`);
          if (problems.length > 0) failures.push(name);
        } finally { await context.close(); }
      }
    }
  } finally { await browser.close(); }
}
console.log(`${String(written.length)} screenshot(s) in ${out}`);
if (failures.length > 0) { console.log(`layout: ${String(failures.length)} failing: ${failures.join(', ')}`); if (check) process.exitCode = 1; }
