// @vitest-environment happy-dom
// oxlint-disable-next-line import/no-nodejs-modules -- Exercise the actual first document before application bundles.
import { readFileSync } from 'node:fs';
import { Window } from 'happy-dom';
import { afterEach, expect, test, vi } from 'vitest';
import { showStartTitle } from '../ui/StartTitle';
import type { TitleDeckView } from '../ui/HUD';
import { stampBuildHtml } from '../../../../scripts/app-build/buildIdentity.mjs';

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

test('a split document cannot expose a loading card before its real arrival metadata is applied', () => {
  const window = new Window({ url: 'https://launch.test/?chunk=driftwood-isle', settings: {
    enableJavaScriptEvaluation: true, disableJavaScriptFileLoading: true, disableCSSFileLoading: true,
    enableImageFileLoading: false, handleDisabledFileLoadingAsSuccess: true,
  } });
  windows.push(window);
  window.sessionStorage.setItem(`wildshard.save.v2@${saveEpoch}.session`, JSON.stringify({keys: {titleArrival: {data: {
    slug: 'driftwood-isle', name: 'Saved destination', art: '/assets/saved-destination.jpg', mode: 'enter', at: Date.now(),
  }}}}));
  const split = html.indexOf('<script data-loading-clock>');
  expect(split).toBeGreaterThan(0);
  window.document.open(); window.document.write(html.slice(0, split));
  expect(window.document.querySelector('.ws-load')).toBeNull();
  window.document.write(html.slice(split)); window.document.close();
  expect(window.document.querySelector('.ws-load [data-el="slug"]')?.textContent).toBe('Saved destination');
  expect(window.document.documentElement.style.getPropertyValue('--ws-load-portrait')).toContain('/assets/saved-destination.jpg');
});

test('plain launch paints its hero and progress without application modules', () => {
  const window = firstDocument(''), panel = window.document.querySelector('[data-title-shell]');
  if (panel === null) throw new Error('Missing inline title');
  expect(window.document.documentElement.classList.contains('title-first')).toBe(true);
  expect(window.getComputedStyle(panel).display).toBe('flex');
  expect(window.getComputedStyle(panel).position).toBe('fixed');
  // RL3: no boat, no wait box, no Retry; QA 11-13 (Jake): the build pill (it reloads) and a moving bar
  const hero = panel.querySelector('.ws-launch-hero');
  if (hero === null) throw new Error('Missing title art');
  expect([...panel.children].map(child => child.className)).toEqual(['ws-launch-hero', 'ws-launch-brand', 'ws-launch-pill', 'ws-launch-load']);
  expect(window.getComputedStyle(hero).backgroundImage).toMatch(/main-crossroads-square-first-[a-f0-9]{16}\.jpg/u); // PZ19: the ~30 kB first cut
  const preload = window.document.querySelector('link[as="image"]');
  expect(preload?.getAttribute('href')).toMatch(/^\/assets\/title\/main-crossroads-square-first-[a-f0-9]{16}\.jpg$/u);
  expect(preload?.getAttribute('fetchpriority')).toBe('low');
  expect(window.document.querySelector('#hud')?.childElementCount).toBe(0);
  const progress = window.document.querySelector('.ws-load');
  if (!(progress instanceof window.HTMLElement)) throw new Error('Missing retained ledger');
  expect(window.getComputedStyle(progress).display).toBe('none');
});

test('BUGBASH-LOOP (J385): the launch shell has no Shard Select of its own', () => {
  const shell = firstDocument('').document.querySelector('[data-title-shell]');
  expect(shell?.querySelector('details, summary, nav, [data-launch-select], [data-launch-worlds]')).toBeNull();
  expect(shell?.textContent).not.toMatch(/shard select/iu);
});

/** MAIN-SCREEN MS4 (J399, "fallback splash"): when the main screen can't be up at once, the one splash is the logo, the
 *  hero framed as the main screen frames it (the square first cut the screen's width, on a phone), a moving bar and LOADING.
 *  Nothing to tap but the build pill's reload, which works with every bundle missing. */
test('MS4: the fallback splash has no button but the reload pill, and frames the phone hero as the main screen does', () => {
  const window = firstDocument('');
  const shell = window.document.querySelector('[data-title-shell]');
  expect([...shell?.querySelectorAll('button, a, [role="button"]') ?? []].map(el => el instanceof window.HTMLElement && el.dataset['launchReload'] !== undefined)).toEqual([true]);
  expect(shell?.querySelector('.ws-launch-brand')?.textContent).toBe('WILDSHARD');
  expect(shell?.querySelector('[data-launch-load] .ws-launch-bar')).not.toBeNull();
  const page = readFileSync('index.html', 'utf8');
  const portrait = /@media \(orientation: portrait\) \{ \.ws-launch-hero \{([^}]*)\}/u.exec(page)?.[1] ?? '';
  expect(portrait).toMatch(/background-image: url\('\/assets\/title\/main-crossroads-square-first-[a-f0-9]{16}\.jpg'\)/u);
  expect(portrait).toContain('background-size: 100% auto, 100% 100%; background-position: 50% 100%, 0 0;');
  expect(portrait).not.toMatch(/aspect-ratio|translateY/u);
});

test('environment flags alone (the phone harness, ?v=) launch the same title and hero preload', () => {
  for (const search of ['?v=build', '?tier=phone&touch=1&mute=1&nolock=1&sw=0']) {
    const window = firstDocument(search);
    expect(window.document.documentElement.classList.contains('title-first')).toBe(true);
    expect(window.document.querySelector('link[as="image"]')?.getAttribute('href')).toMatch(/^\/assets\/title\/main-crossroads-square-first-[a-f0-9]{16}\.jpg$/u);
  }
  expect(firstDocument('?tier=phone&chunk=driftwood-isle').document.documentElement.classList.contains('title-first')).toBe(false);
});

test('BUGBASH-LOOP (J385): a selected shard paints its full-screen loading card, never the title shell or a thin bar', () => {
  const window = firstDocument('?chunk=driftwood-isle'), panel = window.document.querySelector('[data-title-shell]');
  if (panel === null) throw new Error('Missing title shell');
  const doc = window.document.documentElement;
  expect(doc.classList.contains('title-first')).toBe(false);
  expect(doc.classList.contains('boot-menu')).toBe(false);
  expect(window.getComputedStyle(panel).display).toBe('none');
  expect(window.document.querySelector('link[as="image"]')).toBeNull();
  const root = window.document.querySelector('.ws-load[data-shell]');
  if (!(root instanceof window.HTMLElement)) throw new Error('Missing loading shell');
  expect(window.getComputedStyle(root).position).toBe('fixed');
  expect(window.getComputedStyle(root).height).not.toBe('3px');
  // LS2 (J188): the card's three phases, clock and ledger are on screen, not collapsed into a bar
  for (const selector of ['.ws-load-clock', '.ws-load-meta', '[data-phase="start"]', '[data-phase="download"]', '[data-phase="load"]', '.ws-load-foot']) {
    const field = root.querySelector(selector);
    if (!(field instanceof window.HTMLElement)) throw new Error(`Missing progress field ${selector}`);
    expect(window.getComputedStyle(field).display).not.toBe('none');
  }
  // J323 follow-up: the source names plain links, which the build bundles into one sheet; the stamped document never blocks on it
  const stamped = stampBuildHtml(html, 'f2a636b3-mx1');
  expect([...stamped.matchAll(/<link rel="stylesheet"[^>]*>/gu)].every(([link]) => link.includes('media="print"') && link.includes('onload='))).toBe(true);
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
  // the inline first-paint script stays small; QA 11-19 row 19 (b000479f2) added its wait while responses still arrive,
  // STAGING-BUGBASH SB53 its reload when the network returns to a page that never booted
  expect(inline.trim().split('\n').length).toBeLessThanOrEqual(29);
});

test('SB53: a page offline before its entry graph ran reloads when the network returns, its one retry spent or not', () => {
  const page = (offline: boolean): { window: Window; reload: ReturnType<typeof vi.fn<() => void>> } => {
    const window = new Window({ url: 'https://launch.test/?chunk=driftwood-isle', settings: { enableJavaScriptEvaluation: true, disableJavaScriptFileLoading: true,
      disableCSSFileLoading: true, enableImageFileLoading: false, handleDisabledFileLoadingAsSuccess: true } });
    windows.push(window);
    Object.defineProperty(window.navigator, 'onLine', { configurable: true, get: () => !offline });
    window.sessionStorage.setItem('wildshard.save.v2@2.session', JSON.stringify({ keys: { 'boot.selfReload': { v: 1, data: '1' } } }));
    const reload = vi.fn<() => void>();
    vi.spyOn(window.location, 'reload').mockImplementation(() => { reload(); });
    window.document.write(html);
    return { window, reload };
  };
  const away = page(true);
  away.window.dispatchEvent(new away.window.Event('online'));
  expect(away.reload).toHaveBeenCalledTimes(1);
  const near = page(false); // never offline: a network event alone reloads nothing
  near.window.dispatchEvent(new near.window.Event('online'));
  expect(near.reload).not.toHaveBeenCalled();
  near.window.dispatchEvent(new near.window.Event('offline')); near.window.document.documentElement.dataset['booted'] = '';
  near.window.dispatchEvent(new near.window.Event('online'));
  expect(near.reload).not.toHaveBeenCalled(); // the entry graph ran: guardBoot owns any later failure
  delete near.window.document.documentElement.dataset['booted'];
  near.window.dispatchEvent(new near.window.Event('online'));
  expect(near.reload).toHaveBeenCalledTimes(1); // offline mid fetch, before the graph ran
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

test('late catalogue refresh preserves the selected card and retires with the title owner', () => {
  document.body.innerHTML = '<div id="hud"></div>';
  let selected = 1, starts = 0;
  const shown = showStartTitle(() => {
    const root = document.createElement('div');
    return { root, cards: [{ slug: 'first' }, { slug: 'selected' }], index: selected,
      select: index => { selected = index; }, activate: () => undefined,
      dispose: () => root.remove(), start: () => { starts++; } };
  });
  shown.refresh();
  expect(selected).toBe(1);
  expect(starts).toBe(2);
  expect(document.querySelector('#hud')?.children.length).toBe(1);
  shown.dispose();
  shown.refresh();
  expect(starts).toBe(2);
  expect(document.querySelector('#hud')?.children.length).toBe(0);
});

test('BUGBASH-LOOP (J385): the title always hides the play HUD (#hud.intro) and publishes readiness', () => {
  document.body.innerHTML = '<div id="hud" class="touch"></div>';
  const ready = vi.fn((): void => undefined);
  document.addEventListener('ws:ready', ready);
  try {
    const title = showStartTitle(() => ({ root: document.createElement('div'), cards: [], index: 0,
      select: () => undefined, activate: () => undefined, start: () => undefined, dispose: () => undefined }));
    expect(ready).toHaveBeenCalledTimes(1);
    expect(document.getElementById('hud')?.classList.contains('intro')).toBe(true);
    title.dispose();
  } finally { document.removeEventListener('ws:ready', ready); }
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

// QA 11-13 (Jake, preview at 09:58: "Whenever I see this frozen screen I'm like, is it broken? ... show the version at top
// right, and have that reload button top right work, at least")
const stampedDocument = (stamped: string): Window => {
  const window = new Window({ url: 'https://launch.test/', width: 402, height: 874, settings: { enableJavaScriptEvaluation: true,
    disableJavaScriptFileLoading: true, disableCSSFileLoading: true, enableImageFileLoading: false, handleDisabledFileLoadingAsSuccess: true } });
  windows.push(window); window.document.write(stamped); return window;
};
const facts = { validator: 'a'.repeat(64), verdicts: [] };
test('QA 11-13: the static title shows the stamped build label at top right, before any module', () => {
  const pill = (window: Window): string => window.document.querySelector('[data-title-shell] .ws-launch-pill [data-launch-version]')?.textContent ?? '';
  expect(pill(stampedDocument(stampBuildHtml(html, 'f2a636b3-mx1', { ...facts, label: 'v0.1.13-100-gf2a636b3' })))).toBe('v0.1.13-100-gf2a636b3');
  expect(pill(stampedDocument(stampBuildHtml(html, 'f2a636b3-mx1')))).toBe('f2a636b'); // an older stamp: the short commit
  expect(pill(firstDocument(''))).toBe('reload'); // a dev page: no stamp, still the reload pill
  expect(() => stampBuildHtml(html, 'f2a636b3-mx1', { ...facts, label: '</script>' })).toThrow('Invalid document build label');
});

test('QA 11-13: the top-right pill reloads with every bundle missing (plain HTML, no module ran)', () => {
  const window = firstDocument(''), reload = vi.spyOn(window.location, 'reload').mockImplementation(() => undefined);
  const button = window.document.querySelector('[data-title-shell] button[data-launch-reload]');
  if (!(button instanceof window.HTMLButtonElement)) throw new Error('Missing static reload pill');
  expect(window.document.documentElement.dataset['booted']).toBeUndefined();
  expect(button.getAttribute('onclick')).toContain('location.reload');
  // STALESHELL: online with a worker, the shell's reload drops the worker first (index.html __wsShellReload); with none it reloads at once
  button.click();
  expect(reload).toHaveBeenCalled();
  expect(button.dataset['reloading']).toBe('');
});

test('QA 11-13: the static bar moves from the boot record: files, then the entry, ticking seconds, amber when stuck', async () => {
  const frames: Frames = { now: 0, callbacks: [] }, window = firstDocument('', frames);
  const shell = window.document.querySelector('[data-title-shell]'), load = shell?.querySelector('[data-launch-load]');
  const text = (): string => shell?.querySelector('[data-launch-step]')?.textContent ?? '';
  const width = (): string => (shell?.querySelector('[data-launch-fill]') as unknown as HTMLElement | null)?.style.width ?? '';
  const settle = (): Promise<void> => new Promise(resolve => { setTimeout(resolve, 150); });
  const timing = (window as unknown as { __bootTiming: { resources: { url: string; responseStatus: number | null }[]; mark: (op: string) => void } }).__bootTiming;
  frames.now = 300; await settle();
  expect(text()).toBe('Loading the page · 0.3 s'); expect(width()).toBe('0%'); // QA 11-19 row 19: the line says what it loads
  const files = [...window.document.querySelectorAll('script[type="module"][src],link[rel="modulepreload"],link[rel="stylesheet"]')]
    .map(node => new URL(node.getAttribute('src') ?? node.getAttribute('href') ?? '', 'https://launch.test/').href);
  expect(files.length).toBeGreaterThan(4);
  timing.resources.push({ url: files[0] ?? '', responseStatus: 200 }, { url: files[1] ?? '', responseStatus: 0 }); // a failed fetch counts nothing
  frames.now = 1200; await settle();
  // row 19: it names the first file still missing (here the failed one), its hash dropped
  const waiting = (files[1] ?? '').split('/').pop()?.replace(/-[A-Za-z0-9_-]{8}(?=\.\w+$)/u, '') ?? '';
  expect(waiting).toMatch(/^[\w.-]+\.(js|css)$/u);
  expect(text()).toBe(`Loading ${waiting} · 1 of ${String(files.length)} files · 1.2 s`); expect(width()).toBe(`${Math.round(80 / files.length)}%`);
  timing.mark('app:entry-body'); frames.now = 1500; await settle();
  expect(text()).toBe('Starting · 1.5 s');
  frames.now = 9600; await settle();
  expect(text()).toBe('Still waiting on the game code · tap reload · 9.6 s');
  expect(shell instanceof window.HTMLElement ? shell.dataset['stalled'] : undefined).toBe('');
  expect(shell?.querySelector('[data-launch-version]')?.textContent).toBe('reload');
  expect(load?.getAttribute('aria-valuenow')).toBe(String(Math.round(80 / files.length + 10)));
  shell?.remove(); frames.now = 9900; await settle();
  expect(text()).toBe('Still waiting on the game code · tap reload · 9.6 s'); // StartTitle removed it: the timer stopped
});

test('QA 11-13: a page the entry turns into the title later (a player reload, an unlisted shard) gets the moving bar too', async () => {
  const frames: Frames = { now: 0, callbacks: [] }, window = firstDocument('?chunk=driftwood-isle', frames);
  const text = (): string => window.document.querySelector('[data-launch-step]')?.textContent ?? '';
  const settle = (): Promise<void> => new Promise(resolve => { setTimeout(resolve, 150); });
  frames.now = 400; await settle();
  expect(text()).toBe('Loading'); // a world page: the hidden shell is left alone
  window.document.documentElement.classList.add('title-first'); frames.now = 700; await settle();
  expect(text()).toBe('Loading the page · 0.7 s');
});

// STAGING-BUGBASH SB44 (staging v0.1.38, a v0.1.36 WebKit shell): the online shell's fresh release read named a newer build, so the
// page reloaded itself into it (`stale deployment code`) a second after Driftwood reached play. A world page's address is bare `/`
// (GO4), so the reload landed on the title and the drop modal said UNEXPECTEDLY BACK AT THE TITLE, though the old page had handed its
// tap to the next document (`setTitleArrival(…, {tab: true})`). The first bytes now take that handoff back into the world.
// CHUNK-PARAM CP1 (J522): the address stays bare; the page reads the zone from the tap. A tap the world page before this one took
// (`taken`, that document's start) is a leftover unless an engine reload hands it on; an untaken one is the tap's own navigation.
function reloadedDocument(search: string, left: { reason: string; ago: number; reload?: true } | null, arrival: { slug: string; ago: number; taken?: number | null } | null): Window {
  const window = new Window({ url: `https://launch.test/${search}`, width: 402, height: 874, settings: {
    enableJavaScriptEvaluation: true, disableJavaScriptFileLoading: true, disableCSSFileLoading: true,
    enableImageFileLoading: false, handleDisabledFileLoadingAsSuccess: true,
  } });
  windows.push(window);
  const now = Date.now();
  if (left !== null) window.localStorage.setItem(`wildshard.save.v2@${saveEpoch}.device`, JSON.stringify({keys: {'life.lastUnload': {v: 1, data: {
    reason: left.reason, t: now - left.ago, build: 'old', slug: 'driftwood-isle', resident: '', mode: 'grid', ...left.reload === undefined ? {} : {reload: true},
  }}}}));
  if (arrival !== null) window.sessionStorage.setItem(`wildshard.save.v2@${saveEpoch}.session`, JSON.stringify({keys: {titleArrival: {v: 1, data: {
    slug: arrival.slug, mode: 'enter', at: now - arrival.ago, ...arrival.taken === null ? {} : { taken: arrival.taken ?? 1 },
  }}}}));
  window.document.write(html);
  return window;
}
const tapTaken = (window: Window): unknown => (JSON.parse(window.sessionStorage.getItem(`wildshard.save.v2@${saveEpoch}.session`) ?? '{}') as
  { keys?: { titleArrival?: { data?: { taken?: unknown } } } }).keys?.titleArrival?.data?.taken;
const titleFirst = (window: Window): boolean => window.document.documentElement.classList.contains('title-first');

test('SB44: the engine\'s own update reload of a bare world page goes back into the world its tap named', () => {
  for (const reason of ['stale deployment code', 'stale build: its files are gone from the server', 'new build panel', 'offline load failure']) {
    const window = reloadedDocument('', { reason, ago: 800 }, { slug: 'driftwood-isle', ago: 900 });
    expect(window.location.search, reason).toBe('');
    expect(titleFirst(window), reason).toBe(false);
    expect(tapTaken(window), `${reason}: this document takes the handed tap`).toBe(window.performance.timeOrigin);
    expect(window.document.documentElement.classList.contains('boot-menu'), reason).toBe(false);
  }
  // the harness's environment flags ride along
  const flagged = reloadedDocument('?tier=phone', { reason: 'stale deployment code', ago: 800 }, { slug: 'driftwood-isle', ago: 900 });
  expect(flagged.location.search).toBe('?tier=phone');
  expect(titleFirst(flagged)).toBe(false);
});

test('CP1: the page a tap navigated is that zone\'s world page on a bare /, and takes the tap so no later page can', () => {
  const window = reloadedDocument('', { reason: 'shard switch to driftwood-isle (fresh page)', ago: 300 }, { slug: 'driftwood-isle', ago: 300, taken: null });
  expect(window.location.search).toBe('');
  expect(titleFirst(window)).toBe(false);
  expect(window.document.documentElement.classList.contains('boot-menu')).toBe(false);
  expect(tapTaken(window)).toBe(window.performance.timeOrigin);
  const flagged = reloadedDocument('?mute=1&nolock=1', null, { slug: 'driftwood-isle', ago: 300, taken: null });
  expect(flagged.location.search, 'the harness flags stay; the zone never enters the address').toBe('?mute=1&nolock=1');
  expect(titleFirst(flagged)).toBe(false);
});

test('SB44: every other bare launch stays the title, with or without a handoff', () => {
  const cases: [string, Parameters<typeof reloadedDocument>[1], Parameters<typeof reloadedDocument>[2]][] = [
    ['a cold launch', null, null],
    ['a tap left over with no reload behind it (DL21)', null, { slug: 'driftwood-isle', ago: 900 }],
    ['a tap the world page took, then a player reload', { reason: 'shard switch to driftwood-isle (fresh page)', ago: 800 }, { slug: 'driftwood-isle', ago: 900 }],
    ['an engine reload with no tap handed over', { reason: 'stale deployment code', ago: 800 }, null],
    ['the player leaving for the title while loading', { reason: 'release page: title screen', ago: 800 }, { slug: 'driftwood-isle', ago: 900 }],
    ['exit to main menu', { reason: 'exit to main menu', ago: 800 }, { slug: 'driftwood-isle', ago: 900 }],
    ['a reload that means the title (`reload`)', { reason: 'stale deployment code', ago: 800, reload: true }, { slug: 'driftwood-isle', ago: 900 }],
    ['an old reload (over 10 s)', { reason: 'stale deployment code', ago: 12_000 }, { slug: 'driftwood-isle', ago: 900 }],
    ['an old tap (over 60 s)', { reason: 'stale deployment code', ago: 800 }, { slug: 'driftwood-isle', ago: 61_000 }],
    ['a slug that is no slug', { reason: 'stale deployment code', ago: 800 }, { slug: '../x?y', ago: 900 }],
  ];
  for (const [name, left, arrival] of cases) {
    const window = reloadedDocument('', left, arrival);
    expect(window.location.search, name).toBe('');
    expect(titleFirst(window), name).toBe(true);
  }
});
