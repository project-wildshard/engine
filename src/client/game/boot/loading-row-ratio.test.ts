// @vitest-environment happy-dom
// Jake (2026-11-12, 17:16 Cancún, v0.1.13 on LTE, Blender Template): "You can't have a progress bar, say 2 out of 31, and
// then still say 80%. Like, that doesn't make any sense." Every row's percent is the ratio its own head prints (J188).
// oxlint-disable-next-line import/no-nodejs-modules -- Run the real first document's Start painter.
import { readFileSync } from 'node:fs';
import { Window } from 'happy-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Loading } from '@wildshard/engine/ui/Loading';
import { paintSpawnDownload, type SpawnDownload, type SpawnDownloadSnapshot } from './spawnDownload';

/** Every "a of b" / "a / b" the head prints must produce its percent: the floored percent lies within the ratio its
 * one-decimal numbers can stand for. A head with no ratio passes; a second ratio that disagrees fails. */
function expectRowAgrees(fact: string, pct: string): void {
  const ratios = [...fact.matchAll(/(\d+(?:\.\d+)?)\s*(?:of|\/)\s*(\d+(?:\.\d+)?)/gu)];
  for (const [, a = '', b = ''] of ratios) {
    const half = (text: string): number => text.includes('.') ? 0.05 : 0;
    const lo = 100 * Math.max(0, Number(a) - half(a)) / (Number(b) + half(b)), hi = 100 * (Number(a) + half(a)) / Math.max(1e-9, Number(b) - half(b));
    const shown = Number(pct);
    expect({ fact, pct, agrees: shown >= Math.floor(lo) - 1e-9 && shown <= Math.min(100, hi) + 1e-9 }).toEqual({ fact, pct, agrees: true });
  }
}

describe('START: the first document\'s painter', () => {
  const windows: Window[] = [];
  afterEach(async () => { for (const window of windows.splice(0)) await window.happyDOM.close(); });
  it('prints code bytes and its percent is those bytes (Jake\'s shot: "2 / 31 code files" beside 80 %)', async () => {
    // 31 code files, 3.1 MB; two big ones (2.5 MB) are in, five of the seven boundaries done
    const files: [string, number][] = [['/assets/three.js', 1_500_000], ['/assets/main.js', 1_000_000],
      ...Array.from({ length: 29 }, (_, i): [string, number] => [`/assets/chunk-${i}.js`, 20_690])];
    const html = readFileSync('index.html', 'utf8').replace('<script data-loading-clock>',
      `<script type="application/json" id="boot-module-files">${JSON.stringify({ common: files })}</script><script data-loading-clock>`);
    const window = new Window({ url: 'https://launch.test/?chunk=_template&tier=phone', width: 402, height: 874, settings: {
      enableJavaScriptEvaluation: true, disableJavaScriptFileLoading: true, disableCSSFileLoading: true,
      enableImageFileLoading: false, handleDisabledFileLoadingAsSuccess: true } });
    windows.push(window);
    window.document.write(html);
    const timing = Reflect.get(window, '__bootTiming') as { entries: object[]; resources: object[] };
    for (const operation of ['app:document-and-module-graph', 'app:page-entry-import', 'app:tables-import-and-prepare', 'app:tier-menu-download-imports', 'app:three-import'])
      timing.entries.push({ operation, end: 1, result: 'complete' });
    for (const [url, bytes] of files.slice(0, 2)) timing.resources.push({ realm: 'page', url: `https://launch.test${url}`, decodedBodySize: bytes, transferSize: bytes / 3 });
    await new Promise(resolve => { setTimeout(resolve, 250); });
    const fact = window.document.querySelector('[data-el="stFact"]')?.textContent ?? '', pct = window.document.querySelector('[data-el="stPct"]')?.textContent ?? '';
    expect(fact).toBe('2.5 of 3.1 MB');
    expect(pct).toBe('80');
    expect(window.document.querySelector('[data-el="stBar"]')?.getAttribute('style')).toContain('width: 80%');
    expectRowAgrees(fact, pct);
  });
});

// Jake's DOWNLOAD: "1.6 of 3.9 MB" (wire) beside 52 (decoded); a template pack runs 4 MB on the wire, 8 MB decoded
const download: SpawnDownloadSnapshot = { totalBytes: 8_000_000, completedBytes: 4_160_000, cachedBytes: 0, filesTotal: 6, filesDone: 2,
  complete: false, error: null, progressKnown: true, wire: { totalBytes: 3_900_000, completedBytes: 1_400_000, cachedBytes: 0, arrivingBytes: 200_000 } };

const quietDom = (): void => {
  vi.useFakeTimers();
  vi.spyOn(performance, 'now').mockImplementation(() => 100);
  vi.stubGlobal('PerformanceObserver', class { observe(): void { /* no transport here */ } disconnect(): void { /* no transport here */ } takeRecords(): PerformanceEntry[] { return []; } });
};
const source: SpawnDownload = { ready: new Promise<void>(() => { /* stays open: mid-download */ }), snapshot: () => download, resolve: url => url,
  cancel: () => undefined, subscribe: listener => { listener(download); return () => undefined; } };

describe('DOWNLOAD', () => {
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); document.body.replaceChildren(); });
  it('the early painter (before Loading adopts) prints the same ratio it paints', () => {
    const root = document.createElement('div'); root.innerHTML = '<span data-el="dlFact"></span><span data-el="dlPct"></span><i data-el="dlBar"></i>';
    const stop = paintSpawnDownload(source, root);
    const fact = root.querySelector('[data-el="dlFact"]')?.textContent ?? '', pct = root.querySelector('[data-el="dlPct"]')?.textContent ?? '';
    expect(fact).toBe('1.6 of 3.9 MB');
    expectRowAgrees(fact, pct);
    expect(root.querySelector<HTMLElement>('[data-el="dlBar"]')?.style.width).toBe(`${pct}%`);
    stop();
  });
  it('Loading\'s head and percent come from the one ratio, wire or decoded', () => {
    quietDom();
    const loading = new Loading({ id: 'ratio', name: 'Ratio' });
    try {
      void loading.setDownloadSource(source);
      const fact = loading.root.querySelector('[data-el="dlFact"]')?.textContent ?? '';
      expect(fact).toBe('1.6 of 3.9 MB');
      expectRowAgrees(fact, loading.root.querySelector('[data-el="dlPct"]')?.textContent ?? '');
    } finally { loading.scope.dispose(); }
  });
});

describe('LOAD', () => {
  let now = 100;
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); document.body.replaceChildren(); });
  it('prints no step ratio beside its measured-cost percent ("step 15 / 20" sat beside 81.4)', () => {
    vi.useFakeTimers(); now = 100;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    vi.stubGlobal('PerformanceObserver', class { observe(): void { /* no transport here */ } disconnect(): void { /* no transport here */ } takeRecords(): PerformanceEntry[] { return []; } });
    const loading = new Loading({ id: 'ratio', name: 'Ratio' });
    try {
      const fact = (): string => loading.root.querySelector('[data-el="suFact"]')?.textContent ?? '';
      const pct = (): string => loading.root.querySelector('[data-el="suPct"]')?.textContent ?? '';
      loading.setPath({ id: 'shardfile', steps: [{ key: 'modules', label: 'Modules', weight: 1 },
        { key: 'admission', label: 'Product admission', weight: 8 }, { key: 'world', label: 'World', weight: 1 }] });
      now = 400; vi.advanceTimersByTime(100);
      expectRowAgrees(fact(), pct());
      loading.paintAdmission({ phase: 'product', detail: 'Reading files', bytesRead: 5, bytesTotal: 10, filesDone: 6, filesTotal: 10 });
      now = 700; vi.advanceTimersByTime(100);
      expect(fact()).toContain('Product admission');
      expectRowAgrees(fact(), pct());
    } finally { loading.scope.dispose(); }
  });
});
