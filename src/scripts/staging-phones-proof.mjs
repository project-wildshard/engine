#!/usr/bin/env node
// TEST-COVERAGE row 46, XR-7 to XR-9 (meta docs/plans/test-coverage/END-TO-END.md): a phone without a phone, on `staging`.
//   XR-7: Mobile Safari in an iOS Simulator goes title to play on staging.wildshard.io and walks on a real touch (idb's HID touch).
//   XR-8: Chrome in an Android emulator does the same (adb's touchscreen input).
//   XR-9: the two, each on its own hosted runner, meet in one Driftwood room and each draws the other (`modelled`), and each
//         reads the other's chat line saying so. The chat line is the only channel between the two jobs.
// A proof against the live staging page, not a test (J186): it needs a booted device and minutes. J205: staging only, never an
// agent socket on production. STAGING-QA SQ14 retired the hosted nightly (phones.yml): the MacBook runs Safari every deploy.
//   SIM_UDID=<booted> node src/scripts/staging-phones-proof.mjs --device=safari --tag=<run> --out=<dir> [--peer-wait=<min>] [--solo]
//   ANDROID_SERIAL=<booted> node src/scripts/staging-phones-proof.mjs --device=android --tag=<run> --out=<dir> [...]
// Safari needs `ios_webkit_debug_proxy` and `idb` (with idb_companion) on PATH; Android needs `adb` (ANDROID_HOME). `--solo` skips XR-9.
// Meta STAGING-QA SQ14 (J426: the Simulator runs every deploy; J428: only the obvious, stable checks): `staging-qa.mjs` runs
// `--device=safari --solo` on the MacBook, against staging or (`--base=http://127.0.0.1:<port>`) the local rig, and
// `--build=<sha>` names the exact build. The checks: the title, play on that build, a drawn canvas, a real touch that walks the
// body. Page errors are listed, not failed. Why 25 of 30 hosted runs failed (2026-11-17/18): the hosted macOS and Linux
// runners have no GPU, so the title took 16 min, `simctl io screenshot` timed out, or Safari or Chrome never opened a page
// in 90 s; no failure was the game's.
import { agentFetch as fetch } from './agent-requests.mjs';
import { agentUrl } from './agent-marker.mjs';
import { execFileSync, spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import * as v from 'valibot';
import { saveFixtureCode } from './debug-settings.mjs';
import { decodeProtocolPng } from './parity/fast-png.mjs';
import { soakInspector } from './soak/inspector.mjs';
import { ownSimulatorHid } from './staging-qa-idb.mjs';
import { chatLinePattern, playerNameSource, roomsHealthURL, splitRoomsHealthLines } from './staging-proof-lines.mjs';
import { SAVE_PREFIX, tapDocument } from './zone-entry.mjs';

const STAGING = 'https://staging.wildshard.io', RELEASE = 'https://packs.wildshard.io/releases/staging.json', SHARD = 'driftwood-isle';
const SOCKETS = new Set(['wss://rooms-staging.wildshard.io', 'wss://wildshard.tailb41b20.ts.net:8443']);
/** @param {string} name @param {string} fallback */
const flag = (name, fallback) => process.argv.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
const device = flag('device', ''), tag = flag('tag', Date.now().toString(36).slice(-6)), out = flag('out', 'tmp/staging-phones'), solo = process.argv.includes('--solo');
const peerWait = Number(flag('peer-wait', '15')) * 60_000;
const BASE = flag('base', STAGING).replace(/\/$/u, ''), expectBuild = flag('build', ''), loopback = /^http:\/\/(127\.0\.0\.1|localhost):\d+$/u.test(BASE);
if (BASE !== STAGING && !loopback) throw new Error('--base is staging or a loopback rig (J205: never production)');
if (expectBuild !== '' && !/^[0-9a-f]{40}$/u.test(expectBuild)) throw new Error('--build is a 40-character SHA');
if (device !== 'safari' && device !== 'android') throw new Error('usage: staging-phones-proof.mjs --device=safari|android --tag=<run> --out=<dir>');
if (!/^[a-z0-9]{1,10}$/u.test(tag)) throw new Error('--tag is 1 to 10 lowercase letters or digits');
const row = device === 'safari' ? 'XR-7' : 'XR-8', me = `XR ${device === 'safari' ? 'iOS' : 'Android'} ${tag}`, peer = `XR ${device === 'safari' ? 'Android' : 'iOS'} ${tag}`;
const shots = join(out, `shots-${device}`);
mkdirSync(shots, { recursive: true });

/** @type {{ item: string, step: string, ok: boolean, detail?: unknown }[]} */
const steps = [];
/** @param {string} item @param {string} step @param {unknown} ok @param {unknown} [detail] */
const note = (item, step, ok, detail) => { steps.push({ item, step, ok: ok === true, ...detail === undefined ? {} : { detail } }); console.log(`${ok === true ? 'ok  ' : 'FAIL'} ${item} ${step}${detail === undefined ? '' : ` ${JSON.stringify(detail).slice(0, 600)}`}`); };

const ProtocolResult = v.looseObject({
  wasThrown: v.optional(v.boolean()),
  result: v.optional(v.looseObject({ description: v.optional(v.string()), value: v.optional(v.unknown()) })),
  exceptionDetails: v.optional(v.looseObject({ exception: v.optional(v.looseObject({ description: v.optional(v.string()) })), text: v.optional(v.string()) })),
});
const Targets = v.array(v.looseObject({ url: v.optional(v.string()), type: v.optional(v.string()), webSocketDebuggerUrl: v.string() }));
const Point = v.object({ x: v.number(), y: v.number() });
const Others = v.array(v.looseObject({ name: v.string(), gait: v.string(), modelled: v.boolean() }));
const Spot = v.object({ x: v.number(), z: v.number() });

/** What the proof needs of a phone's browser. `swipe` is a real OS touch from one screen point to another (the device's own
 *  units: points on iOS, pixels on Android) over `ms`; `tap` the same, held still. `scale` turns a CSS pixel into that unit.
 * @typedef {{ open: (url: string) => Promise<void>, evaluate: (expression: string) => Promise<unknown>, swipe: (from: {x: number, y: number}, to: {x: number, y: number}, ms: number) => Promise<void>, tap: (at: {x: number, y: number}) => Promise<void>, scale: () => Promise<number>, shot: (name: string) => Promise<void>, errors: {text: string, url?: string}[], close: () => Promise<void> }} Phone */

/** A page's own Inspector socket, re-found when the page moves under it. @param {() => Promise<string>} find @param {'webkit' | 'chromium'} kind */
function inspector(find, kind) {
  const errors = /** @type {{text: string, url?: string}[]} */ ([]);
  /** @type {ReturnType<typeof soakInspector> | null} */
  let page = null;
  const connect = async () => {
    page?.close(); page = null;
    const held = soakInspector(await find());
    await held.opened;
    if (kind === 'webkit') {
      await sleep(700);
      held.on('Console.messageAdded', params => { const { message } = v.parse(v.object({ message: v.looseObject({ level: v.string(), text: v.string(), url: v.optional(v.string()) }) }), params); if (message.level === 'error') errors.push({ text: message.text.slice(0, 400), ...message.url === undefined || message.url === '' ? {} : { url: message.url } }); });
      await held.send('Console.enable').catch(() => undefined);
    } else {
      held.on('Runtime.exceptionThrown', params => { const { exceptionDetails } = v.parse(v.object({ exceptionDetails: v.looseObject({ exception: v.optional(v.looseObject({ description: v.optional(v.string()) })), text: v.string() }) }), params); errors.push({ text: (exceptionDetails.exception?.description ?? exceptionDetails.text).slice(0, 400) }); });
      held.on('Log.entryAdded', params => { const { entry } = v.parse(v.object({ entry: v.looseObject({ level: v.string(), text: v.string(), url: v.optional(v.string()) }) }), params); if (entry.level === 'error') errors.push({ text: entry.text.slice(0, 400), ...entry.url === undefined ? {} : { url: entry.url } }); });
      await held.send('Runtime.enable'); await held.send('Log.enable'); await held.send('Page.enable');
    }
    page = held;
    return held;
  };
  /** @param {string} expression */
  const evaluate = async expression => {
    const held = page ?? await connect();
    try {
      const said = v.parse(ProtocolResult, await held.send('Runtime.evaluate', { expression, returnByValue: true, ...kind === 'webkit' ? { emulateUserGesture: true } : { userGesture: true } }));
      if (said.wasThrown === true) throw new Error(said.result?.description ?? 'evaluation threw');
      if (said.exceptionDetails !== undefined) throw new Error(String(said.exceptionDetails.exception?.description ?? said.exceptionDetails.text));
      return said.result?.value;
    } catch (error) { if (/Inspector closed|timeout/u.test(String(error))) { page?.close(); page = null; } throw error; }
  };
  /** @param {string} method @param {Record<string, unknown>} [params] */
  const send = async (method, params) => (page ?? await connect()).send(method, params);
  return { errors, evaluate, send, connect, close: () => { page?.close(); page = null; } };
}

/** Mobile Safari in a booted Simulator, through its Web Inspector socket (ios_webkit_debug_proxy) and idb's HID touches. @param {string} udid @returns {Phone} */
function safari(udid) {
  const socket = execFileSync('xcrun', ['simctl', 'getenv', udid, 'RWI_LISTEN_SOCKET'], { encoding: 'utf8' }).trim();
  const proxy = spawn('ios_webkit_debug_proxy', ['-s', `unix:${socket}`, '-c', 'null:9221,:9232-9240'], { stdio: 'ignore' });
  const find = async () => {
    const deadline = Date.now() + 90_000;
    while (Date.now() < deadline) {
      for (let port = 9232; port <= 9240; port++) {
        const rows = await fetch(`http://127.0.0.1:${String(port)}/json`, { signal: AbortSignal.timeout(800) }).then(async found => v.parse(Targets, await found.json())).catch(() => []);
        const found = rows.find(each => each.url?.startsWith(BASE) === true);
        if (found !== undefined) return found.webSocketDebuggerUrl;
      }
      await sleep(400);
    }
    throw new Error(`No Safari page on ${BASE}`);
  };
  const page = inspector(find, 'webkit');
  const hid = ownSimulatorHid(udid);
  const r = (/** @type {number} */ value) => String(Math.round(value));
  return { errors: page.errors, evaluate: page.evaluate,
    open: async url => {
      try { execFileSync('xcrun', ['simctl', 'terminate', udid, 'com.apple.mobilesafari'], { stdio: 'ignore' }); } catch { /* Not running. */ }
      await sleep(1500);
      execFileSync('xcrun', ['simctl', 'openurl', udid, url]);
      await page.connect();
    },
    swipe: async (from, to, ms) => { await hid.tapOrSwipe(['swipe', r(from.x), r(from.y), r(to.x), r(to.y), '--duration', String(ms / 1000), '--delta', '3']); },
    tap: async at => { await hid.tapOrSwipe(['tap', r(at.x), r(at.y)]); },
    scale: () => Promise.resolve(1),
    shot: async name => { execFileSync('xcrun', ['simctl', 'io', udid, 'screenshot', join(shots, `${name}.png`)], { stdio: 'ignore', timeout: 60_000 }); await Promise.resolve(); },
    close: async () => { page.close(); proxy.kill('SIGTERM'); await hid.close(); await sleep(200); } };
}

/** Chrome in a booted Android emulator, through its DevTools socket and the touchscreen of `adb shell input`. @param {string} serial @returns {Phone} */
function android(serial) {
  const tool = join(process.env.ANDROID_HOME ?? '', 'platform-tools/adb');
  /** @param {...string} args */
  const adb = (...args) => execFileSync(tool, ['-s', serial, ...args], { encoding: 'utf8', timeout: 90_000 }).trim();
  adb('shell', 'settings put global stay_on_while_plugged_in 3; svc power stayon true; wm dismiss-keyguard; input keyevent KEYCODE_WAKEUP');
  adb('shell', 'echo "chrome --disable-fre --no-default-browser-check --no-first-run --ignore-gpu-blocklist --mute-audio" > /data/local/tmp/chrome-command-line; chmod 644 /data/local/tmp/chrome-command-line; am set-debug-app --persistent com.android.chrome');
  try { adb('shell', 'pm grant com.android.chrome android.permission.POST_NOTIFICATIONS'); } catch { /* An older Android has no such permission. */ }
  adb('forward', 'tcp:9333', 'localabstract:chrome_devtools_remote');
  const find = async () => {
    const deadline = Date.now() + 90_000;
    while (Date.now() < deadline) {
      const rows = await fetch('http://127.0.0.1:9333/json', { signal: AbortSignal.timeout(2000) }).then(async found => v.parse(Targets, await found.json())).catch(() => []), tab = rows.find(each => each.type === 'page');
      if (tab !== undefined) return tab.webSocketDebuggerUrl;
      await sleep(500);
    }
    throw new Error('No Chrome page');
  };
  const page = inspector(find, 'chromium');
  const r = (/** @type {number} */ value) => String(Math.round(value));
  return { errors: page.errors, evaluate: page.evaluate,
    open: async url => {
      adb('shell', `am start -a android.intent.action.VIEW -n com.android.chrome/com.google.android.apps.chrome.Main -d '${url}'`);
      await sleep(4000);
      const held = await page.connect();
      await held.send('Page.navigate', { url }); await sleep(1500);
    },
    // Not `input swipe`: it slides the finger over `ms`, and Chrome hands the page one coalesced move per frame, so on the
    // emulator's software GPU (1 to 2 fps) the stick read 0.08 (local API 37, 2026-11-16). The thumb goes down, moves to
    // the end in five steps, holds there for `ms`, then lifts.
    swipe: async (from, to, ms) => {
      const moves = [1, 2, 3, 4, 5].map(step => `input touchscreen motionevent MOVE ${r(from.x + (to.x - from.x) * step / 5)} ${r(from.y + (to.y - from.y) * step / 5)}`);
      adb('shell', [`input touchscreen motionevent DOWN ${r(from.x)} ${r(from.y)}`, ...moves, `sleep ${String(ms / 1000)}`, `input touchscreen motionevent UP ${r(to.x)} ${r(to.y)}`].join('; '));
      await Promise.resolve();
    },
    tap: async at => { adb('shell', 'input', 'touchscreen', 'tap', r(at.x), r(at.y)); await Promise.resolve(); },
    scale: async () => Number(await page.evaluate('window.devicePixelRatio')),
    // `screencap` aborts on the hosted emulator's gfxstream (hasReadColorBufferDma): the page's own capture is the fallback.
    shot: async name => {
      const png = execFileSync(tool, ['-s', serial, 'exec-out', 'screencap', '-p'], { maxBuffer: 64 << 20, timeout: 60_000 });
      if (png.length > 1000) { writeFileSync(join(shots, `${name}.png`), png); return; }
      const said = v.parse(v.looseObject({ data: v.string() }), await Promise.race([page.send('Page.captureScreenshot', { format: 'png' }), sleep(20_000).then(() => { throw new Error('Page.captureScreenshot timed out'); })]));
      writeFileSync(join(shots, `${name}.png`), decodeProtocolPng(said.data));
    },
    close: async () => {
      page.close();
      try { writeFileSync(join(shots, 'logcat.txt'), execFileSync(tool, ['-s', serial, 'logcat', '-d', '-t', '4000'], { encoding: 'utf8', maxBuffer: 64 << 20, timeout: 60_000 })); } catch { /* A dead emulator has no log. */ }
      await Promise.resolve();
    } };
}

// What a waiting phone shows, and whether it still paints: `raf` counts frames since the first look (a hidden or stalled page
// holds it still), `step` is the loading card's step.
const SHOWN = String.raw`({ text: (document.body?.innerText ?? '').replace(/\s+/gu, ' ').slice(0, 160), href: location.href, worker: typeof window.__workerClient === 'function', vis: document.visibilityState, focus: document.hasFocus(), step: document.querySelector('.ws-load')?.dataset.step ?? null, shell: document.querySelector('.ws-load')?.hasAttribute('data-shell') ?? null, raf: (window.__xrRaf ??= (() => { let n = 0; const f = () => { n++; requestAnimationFrame(f); }; requestAnimationFrame(f); return () => n; })())() })`;
/** @param {Phone} phone @param {string} expression @param {number} ms @param {string} [what] */
const until = async (phone, expression, ms, what = expression) => {
  const end = Date.now() + ms;
  let last = '', told = Date.now();
  while (Date.now() < end) {
    try { if (await phone.evaluate(expression) === true) return; } catch (error) { last = String(error).slice(0, 160); }
    // A slow phone says what it shows every 30 s, so a timeout reads as a story, not a wall.
    if (Date.now() - told > 30_000) { told = Date.now(); console.log(`  waiting for ${what.slice(0, 60)}: ${JSON.stringify(await phone.evaluate(SHOWN).catch((/** @type {unknown} */ error) => String(error).slice(0, 120)))}`); }
    await sleep(400);
  }
  throw new Error(`Timed out: ${what.slice(0, 160)}${last === '' ? '' : ` (${last})`}`);
};
const INSIDE = "typeof window.__workerClient === 'function' && window.__wildshard?.world?.player !== undefined";
const GPU = "(() => { const gl = document.createElement('canvas').getContext('webgl2'); if (gl === null) return null; const debug = gl.getExtension('WEBGL_debug_renderer_info'); return { renderer: debug === null ? gl.getParameter(gl.RENDERER) : gl.getParameter(debug.UNMASKED_RENDERER_WEBGL), astc: gl.getExtension('WEBGL_compressed_texture_astc') !== null, etc: gl.getExtension('WEBGL_compressed_texture_etc') !== null, agent: navigator.userAgent, screen: [screen.width, screen.height], inner: [innerWidth, innerHeight], ratio: devicePixelRatio, coarse: matchMedia('(pointer: coarse)').matches }; })()";
/** What the game's canvas holds over a dozen frames: a black world must not pass for a world. */
const CANVAS = "(async () => { window.__xrCanvas = null; const canvas = document.querySelector('canvas#game'), gl = canvas.getContext('webgl2'), read = (u, v) => { const pixel = new Uint8Array(4); gl.readPixels(Math.floor(canvas.width * u), Math.floor(canvas.height * v), 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel); return [...pixel]; }; let pixels = []; for (let frame = 0; frame < 12 && !pixels.some(([red, green, blue]) => red + green + blue > 30); frame++) { await new Promise(next => { requestAnimationFrame(next); }); pixels = [[0.5, 0.5], [0.25, 0.75], [0.75, 0.25], [0.5, 0.9], [0.5, 0.1]].map(([u, v]) => read(u, v)); } window.__xrCanvas = { size: [canvas.width, canvas.height], pixels }; })(); true";
const SETUP = `(() => { ${saveFixtureCode({ scope: 'device', key: 'devMode', data: true })}; ${saveFixtureCode({ scope: 'global', key: 'settings', data: { music: false, sfx: false, volume: 0 }, merge: true })}; return true; })()`;
const SERVER = '({ x: window.__workerClient().serverX, z: window.__workerClient().serverZ })';
const others = async (/** @type {Phone} */ phone) => v.parse(Others, await phone.evaluate('window.__onlinePlayers?.() ?? []'));
const chat = async (/** @type {Phone} */ phone) => String(await phone.evaluate("document.querySelector('#ws-chat')?.textContent ?? ''"));
/** @param {Phone} phone @param {string} line */
const say = (phone, line) => phone.evaluate(`(() => { const box = document.querySelector('#ws-chat'), field = box?.querySelector('input'), form = box?.querySelector('form'); if (!field || !form) return false; field.value = ${JSON.stringify(line)}; field.dispatchEvent(new Event('input', { bubbles: true })); form.requestSubmit(); return true; })()`);

/** The screen point (device units) of a CSS point, from one real tap: the page reads where the touch landed. @param {Phone} phone */
async function calibrate(phone) {
  await phone.evaluate("(() => { window.__xrTouch = null; window.addEventListener('touchstart', event => { const touch = event.touches[0]; if (touch !== undefined) window.__xrTouch = { x: touch.clientX, y: touch.clientY }; }, { capture: true }); return true; })()");
  const scale = await phone.scale(), view = v.parse(Point, await phone.evaluate('({ x: innerWidth, y: innerHeight })'));
  // The look side above the bar: a tap there turns nothing and fires nothing.
  const css = { x: view.x * 0.78, y: view.y * 0.3 }, aim = { x: css.x * scale, y: (css.y + 90) * scale };
  await phone.tap(aim);
  await until(phone, 'window.__xrTouch !== null', 10_000, 'the calibration touch');
  const got = v.parse(Point, await phone.evaluate('window.__xrTouch'));
  return { scale, dx: aim.x - got.x * scale, dy: aim.y - got.y * scale, got };
}

/** A thumb on the move stick, pushed up, for `ms`: a real OS touch. Returns the most the stick read while it walked. @param {Phone} phone @param {number} ms */
async function thumbWalk(phone, ms) {
  const map = await calibrate(phone);
  const stick = v.parse(v.object({ x: v.number(), y: v.number(), reach: v.number() }), await phone.evaluate("(() => { const box = document.querySelector('.ws-touch-stick').getBoundingClientRect(); return { x: box.x + box.width / 2, y: box.y + box.height / 2, reach: box.height / 2 }; })()"));
  const from = { x: stick.x * map.scale + map.dx, y: stick.y * map.scale + map.dy }, to = { x: from.x, y: from.y - stick.reach * 0.75 * map.scale };
  await phone.evaluate('(() => { window.__xrStick = 0; const read = () => { const p = window.__wildshard?.world?.player; if (p !== undefined) window.__xrStick = Math.max(window.__xrStick, p.touchMove.y); if (window.__xrStick !== null) requestAnimationFrame(read); }; requestAnimationFrame(read); return true; })()');
  await phone.swipe(from, to, ms);
  const most = Number(await phone.evaluate('(() => { const most = window.__xrStick; window.__xrStick = null; return most; })()'));
  return { map, stick, from, to, most };
}

const faultsOf = (/** @type {Phone} */ phone, /** @type {string} */ socket) => splitRoomsHealthLines(phone.errors, socket === '' ? null : roomsHealthURL(socket));

const version = v.parse(v.looseObject({ build: v.string() }), await (await fetch(`${BASE}/version.json`, { cache: 'no-store', signal: AbortSignal.timeout(30_000) })).json());
if (expectBuild !== '' && version.build !== expectBuild) throw new Error(`${BASE} serves ${version.build.slice(0, 8)}, not ${expectBuild.slice(0, 8)}`);
let socket = '';
if (loopback) note(row, 'the page is the local rig on loopback', true, { build: version.build });
else {
  const signed = v.parse(v.object({ body: v.string(), signature: v.string() }), await (await fetch(RELEASE, { cache: 'no-store', signal: AbortSignal.timeout(30_000) })).json());
  const release = v.parse(v.looseObject({ channel: v.string(), socket: v.string(), engineBuild: v.string() }), JSON.parse(signed.body));
  socket = release.socket.replace(/\/$/u, '');
  const html = await (await fetch(BASE, { signal: AbortSignal.timeout(30_000) })).text();
  const isolated = release.channel === 'staging' && SOCKETS.has(socket) && html.includes(RELEASE) && !html.includes('/releases/production.json');
  note(row, 'J205: the page is staging, its release is staging, its socket is the staging door', isolated, { build: version.build, release: release.engineBuild, socket });
  if (!isolated) throw new Error('J205 refuses anything but the isolated staging page');
}

const phone = device === 'safari' ? safari(process.env.SIM_UDID ?? '') : android(process.env.ANDROID_SERIAL ?? 'emulator-5554');
// CHUNK-PARAM-REMOVAL CP16 (J522): the zone rides the tap in the tab, written on the origin before the bare page opens.
const url = agentUrl(`${BASE}/?mute=1&nolock=1&skipintro=1`);
let code = 1;
try {
  await phone.open(`${BASE}/version.json`);
  await phone.evaluate(SETUP);
  await phone.evaluate(`sessionStorage.setItem(${JSON.stringify(`${SAVE_PREFIX}session`)}, ${JSON.stringify(tapDocument({ zone: SHARD }))}); true`);
  console.log(`  ${row} browser and GPU at open: ${JSON.stringify(await phone.evaluate(GPU).catch((/** @type {unknown} */ error) => String(error).slice(0, 200)))}`);
  await phone.evaluate(`location.replace(${JSON.stringify(url)}); true`).catch(() => undefined);
  // The hosted Android emulator draws on a software GPU at 1 to 2 fps: its title took over 4 minutes (run 43977695438).
  await until(phone, "document.querySelector('#ws-name-box input') !== null", 480_000, 'the title and its Name box');
  note(row, 'the title shows, with the Name box', true, await phone.evaluate('({ build: globalThis.__WS_BUILD_ID__, href: location.href })'));
  await phone.shot('1-title');
  await phone.evaluate(`(() => { const field = document.querySelector('#ws-name-box input'); field.value = ${JSON.stringify(me)}; field.dispatchEvent(new Event('input', { bubbles: true })); document.querySelector('#ws-name-box').requestSubmit(); return true; })()`);
  await until(phone, INSIDE, 480_000, 'the world');
  await phone.evaluate('(window.__wildshard.world.hud.enterNow(), true)');
  await until(phone, '(window.__workerClient?.().frames ?? 0) > 30', 120_000, 'thirty frames');
  if (await phone.evaluate('window.__wildshard?.world?.game.app.clock.paused === true') === true) await phone.evaluate("(() => { const button = [...document.querySelectorAll('button')].find(each => /^resume$/iu.test(each.textContent?.trim() ?? '')); button?.click(); return button !== undefined; })()");
  await until(phone, 'window.__wildshard?.world?.game.app.clock.paused === false', 30_000, 'an unpaused clock');
  note(row, 'the phone\'s browser and GPU', true, await phone.evaluate(GPU));
  await phone.evaluate(CANVAS);
  await until(phone, 'window.__xrCanvas !== null', 20_000, 'the canvas read');
  const drawn = v.parse(v.looseObject({ pixels: v.array(v.array(v.number())) }), await phone.evaluate('window.__xrCanvas'));
  note(row, 'the canvas holds a world, not black', drawn.pixels.some(([red = 0, green = 0, blue = 0]) => red + green + blue > 30), drawn);
  await phone.shot('2-in-play');

  // A lit solo world has frames but no server actor. Wait for ownership before taking either position.
  await until(phone, '(() => { const room = window.__workerClient?.(); return typeof room?.own === "string" && room.own.length > 0 && room.closed === null; })()', 30_000, 'an owned actor in the signed room');
  const seat = v.parse(v.object({ build: v.string(), own: v.string(), frames: v.number() }), await phone.evaluate('({ build: globalThis.__WS_BUILD_ID__, own: window.__workerClient().own, frames: window.__workerClient().frames })'));
  note(row, 'title to play: exact build and an owned actor in the signed room', seat.build === version.build, seat);

  // The touch walk: the stick reads the thumb, and the server moves the body.
  await until(phone, "document.querySelector('.ws-touch-stick')?.getBoundingClientRect().width > 0", 30_000, 'the move stick');
  const before = v.parse(Spot, await phone.evaluate(SERVER));
  const walk = await thumbWalk(phone, 6000);
  await sleep(1200);
  const after = v.parse(Spot, await phone.evaluate(SERVER)), moved = Math.hypot(after.x - before.x, after.z - before.z);
  note(row, 'a real touch on the move stick walks the body on the server', walk.most > 0.3 && moved > 1, { moved: Math.round(moved * 100) / 100, before, after, walk });
  await phone.shot('3-after-the-touch-walk');

  if (!solo) {
    // XR-9: wait for the other phone, then tell it, and wait to be told.
    const seen = (/** @type {readonly {name: string, modelled: boolean}[]} */ rows) => rows.some(each => new RegExp(playerNameSource(peer), 'u').test(each.name) && each.modelled);
    const end = Date.now() + peerWait;
    let rows = await others(phone);
    while (!seen(rows) && Date.now() < end) { await sleep(1000); rows = await others(phone); }
    note('XR-9', `${me} draws ${peer} (body and Name, in the same room)`, seen(rows), rows);
    if (seen(rows)) {
      await phone.shot('4-sees-the-other-phone');
      const ack = `xr9 ${me} saw ${peer}`, heard = chatLinePattern(peer, `xr9 ${peer} saw ${me}`);
      let told = false, said = 0;
      while (Date.now() < end) {
        if (Date.now() - said > 20_000) { await say(phone, ack); said = Date.now(); }
        if (heard.test(await chat(phone))) { told = true; break; }
        await sleep(1000);
      }
      note('XR-9', `${peer} says it draws ${me} too`, told, { chat: (await chat(phone)).slice(-400) });
      if (told) { await say(phone, ack); await sleep(15_000); }
      await phone.shot('5-after-the-meeting');
    }
  }
  // A socket the page closes while it still dials (the title's dial, then the room's) is listed, not failed, as in online-phone-proof.
  // Chrome also logs every 404 it fetches ("Failed to load resource", Safari's console does not): listed with its address,
  // not failed, as in online-phone-proof.
  const lines = faultsOf(phone, socket), dial = (/** @type {{text: string}} */ line) => /^WebSocket connection to 'wss:\/\/rooms-staging\.wildshard\.io\/' failed: WebSocket is closed before the connection is established\.$/u.test(line.text);
  const load = (/** @type {{text: string}} */ line) => line.text.startsWith('Failed to load resource: '), other = lines.other.filter(line => !dial(line) && !load(line));
  // J428: listed for the reader, never failed; a message's wording changes with every feature
  note(row, 'page errors (listed, not failed)', true, { other: other.slice(0, 8), dials: lines.other.filter(dial).length, loads: lines.other.filter(load).slice(0, 8), health: lines.health.length });
  code = steps.every(each => each.ok) ? 0 : 1;
} catch (error) {
  note(row, 'the proof stopped', false, { error: String(error).slice(0, 500), errors: phone.errors.slice(-8) });
  await phone.shot('stopped').catch(() => undefined);
} finally {
  const items = [...new Set(steps.map(each => each.item))].map(item => ({ item, ok: steps.filter(each => each.item === item).every(each => each.ok) }));
  writeFileSync(join(out, `report-${device}.json`), JSON.stringify({ device, me, peer, build: version.build, socket, items, steps }, null, 1));
  await phone.close();
}
console.log(code === 0 ? 'PASS' : 'FAIL');
process.exit(code);
