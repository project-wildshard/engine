import { saveFixture, debugSettings } from './debug-settings.mjs';
// playground-harness.mjs — the shared half of the E307 playground tests (scripts/playground-grapple.mjs,
// scripts/playground-horse.mjs): an iPhone-16-Pro portrait touch page (402 × 874 @ 3×, phone tier) in Developer mode, booted
// to the TITLE, then real taps: EXPLORE WORLD → the hub → a playground's card. Plus the in-page video recorder
// (canvas.captureStream + MediaRecorder, the game's real render resolution, no DOM) and the ~4.5 Mb/s phone encode.
//
// Every browser is muted (--mute-audio + &mute=1) and on Metal. Run the tests inside the machine's browser lane:
//   scripts/browser-lane.sh node scripts/playground-grapple.mjs --url=http://127.0.0.1:5173
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { browserBakeBytes } from './bake-output.mjs';
import { uploadRecordedClip } from './model-spin-recording.mjs';

export const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

/** other agents' saves full-reload a dev-server page mid-run: a stub @vite/client ignores them */
export const VITE_STUB = `
import '/@vite/env';
const hot = () => ({ data: {}, accept() {}, acceptExports() {}, dispose() {}, prune() {}, decline() {}, invalidate() {}, on() {}, off() {}, send() {} });
export function createHotContext() { return hot(); }
const sheets = new Map();
export function updateStyle(id, css) { let s = sheets.get(id); if (!s) { s = document.createElement('style'); s.setAttribute('data-vite-dev-id', id); document.head.appendChild(s); sheets.set(id, s); } s.textContent = css; }
export function removeStyle(id) { const s = sheets.get(id); if (s) { s.remove(); sheets.delete(id); } }
export function injectQuery(url) { return url; }
export class ErrorOverlay extends HTMLElement {}
`;

export function flags(argv = process.argv.slice(2)) {
  return (name, dflt) => { const a = argv.find((x) => x.startsWith(`--${name}=`)); return a ? a.slice(name.length + 3) : dflt; };
}

/** a phone page in Developer mode (the hub's Practice + playground cards are developer entries), `settings` merged in */
export async function phonePage(browser, settings = {}) {
  const ctx = await browser.newContext({ viewport: { width: 402, height: 874 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
  await saveFixture(ctx, { scope: 'device', key: 'devMode', data: true });
  await debugSettings(ctx, settings);
  const page = await ctx.newPage();
  await page.route('**/@vite/client', (r) => r.fulfill({ contentType: 'application/javascript', body: VITE_STUB }));
  return page;
}

/** a real tap on the centre of `sel` */
export async function tap(page, sel) {
  const el = await page.$(sel);
  const box = await el?.boundingBox();
  if (!box) throw new Error(`nothing to tap: ${sel}`);
  await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
}

/** boot `slug` to its title (the deck, no skipintro) */
export async function bootToTitle(page, base, slug) {
  const t0 = Date.now();
  await page.goto(`${base}/?chunk=${slug}&tier=phone&touch=1&mute=1&nolock=1&sw=0`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.querySelector('.ws-menu-explore') !== null && document.querySelector('.ws-load') === null && window.__wildshard?.world !== undefined, undefined, { timeout: 480000, polling: 1000 });
  await sleep(2500);
  return Math.round((Date.now() - t0) / 1000);
}

/** EXPLORE WORLD on the title → the hub: what it lists, whether it scrolls sideways */
export async function openHub(page) {
  await tap(page, '.ws-menu-explore');
  await page.waitForFunction(() => document.querySelector('.ws-x.show[data-mode="hub"] .ws-x-hub') !== null, undefined, { timeout: 180000, polling: 500 });
  await sleep(2500);
  return page.evaluate(() => {
    const h = document.querySelector('.ws-x-hub');
    const shown = (e) => e instanceof HTMLElement && !e.hidden && e.offsetParent !== null;
    return {
      cards: [...document.querySelectorAll('.ws-x-card')].filter(shown).map((c) => c.querySelector('b')?.textContent ?? ''),
      sections: [...document.querySelectorAll('.ws-x-hub-heading')].filter(shown).map((c) => c.textContent),
      scroll: { height: h?.scrollHeight ?? 0, view: h?.clientHeight ?? 0, width: h?.scrollWidth ?? 0, viewW: h?.clientWidth ?? 0 },
      pageScrollX: document.documentElement.scrollWidth > innerWidth,
    };
  });
}

/** the playground's card (scrolled into view first, as a thumb would) → in it */
export async function enterPlayground(page, id) {
  await page.evaluate((pg) => { document.querySelector(`.ws-x-card[data-pg="${pg}"]`)?.scrollIntoView({ block: 'center' }); }, id);
  await sleep(400);
  await tap(page, `.ws-x-card[data-pg="${id}"]`);
  await page.waitForFunction(() => window.__wildshard?.world?.playground?.()?.entered === true, undefined, { timeout: 120000, polling: 250 });
  await sleep(1500);
}

/** the game's canvas into a MediaRecorder at its real size (vp9 ~16 Mb/s): start … stop → the webm on disk */
export async function startRecording(page) {
  await page.evaluate(() => {
    const canvas = window.__wildshard.world.game.renderer.domElement;
    const stream = canvas.captureStream(60);
    const type = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'].find((t) => MediaRecorder.isTypeSupported(t)) ?? 'video/webm';
    const rec = new MediaRecorder(stream, { mimeType: type, videoBitsPerSecond: 16_000_000 });
    const parts = [];
    rec.ondataavailable = (e) => { if (e.data.size > 0) parts.push(e.data); };
    rec.start(250);
    window.__pgRec = { rec, parts, size: [canvas.width, canvas.height] };
  });
}

export async function stopRecording(page, file) {
  const clip = await page.evaluate(async () => {
    const r = window.__pgRec;
    try {
      await new Promise((resolve) => { r.rec.onstop = resolve; r.rec.stop(); });
    } finally {
      for (const track of r.rec.stream.getTracks()) track.stop();
      delete window.__pgRec;
    }
    const blob = new Blob(r.parts, { type: 'video/webm' });
    return { url: URL.createObjectURL(blob), bytes: blob.size, size: r.size };
  });
  try {
    const sink = await browserBakeBytes(page, { maxBytes: Math.max(1, clip.bytes), maxFiles: 1 });
    try {
      await page.evaluate(uploadRecordedClip, { source: clip.url, destination: `${sink.url}clip` });
      const bytes = sink.take('clip');
      if (bytes.byteLength !== clip.bytes) throw new Error('Playground clip byte count changed');
      writeFileSync(file, bytes);
      return clip.size;
    } finally { await sink.dispose(); }
  } finally { await page.evaluate(url => { URL.revokeObjectURL(url); }, clip.url); }
}

/** the phone encode: H.264 ~4.5 Mb/s, 30 fps, faststart — what SendUserFile and the art folder take (< 30 MB) */
export function encodePhone(webm, mp4) {
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', webm, '-an', '-c:v', 'libx264', '-preset', 'slow', '-b:v', '4500k', '-maxrate', '5000k', '-bufsize', '9000k', '-r', '30', '-pix_fmt', 'yuv420p', '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2', '-movflags', '+faststart', mp4]);
  const probe = execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration,size,bit_rate:stream=width,height', '-of', 'json', mp4]).toString();
  return JSON.parse(probe);
}

/** turn the view to look at a world point (yaw faces (−sin, −cos); pitch up is positive) */
export function aimAt(page, point) {
  return page.evaluate(([x, y, z]) => {
    const w = window.__wildshard?.world, c = w.game.camera.position;
    w.player.yaw = Math.atan2(-(x - c.x), -(z - c.z));
    w.player.pitch = Math.atan2(y - c.y, Math.hypot(x - c.x, z - c.z));
  }, point);
}
