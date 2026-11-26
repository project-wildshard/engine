// QA-FEEDBACK 11-19 row 21 (Jake, iPhone, Driftwood): the move stick stuck pinned up-left in SPRINT and would not answer a
// touch. src/client/engine/player/touch-stranded.test.ts drives the real touch layer through each release path in
// happy-dom; this runs the hold tracker it uses (touchHolds.ts) in real WebKit with touch on, with WebKit's own Touch,
// TouchEvent and PointerEvent in WebKit's order (pointerdown before touchstart). Playwright's WebKit cannot hold a drag
// (touchscreen.tap only), so the events are dispatched in the page.
// oxlint-disable-next-line import/no-nodejs-modules -- Skip where WebKit is not installed (main's ci installs Chromium only).
import { existsSync } from 'node:fs';
import { afterAll, beforeAll, expect, test } from 'vitest';
import { build } from 'vite';
import { webkit } from '../src/scripts/browser-playwright.mjs';

type Browser = Awaited<ReturnType<typeof webkit.launch>>;
let browser: Browser | null = null, bundle = '';
const HAVE_WEBKIT = existsSync(webkit.executablePath());

beforeAll(async () => {
  if (!HAVE_WEBKIT) return;
  const out = await build({ configFile: false, logLevel: 'silent', build: { write: false, minify: false,
    lib: { entry: 'src/client/engine/input/touchHolds.ts', name: 'TouchHoldsUnderTest', formats: ['iife'], fileName: () => 'holds.js' } } });
  const result = Array.isArray(out) ? out[0] : out;
  if (result === undefined || !('output' in result)) throw new Error('vite returned a watcher');
  const chunk = result.output.find(o => o.type === 'chunk');
  if (chunk === undefined) throw new Error('Missing touchHolds bundle');
  bundle = chunk.code;
  browser = await webkit.launch({ headless: true });
}, 120_000);
afterAll(async () => { await browser?.close(); });

interface Run { name: string; held: number }
test.skipIf(!HAVE_WEBKIT)('in WebKit, every lost-lift path releases the hold, and a stale hold yields to the next finger', async () => {
  if (browser === null) throw new Error('Missing WebKit');
  const context = await browser.newContext({ hasTouch: true, isMobile: true, viewport: { width: 402, height: 874 } });
  const page = await context.newPage();
  await page.setContent('<div id="layer" style="position:fixed;inset:0"></div>');
  await page.addScriptTag({ content: bundle });
  const runs = await page.evaluate((): Run[] => {
    const lib: unknown = Reflect.get(globalThis, 'TouchHoldsUnderTest');
    if (typeof lib !== 'object' || lib === null) throw new Error('Missing bundle global');
    const { TouchHolds, wireTouchHolds, overlayChanged } = lib as typeof import('../src/client/engine/input/touchHolds');
    const root = document.getElementById('layer');
    if (root === null) throw new Error('Missing layer');
    // WebKit's own Touch (its constructor is not exposed on desktop WebKit; createTouch is)
    const make: unknown = Reflect.get(document, 'createTouch');
    if (typeof make !== 'function') throw new Error('Missing document.createTouch');
    const touch = (id: number, x: number, y: number): Touch => Reflect.apply(make, document, [window, root, id, x, y, x, y]) as Touch;
    const makeList: unknown = Reflect.get(document, 'createTouchList');
    if (typeof makeList !== 'function') throw new Error('Missing document.createTouchList');
    // a TouchList at run time; TouchEventInit's DOM typing says Touch[]
    const list = (...touches: Touch[]): Touch[] => Reflect.apply(makeList, document, touches) as Touch[];
    const out: Run[] = [];
    const fresh = (name: string, act: (h: InstanceType<typeof TouchHolds>) => void): void => {
      const disposers: (() => void)[] = [];
      const scope = { listen: (t: EventTarget, type: string, fn: EventListener, o?: AddEventListenerOptions) => { t.addEventListener(type, fn, o); disposers.push(() => { t.removeEventListener(type, fn, o); }); },
        onDispose: (fn: () => void) => { disposers.push(fn); } };
      const holds = new TouchHolds((id) => { holds.lift(id); });
      wireTouchHolds(scope as never, root, holds, () => undefined);
      // the stick: finger 1 lands (WebKit: pointerdown first, then touchstart) and drags up-left
      holds.hold(1, 60, 800);
      const t1 = touch(1, 60, 800);
      root.dispatchEvent(new TouchEvent('touchstart', { touches: list(t1), changedTouches: list(t1), bubbles: true }));
      holds.move(1, 20, 710);
      act(holds);
      out.push({ name, held: holds.size });
      for (const d of disposers) d();
    };
    fresh('held while the finger stays', () => undefined);
    fresh('blur', () => { window.dispatchEvent(new Event('blur')); });
    fresh('pagehide', () => { window.dispatchEvent(new PageTransitionEvent('pagehide')); });
    fresh('hidden', () => {
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' });
      document.dispatchEvent(new Event('visibilitychange'));
      Reflect.deleteProperty(document, 'visibilityState');
    });
    fresh('lostpointercapture', () => { root.dispatchEvent(new PointerEvent('lostpointercapture', { pointerId: 1, pointerType: 'touch', bubbles: true })); });
    fresh('overlay', () => { overlayChanged(); });
    fresh('stale on the next touch', () => {
      const t7 = touch(7, 60, 800);
      root.dispatchEvent(new TouchEvent('touchstart', { touches: list(t7), changedTouches: list(t7), bubbles: true }));
    });
    fresh('live when a second finger lands', (h) => {
      h.hold(8, 300, 400);
      const t1 = touch(1, 21, 711), t8 = touch(8, 300, 400);
      root.dispatchEvent(new TouchEvent('touchstart', { touches: list(t1, t8), changedTouches: list(t8), bubbles: true }));
    });
    return out;
  });
  await context.close();
  expect(runs).toEqual([
    { name: 'held while the finger stays', held: 1 },
    { name: 'blur', held: 0 }, { name: 'pagehide', held: 0 }, { name: 'hidden', held: 0 },
    { name: 'lostpointercapture', held: 0 }, { name: 'overlay', held: 0 },
    { name: 'stale on the next touch', held: 0 },
    { name: 'live when a second finger lands', held: 2 },
  ]);
}, 120_000);
