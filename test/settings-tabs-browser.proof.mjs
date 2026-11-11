// Run by name, never in the gated Vitest suite (it needs browsers): CI's e2e job runs it in Chromium.
//   [WS_SETTINGS_SHOTS=<shots dir>] scripts/browser-lane.sh node --test test/settings-tabs-browser.proof.mjs
// J245 (Jake, 2026-11-10: "Settings, let's do A, like the bag. The tabs at the top, 5 tabs. Developer mode is on, 6 tabs"):
// the real GameMenu (test/settings-tabs/page.ts) on a phone (iPhone, 402 × 874) and a desktop (1440 × 900). Every tab opens
// from its button, every row lands in the tab this list says (written from meta SETTINGS-REDESIGN-PLAN.md, not read from the
// page), and every control changes the setting it names. Headless Chromium with the keychain flags (J148).
// SR13: with the review inbox unlocked there is no second tab bar; System ▸ Feedback opens the composer and its back bar
// returns to System. SR11: the title's Settings (BootSettings.ts) is the same tab bar, walked tab by tab, without Review.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, resolve } from 'node:path';
import { chromium, devices } from 'playwright';
import { build } from 'vite';
import { KEYCHAIN_ARGS } from '../scripts/chromium-keychain.mjs';

const OUT = resolve('tmp/settings-tabs'), SHOTS = process.env['WS_SETTINGS_SHOTS'] ?? resolve('tmp/settings-tabs-shots');
/** @type {Readonly<Record<string, string>>} */
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.woff2': 'font/woff2', '.svg': 'image/svg+xml', '.png': 'image/png' };
const TABS = ['graphics', 'sound', 'controls', 'saves', 'system'];
/** where each row must be: `data-setting` keys (switches, sliders, pickers) and `data-gfx` ids (Graphics), by tab */
const EXPECT = {
  graphics: { phone: ['gfx:mode', 'gfx:tier', 'gfx:aa', 'gfx:firstPlay'], desk: ['gfx:deskNote', 'gfx:tier', 'gfx:scale', 'gfx:aa'] },
  sound: ['volume', 'music', 'musicStyle'],
  controls: ['look', 'lockCam', 'autoLock', 'aimAssist'],
};

test('Settings: five tabs (six in Developer mode), every row in its tab, every control works', { timeout: 240_000 }, async () => {
  mkdirSync(SHOTS, { recursive: true });
  await build({ configFile: false, root: resolve('test/settings-tabs'), logLevel: 'warn', publicDir: false,
    define: { __TITLE_ASSET_URLS__: '{}', __BUILD_ID__: '(globalThis.__WS_BUILD_ID__ ?? "")', __DEVSERVER__: 'false', __ENGINE_RELEASE__: '"v0.0.0"' },
    build: { outDir: OUT, emptyOutDir: true, target: 'es2022', minify: false } });
  const fonts = (readFileSync('index.html', 'utf8').match(/@font-face\{[^}]*\}/gu) ?? []).join('\n');
  const server = createServer((request, response) => {
    const path = decodeURIComponent(new URL(request.url ?? '/', 'http://localhost').pathname);
    if (path === '/fonts.css') { response.writeHead(200, { 'content-type': 'text/css' }).end(fonts); return; }
    for (const base of [OUT, resolve('public')]) {
      try { const file = join(base, path === '/' ? 'index.html' : path), bytes = readFileSync(file); response.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' }).end(bytes); return; } catch { /* the next root */ }
    }
    response.writeHead(404).end();
  });
  await new Promise(ready => { server.listen(0, '127.0.0.1', () => { ready(null); }); });
  const address = server.address(), port = typeof address === 'object' && address !== null ? address.port : 0;
  const browser = await chromium.launch({ args: [...KEYCHAIN_ARGS] });
  try {
    for (const kind of /** @type {const} */ (['phone', 'desk'])) {
      const phone = kind === 'phone';
      const context = await browser.newContext(phone ? { ...devices['iPhone 15'], viewport: { width: 402, height: 874 }, deviceScaleFactor: 2 } : { viewport: { width: 1440, height: 900 } });
      const page = await context.newPage();
      /** @type {string[]} */ const errors = [];
      page.on('pageerror', error => { errors.push(error.message); });
      await page.goto(`http://127.0.0.1:${String(port)}/`);
      await page.waitForFunction(() => /** @type {any} */ (window).settingsReady === true);
      await page.evaluate(() => document.fonts.ready);
      /** @param {string} expr */
      const read = expr => page.evaluate(`(() => { const s = window.__settings; return ${expr}; })()`);
      /** @param {string} selector */
      const tap = async selector => { await page.locator(selector).first().click(); await page.waitForTimeout(60); };
      const shownTabs = () => page.$$eval('.ws-gmenu-svtab', bs => bs.filter(b => !b.hidden).map(b => /** @type {HTMLElement} */ (b).dataset['svTab']));
      /** @param {string} tab */
      const open = async tab => { await tap(`.ws-gmenu-svtab[data-sv-tab="${tab}"]`); };
      /** @param {string} tab */
      const visibleIn = tab => page.$$eval(`.ws-gmenu-svpane[data-sv-pane="${tab}"] [data-setting], .ws-gmenu-svpane[data-sv-pane="${tab}"] [data-gfx]`,
        els => els.filter(e => /** @type {HTMLElement} */ (e).offsetParent !== null).map(e => { const d = /** @type {HTMLElement} */ (e).dataset; return d['gfx'] === undefined ? String(d['setting']) : `gfx:${d['gfx']}`; }));
      /** @param {string} selector @param {number} value */
      const slide = async (selector, value) => {
        await page.$eval(selector, (input, v) => { const s = /** @type {HTMLInputElement} */ (input); s.value = String(v); s.dispatchEvent(new Event('input', { bubbles: true })); }, value);
      };

      await page.evaluate(() => { /** @type {any} */ (window).__settings.menu.open('settings'); });
      await page.waitForTimeout(200);
      assert.equal(await page.locator('.ws-gmenu-title').textContent(), 'Settings', `${kind}: the menu is SETTINGS`);
      assert.deepEqual(await shownTabs(), TABS, `${kind}: five tabs outside Developer mode`);
      assert.equal(await page.$eval('.ws-gmenu-svtab.active', b => /** @type {HTMLElement} */ (b).dataset['svTab']), 'graphics', `${kind}: Settings opens on Graphics`);

      // every tab opens from its button, and shows its pane only
      for (const tab of TABS) {
        await open(tab);
        const active = await page.$$eval('.ws-gmenu-svpane.active', ps => ps.map(p => /** @type {HTMLElement} */ (p).dataset['svPane']));
        assert.deepEqual(active, [tab], `${kind}: ${tab} opens alone`);
        await page.screenshot({ path: join(SHOTS, `${kind}-${tab}.png`) });
      }
      // every row in its tab (and nothing left outside the panes)
      for (const [tab, want] of Object.entries(EXPECT)) {
        await open(tab);
        const keys = Array.isArray(want) ? want : want[kind];
        const seen = await visibleIn(tab);
        for (const key of keys) assert.ok(seen.includes(key), `${kind}: ${key} shows in ${tab} (saw ${seen.join(', ')})`);
      }
      const stray = await page.$$eval('.ws-gmenu-svpanel .ws-gmenu-switch, .ws-gmenu-svpanel .ws-gmenu-slider, .ws-gmenu-svpanel .ws-gmenu-segbtn', els => els.filter(e => e.closest('.ws-gmenu-svpane') === null).length);
      assert.equal(stray, 0, `${kind}: every control is inside a tab`);

      // GRAPHICS
      await open('graphics');
      if (phone) {
        await tap('.ws-gmenu-svmodecard[data-mode="low"]'); assert.equal(await read('s.graphicsMode()'), 'low', 'Low applies');
        await tap('.ws-gmenu-svmodecard[data-mode="high"]'); assert.equal(await read('s.graphicsMode()'), 'high', 'High applies');
      } else {
        await tap('[data-gfx="scale"] .ws-gmenu-segbtn[data-v="1.5"]'); assert.equal(await read('s.gfxPrefs.dpr'), '1.5', 'render scale saves');
        await tap('[data-gfx="scale"] .ws-gmenu-segbtn[data-v="auto"]');
      }
      await tap('[data-gfx="aa"] .ws-gmenu-segbtn[data-v="off"]'); assert.equal(await read('s.gfxPrefs.aa'), 'off', `${kind}: anti-aliasing saves`);
      assert.equal(await page.locator('[data-gfx="reload"]').isVisible(), true, `${kind}: a pending boot pick shows Reload now`);
      await tap('[data-gfx="aa"] .ws-gmenu-segbtn[data-v="auto"]');
      await tap('[data-gfx="tier"] .ws-gmenu-segbtn[data-v="desktop"]'); assert.equal(await read("s.savedSetting('tier')"), 'desktop', `${kind}: quality saves`);
      await tap('[data-gfx="tier"] .ws-gmenu-segbtn[data-v="auto"]');
      assert.equal(await page.locator('[data-gfx="reload"]').isVisible(), false, `${kind}: nothing pending, no Reload now`);
      // the registry (graphicsControls.ts): a control the Low / High lane registers shows under Effects
      await page.evaluate(() => { const s = /** @type {any} */ (window).__settings; s.registerGraphicsControl({ id: 'proofShadows', section: 'effects', order: 10, build: () => { const b = document.createElement('button'); b.className = 'ws-gmenu-switch'; b.textContent = 'Shadows'; return b; } }); s.menu.close(); s.menu.open('settings'); });
      await open('graphics');
      assert.equal(await page.locator('[data-gfx="proofShadows"]').isVisible(), true, `${kind}: a registered graphics control shows in Graphics`);
      assert.equal(await page.locator('.ws-gmenu-svgroup[data-sv-group="graphics.effects"] [data-gfx="proofShadows"]').count(), 1, `${kind}: under Effects`);
      assert.equal(await page.locator('[data-gfx="reload"]').isVisible(), false, `${kind}: a reopened menu shows no Reload now while nothing is pending`);
      await page.screenshot({ path: join(SHOTS, `${kind}-graphics-registered.png`) });
      // a replacement swaps the row (one row, the new one); its disposer takes it away
      const gone = await page.evaluate(() => {
        const s = /** @type {any} */ (window).__settings;
        const off = s.registerGraphicsControl({ id: 'proofShadows', section: 'effects', order: 10, build: () => { const b = document.createElement('button'); b.className = 'ws-gmenu-switch'; b.textContent = 'Shadows 2'; return b; } });
        const rows = [...document.querySelectorAll('[data-gfx="proofShadows"]')].map(r => r.textContent);
        off(); return { rows, after: document.querySelectorAll('[data-gfx="proofShadows"]').length };
      });
      assert.deepEqual(gone, { rows: ['Shadows 2'], after: 0 }, `${kind}: replace and unregister a graphics control`);

      // SOUND
      await open('sound');
      await slide('[data-setting="volume"] input', 30); assert.equal(await read("s.getNumber('volume')"), 0.3, `${kind}: master volume`);
      await slide('[data-setting="music"] input', 40); assert.equal(await read("s.getNumber('music')"), 0.4, `${kind}: music volume`);
      await tap('[data-setting="musicStyle"] .ws-gmenu-segbtn:last-child');
      const style = await page.$eval('[data-setting="musicStyle"] .ws-gmenu-segbtn:last-child', b => /** @type {HTMLElement} */ (b).dataset['v'] ?? b.textContent?.toLowerCase());
      assert.equal(await read('s.getMusicStyle()'), style, `${kind}: music style`);

      // CONTROLS
      await open('controls');
      await slide('[data-setting="look"] input', 150); assert.equal(await read("s.getNumber('look')"), 1.5, `${kind}: look speed`);
      await tap('[data-setting="lockCam"] .ws-gmenu-segbtn[data-v="0"]'); assert.equal(await read("s.getNumber('lockCam')"), 0, `${kind}: lock-on camera`);
      for (const key of ['autoLock', 'aimAssist']) {
        const before = await read(`s.getSetting('${key}')`);
        await tap(`[data-setting="${key}"]`); assert.equal(await read(`s.getSetting('${key}')`), !before, `${kind}: ${key} toggles`);
      }
      await tap('.ws-gmenu-svgroup[data-sv-group="controls.touch"] .ws-gmenu-segbtn[data-v="on"]'); assert.equal(await read("s.savedSetting('touch')"), 'on', `${kind}: touch controls`);
      await tap('.ws-gmenu-svgroup[data-sv-group="controls.touch"] .ws-gmenu-segbtn[data-v="auto"]');
      // gated rows (E130): the blade's swing speed and the bow's aids show only with that weapon in hand
      assert.equal(await page.locator('[data-setting="swingLook"]').isVisible(), false, `${kind}: no swing speed without a blade`);
      await page.evaluate(() => { const s = /** @type {any} */ (window).__settings; s.held.melee = true; s.held.huntersEye = true; s.held.tracers = true; s.menu.close(); s.menu.open('settings'); });
      await open('controls');
      for (const key of ['swingLook', 'huntersEye', 'tracers']) assert.equal(await page.locator(`[data-setting="${key}"]`).isVisible(), true, `${kind}: ${key} with its weapon`);
      await tap('[data-setting="tracers"]'); assert.equal(await read("s.getSetting('tracers')"), false, `${kind}: tracers toggle`);
      await page.screenshot({ path: join(SHOTS, `${kind}-controls-armed.png`) });

      // SAVES: the game's section first, then the progress file
      await open('saves');
      assert.equal(await page.locator('[data-proof="saveCards"]').isVisible(), true, `${kind}: the game's save cards`);
      assert.ok(await page.locator('.ws-gmenu-svpane[data-sv-pane="saves"] .ws-gmenu-btn').count() >= 2, `${kind}: export and import`);

      // SYSTEM: the connection check, review, Developer mode → the DEV tab
      await open('system');
      assert.ok(await page.locator('.ws-gmenu-svpane[data-sv-pane="system"] .ws-gmenu-input[type="password"]').isVisible(), `${kind}: review`);
      assert.ok((await page.locator('.ws-gmenu-svpane[data-sv-pane="system"]').textContent())?.includes('Check connection'), `${kind}: check connection`);
      await tap('.ws-gmenu-svpane[data-sv-pane="system"] .ws-gmenu-switch[role="switch"]');
      assert.equal(await read('s.isDev()'), true, `${kind}: Developer mode on`);
      await page.waitForTimeout(100);
      assert.deepEqual(await shownTabs(), [...TABS, 'dev'], `${kind}: six tabs in Developer mode`);
      await open('dev');
      assert.equal(await page.locator('.ws-gmenu-svpane[data-sv-pane="dev"] .ws-gmenu-card.fold').first().isVisible(), true, `${kind}: Developer tools and Debug`);
      await page.screenshot({ path: join(SHOTS, `${kind}-dev.png`) });
      await open('system');
      await tap('.ws-gmenu-svpane[data-sv-pane="system"] .ws-gmenu-switch[role="switch"]');
      await page.waitForTimeout(100);
      assert.deepEqual(await shownTabs(), TABS, `${kind}: five tabs again with Developer mode off`);

      // SR13: unlock the review inbox (the inbox's check answered by a stub), then Feedback is a System row, not a tab bar
      await page.route('**/inbox**', route => route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
      await page.locator('.ws-gmenu-svpane[data-sv-pane="system"] .ws-gmenu-input[type="password"]').fill('proof');
      await tap('.ws-gmenu-svpane[data-sv-pane="system"] .ws-gmenu-review .ws-gmenu-unlock');
      await page.waitForFunction(() => /** @type {any} */ (window).__settings.reviewUnlocked() === true);
      await page.waitForTimeout(100);
      assert.equal(await page.locator('.ws-gmenu-tabs').isVisible(), false, `${kind}: no outer SETTINGS · FEEDBACK bar with review unlocked`);
      assert.deepEqual(await shownTabs(), TABS, `${kind}: still the five tabs`);
      await page.screenshot({ path: join(SHOTS, `${kind}-system-feedback-row.png`) });
      await tap('.ws-gmenu-svpane[data-sv-pane="system"] [data-setting="feedback"] button');
      assert.equal(await page.locator('[data-proof="composer"]').isVisible(), true, `${kind}: System ▸ Feedback opens the composer`);
      assert.equal(await read('s.composed()'), 1, `${kind}: the composer mounted once`);
      assert.equal(await page.locator('.ws-gmenu-tabs').isVisible(), false, `${kind}: the composer has no tab bar either`);
      await page.screenshot({ path: join(SHOTS, `${kind}-feedback.png`) });
      await tap('.ws-gmenu-fbback');
      assert.equal(await page.$eval('.ws-gmenu-svtab.active', b => /** @type {HTMLElement} */ (b).dataset['svTab']), 'system', `${kind}: back returns to System`);
      assert.equal(await page.locator('.ws-gmenu-svpane[data-sv-pane="system"]').isVisible(), true, `${kind}: System shows again`);
      await tap('.ws-gmenu-svpane[data-sv-pane="system"] .ws-gmenu-review .ws-gmenu-row:not([data-setting]) .ws-gmenu-unlock'); // LOCK
      await page.evaluate(() => { /** @type {any} */ (window).__settings.menu.close(); });

      // SR11: the title's Settings is the same tabs (BootSettings.ts), without the in-game-only rows
      await page.evaluate(() => { /** @type {any} */ (window).__settings.openBootSettings(); });
      await page.waitForTimeout(200);
      const boot = '.ws-gmenu-boot';
      const bootTabs = () => page.$$eval(`${boot} .ws-gmenu-svtab`, bs => bs.filter(b => !b.hidden).map(b => /** @type {HTMLElement} */ (b).dataset['svTab']));
      assert.deepEqual(await bootTabs(), TABS, `${kind}: the title has the same five tabs`);
      for (const tab of TABS) {
        await page.locator(`${boot} .ws-gmenu-svtab[data-sv-tab="${tab}"]`).click(); await page.waitForTimeout(60);
        const active = await page.$$eval(`${boot} .ws-gmenu-svpane.active`, ps => ps.map(p => /** @type {HTMLElement} */ (p).dataset['svPane']));
        assert.deepEqual(active, [tab], `${kind}: the title's ${tab} opens alone`);
        await page.screenshot({ path: join(SHOTS, `${kind}-title-${tab}.png`) });
      }
      const bootSeen = async (/** @type {string} */ tab) => page.$$eval(`${boot} .ws-gmenu-svpane[data-sv-pane="${tab}"] [data-setting], ${boot} .ws-gmenu-svpane[data-sv-pane="${tab}"] [data-gfx]`,
        els => els.map(e => { const d = /** @type {HTMLElement} */ (e).dataset; return d['gfx'] === undefined ? String(d['setting']) : `gfx:${d['gfx']}`; }));
      for (const key of ['volume', 'music', 'musicStyle']) assert.ok((await bootSeen('sound')).includes(key), `${kind}: the title's Sound has ${key}`);
      for (const key of ['look', 'lockCam', 'autoLock', 'aimAssist']) assert.ok((await bootSeen('controls')).includes(key), `${kind}: the title's Controls has ${key}`);
      assert.ok((await bootSeen('graphics')).includes('gfx:tier'), `${kind}: the title's Graphics has Quality`);
      if (phone) assert.ok((await bootSeen('graphics')).includes('gfx:mode'), `${kind}: the title's Graphics has Low · High`);
      assert.equal(await page.locator(`${boot} .ws-gmenu-review`).count(), 0, `${kind}: no Review on the title`);
      assert.equal(await page.locator(`${boot} [data-proof="saveCards"]`).count(), 0, `${kind}: no shard save cards on the title`);
      assert.equal(await page.locator(`${boot} [data-setting="swingLook"]`).isVisible(), false, `${kind}: no weapon rows on the title`);
      await page.locator(`${boot} .ws-gmenu-close`).click();
      assert.deepEqual(errors, [], `${kind}: no page errors`);
      await context.close();
    }
  } finally {
    await browser.close();
    await new Promise(done => { server.close(() => { done(null); }); });
  }
});
