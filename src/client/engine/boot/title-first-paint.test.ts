// @vitest-environment happy-dom
// oxlint-disable-next-line import/no-nodejs-modules -- Exercise the actual first document before application bundles.
import { readFileSync } from 'node:fs';
import { Window } from 'happy-dom';
import { afterEach, expect, test, vi } from 'vitest';
import { showStartTitle } from '../ui/StartTitle';
import type { TitleDeckView } from '../ui/HUD';

const html = readFileSync('index.html', 'utf8');
// The real HTML runs before runtime identity installation (test/setup is epoch
// zero for historical fixtures). Its handoff must use this release's epoch.
const saveEpoch = (JSON.parse(readFileSync('save-epoch.json', 'utf8')) as { saveEpoch: number }).saveEpoch;
const windows: Window[] = [];
interface Frames { now: number; callbacks: FrameRequestCallback[] }
afterEach(async () => {
  vi.restoreAllMocks();
  for (const window of windows.splice(0)) await window.happyDOM.close();
  document.body.innerHTML = '';
});
function firstDocument(search: string, frames?: Frames, developer = false, handoffMs = 0): Window {
  const window = new Window({ url: `https://launch.test/${search}`, width: 402, height: 874, settings: {
    enableJavaScriptEvaluation: true, disableJavaScriptFileLoading: true, disableCSSFileLoading: true,
    enableImageFileLoading: false, handleDisabledFileLoadingAsSuccess: true,
  } });
  if (frames !== undefined) {
    vi.spyOn(window.performance, 'now').mockImplementation(() => frames.now);
    const nativeFrame = window.requestAnimationFrame.bind(window);
    // oxlint-disable-next-line promise/prefer-await-to-callbacks -- RAF returns happy-dom's native handle; this fixture owns callback delivery.
    window.requestAnimationFrame = callback => { frames.callbacks.push(callback); return nativeFrame(() => undefined); };
  }
  windows.push(window);
  if (handoffMs > 0) window.sessionStorage.setItem(`wildshard.save.v2@${saveEpoch}.session`, JSON.stringify({keys: {titleArrival: {data: JSON.stringify({
    slug: 'driftwood-isle', name: 'Home', mode: 'enter', at: window.performance.timeOrigin + (frames?.now ?? 0) - handoffMs,
  })}}}));
  window.document.write(html);
  // Happy DOM does not retain the head's lexical homeParams across script tags;
  // the real storage-to-Developer gate is covered by the two-engine phone run.
  if (developer) window.document.documentElement.dataset['dev'] = '';
  return window;
}

test('plain launch paints only the approved hero and WILDSHARD, the launch image\'s own art, without application modules', () => {
  const window = firstDocument(''), panel = window.document.querySelector('[data-title-shell]');
  if (panel === null) throw new Error('Missing inline title');
  expect(window.document.documentElement.classList.contains('title-first')).toBe(true);
  expect(window.getComputedStyle(panel).display).toBe('flex');
  expect(window.getComputedStyle(panel).position).toBe('fixed');
  // RL3: no boat, no bar, no wait box, no Retry
  const hero = panel.querySelector('.ws-launch-hero');
  if (hero === null) throw new Error('Missing title art');
  expect([...panel.children].map(child => child.className)).toEqual(['ws-launch-hero', 'ws-launch-brand']);
  expect(window.getComputedStyle(hero).backgroundImage).toMatch(/main-crossroads-square-[a-f0-9]{16}\.jpg/u);
  expect(window.document.querySelector('link[as="image"]')?.getAttribute('href')).toMatch(/^\/assets\/title\/main-crossroads-square-[a-f0-9]{16}\.jpg$/u);
  expect(window.document.querySelector('#hud')?.childElementCount).toBe(0);
});

test('environment flags alone (the phone harness, ?v=) launch the same title and hero preload', () => {
  for (const search of ['?v=build', '?tier=phone&touch=1&mute=1&nolock=1&sw=0']) {
    const window = firstDocument(search);
    expect(window.document.documentElement.classList.contains('title-first')).toBe(true);
    expect(window.document.querySelector('link[as="image"]')?.getAttribute('href')).toMatch(/^\/assets\/title\/main-crossroads-square-[a-f0-9]{16}\.jpg$/u);
  }
  expect(firstDocument('?tier=phone&chunk=driftwood-isle').document.documentElement.classList.contains('title-first')).toBe(false);
});

test('a selected shard keeps its existing loader and does not preload the title hero', () => {
  const window = firstDocument('?chunk=driftwood-isle'), panel = window.document.querySelector('[data-title-shell]');
  if (panel === null) throw new Error('Missing title shell');
  expect(window.document.documentElement.classList.contains('title-first')).toBe(false);
  expect(window.getComputedStyle(panel).display).toBe('none');
  expect(window.document.querySelector('link[as="image"]')).toBeNull();
  expect(window.document.querySelector('.ws-load[data-shell]')).not.toBeNull();
  const root = window.document.querySelector('.ws-load[data-shell]');
  if (!(root instanceof window.HTMLElement)) throw new Error('Missing loading shell');
  expect(window.getComputedStyle(root).position).toBe('fixed');
  expect(window.getComputedStyle(root).display).toBe('flex');
  expect([...html.matchAll(/<link rel="stylesheet"[^>]*>/gu)].every(([link]) => link.includes('media="print"') && link.includes('onload='))).toBe(true);
});

test('public first paint and admitted loading keep every detailed progress field visible', () => {
  const window = firstDocument('?chunk=driftwood-isle'), root = window.document.querySelector('.ws-load[data-shell]');
  if (!(root instanceof window.HTMLElement)) throw new Error('Missing public loading shell');
  const detailed = ['.ws-load-clock', '.ws-load-meta', '.ws-load-track', '.ws-load-log', '.ws-load-diagnostics', '.ws-load-foot'];
  const visible = (): void => {
    expect(Object.hasOwn(window.document.documentElement.dataset, 'dev')).toBe(false);
    for (const selector of detailed) {
      const field = root.querySelector(selector);
      if (!(field instanceof window.HTMLElement)) throw new Error(`Missing progress field ${selector}`);
      expect(window.getComputedStyle(field).display).not.toBe('none');
    }
  };
  visible();
  const style = window.document.createElement('style');
  style.textContent = readFileSync('src/client/engine/ui/loading.css', 'utf8'); window.document.head.append(style);
  delete root.dataset['shell']; visible();
  const simple = root.querySelector('.ws-load-simple');
  if (!(simple instanceof window.HTMLElement)) throw new Error('Missing compatibility progress field');
  expect(window.getComputedStyle(simple).display).toBe('none');
});

test('RL3: a page whose entry graph never arrived reloads once at 12 s; a running slow boot, the title or the card never', () => {
  const later: (() => void)[] = [];
  const window = new Window({ url: 'https://launch.test/', settings: { enableJavaScriptEvaluation: true, disableJavaScriptFileLoading: true,
    disableCSSFileLoading: true, enableImageFileLoading: false, handleDisabledFileLoadingAsSuccess: true } });
  windows.push(window);
  const handle = setTimeout(() => undefined, 0); clearTimeout(handle); // a real, spent timer handle for the captured call
  const timers = vi.spyOn(window, 'setTimeout').mockImplementation((run: Parameters<typeof window.setTimeout>[0], ms?: number) => { if (ms === 12000) later.push(() => { Reflect.apply(run, undefined, []); }); return handle; });
  const reload = vi.spyOn(window.location, 'reload').mockImplementation(() => undefined);
  window.document.write(html);
  expect(later).toHaveLength(1);
  later[0]?.(); expect(reload).toHaveBeenCalledTimes(1);
  later[0]?.(); expect(reload).toHaveBeenCalledTimes(1); // once a session
  window.sessionStorage.clear(); window.document.documentElement.dataset['booted'] = '';
  later[0]?.(); expect(reload).toHaveBeenCalledTimes(1); // the entry graph ran (a slow world boot): nothing to do
  delete window.document.documentElement.dataset['booted']; window.document.querySelector('[data-title-shell]')?.remove();
  later[0]?.(); expect(reload).toHaveBeenCalledTimes(1); // the title arrived: nothing to do
  timers.mockRestore();
  const inline = /<script data-loading-first-paint>([\s\S]*?)<\/script>/u.exec(html)?.[1] ?? '';
  expect(inline.trim().split('\n').length).toBeLessThanOrEqual(15);
});

test('the first-paint panel survives failed title start and retires only after the real deck is mounted', () => {
  document.body.innerHTML = '<div data-title-shell></div><div id="hud"></div>';
  const shell = document.querySelector('[data-title-shell]');
  const build = (refuse: boolean): TitleDeckView => {
    const root = document.createElement('div');
    return { root, cards: [], index: 0, select: () => undefined, activate: () => undefined, dispose: () => root.remove(),
      start: () => {
        expect(root.isConnected).toBe(true); expect(shell?.isConnected).toBe(true);
        if (refuse) throw new Error('Title refused');
      },
    };
  };
  expect(() => showStartTitle(() => build(true))).toThrow('Title refused');
  expect(shell?.isConnected).toBe(true);
  showStartTitle(() => build(false));
  expect(shell?.isConnected).toBe(false);
});


test('the standalone launch image matches the declared phone pixel dimensions', () => {
  const window = firstDocument('');
  const link = window.document.querySelector('link[rel="apple-touch-startup-image"]');
  expect(link?.getAttribute('media')).toContain('(device-width: 402px)');
  expect(link?.getAttribute('media')).toContain('(device-height: 874px)');
  expect(link?.getAttribute('media')).toContain('(-webkit-device-pixel-ratio: 3)');
  const href = link?.getAttribute('href');
  if (href === undefined || href === null) throw new Error('Missing native launch image');
  expect(href).toMatch(/^\/assets\/title\/launch-1206x2622-[a-f0-9]{12}\.png$/u);
  const png = readFileSync(`public${href}`);
  expect(png.subarray(1, 4).toString()).toBe('PNG');
  expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([1206, 2622]);
});

const startedOf = (window: Window): string | undefined => { const card = window.document.querySelector('.ws-load'); return card instanceof window.HTMLElement ? card.dataset['clockStartedAt'] : undefined; };
test('DL21: a world page\'s first-paint card runs its clock from the title tap before any module, until Loading adopts it', async () => {
  // The title tapped 1.5 s before this document started (the fixture's stored arrival); no module script runs here.
  const frames: Frames = { now: 0, callbacks: [] }, window = firstDocument('?chunk=driftwood-isle', frames, false, 1500);
  const card = window.document.querySelector('.ws-load[data-shell]'), clock = (): string => card?.querySelector('[data-el="clock"]')?.textContent ?? '';
  expect(startedOf(window)).toBe('-1500');
  expect(card?.querySelector('[data-el="slug"]')?.textContent).toBe('Home');
  await new Promise(resolve => { setTimeout(resolve, 250); });
  expect(clock()).toBe('00:01.5');
  frames.now = 2000; await new Promise(resolve => { setTimeout(resolve, 250); });
  expect(clock()).toBe('00:03.5');
  // Loading adopts the card (data-shell goes): the inline clock stops; Loading keeps the same start.
  if (card instanceof window.HTMLElement) delete card.dataset['shell'];
  frames.now = 9000; await new Promise(resolve => { setTimeout(resolve, 250); });
  expect(clock()).toBe('00:03.5');
});

test('DL21: the title page and an arrival for another shard leave the card\'s clock alone', () => {
  expect(startedOf(firstDocument('', undefined, false, 1500))).toBeUndefined();
  const other = firstDocument('?chunk=pine-hollow', { now: 0, callbacks: [] }, false, 1500);
  expect(startedOf(other)).toBe('0'); expect(other.document.querySelector('[data-el="slug"]')?.textContent).toBe('');
});
