#!/usr/bin/env node
// E7.2d, E7.9: a phone's browser in the one world, on this Mac. Mobile Safari in the Simulator or Chrome in an Android emulator plays beside a Chromium page, on the
// rig of `online-proof.mjs`, and rides real deploys. It's a proof and not a test (J186): it needs a booted device, and takes minutes.
//   scripts/sim-lane.sh run --max 25 wildshard-loading scripts/browser-lane.sh --max 24 node scripts/online-phone-proof.mjs <app dist> <work dir> <key.json> <pg bin dir> <pg data dir> --device=safari --next=<app dist> [--warm]
//   ANDROID_AVD_HOME=<scratch> scripts/browser-lane.sh --max 40 node scripts/online-phone-proof.mjs <same> --device=android --avd=<name> --next=<app dist> [--gpu=host] [--fair=60]
// `--warm` reloads the phone before the deploy, so the worker owns its document, as on any visit but the first.
import { execFileSync, spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { chromium, devices } from 'playwright';
import * as v from 'valibot';
import { saveFixtureCode } from './debug-settings.mjs';
import { FLOOR_GRID_ENTER } from './frame-floor-navigation.mjs';
import { enterPage, intoWorld, openRig, PAGE_PORT, RELEASE_PORT, WORLD_PORT } from './online-rig.mjs';
import { soakInspector } from './soak/inspector.mjs';

const ProtocolResult = v.looseObject({
  wasThrown: v.optional(v.boolean()),
  result: v.optional(v.looseObject({ description: v.optional(v.string()), value: v.optional(v.unknown()) })),
  exceptionDetails: v.optional(v.looseObject({ exception: v.optional(v.looseObject({ description: v.optional(v.string()) })), text: v.optional(v.string()) })),
});
const Targets = v.array(v.looseObject({ url: v.optional(v.string()), type: v.optional(v.string()), webSocketDebuggerUrl: v.string() }));
const Position = v.object({ x: v.number(), z: v.number() });
const Others = v.array(v.looseObject({ name: v.string(), gait: v.string(), modelled: v.boolean() }));

const [dist = '', work = '', keyFile = '', pgBin = '', pgData = ''] = process.argv.slice(2).filter(value => !value.startsWith('--'));
/** @param {string} name @param {string} fallback */
const flag = (name, fallback) => process.argv.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
const device = flag('device', 'safari'), nextDist = flag('next', ''), warm = process.argv.includes('--warm'), fair = Number(flag('fair', '60')), SHARD = 'driftwood-isle';
const shots = join(work, `shots-${device}`), SDK = process.env.ANDROID_HOME ?? join(homedir(), 'Library/Android/sdk');
mkdirSync(shots, { recursive: true });

const steps = /** @type {{ step: string, ok: boolean, detail?: unknown }[]} */ ([]);
/** @param {string} step @param {unknown} ok @param {unknown} [detail] */
const note = (step, ok, detail) => { steps.push({ step, ok: ok === true, ...detail === undefined ? {} : { detail } }); console.log(`${ok === true ? 'ok  ' : 'FAIL'} ${step}${detail === undefined ? '' : ` ${JSON.stringify(detail).slice(0, 400)}`}`); };

/** `--gl-trace`: every WebGL2 call reads its own error, so the first failing call has a name. It also eats the error, so a page gets past a guard that would stop it: a diagnosis, never a result. */
const GL_TRACE = "(() => { const proto = WebGL2RenderingContext.prototype, read = proto.getError; window.__glErrors = []; for (const name of Object.getOwnPropertyNames(proto)) { const row = Object.getOwnPropertyDescriptor(proto, name); if (typeof row.value !== 'function' || name === 'getError') continue; const real = row.value; proto[name] = function (...args) { const out = real.apply(this, args), error = read.call(this); if (error !== 0 && window.__glErrors.length < 24) window.__glErrors.push({ name, error, args: args.slice(0, 5).map(value => typeof value === 'number' ? value : typeof value) }); return out; }; } })()";
/** What a proof needs of a phone's browser. @typedef {{ open: (url: string) => Promise<void>, evaluate: (expression: string) => Promise<unknown>, gesture: (expression: string) => Promise<unknown>, tap: (selector: string) => Promise<unknown>, shot: (name: string) => Promise<void>, errors: string[], thumb?: (down: boolean) => Promise<void>, close: () => Promise<void> }} Phone */

/** Mobile Safari in a booted Simulator, through its Inspector. The caller holds `sim-lane.sh`. @param {string} udid @param {string} base @returns {Phone} */
function safari(udid, base) {
  const socket = execFileSync('xcrun', ['simctl', 'getenv', udid, 'RWI_LISTEN_SOCKET'], { encoding: 'utf8' }).trim();
  const proxy = spawn('ios_webkit_debug_proxy', ['-s', `unix:${socket}`, '-c', 'null:9221,:9232-9240'], { stdio: 'ignore' });
  const errors = /** @type {string[]} */ ([]);
  /** @type {ReturnType<typeof soakInspector> | null} */
  let page = null;
  const current = () => { if (page === null) throw new Error('No Inspector page'); return page; };
  /** @param {string} prefix */
  const connect = async prefix => {
    page?.close(); page = null;
    const deadline = Date.now() + 90_000;
    while (Date.now() < deadline) {
      for (let port = 9232; port <= 9240; port++) {
        const rows = await fetch(`http://127.0.0.1:${String(port)}/json`, { signal: AbortSignal.timeout(500) }).then(async found => v.parse(Targets, await found.json())).catch(() => []);
        const found = rows.find(row => typeof row.url === 'string' && row.url.startsWith(prefix));
        if (found === undefined) continue;
        try {
          const held = soakInspector(found.webSocketDebuggerUrl);
          await held.opened; await sleep(700);
          held.on('Console.messageAdded', params => { const { message } = v.parse(v.object({ message: v.object({ level: v.string(), text: v.string() }) }), params); if (message.level === 'error') errors.push(message.text.slice(0, 240)); });
          await held.send('Console.enable').catch(() => undefined);
          await held.evaluate('1');
          page = held; return;
        } catch { /* The page moved under the socket. */ }
      }
      await sleep(300);
    }
    throw new Error(`No Inspector page for ${prefix}`);
  };
  /** @param {string} expression @param {boolean} gesture */
  const sent = async (expression, gesture) => {
    if (page === null) await connect(base);
    try {
      const said = v.parse(ProtocolResult, await current().send('Runtime.evaluate', { expression, returnByValue: true, emulateUserGesture: gesture }));
      if (said.wasThrown) throw new Error(said.result?.description ?? 'Safari evaluation threw');
      return said.result?.value;
    } catch (error) { page?.close(); page = null; throw error; }
  };
  return { errors,
    open: async url => {
      try { execFileSync('xcrun', ['simctl', 'terminate', udid, 'com.apple.mobilesafari'], { stdio: 'ignore' }); } catch { /* Not running. */ }
      await sleep(1500);
      execFileSync('xcrun', ['simctl', 'openurl', udid, url]); await connect(url);
    },
    evaluate: expression => sent(expression, false), gesture: expression => sent(expression, true),
    tap: selector => sent(`(() => { document.querySelector(${JSON.stringify(selector)}).click(); return 1; })()`, true),
    shot: name => { execFileSync('xcrun', ['simctl', 'io', udid, 'screenshot', join(shots, `${name}.png`)], { stdio: 'ignore' }); return Promise.resolve(); },
    close: async () => { await sent("location.replace('about:blank'); 1", false).catch(() => undefined); await sleep(500); page?.close(); proxy.kill('SIGTERM'); try { execFileSync('xcrun', ['simctl', 'terminate', udid, 'com.apple.mobilesafari'], { stdio: 'ignore' }); } catch { /* Not running. */ } } };
}

/** Chrome in an Android emulator it boots and stops. Its loopback reaches this Mac's through `adb reverse`, so the stamped addresses hold and the origin stays secure, and its
 * outside network is off, so nothing but our page reaches it. Playwright's `connectOverCDP` hangs on a phone's Chrome, so this speaks to the page's own DevTools socket. @param {string} avd @param {string} base @returns {Promise<Phone>} */
async function android(avd, base) {
  const port = 5580, serial = `emulator-${String(port)}`, tool = join(SDK, 'platform-tools/adb');
  /** @param {...string} args */
  const adb = (...args) => execFileSync(tool, ['-s', serial, ...args], { encoding: 'utf8', timeout: 60_000 }).trim();
  const emulator = spawn(join(SDK, 'emulator/emulator'), ['-avd', avd, '-port', String(port), '-no-window', '-no-audio', '-no-boot-anim', '-no-snapshot', '-gpu', flag('gpu', 'host')], { stdio: 'ignore' });
  const booting = Date.now() + 180_000;
  while (Date.now() < booting) {
    try { if (adb('shell', 'getprop', 'sys.boot_completed') === '1') break; } catch { /* Not up yet. */ }
    await sleep(2000);
  }
  adb('root'); await sleep(3000); execFileSync(tool, ['-s', serial, 'wait-for-device'], { timeout: 30_000 });
  adb('shell', 'svc wifi disable; svc data disable; settings put global stay_on_while_plugged_in 3; svc power stayon true; wm dismiss-keyguard');
  adb('shell', 'echo "chrome --disable-fre --no-default-browser-check --no-first-run --ignore-gpu-blocklist --mute-audio" > /data/local/tmp/chrome-command-line; chmod 644 /data/local/tmp/chrome-command-line; am set-debug-app --persistent com.android.chrome; pm grant com.android.chrome android.permission.POST_NOTIFICATIONS');
  for (const each of [PAGE_PORT, RELEASE_PORT, WORLD_PORT]) adb('reverse', `tcp:${String(each)}`, `tcp:${String(each)}`);
  adb('shell', `am start -a android.intent.action.VIEW -n com.android.chrome/com.google.android.apps.chrome.Main -d ${base}/version.json`);
  await sleep(5000);
  adb('forward', 'tcp:9333', 'localabstract:chrome_devtools_remote');
  const errors = /** @type {string[]} */ ([]);
  /** @type {ReturnType<typeof soakInspector> | null} */
  let page = null;
  const current = () => { if (page === null) throw new Error('No Inspector page'); return page; };
  const connect = async () => {
    page?.close(); page = null;
    const deadline = Date.now() + 60_000;
    while (Date.now() < deadline) {
      const rows = await fetch('http://127.0.0.1:9333/json', { signal: AbortSignal.timeout(2000) }).then(async found => v.parse(Targets, await found.json())).catch(() => []), tab = rows.find(row => row.type === 'page');
      if (tab !== undefined) {
        const held = soakInspector(tab.webSocketDebuggerUrl);
        await held.opened;
        held.on('Runtime.exceptionThrown', params => { const { exceptionDetails } = v.parse(v.object({ exceptionDetails: v.object({ exception: v.optional(v.object({ description: v.optional(v.string()) })), text: v.string() }) }), params); errors.push((exceptionDetails.exception?.description ?? exceptionDetails.text).slice(0, 240)); });
        held.on('Log.entryAdded', params => { const { entry } = v.parse(v.object({ entry: v.object({ level: v.string(), text: v.string() }) }), params); if (entry.level === 'error') errors.push(entry.text.slice(0, 240)); });
        await held.send('Runtime.enable'); await held.send('Log.enable'); await held.send('Page.enable');
        if (process.argv.includes('--gl-trace')) await held.send('Page.addScriptToEvaluateOnNewDocument', { source: GL_TRACE });
        page = held; return;
      }
      await sleep(500);
    }
    throw new Error('No Chrome page');
  };
  /** @param {string} expression */
  const sent = async expression => {
    if (page === null) await connect();
    try {
      const said = v.parse(ProtocolResult, await current().send('Runtime.evaluate', { expression, returnByValue: true, userGesture: true }));
      if (said.exceptionDetails !== undefined) throw new Error(String(said.exceptionDetails.exception?.description ?? said.exceptionDetails.text));
      return said.result?.value;
    } catch (error) { if (/Inspector closed/u.test(String(error))) page = null; throw error; }
  };
  return { errors,
    open: async url => { if (page === null) await connect(); await current().send('Page.navigate', { url }); await sleep(1500); },
    evaluate: sent, gesture: sent,
    tap: async selector => {
      const at = v.parse(v.object({ x: v.number(), y: v.number() }), await sent(`(() => { const box = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect(); return { x: box.x + box.width / 2, y: box.y + box.height / 2 }; })()`));
      await current().send('Input.synthesizeTapGesture', { x: at.x, y: at.y, tapCount: 1 });
    },
    /** A thumb on the move stick, up to walk: trusted touches, the way Matt's arrive. @param {boolean} down */
    thumb: async down => {
      if (!down) { await current().send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }); return; }
      const at = v.parse(v.object({ x: v.number(), y: v.number(), reach: v.number() }), await sent("(() => { const box = document.querySelector('.ws-touch-stick').getBoundingClientRect(); return { x: box.x + box.width / 2, y: box.y + box.height / 2, reach: box.height / 2 }; })()"));
      await current().send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: at.x, y: at.y }] });
      await current().send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: at.x, y: at.y - at.reach * 0.6 }] });
    },
    shot: name => { writeFileSync(join(shots, `${name}.png`), execFileSync(tool, ['-s', serial, 'exec-out', 'screencap', '-p'], { maxBuffer: 64 << 20, timeout: 60_000 })); return Promise.resolve(); },
    close: async () => { page?.close(); try { writeFileSync(join(shots, 'logcat.txt'), execFileSync(tool, ['-s', serial, 'logcat', '-d', '-t', '4000'], { encoding: 'utf8', maxBuffer: 64 << 20, timeout: 60_000 })); } catch { /* A dead emulator has no log. */ } try { adb('emu', 'kill'); } catch { emulator.kill('SIGTERM'); } await sleep(2000); } };
}

/** @param {Phone} phone @param {string} expression @param {number} ms @param {string} [what] */
const until = async (phone, expression, ms, what = expression) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    try { if (await phone.evaluate(expression)) return; } catch { /* The page moved. */ }
    await sleep(250);
  }
  throw new Error(`Timed out: ${what.slice(0, 160)}`);
};
const INSIDE = "typeof window.__workerClient === 'function' && window.__wildshard?.world?.player !== undefined";
const SAID = `(async () => { window.__said = null; const found = await navigator.serviceWorker?.getRegistration(), state = worker => worker?.state ?? null;
  window.__said = { build: globalThis.__WS_BUILD_ID__, navigation: performance.getEntriesByType('navigation')[0]?.type, shown: document.body.innerText.slice(0, 200), modal: document.querySelector('#wserr')?.innerText?.slice(0, 200) ?? null, loadError: document.querySelector('.ws-load-error')?.innerText?.slice(0, 700) ?? null, glErrors: window.__glErrors?.slice(0, 24) ?? null, controller: navigator.serviceWorker?.controller?.state ?? null, installing: state(found?.installing), waiting: state(found?.waiting), active: state(found?.active) }; })(); 1`;
/** @param {Phone} phone */
const said = async phone => { try { await phone.evaluate(SAID); await sleep(600); return await phone.evaluate('window.__said'); } catch (error) { return String(error).slice(0, 200); } };
const RESET = `(async () => { window.__clean = null; const workers = await navigator.serviceWorker.getRegistrations(); for (const found of workers) await found.unregister(); for (const name of await caches.keys()) await caches.delete(name); localStorage.clear(); sessionStorage.clear(); ${saveFixtureCode({ scope: 'device', key: 'devMode', data: true })}; window.__clean = workers.length; })(); 1`;
const FPS_START = '(() => { const frames = { gaps: [], last: performance.now(), stop: false }; window.__frames = frames; const step = at => { frames.gaps.push(at - frames.last); frames.last = at; if (!frames.stop) requestAnimationFrame(step); }; requestAnimationFrame(step); return 1; })()';
const FPS_READ = "(() => { const frames = window.__frames; frames.stop = true; const gaps = frames.gaps.slice(1), whole = gaps.reduce((sum, gap) => sum + gap, 0), sorted = [...gaps].sort((a, b) => a - b), at = share => Math.round(sorted[Math.floor(sorted.length * share)] ?? 0); return { frames: gaps.length, seconds: Math.round(whole / 100) / 10, fps: Math.round(gaps.length / whole * 10_000) / 10, p50: at(0.5), p95: at(0.95), p99: at(0.99), worst: Math.round(sorted.at(-1) ?? 0), over34: gaps.filter(gap => gap > 34).length, hidden: document.hidden }; })()";
const GPU = "(() => { const gl = document.createElement('canvas').getContext('webgl2'); if (gl === null) return null; const debug = gl.getExtension('WEBGL_debug_renderer_info'); return { renderer: debug === null ? gl.getParameter(gl.RENDERER) : gl.getParameter(debug.UNMASKED_RENDERER_WEBGL), vendor: debug === null ? gl.getParameter(gl.VENDOR) : gl.getParameter(debug.UNMASKED_VENDOR_WEBGL), astc: gl.getExtension('WEBGL_compressed_texture_astc') !== null, etc: gl.getExtension('WEBGL_compressed_texture_etc') !== null, s3tc: gl.getExtension('WEBGL_compressed_texture_s3tc') !== null, memory: navigator.deviceMemory ?? null, cores: navigator.hardwareConcurrency, online: navigator.onLine, agent: navigator.userAgent }; })()";
/** What the game's canvas holds over a dozen frames, since a capped game skips some and a skipped frame reads empty: a black world at 30 fps must not pass for a world. */
const CANVAS = "(async () => { window.__canvas = null; const canvas = document.querySelector('canvas#game'), gl = canvas.getContext('webgl2'), read = (u, v) => { const pixel = new Uint8Array(4); gl.readPixels(Math.floor(canvas.width * u), Math.floor(canvas.height * v), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel); return [...pixel]; }; let pixels = []; for (let frame = 0; frame < 12 && !pixels.some(([red, green, blue]) => red + green + blue > 30); frame++) { await new Promise(next => { requestAnimationFrame(next); }); pixels = [[0.5, 0.5], [0.25, 0.75], [0.75, 0.25], [0.5, 0.9], [0.5, 0.1]].map(([u, v]) => read(u, v)); } window.__canvas = { size: [canvas.width, canvas.height], antialias: gl.getContextAttributes().antialias, onScreen: gl.getParameter(gl.FRAMEBUFFER_BINDING) === null, pixels, error: gl.getError(), floatTarget: gl.getExtension('EXT_color_buffer_float') !== null, floatBlend: gl.getExtension('EXT_float_blend') !== null, halfFloatTarget: gl.getExtension('EXT_color_buffer_half_float') !== null, floatLinear: gl.getExtension('OES_texture_float_linear') !== null }; })(); 1";
/** The page's own WebCrypto, on a key that isn't the build's: the same call `readSignedRelease` makes, with a tampered file refused. */
const CRYPTO = `(async () => { window.__crypto = null; try { const pair = await crypto.subtle.generateKey('Ed25519', true, ['sign', 'verify']), bytes = new TextEncoder().encode('release'), signature = await crypto.subtle.sign('Ed25519', pair.privateKey, bytes), good = await crypto.subtle.verify('Ed25519', pair.publicKey, signature, bytes), bad = await crypto.subtle.verify('Ed25519', pair.publicKey, signature, new TextEncoder().encode('tampered')); window.__crypto = { secure: isSecureContext, good, bad }; } catch (error) { window.__crypto = { secure: isSecureContext, error: String(error) }; } })(); 1`;

const rig = await openRig({ dist, nextDist, work, keyFile, pgBin, pgData, shard: SHARD }), { build, nextBuild, base } = rig, url = `${base}/?chunk=${SHARD}&mute=1&nolock=1&skipintro=1`;
const phone = device === 'safari' ? safari(process.env.SIM_UDID ?? '', base) : await android(flag('avd', 'e7_phones'), base);
const launched = await chromium.launch({ headless: true, args: ['--mute-audio', '--use-angle=metal', '--ignore-gpu-blocklist'] });
const { defaultBrowserType: _engine, ...desk } = devices['iPhone 16 Pro'];
let code = 1;

/** The phone's side of a join, from a bare page to play. @param {string} name */
const join_ = async name => {
  await phone.open(`${base}/version.json`);
  await phone.evaluate(RESET); await until(phone, 'window.__clean !== null', 30_000, 'the wipe');
  note('the phone starts with nothing held', true, { workers: await phone.evaluate('window.__clean') });
  await phone.evaluate(`location.replace(${JSON.stringify(url)}); 1`).catch(() => undefined);
  await until(phone, "document.querySelector('#ws-name-box input') !== null", 180_000, 'the Name box');
  await phone.evaluate(CRYPTO); await until(phone, 'window.__crypto !== null', 10_000, 'WebCrypto');
  const verified = v.parse(v.looseObject({ good: v.optional(v.boolean()), bad: v.optional(v.boolean()) }), await phone.evaluate('window.__crypto'));
  note('WebCrypto Ed25519 signs, verifies, and refuses a tampered file', verified.good === true && verified.bad === false, verified);
  note('the signed release file passed: the Name box comes after it', true);
  await phone.gesture(`(() => { const field = document.querySelector('#ws-name-box input'); field.value = ${JSON.stringify(name)}; document.querySelector('#ws-name-box').requestSubmit(); return 1; })()`);
  await until(phone, INSIDE, 180_000, 'the world');
  await phone.evaluate(FLOOR_GRID_ENTER);
  await until(phone, 'window.__workerClient().frames > 30', 90_000, 'thirty frames');
};
/** @param {() => Promise<readonly {name: string, gait: string, modelled: boolean}[]>} read @param {(rows: readonly {name: string, gait: string, modelled: boolean}[]) => boolean} seen @param {string} step */
const seeing = async (read, seen, step) => { for (let tries = 0; tries < 80; tries++) { const rows = await read(); if (seen(rows)) { note(step, true, rows); return rows; } await sleep(250); } note(step, false, await read()); return []; };
const others = async () => v.parse(Others, await phone.evaluate('window.__onlinePlayers?.() ?? []'));
/** A deploy under the phone. `pagesLate`: the server moves first, and the page's origin still serves the old build. */
/** @param {number} serial @param {string} target */
const countdown = async (serial, target) => {
  rig.publish(serial, target);
  await until(phone, "document.querySelector('#ws-countdown-strip')?.textContent?.startsWith('Updating in') === true", 20_000, 'the countdown');
  await phone.shot(`countdown-${String(serial)}`);
  note(`deploy ${String(serial)}: the countdown shows, and play goes on`, await phone.evaluate('window.__workerClient().closed === null'));
};
/** @param {string} target */
const landed = async target => {
  await until(phone, `globalThis.__WS_BUILD_ID__ === '${target}' && ${INSIDE}`, 120_000, `the page on ${target}`);
  await phone.evaluate(FLOOR_GRID_ENTER);
  await until(phone, 'window.__workerClient().own !== null && window.__workerClient().frames > 30', 90_000, 'a seat on the new build');
};

try {
  note('a phone is here', true, await phone.evaluate('1').catch(() => 'no page yet'));
  await join_('Jake');
  note('the phone holds a seat', true, await phone.evaluate('({ own: window.__workerClient().own, build: globalThis.__WS_BUILD_ID__ })'));
  note('the phone\'s GPU', true, await phone.evaluate(GPU));
  await phone.shot('1-in-the-world');
  const { page, context, errors: deskErrors } = await enterPage(launched, desk, url, 'Matt');
  await intoWorld(page);
  await seeing(others, rows => rows.some(row => row.name === 'Matt' && row.modelled), 'the phone sees Matt\'s body and Name');
  await seeing(() => page.evaluate(() => window.__onlinePlayers?.() ?? []), rows => rows.some(row => row.name === 'Jake' && row.modelled), 'Matt sees the phone\'s body and Name');
  await page.keyboard.down('KeyW');
  await seeing(others, rows => rows.some(row => row.name === 'Matt' && row.gait !== 'idle'), 'Matt walks, and the phone sees the gait');
  await phone.shot('2-sees-matt-walk');
  await page.keyboard.up('KeyW');
  await phone.gesture("(() => { document.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyW', key: 'w', bubbles: true })); return 1; })()");
  await seeing(() => page.evaluate(() => window.__onlinePlayers?.() ?? []), rows => rows.some(row => row.name === 'Jake' && row.gait !== 'idle'), 'the phone walks, and Matt sees the gait');
  await phone.gesture("(() => { document.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyW', key: 'w', bubbles: true })); return 1; })()");
  if (phone.thumb !== undefined) {
    await seeing(() => page.evaluate(() => window.__onlinePlayers?.() ?? []), rows => rows.some(row => row.name === 'Jake' && row.gait === 'idle'), 'the phone stands');
    await phone.thumb(true);
    await seeing(() => page.evaluate(() => window.__onlinePlayers?.() ?? []), rows => rows.some(row => row.name === 'Jake' && row.gait !== 'idle'), 'a thumb on the stick walks, and Matt sees the gait');
    await phone.shot('2b-the-thumb-walks');
    await phone.thumb(false);
  }
  await page.locator('#ws-chat input').fill('hello from the desk');
  await page.locator('#ws-chat input').press('Enter');
  await until(phone, "document.querySelector('#ws-chat')?.textContent?.includes('Matt: hello from the desk') === true", 10_000, 'the chat line');
  note('the phone sees the line', true);
  await phone.evaluate(FPS_START);
  await page.keyboard.down('KeyW');
  await sleep(fair * 1000);
  await page.keyboard.up('KeyW');
  note(`the frame rate over ${String(fair)} s, Matt in view and walking`, true, await phone.evaluate(FPS_READ));
  await phone.evaluate(CANVAS);
  await until(phone, 'window.__canvas !== null', 15_000, 'the canvas read');
  const drawn = v.parse(v.looseObject({ pixels: v.array(v.tuple([v.number(), v.number(), v.number(), v.number()])) }), await phone.evaluate('window.__canvas'));
  note('the canvas holds a world', drawn.pixels.some(([red, green, blue]) => red + green + blue > 30), drawn);
  await phone.shot('3-after-the-reading');
  if (warm) {
    await phone.evaluate('location.reload(); 1').catch(() => undefined);
    await until(phone, `${INSIDE} && navigator.serviceWorker.controller !== null`, 180_000, 'a controlled page');
    await phone.evaluate(FLOOR_GRID_ENTER);
    await until(phone, 'window.__workerClient().frames > 30', 90_000, 'thirty frames, warm');
    note('warm: the worker owns the document', true, await said(phone));
  }
  if (nextBuild !== '') {
    const at = v.parse(Position, await phone.evaluate('({ x: window.__workerClient().serverX, z: window.__workerClient().serverZ })'));
    await countdown(2, nextBuild);
    await rig.pagesServe(nextDist);
    await rig.drained();
    rig.start(nextBuild);
    let stuck = null;
    await landed(nextBuild).catch(async (/** @type {unknown} */ error) => { stuck = await said(phone); note('the stale tab did not reload itself', false, { error: String(error).slice(0, 160), stuck, errors: phone.errors.slice(-6) }); await phone.shot('stuck'); });
    if (stuck === null) {
      note('the stale tab reloaded itself into the server\'s build', true, await said(phone));
      const back = v.parse(Position, await phone.evaluate('({ x: window.__workerClient().serverX, z: window.__workerClient().serverZ })'));
      note('the phone landed where it stood', Math.hypot(back.x - at.x, back.z - at.z) < 2, { at, back });
      note('the Name stayed with the device', await phone.evaluate("document.querySelector('#ws-name-box') === null"));
      await phone.shot('4-after-the-deploy');
    }
    // The server moves and the page's origin is late, so `version.json` still says this build: the page can't reload into anything, and says so.
    await context.close();
    const before = stuck === null ? nextBuild : build, target = stuck === null ? build : nextBuild;
    const late = (/** @type {number} */ serial) => `the panel, deploy ${String(serial)}`, PANEL = "document.querySelector('#ws-new-build button') !== null";
    await countdown(3, target);
    await rig.drained();
    rig.start(target);
    await until(phone, PANEL, 40_000, late(3));
    note('with the origin late, the page says a new build is out, and no modal', await phone.evaluate("document.querySelector('#wserr') === null"), await said(phone));
    await phone.shot('5-the-new-build-panel');
    await phone.tap('#ws-new-build button');
    await sleep(3000);
    await until(phone, `${PANEL} && globalThis.__WS_BUILD_ID__ === '${before}'`, 120_000, 'the panel after a tap with the origin late');
    note('a tap with the origin still late comes back to the panel, off the worker', await phone.evaluate("performance.getEntriesByType('navigation')[0]?.type === 'reload' && navigator.serviceWorker.controller === null"), await said(phone));
    await rig.pagesServe(stuck === null ? dist : nextDist);
    await landed(target);
    note('the origin catches up, and the tab lands by itself', true, await said(phone));
    await phone.shot('6-landed-by-itself');
    await countdown(4, before);
    await rig.drained();
    rig.start(before);
    await until(phone, PANEL, 40_000, late(4));
    await rig.pagesServe(stuck === null ? nextDist : dist);
    // A tab session outlives the reload, so this shows the button did it, and not the panel's own retry beating the tap.
    await phone.evaluate("document.querySelector('#ws-new-build button').addEventListener('click', () => { sessionStorage.setItem('proof.tapped', '1'); }); 1");
    await phone.tap('#ws-new-build button');
    await landed(before);
    note('the Reload button lands on the new build', await phone.evaluate("sessionStorage.getItem('proof.tapped') === '1'"), await said(phone));
    await phone.shot('7-after-the-reload-button');
  }
  /** @param {string} line */
  const quiet = line => !/WebSocket connection|WebSocket is already|ERR_CONNECTION|Failed to load resource|Could not connect/u.test(line), faults = [...phone.errors, ...deskErrors].filter(quiet);
  note('no page error', faults.length === 0, faults.slice(0, 6));
  code = steps.every(row => row.ok) ? 0 : 1;
} catch (error) {
  note('the proof stopped', false, { error: String(error).slice(0, 400), said: await said(phone), errors: phone.errors.slice(-8) });
  await phone.shot('stopped').catch(() => undefined);
} finally {
  writeFileSync(join(work, `report-${device}.json`), JSON.stringify(steps, null, 1));
  await launched.close();
  await phone.close();
  await rig.close();
}
console.log(code === 0 ? 'PASS' : 'FAIL');
process.exit(code);
