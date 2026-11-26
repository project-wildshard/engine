// QA 11-25 row 22 (Jake, 2026-11-26 grill: "hide the voice tip while the TALK prompt shows, then bring it back"; nothing else on
// the HUD moves). On staging at 402x874 hud-worst's union check found the chat corner's voice tip over the USE band (TALK ·
// Castaway). This lays out the real chat corner (chatLines.ts, voiceUi.ts, through hud-worst's chat entry) over the real
// touch.css band in headless Chromium at 402x874 with touch on: TALK up hides the tip and nothing else in the corner moves,
// TALK gone brings the same tip back, and a tip closed while TALK was up stays closed.
// oxlint-disable-next-line import/no-nodejs-modules -- the real stylesheet, and skip where Chromium is not installed
import { existsSync, readFileSync } from 'node:fs';
import { afterAll, beforeAll, expect, test } from 'vitest';
import { build, type Plugin } from 'vite';
import { chromium } from '../src/scripts/browser-playwright.mjs';
import { KEYCHAIN_ARGS } from '../src/scripts/.kit/chromium-keychain.mjs';

type Browser = Awaited<ReturnType<typeof chromium.launch>>;
const executablePath = chromium.executablePath();
const HAVE_CHROMIUM = existsSync(executablePath);
let browser: Browser | null = null, bundle = '';

// As hud-worst.mjs: the chat modules reach rapier (a top-level await) and lazy imports through shared engine modules; the
// corner uses neither, so rapier is an inert stub and every lazy import an empty external, and the bundle is one IIFE.
const STUB = 'const stub = new Proxy(function () {}, { get: (_, key) => key === "then" ? undefined : stub, apply: () => stub, construct: () => stub }); export default stub; export const RawVector = stub;';
const chatOnly: Plugin = { name: 'voice-tip-chat-only', enforce: 'pre',
  resolveId: (id, _from, how) => (how as { kind?: string } | undefined)?.kind === 'dynamic-import' ? { id: 'data:text/javascript,export{}', external: true }
    : id.startsWith('@dimforge/rapier3d') ? '\0voice-tip-no-rapier' : null,
  load: id => id === '\0voice-tip-no-rapier' ? STUB : null };

beforeAll(async () => {
  if (!HAVE_CHROMIUM) return;
  const out = await build({ configFile: false, logLevel: 'silent', publicDir: false, plugins: [chatOnly], define: { __BUILD_ID__: '"voice-tip"' },
    build: { write: false, minify: false, target: 'es2022', lib: { entry: 'src/scripts/hud-worst/chat.ts', name: 'voiceTipChat', formats: ['iife'], fileName: () => 'chat.js' } } });
  const result = Array.isArray(out) ? out[0] : out;
  if (result === undefined || !('output' in result)) throw new Error('vite returned a watcher');
  const chunk = result.output.find(o => o.type === 'chunk');
  if (chunk === undefined) throw new Error('Missing chat bundle');
  bundle = chunk.code;
  browser = await chromium.launch({ executablePath, headless: true, args: [...KEYCHAIN_ARGS] });
}, 120_000);
afterAll(async () => { await browser?.close(); });

const PAGE = `<!doctype html><html data-ws-state="play"><head><meta name="viewport" content="width=device-width,initial-scale=1">
<style>${readFileSync('src/client/engine/ui/styles/touch.css', 'utf8')}</style></head>
<body style="margin:0"><div id="hud" class="touch"><div class="ws-touch"><button class="ws-touch-use" type="button">Talk · Castaway</button></div></div></body></html>`;

interface Box { left: number; top: number; right: number; bottom: number }
interface Read { tip: Box | null; tipText: string; band: Box | null; corner: Record<string, Box | null> }

test.skipIf(!HAVE_CHROMIUM)('at 402x874 the voice tip hides while TALK shows, comes back after, and nothing else moves', async () => {
  if (browser === null) throw new Error('Missing Chromium');
  const context = await browser.newContext({ hasTouch: true, isMobile: true, viewport: { width: 402, height: 874 } });
  try {
    const page = await context.newPage();
    // a real origin: voice's prefs read localStorage, which about:blank refuses
    await page.route('http://voice-tip.test/**', route => route.fulfill({ contentType: 'text/html', body: PAGE }));
    await page.goto('http://voice-tip.test/');
    await page.addScriptTag({ content: bundle });
    // voice off with two players on it: the tip says "Maren and Kai are on voice. Tap the mic to join."
    await page.evaluate(() => { (globalThis as unknown as { __hudWorstChat: (l: unknown[], s: string, p: string[]) => void }).__hudWorstChat([], 'off', ['Maren', 'Kai']); });
    const read = (): Promise<Read> => page.evaluate((): Read => {
      const box = (sel: string): Box | null => {
        const el = document.querySelector(sel);
        if (el === null) return null;
        const r = el.getBoundingClientRect(), s = getComputedStyle(el);
        return r.width > 0 && r.height > 0 && s.display !== 'none' && s.visibility !== 'hidden' ? { left: r.left, top: r.top, right: r.right, bottom: r.bottom } : null;
      };
      const corner: Record<string, Box | null> = {};
      for (const sel of ['#ws-chat', '#ws-chat > form', '#ws-voice', '#ws-chat-icon', '#ws-chat > [data-lines]']) corner[sel] = box(sel);
      return { tip: box('#ws-voice-tip'), tipText: document.querySelector('#ws-voice-tip span')?.textContent ?? '', band: box('.ws-touch-use'), corner };
    });
    const talk = (on: boolean): Promise<void> => page.evaluate((show: boolean) => { document.querySelector('.ws-touch-use')?.classList.toggle('show', show); }, on);
    const over = (a: Box, b: Box): boolean => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;

    const before = await read();
    expect(before.tip, 'the voice tip shows before TALK').not.toBeNull();
    expect(before.tipText).toContain('on voice');
    expect(before.band).toBeNull();
    expect(before.corner['#ws-voice'], 'the mic shows').not.toBeNull();

    await talk(true);
    const during = await read();
    expect(during.band, 'the TALK band shows').not.toBeNull();
    // the band's place is touch.css's, untouched: it is where the tip stood (the overlap the row found)
    if (before.tip === null || during.band === null) throw new Error('unreachable');
    expect(over(before.tip, during.band), 'without the fix the tip would stand over TALK').toBe(true);
    expect(during.tip, 'the voice tip hides while TALK shows').toBeNull();
    expect(during.corner, 'nothing else in the corner moves').toEqual(before.corner);

    await talk(false);
    const after = await read();
    expect(after.band).toBeNull();
    expect(after.tip, 'the same tip comes back when TALK goes').toEqual(before.tip);
    expect(after.tipText).toBe(before.tipText);
    expect(after.corner).toEqual(before.corner);

    // a tip closed while TALK is up stays closed when TALK goes (the close works under it; it never reappears)
    await talk(true);
    await page.evaluate(() => { document.querySelector<HTMLButtonElement>('#ws-voice-tip button[aria-label="Dismiss"]')?.click(); });
    await talk(false);
    expect((await read()).tip, 'a closed tip does not come back').toBeNull();
  } finally {
    await context.close();
  }
}, 60_000);
