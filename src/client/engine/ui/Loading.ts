import { uiScope, mountUi } from './ownership';
import { bootMark, bootTiming } from '../../../shared/engine/boot/timing';
import { serverBootProgress } from '../../../shared/engine/boot/serverProgress';
import { diagnosticNow } from '../../../shared/engine/core/clock';
import {app} from '../app/runtime';
import { engineString } from '../../../shared/engine/strings';
import { saveStorage } from '../saves/slots';
import { formatMB, type ProgressView } from '../boot/plan';
import { bootWaits, loadingStepWaits, STAGE_READS } from '../../../shared/engine/boot/waits';
import { TIER } from '../core/tier';
import { loadShellTemplate, START_STEPS, stopShellClock } from '../boot/shell';
import { appIdentity } from '../../../shared/engine/app/identity';
import { recordBootCheckpoint, recordBootProgress, startBoot } from '../boot/bootTrace';
import { adoptLoadingWait } from '../boot/download';
import { beginLoadingWait, reportLoadingWait, finishLoadingWait, loadingWaitState } from '../../../shared/engine/boot/loadingWaits';
import { loadingCacheText, loadingDownloadText, loadingDownloadFraction, loadingPrefetchFraction, loadingPrefetchText, type LoadingPrefetchSnapshot, type LoadingDownloadSnapshot } from '../boot/loadingDownloadText';
import { LoadingTimeline, installLoadingTimeline, type LoadingPath, type LoadingRow, type LoadingGap } from '../../../shared/engine/boot/timeline';
import {loadingFraction} from '../boot/weights';
import {TimeLeftClock,timeLeftSeconds,timeLeftText} from '../boot/timeLeft';
import {diagnosticBuild,diagnosticStep,safeBootDiagnostics} from '../boot/diagnostics';
import { isDev, onDev } from '../core/devMode';
import { getSetting, onSetting } from './Settings';
import { listenTap } from '../input/dom';
import { withOwner } from '../../../shared/engine/app/ownership';
import { holdLoadingSwitch } from './devSwitch';
import { markReload } from '../boot/lastEnd';
import { copyText, setDiagnosticsSource } from './diagnosticsCopy';
import './loading.css';

const savedStorage = saveStorage('session');
/**
 * Loading screen in the Wildshard staging identity — a painter of the boot plan's view
 * (src/client/engine/boot/plan.ts) and nothing else: two tracks (DOWNLOAD bytes read / declared, SETUP
 * weighted steps and reported sub-progress) as integers that read 100 only when the fraction is exactly 1,
 * an elapsed clock, and one row per step with its wall ms and live detail. Bytes and completed work come
 * from the producer; unknown totals and waits stay explicit. `done()` fades it out and resolves when it is gone.
 *
 * Everyone sees the detailed tracks, grouped step log, tier and elapsed clock (G846).
 * Only the existing hold-at-completion setting is Developer-only.
 */
type TimelineSnapshot = ReturnType<LoadingTimeline['snapshot']>;
type ElKey = 'clock' | 'kicker' | 'stHead' | 'stFact' | 'stPct' | 'stBar' | 'stRows' | 'dlHead' | 'dlFact' | 'dlPct' | 'dlBar' | 'dlRows' | 'pfRow' | 'pfFact' | 'pfPct'
  | 'suHead' | 'suFact' | 'suPct' | 'suBar' | 'suRows' | 'foot' | 'slug' | 'tier' | 'retry' | 'leftRow' | 'left';
/** LS2 (J188, density 2): three phases that add up to the total. Start runs from the tap until this panel adopts the
 *  card (the game's own code), Download until the spawn download closes, Load until the world is ready. */
export type LoadingPhase = 'start' | 'download' | 'load';
const PHASES: readonly LoadingPhase[] = ['start', 'download', 'load'];

/** Write text only when it changed: an unchanged textContent write still dirties layout. */
const set = (el: HTMLElement, text: string): void => { if (el.textContent !== text) el.textContent = text; };
/** The same for a `data-*` attribute: the plan republishes on every byte chunk and sub-step, and every attribute write
 *  (even an unchanged one) invalidates style and queues a mutation record (SF67). */
const setData = (el: HTMLElement, key: string, value: string): void => { if (el.dataset[key] !== value) el.dataset[key] = value; };
const mb = (bytes: number): string => `${(bytes / 1_000_000).toFixed(1)} MB`;
/** LS3: every write of a bar uses one precision, so two writers of the same reading can never step it back. */
/** J204 (Jake, 2026-11-09): the Load phase's number shows tenths, so a 0.1 % step is visible on the card ("moving the bar
 *  from 91.2 to 91.3 every 2s etc is visible progress"); it floors like the bar, and reads 100 only when complete. */
const loadPct = (fraction: number): string => fraction >= 1 ? '100' : (Math.floor(Math.max(0, fraction) * 1000) / 10).toFixed(1);
const barWidth = (fraction: number): string => `${(Math.floor(Math.max(0, Math.min(1, fraction)) * 1000) / 10).toFixed(1)}%`;
/** LS2: the ready card's three phase times in tenths that add up to its clock's tenths (largest remainder). */
export function phaseTenths(parts: readonly number[], total: number): number[] {
  const phaseTotal=parts.reduce((value,ms)=>value+ms,0);
  if(!Number.isFinite(total)||total<0||parts.some(ms=>!Number.isFinite(ms)||ms<0)
    ||Math.abs(phaseTotal-total)>Math.max(0.000001,Math.abs(total)*Number.EPSILON*4))throw new RangeError('Loading phases must partition their total');
  const want = Math.round(Math.max(0, total) / 100), raw = parts.map(ms => Math.max(0, ms) / 100);
  const shown = raw.map(Math.floor);
  const order = raw.map((value, index) => ({ index, rest: value - Math.floor(value) })).sort((a, b) => b.rest - a.rest);
  for (let left = want - shown.reduce((sum, value) => sum + value, 0), at = 0; left > 0 && order.length > 0; left--, at++) {
    const pick = order[at % order.length];
    if (pick !== undefined) shown[pick.index] = (shown[pick.index] ?? 0) + 1;
  }
  return shown;
}
/** Write a bar only when its reading changed. */
const setBar = (el: HTMLElement, fraction: number): void => { const width = barWidth(fraction); if (el.style.width !== width) el.style.width = width; };
const seconds = (ms: number): string => Number.isFinite(ms) ? `${(Math.max(0, ms) / 1000).toFixed(1)} s` : '—';
interface LogRow { readonly label: string; readonly detail: string; readonly ms: number }
/** One fixed log (Start's and Download's rows): written only where the text changed. */
function paintLog(log: HTMLElement, rows: readonly LogRow[]): void {
  while (log.children.length > rows.length) log.lastElementChild?.remove();
  while (log.children.length < rows.length) { const d = document.createElement('div'); d.className = 'ok'; d.innerHTML = engineString('s_a9fadf880555'); log.append(d); }
  rows.forEach((row, index) => {
    const el = log.children[index] as HTMLElement;
    set(el.children[0] as HTMLElement, row.label); set(el.children[1] as HTMLElement, row.detail);
    set(el.children[2] as HTMLElement, Number.isFinite(row.ms) ? seconds(row.ms) : '');
  });
}


/** Renderer-independent admission facts; the caller owns its phases and actual byte counter. */
export interface LoadingAdmission {
  phase: string; detail: string; bytesRead: number; bytesTotal: number; filesDone: number; filesTotal: number;
}
/** The composition root lends its one manifest operation. The UI never
 * discovers files, estimates their sizes or decides that a read is complete. */
export interface LoadingDownloadSource {
  readonly ready: Promise<void>;
  readonly snapshot: () => LoadingDownloadSnapshot;
  readonly subscribe: (listener: () => void) => () => void;
}
/** Facts repaint at 5 Hz; the clock samples at 10 Hz. Done and errors paint at once. */
const PAINT_MS = 200;
const CLOCK_MS = 100;
let currentLoading: { id: string; loading: Loading } | null = null;
/** the loading screen: the download and set-up bars, the boot steps' rows, the tier and the diagnostics */
export class Loading {
  readonly scope: ReturnType<typeof uiScope> = uiScope('Loading');
  root: HTMLElement;
  private els: Record<ElKey, HTMLElement>;
  private rowsEl: HTMLElement;
  private t0 = performance.now();
  private clockT0 = this.t0;
  private readonly clockScope = this.scope.child('clock');
  private view: ProgressView | null = null;
  private dirty = false;
  private lastPaintAt = 0;
  private lastPaintStep = '';
  private textureBytes = 0;
  /** Page-axis ends of Start and Download, and the ready time: the phases' exclusive wall segments. */
  private startEndAt = Number.NaN;
  private downloadEndAt = Number.NaN;
  private readyAt = Number.NaN;
  /** Phases the player opened by tapping; the running phase is always open. */
  private readonly opened = new Set<LoadingPhase>();
  private copyButton: HTMLButtonElement | null = null;
  private readonly attempt: number;
  private admission: LoadingAdmission | null = null;
  private prefetchSource: (() => LoadingPrefetchSnapshot | null) | undefined;
  private downloadSource: LoadingDownloadSource | undefined;
  private stopDownloadSource: (() => void) | undefined;
  private readonly timeline: LoadingTimeline;
  private phase: { end: () => void; detail: (text: string) => void } | undefined;
  private phaseKey = 'modules';
  private readonly waitId: number;
  private retryWait: (() => void) | null = null;
  private retryNavigation = true;
  private configured = false;
  private finished = false;
  private completion: Promise<void> | undefined;
  private playPicked = false;
  private shownSetup = 0;
  /** whether any transfer fact (a source with declared files or bytes, or its completion) has been painted */
  private downloadKnown = false;
  private readonly admissionPhases = new Set<string>();
  private readonly paintedRows: (LoadingRow | LoadingGap)[] = [];
  /** G555: a mid-play load (a grid cell entry): no boot trace, no adopted shell, no page-wide timeline or download
   *  accounting; its owner drives the steps (`scopedStep`) and `done()` disposes it */
  private readonly scoped: boolean;
  private failedReason: string | null = null;
  /** LS5: the shown time left, and whether the shaders step measured a GPU the time-left tables do not describe. */
  private readonly timeLeft = new TimeLeftClock();
  private slowGpu = false;
  private timeLeftShown = false;

  constructor(chunk: { id: string; name: string; trace?: boolean }, mode: { readonly scoped?: boolean } = {}) {
    bootMark('app:loading-adopt', {scoped: mode.scoped === true, chunk: chunk.id});
    app.ui.bindPresentation(this.scope);app.ui.holdCovered(this.scope);
    this.scoped = mode.scoped === true;
    if (!this.scoped) startBoot({ id: chunk.id, name: chunk.name }, TIER === 'phone' && chunk.trace === true);
    // LS4: a fatal load screen covers this card; it copies the same report through this source.
    if (!this.scoped) setDiagnosticsSource(() => this.diagnosticsText());
    // index.html paints this panel from its first bytes (src/client/engine/boot/shell.ts): adopt it; a page without it gets a fresh one
    const shell = this.scoped ? null : document.querySelector<HTMLElement>('.ws-load[data-shell]');
    if (shell) { stopShellClock(); this.root = shell; delete shell.dataset['shell']; mountUi(shell, this.scope, document.body); }
    else {
      this.root = document.createElement('div');
      this.root.className = 'ws-load';
      this.root.innerHTML = loadShellTemplate();
      mountUi(this.root, this.scope, document.body);
    }
    // RL3: index.html's card has no inline clock any more; an adopted first-document card started with the document
    const startedAt = Number(this.root.dataset['startedAt'] ?? (shell !== null ? 0 : Number.NaN));
    if (Number.isFinite(startedAt) && startedAt >= 0 && startedAt <= this.t0) this.t0 = startedAt;
    this.clockT0 = this.t0;
    const clockStartedAt = Number(this.root.dataset['clockStartedAt']);
    if (Number.isFinite(clockStartedAt) && clockStartedAt <= this.t0 && clockStartedAt >= this.t0 - 60000) this.clockT0 = clockStartedAt;
    this.timeline = new LoadingTimeline({ id: 'pending', steps: [{ key: 'modules', label: engineString('s_loading_modules'), weight: 1 }] }, this.t0,
      undefined, {readSetup: () => {
        // the whole percent the card publishes (data-setup); its text shows tenths (J204)
        const shown = this.root.dataset['setup'];
        return shown === undefined || shown === '' ? undefined : Number(shown);
      }, beforeStart: () => { this.paintBoundarySetup(); },
      initialSetup: {at: startedAt, setup: Number(this.root.dataset['initialSetup'])}});
    this.phase = this.scoped ? undefined : this.timeline.begin('modules');
    this.waitId = this.scoped ? beginLoadingWait('Loading cell', { owner: this.timeline.waitOwner, startedAt: this.t0 })
      : adoptLoadingWait(this.root, this.timeline.waitOwner, 'modules');
    this.scope.onDispose(() => { finishLoadingWait(this.waitId); });
    if (!this.scoped) this.scope.onDispose(installLoadingTimeline(this.timeline));
    this.scope.onDispose(() => {this.stopDownloadSource?.();});
    const tagline = this.root.querySelector('.ws-load-tagline'); if (tagline === null) throw new Error('Loading: no tagline'); tagline.textContent = appIdentity().tagline;
    const el = (key: ElKey): HTMLElement => { const e = this.root.querySelector<HTMLElement>(`[data-el="${key}"]`); if (!e) throw new Error(`Loading: no [data-el="${key}"]`); return e; };
    const keys: readonly ElKey[] = ['clock', 'kicker', 'stHead', 'stFact', 'stPct', 'stBar', 'stRows', 'dlHead', 'dlFact', 'dlPct', 'dlBar', 'dlRows', 'pfRow', 'pfFact', 'pfPct',
      'suHead', 'suFact', 'suPct', 'suBar', 'suRows', 'foot', 'slug', 'tier', 'retry', 'leftRow', 'left'];
    this.els = Object.fromEntries(keys.map(key => [key, el(key)])) as Record<ElKey, HTMLElement>;
    set(this.els.kicker, engineString('s_loading_kicker'));
    // Density 2: only the running phase shows its rows; a tap on a phase opens (or closes) the others.
    for (const [phase, head] of [['start', this.els.stHead], ['download', this.els.dlHead], ['load', this.els.suHead]] as const) {
      listenTap(this.scope, head, () => { if (this.opened.has(phase)) this.opened.delete(phase); else this.opened.add(phase); this.paintPhases(); });
    }
    this.els.retry.onclick = null; // Adopt the inline retry without keeping its document-only handler.
    set(this.els.retry, engineString('s_loading_retry'));
    listenTap(this.scope, this.els.retry, () => { if (this.retryWait === null) return; if (this.retryNavigation) markReload('loading wait retry'); this.retryWait(); });
    // LS6: an adopted card already names the arrival's destination (a grid tap resumes at its last place); keep it.
    if (shell === null || this.els.slug.textContent === '') this.els.slug.textContent = chunk.name;
    const key = 'loadAttempt';
    let attempt = 1;
    try {
      const previous: unknown = JSON.parse(savedStorage.getItem(key) ?? 'null');
      if (typeof previous === 'object' && previous !== null && Reflect.get(previous, 'slug') === chunk.id) {
        const when: unknown = Reflect.get(previous, 'at');
        const count: unknown = Reflect.get(previous, 'count');
        if (typeof when === 'number' && Date.now() - when < 120_000 && typeof count === 'number') attempt = count + 1;
      }
      savedStorage.setItem(key, JSON.stringify({ slug: chunk.id, at: Date.now(), count: attempt }));
    } catch { /* a storage-denied PWA still gets the loader */ }
    this.attempt = attempt;
    const earlyTiming = bootTiming(); if (earlyTiming !== undefined) earlyTiming.attemptCount = attempt;
    set(this.els.tier, this.tierText());
    this.rowsEl = this.els.suRows;
    // Start ends here: the game's own code owns the card. A scoped (mid-play) load has no Start.
    this.root.querySelector<HTMLElement>('[data-phase="start"]')?.toggleAttribute('hidden', this.scoped);
    this.startEndAt = this.scoped ? this.t0 : diagnosticNow();
    if (!this.scoped) this.paintStart();
    this.root.querySelector<HTMLElement>('[data-phase="download"]')?.toggleAttribute('hidden', this.scoped);
    if (!this.scoped) {
      const hold = holdLoadingSwitch(this.scope); hold.classList.add('ws-load-hold');
      this.root.querySelector('.ws-load-body')?.append(hold);
    }
    set(this.els.suFact, engineString('s_loading_waiting'));
    this.paintPhases();
    this.tickClock();
    this.clockScope.interval(CLOCK_MS, () => { this.tickClock(); });
    const unsubscribe = bootTiming()?.subscribe?.(() => { this.readServerProgress(); });
    if (unsubscribe !== undefined) this.clockScope.onDispose(unsubscribe);
  }

  /** Read application-owned disk-prefetch progress without changing this attempt's wire accounting. */
  setPrefetchSource(source: () => LoadingPrefetchSnapshot | null): void { this.prefetchSource = source; this.dirty = true; }

  /** Adopt one manifest operation and retire this panel's old receipt observer. */
  setDownloadSource(source: LoadingDownloadSource): Promise<void> {
    if (this.downloadSource === source) return source.ready;
    this.root.querySelector<HTMLElement>('[data-phase="download"]')?.removeAttribute('hidden');
    this.stopDownloadSource?.();
    this.downloadSource = source;
    const timing=bootTiming();
    if(!this.scoped&&timing!==undefined)(timing.work??={}).download=source.snapshot;
    this.scope.onDispose(()=>{if(timing?.work?.download===source.snapshot)delete timing.work.download;});
    this.stopDownloadSource = source.subscribe(() => {
      const fraction = this.paintDownloads();
      set(this.els.dlPct, this.downloadPct(fraction)); setBar(this.els.dlBar, fraction);
      this.dirty = true;
    });
    return source.ready;
  }

  /** Show real pre-session work. Unknown totals stay explicit instead of inventing a percentage. */
  paintAdmission(progress: LoadingAdmission): void {
    if (this.view !== null) throw new Error('Admission progress arrived after world setup started');
    if (!this.scoped && !this.admissionPhases.has(progress.phase)) { this.admissionPhases.add(progress.phase); recordBootCheckpoint(`admission:${progress.phase}`, { detail: progress.detail }); }
    this.admission = progress;
    const phase = progress.phase === 'modules' ? 'modules' : 'admission';
    let phaseChanged = false;
    if (this.phase !== undefined && phase !== this.phaseKey) {
      this.phase.end(); this.phase = this.timeline.begin(phase); this.phaseKey = phase; phaseChanged = true;
    }
    const files = progress.filesTotal > 0 ? ` · ${progress.filesDone} / ${progress.filesTotal} files` : '';
    const bytes = progress.bytesTotal > 0 || progress.bytesRead > 0 ? ` · ${formatMB(progress.bytesRead)} read` : '';
    const detail = `${progress.detail}${files}${bytes}`;
    this.phase?.detail(detail);
    // Admission switches inventories: one descriptor, then sections, then
    // assets and cache verification. Their local counts describe the work,
    // not a fraction of the complete stage. Completion credits that stage.
    if (phase === 'modules') this.timeline.report(phase, detail, progress.filesDone, progress.filesTotal);
    else this.timeline.report(phase, detail);
    // Hand off the footer before exposing the new phase to the next callback;
    // same-phase byte updates keep the ordinary paced panel repaint.
    if (phaseChanged) this.paintWaiting(this.timeline.snapshot());
    setData(this.root, 'step', `admission.${progress.phase}`);
    this.dirty = true;
  }

  /** G555: a scoped load's current step (a key of its `setPath` path) and its live detail. Earlier steps end as it moves on. */
  scopedStep(key: string, detail: string): void {
    if (!this.scoped) throw new Error('Loading: scopedStep is for a scoped (mid-play) load');
    if (key !== this.phaseKey || this.phase === undefined) { this.phase?.end(); this.phase = this.timeline.begin(key, detail); this.phaseKey = key; }
    else this.phase.detail(detail);
    this.admission = { phase: key, detail, bytesRead: 0, bytesTotal: 0, filesDone: 0, filesTotal: 0 };
    setData(this.root, 'step', key);
    this.dirty = true;
  }
  /** G555: a scoped load that cannot finish (a refused cell): its reason stays on the screen until the owner disposes it. */
  scopedFail(reason: string): void {
    if (!this.scoped) throw new Error('Loading: scopedFail is for a scoped (mid-play) load');
    this.admission = { phase: this.phaseKey, detail: reason, bytesRead: 0, bytesTotal: 0, filesDone: 0, filesTotal: 0 };
    this.failedReason = reason; setData(this.root, 'failed', 'true'); set(this.els.foot, reason); this.dirty = true; this.showCopy();
  }

  /** Explain module/tier/SW waits before the first source denominator is known. */
  waiting(detail: string): void {
    this.paintAdmission({ phase: 'modules', detail, bytesRead: 0, bytesTotal: 0, filesDone: 0, filesTotal: 0 });
  }

  /** The composition root supplies the actual path's vocabulary before its product or world starts. */
  setPath(path: LoadingPath): void {
    this.timeline.configure(path); setData(this.root, 'path', path.id);
    this.configured = true;
  }
  /** End pre-session admission before LevelLoader's data/world boundaries take over. */
  endAdmission(): void { this.phase?.end(); this.phase = undefined; }

  /**
   * The plan publishes a view on every event (every byte chunk of every fetch, every sub-step); the
   * cheap attributes land at once (`data-step` is what the bench and the tests read), the text and
   * bars at most once per frame (`tickClock`) — the DOM writes and the layout they force were ~8 %
   * of a phone-tier load at 4× CPU (project/archive/2026-09-22-load-perf.md Status). Integers floor, so 100 means done.
   */
  paint(view: ProgressView): void {
    this.phase?.end(); this.phase = undefined;
    let v = view;
    v = { ...v, setup: this.setupProgress() };
    const transfer = this.downloadProgress();
    v = { ...v, bytesRead: transfer.completedBytes, bytesTotal: transfer.totalBytes,
      filesDone: transfer.filesDone, filesTotal: transfer.filesTotal, download: transfer.fraction };
    this.view = v;
    if (!this.scoped) recordBootProgress(v);
    this.dirty = true;
    const pct = (f: number): string => String(Math.floor(f * 100));
    this.paintDownloadCounters(transfer);
    setData(this.root, 'setup', pct(v.setup));
    if (v.error) { this.els.foot.textContent = v.error; this.paintNow(); this.showCopy(); }
    else if (v.done) this.paintNow();
  }

  /** Text + bars from the latest view; only what changed is written (a write forces the next layout). */
  private paintNow(): void {
    if (!this.dirty) return;
    const timeline = this.timeline.snapshot();
    this.paintWaiting(timeline);
    const v = this.view;
    if (!v) { this.paintAdmissionNow(timeline); return; }
    this.dirty = false;
    set(this.els.tier, this.tierText());
    const pct = (f: number): string => String(Math.floor(f * 100));
    const download = this.paintDownloads();
    setData(this.root, 'setup', pct(v.setup));
    set(this.els.dlPct, this.downloadPct(download));
    set(this.els.suPct, loadPct(v.setup));
    setBar(this.els.dlBar, download); setBar(this.els.suBar, v.setup);
    this.paintRows(timeline);
    this.paintPhases();
    this.paintTimeLeft(timeline);
  }

  private paintAdmissionNow(timeline: TimelineSnapshot): void {
    const p = this.admission;
    if (p === null) return;
    this.dirty = false;
    const download = this.paintDownloads();
    const setup = this.setupProgress();
    setData(this.root, 'download', String(Math.floor(download * 100)));
    setData(this.root, 'setup', String(Math.floor(setup * 100)));
    set(this.els.dlPct, this.downloadPct(download)); set(this.els.suPct, loadPct(setup));
    setBar(this.els.dlBar, download); setBar(this.els.suBar, setup);
    set(this.els.suFact, p.detail);
    this.paintRows(timeline);
    this.paintPhases();
  }

  private downloadProgress(): LoadingDownloadSnapshot & {readonly fraction: number} {
    const row = this.downloadSource?.snapshot() ?? {totalBytes: 0, completedBytes: 0, cachedBytes: 0,
      filesDone: 0, filesTotal: 0, complete: false, error: null};
    return {...row, fraction: loadingDownloadFraction(row)};
  }

  private setupProgress(): number {
    if (!this.configured) return 0;
    this.shownSetup = Math.max(this.shownSetup, loadingFraction(this.timeline.snapshot().rows, this.finished));
    return this.shownSetup;
  }

  /** Publish completed credit before new work begins, without repainting rows or diagnostics. */
  private paintBoundarySetup(): void {
    const setup = this.setupProgress(), pct = String(Math.floor(setup * 100));
    setData(this.root, 'setup', pct); set(this.els.suPct, loadPct(setup));
    setBar(this.els.suBar, setup);
  }

  /** Publish each cheap progress tuple together, even between throttled paints. */
  private paintDownloadCounters(row: LoadingDownloadSnapshot & {readonly fraction: number}): void {
    setData(this.root, 'download', row.progressKnown === false ? '' : String(Math.floor(row.fraction * 100)));
    setData(this.root, 'cachedBytes', String(row.cachedBytes));
    setData(this.root, 'pendingBytes', String(row.totalBytes - row.completedBytes));
    setData(this.root, 'declaredBytes', String(row.totalBytes));
    setData(this.root, 'readBytes', String(row.completedBytes));
    setData(this.root, 'readCachedBytes', String(row.cachedBytes));
    setData(this.root, 'readUnknownSourceBytes', '0');
    setData(this.root, 'readsClosed', String(row.complete));
    setData(this.root, 'entryDownloadBytes', String(row.totalBytes));
    setData(this.root, 'spawnFilesDone', String(row.filesDone));
    setData(this.root, 'spawnFilesTotal', String(row.filesTotal));
    setData(this.root, 'streamedBytes', String(row.streamedBytes ?? row.completedBytes));
  }

  /** MF4 (sp-x6): the DOWNLOAD number before any transfer fact (no source, nothing declared) reads unknown, never an
   *  invented 0 that a page already holding a complete download would visibly step back to */
  private downloadPct(fraction: number): string { return this.downloadKnown ? String(Math.floor(fraction * 100)) : '—'; }

  private paintDownloads(): number {
    const transfer = this.downloadProgress();
    this.downloadKnown = transfer.complete || transfer.progressKnown !== false && (transfer.totalBytes > 0 || transfer.filesTotal > 0);
    this.paintDownloadCounters(transfer);
    const prefetch = this.prefetchSource?.() ?? null;
    setData(this.root, 'prefetch', prefetch === null ? '' : JSON.stringify(prefetch));
    if (transfer.complete && !(this.downloadEndAt >= 0)) this.downloadEndAt = Math.max(diagnosticNow(), this.startEndAt);
    set(this.els.dlFact, this.downloadEndAt >= 0 ? this.phaseDone(this.downloadEndAt - this.startEndAt) : loadingDownloadText(transfer));
    this.paintDownloadRows(transfer);
    this.els.pfRow.hidden = prefetch === null;
    if (prefetch !== null) { set(this.els.pfFact, loadingPrefetchText(prefetch)); set(this.els.pfPct, String(Math.floor(loadingPrefetchFraction(prefetch) * 100))); }
    return transfer.fraction;
  }

  private paintRows(timeline: TimelineSnapshot): void {
    // Passive capture of all rows, including collapsed quick steps. The DOM
    // owns this data; importing the module installs no observer or service.
    Reflect.set(this.root, Symbol.for('engine.loading.snapshot'), timeline);
    const current = timeline.rows.find(row => row.key === timeline.current);
    const currentGap = timeline.gaps.find(row => row.state === 'on');
    setData(this.root, 'step', current?.key ?? 'gap');
    if (current !== undefined) set(this.els.suFact, this.configured
      ? engineString('s_af18899b96b3', [current.number, timeline.rows.length, current.label, current.detail ? engineString('s_614cafefe4f0', [current.detail]) : ''])
      : `${current.label}${current.detail ? ` · ${current.detail}` : ''}`);
    else set(this.els.suFact, currentGap?.label ?? 'Final activation');
    const shown: (LoadingRow | LoadingGap)[] = [];
    for (const gap of timeline.gaps) if (gap.after === null) shown.push(gap);
    for (const row of timeline.rows) {
      if (row.state === 'todo') continue;
      shown.push(row);
      for (const gap of timeline.gaps) if (gap.after === row.key) shown.push(gap);
    }
    const quick = shown.filter(row => 'key' in row && (row.state === 'ok' || this.finished) && row.ms < 500);
    // Rows run in step order (QA 3): a gap sits after its step; the quick steps' total closes the list.
    const order = (row: LoadingRow | LoadingGap): number => 'number' in row ? row.number : row.after === null ? 0 : timeline.rows.find(step => step.key === row.after)?.number ?? 0;
    const visible = shown.filter(row => row.ms >= 500).sort((x, y) => order(x) - order(y));
    if (quick.length > 0) visible.push({ label: engineString('s_loading_quick_steps', [quick.length]), state: 'ok', ms: quick.reduce((sum, row) => sum + row.ms, 0), after: null });
    while (this.rowsEl.children.length > visible.length) this.rowsEl.lastElementChild?.remove();
    this.paintedRows.length = visible.length;
    while (this.rowsEl.children.length < visible.length) { const d = document.createElement('div'); d.innerHTML = engineString('s_a9fadf880555'); this.rowsEl.append(d); }
    visible.forEach((r, i) => {
      const previous = this.paintedRows[i];
      // Completed rows keep their exact values. Avoid translating their
      // labels and reading their DOM children on every active-step paint.
      if (previous !== undefined && previous.state === r.state && previous.ms === r.ms
        && previous.label === r.label
        && ('detail' in previous ? previous.detail : '') === ('detail' in r ? r.detail : '')
        && ('key' in previous ? previous.key : 'gap') === ('key' in r ? r.key : 'gap')
        && ('number' in previous ? previous.number : 0) === ('number' in r ? r.number : 0)) return;
      this.paintedRows[i] = r;
      const el = this.rowsEl.children[i] as HTMLElement;
      const cls = r.state === 'on' ? 'on' : 'ok';
      if (el.className !== cls) el.className = cls;
      set(el.children[0] as HTMLElement, r.label);
      set(el.children[1] as HTMLElement, 'detail' in r ? r.detail : '');
      setData(el, 'key', 'key' in r ? r.key : 'gap');
      setData(el, 'ms', String(r.ms));
      setData(el, 'startedAt', 'key' in r && r.startedAt !== undefined ? String(r.startedAt) : '');
      setData(el, 'setupAtStart', 'key' in r && r.setupAtStart !== undefined ? String(r.setupAtStart) : '');
      const ms = r.ms;
      set(el.children[2] as HTMLElement, ms >= 1000 ? engineString('s_51b784eb9dd6', [(ms / 1000).toFixed(1)]) : engineString('s_f3813306296c', [Math.round(ms)]));
    });
  }

  /**
   * LS5 (J188): time left from the path's measured rows and this device's measured speed (boot/timeLeft.ts), hidden until
   * the readings make it honest: a path measured on two profiles, a second of finished work to read the speed from, the
   * download closed, and a GPU like the ones measured. A GPU the shaders step measured slow (a software renderer, LS8's
   * narrow first frame) builds its pipelines on the CPU inside the first frame, 20 times the measured seconds: no table
   * describes it, so the card shows no number for the rest of that boot.
   */
  private paintTimeLeft(timeline: TimelineSnapshot): void {
    const row = this.els.leftRow;
    if (this.finished || this.scoped || this.view?.error || this.failedReason !== null) {
      row.hidden = true; delete row.dataset['shown']; setData(this.root, 'timeLeft', ''); setData(this.root, 'timeLeftSeconds', ''); return;
    }
    const transfer = this.downloadProgress();
    const honest = this.configured && (this.downloadSource === undefined || transfer.complete) && !this.measuredSlowGpu(timeline);
    const shown = this.timeLeft.read(performance.now(), honest ? timeLeftSeconds(timeline.rows) : null);
    if (shown === null) { delete row.dataset['shown']; setData(this.root, 'timeLeft', ''); setData(this.root, 'timeLeftSeconds', ''); return; }
    set(this.els.left, timeLeftText(shown.seconds));
    row.dataset['shown'] = '';
    // the estimate, and the whole seconds the card shows (the LS5 proof scores what the player reads)
    setData(this.root, 'timeLeft', String(shown.ms)); setData(this.root, 'timeLeftSeconds', String(shown.seconds));
    if (!this.timeLeftShown) { this.timeLeftShown = true; bootMark('app:time-left-shown', { seconds: shown.seconds }); }
  }

  /** LS8's reading of the GPU, written once after the shaders step (finish.ts `app:first-frame-plan`). */
  private measuredSlowGpu(timeline: TimelineSnapshot): boolean {
    if (this.slowGpu) return true;
    if (timeline.rows.find(row => row.key === 'shaders')?.state !== 'ok') return false;
    const plan = bootTiming()?.entries.find(entry => entry.operation === 'app:first-frame-plan');
    this.slowGpu = plan?.detail['narrow'] === true;
    return this.slowGpu;
  }

  /** Actual collector events publish even if a worker boots between clock ticks. */
  private readServerProgress(): void {
    // LS7: the worker's completed internal work is already in the collector.
    // Sampling it cannot mint work; a quiet/failed worker leaves the count fixed.
    const server = this.timeline.snapshot().rows.find(row => row.key === 'server' && row.state === 'on');
    const timing = bootTiming();
    if (server?.startedAt !== undefined && timing !== undefined) {
      const progress = serverBootProgress(timing, server.startedAt);
      this.timeline.report('server', progress.detail, progress.done, progress.total);
      setData(this.root, 'serverSteps', String(progress.steps));
      setData(this.root, 'serverFiles', String(progress.files));
      setData(this.root, 'serverBytes', String(progress.bytes));
    }
  }

  private tickClock(): void {
    const now = this.readyAt >= 0 ? this.readyAt : performance.now();
    // The clock is one text node, sampled at its displayed precision without another animation-frame chain.
    const s = (now - this.clockT0) / 1000;
    set(this.els.clock, engineString('s_c0951c6055b1', [String(Math.floor(s / 60)).padStart(2, '0'), (s % 60).toFixed(1).padStart(4, '0')]));
    // SF67 / G622: within a step the bars, rows and facts repaint at most PAINT_MS apart, not every frame: each repaint
    // snapshots the timeline, the waits and every declared file, then styles, lays out and paints the panel (~180 ms of a
    // grid Home region at 50 ms apart). A new step paints on its first frame; done and errors paint at once.
    const step = this.view?.step ?? this.admission?.phase ?? '';
    if (step === this.lastPaintStep && now - this.lastPaintAt < PAINT_MS) return;
    this.lastPaintAt = now; this.lastPaintStep = step;
    this.readServerProgress();
    // Refresh explicit producer progress and the elapsed clock during quiet waits.
    if (this.view !== null) this.view = { ...this.view, setup: this.setupProgress() };
    this.dirty = true;
    this.paintNow();
  }

  private paintWaiting(timeline: TimelineSnapshot): void {
    if (this.view?.error || this.failedReason !== null) return;
    if (this.finished) { set(this.els.foot, ''); this.els.retry.hidden = true; setData(this.root, 'stalled', 'false'); return; }
    const pending = this.scoped ? [] : loadingStepWaits(bootWaits(), timeline.display, timeline.current, this.timeline.waitOwner).filter(wait => wait.id !== this.waitId);
    const files = pending.filter(wait => wait.kind === 'file');
    // The outer admission promise has no file identity. Let the current
    // reported phase explains its paced CPU/cache work between real waits.
    // DL21 (sp-o1): a read held for the spawn download's whole set waits on that download, not on its own file: name it
    // with the download's bytes ('Spawn download · 3.1 of 9.8 MB'), never the step's first file ('Read audio 1 / 77')
    const spawnHold = files.find(row => row.resource?.startsWith('spawn-download:') === true);
    const wait = pending.find(row => row.retry !== null) ?? spawnHold ?? files[0] ?? pending.find(row => row.id !== this.waitId && row.kind !== 'admission');
    // DL21: a step's file waits come and go one at a time ('Read Model data · 0.1 s' held Nalati's step 8 unchanged for 6.3 s
    // in the DL23 recording while its reads kept landing): the step's reads tally rides along, so the line moves per read,
    // and its count is progress (sp-x1's review: else 'No reported progress' would sit beside a growing count)
    const tally = wait?.kind === 'file' && wait !== spawnHold ? pending.find(row => row.resource === STAGE_READS) : undefined;
    const transfer = this.downloadProgress();
    const current = timeline.rows.find(row => row.key === timeline.current);
    const signature = `${timeline.display}:${timeline.current}:${transfer.completedBytes}:${transfer.cachedBytes}:${transfer.filesDone}:${wait?.id ?? 0}:${tally?.label ?? ''}`;
    const spawnLabel = wait !== undefined && wait === spawnHold
      ? `${wait.label} · ${(transfer.completedBytes / 1e6).toFixed(1)} of ${(transfer.totalBytes / 1e6).toFixed(1)} MB` : undefined;
    const label = spawnLabel ?? wait?.label ?? (current === undefined ? undefined : `${current.label}${current.detail ? ` · ${current.detail}` : ''}`) ?? timeline.gaps.find(row => row.state === 'on')?.label ?? 'Final activation';
    reportLoadingWait(this.waitId, { label, step: timeline.current, progress: signature,
      loadedBytes: transfer.completedBytes, totalBytes: transfer.totalBytes > 0 ? transfer.totalBytes : null });
    const fallback = loadingWaitState().pending.get(this.waitId), selected = wait ?? fallback;
    const now = performance.now();
    const quietMs = Math.max(0, now - Math.max(selected?.progressAt ?? now, fallback?.progressAt ?? 0));
    const stalled = !this.finished && selected?.retry !== null && selected?.retry !== undefined;
    this.retryWait = selected?.retry ?? null;
    this.retryNavigation = selected?.retryNavigation !== false;
    this.els.retry.hidden = !stalled;
    setData(this.root, 'stalled', String(stalled));
    setData(this.root, 'waiting', wait?.label ?? '');
    setData(this.root, 'filesInFlight', String(files.length));
    const readsSoFar = tally === undefined ? '' : ` · ${tally.label.replace(/^Reading /u, '')} read so far`;
    const detail = wait === undefined ? `Now working on: ${label}` : `Now waiting for: ${label}${readsSoFar} · ${(wait.ageMs / 1000).toFixed(1)} s${files.length > 0 ? ` · ${files.length} files in flight` : ''}${pending.length > 1 ? ` · ${pending.length} waits` : ''}`;
    // A quiet phase still reports its actual age, without advancing a byte,
    // file or setup credit. Only an explicit failed-read retry capability offers
    // an action; a long pending operation remains pending.
    set(this.els.foot, stalled ? `Waiting for ${label} · ${(quietMs / 1000).toFixed(1)} s` : !this.finished && quietMs >= 500
      ? `No reported progress for ${(quietMs / 1000).toFixed(1)} s · ${detail}` : detail);
  }

  /** Estimated scene texture allocation; it goes in Copy diagnostics, never on the card (LS2 removed the memory lines). */
  setTextureBytes(bytes: number): void { this.textureBytes = bytes; }

  /** The kept facts (LS2): tier, visit and attempt. A page a service worker already controls is a return visit. */
  private tierText(): string {
    return engineString('s_loading_tier', [TIER, engineString(navigator.serviceWorker?.controller ? 's_loading_return_visit' : 's_loading_first_visit'), this.attempt]);
  }

  private phaseDone(ms: number): string { return engineString('s_loading_done', [seconds(ms)]); }

  /** The three exclusive wall segments; they add up to the total (LS2). NaN for a phase not finished yet. */
  phaseTimes(): { readonly start: number; readonly download: number; readonly load: number; readonly total: number } {
    const end = this.readyAt >= 0 ? this.readyAt : diagnosticNow();
    const download = this.downloadSource === undefined ? this.startEndAt : this.downloadEndAt;
    return { start: this.startEndAt - this.clockT0, download: download - this.startEndAt,
      load: this.readyAt - Math.max(this.startEndAt, download), total: end - this.clockT0 };
  }

  private runningPhase(): LoadingPhase | null {
    if (this.finished) return null;
    if (!(this.startEndAt >= 0)) return 'start';
    if (!(this.downloadEndAt >= 0) && (this.downloadSource !== undefined || !this.scoped)) return 'download';
    return 'load';
  }

  /** Start's rows: LS1's named boundaries from the tap to this adoption, each the wall time since the one before. */
  private paintStart(): void {
    set(this.els.stFact, this.phaseDone(this.startEndAt - this.clockT0)); set(this.els.stPct, '100'); setBar(this.els.stBar, 1);
    const timing = bootTiming();
    if (timing === undefined) return;
    const rows: LogRow[] = [];
    const responseEnd = timing.navigation?.['responseEnd'];
    let previous = this.clockT0;
    if (typeof responseEnd === 'number' && responseEnd > 0) { rows.push({ label: engineString('s_loading_start_page'), detail: '', ms: responseEnd - previous }); previous = responseEnd; }
    for (const [operation, label] of START_STEPS) {
      const at = timing.entries.find(row => row.operation === operation && row.end !== null && row.result === 'complete')?.end;
      if (typeof at !== 'number' || at < previous) continue;
      rows.push({ label, detail: '', ms: at - previous }); previous = at;
    }
    if (this.startEndAt > previous) rows.push({ label: engineString('s_loading_start_handoff'), detail: '', ms: this.startEndAt - previous });
    const files = timing.resources.filter(row => row['realm'] === 'page' && typeof row['responseEnd'] === 'number' && row['responseEnd'] <= this.startEndAt);
    const bytes = files.reduce((sum, row) => sum + (typeof row['transferSize'] === 'number' ? row['transferSize'] : 0), 0);
    rows.push({ label: engineString('s_loading_files'), detail: engineString('s_loading_start_files', [files.length, mb(bytes)]), ms: Number.NaN });
    paintLog(this.els.stRows, rows);
  }

  private paintDownloadRows(row: LoadingDownloadSnapshot): void {
    if (row.totalBytes === 0 && row.filesTotal === 0 && !row.complete) { paintLog(this.els.dlRows, []); return; }
    paintLog(this.els.dlRows, [
      { label: engineString('s_loading_files'), detail: engineString('s_loading_files_of', [row.filesDone, row.filesTotal]), ms: Number.NaN },
      { label: loadingCacheText(row), detail: '', ms: Number.NaN },
    ]);
  }

  /** Density 2: only the running phase shows its rows; a tapped phase opens too. The ready card opens Load. */
  private paintPhases(): void {
    const running = this.runningPhase();
    for (const phase of PHASES) {
      const el = this.root.querySelector<HTMLElement>(`.ws-load-phase[data-phase="${phase}"]`);
      if (el === null) continue;
      const open = phase === running || this.opened.has(phase) || running === null && phase === 'load';
      if (Object.hasOwn(el.dataset, 'open') !== open) { if (open) el.dataset['open'] = ''; else delete el.dataset['open']; }
      setData(el, 'state', phase === running ? 'on' : running === null || PHASES.indexOf(phase) < PHASES.indexOf(running) ? 'ok' : 'todo');
    }
    const times = this.phaseTimes();
    if (!this.finished || !(times.load >= 0)) return;
    // The ready card's phases add up to its clock: Start + Download + Load = the total it shows (LS2).
    const phases:readonly LoadingPhase[]=this.scoped?(this.downloadSource===undefined?['load']:['download','load']):PHASES;
    const tenths = phaseTenths(phases.map(phase=>times[phase]), times.total);
    const facts={start:this.els.stFact,download:this.els.dlFact,load:this.els.suFact};
    phases.forEach((phase,index)=>{set(facts[phase],engineString('s_loading_done',[`${((tenths[index]??0)/10).toFixed(1)} s`]));});
    for (const [key, ms] of Object.entries(times)) setData(this.root, `${key}Ms`, String(Math.round(ms)));
  }

  /** LS4: everything the card leaves out, for Jake to paste. The full LS1 timeline rides at the end. */
  diagnosticsText(): string {
    const localTiming = bootTiming()?.read(), timing=safeBootDiagnostics(localTiming), transfer = this.downloadProgress(), times = this.phaseTimes();
    const all = this.timeline.snapshot(), summary = timing?.['summary'];
    const lines = [
      `Wildshard boot diagnostics · ${new Date().toISOString()}`,
      // LD3 (J208): a human reads the cause first; the same lines lead the JSON below
      ...(Array.isArray(summary) ? summary.filter((line): line is string => typeof line === 'string') : []),
      `build ${diagnosticBuild(localTiming?.build)} · ${this.tierText()} · ${innerWidth}x${innerHeight} @${devicePixelRatio}x`,
      `total ${seconds(times.total)} · start ${seconds(times.start)} · download ${seconds(times.download)} · load ${seconds(times.load)}${this.finished ? '' : ' · not ready'}`,
      `download ${loadingCacheText(transfer)} · files ${transfer.filesDone} of ${transfer.filesTotal} · ${transfer.complete ? 'complete' : 'open'}${transfer.error === null ? '' : ' · error (private text omitted)'}`,
      `scene textures ~${Math.round(this.textureBytes / 1048576)} MiB${this.failedReason === null && !this.view?.error ? '' : ' · failed (private text omitted)'}`,
      'load rows:',
      ...all.rows.map(row => `  ${row.number}. ${diagnosticStep(row.key,row.number)} · ${row.state} · ${Math.round(row.ms)} ms`),
      ...all.gaps.map(gap => `  gap · ${gap.state} · ${Math.round(gap.ms)} ms`),
      'This page\'s files are named by path; other URLs use local report IDs; free text, details and errors are omitted.',
      'timeline (LS1):',
      JSON.stringify(timing ?? null),
    ];
    return lines.join('\n');
  }

  /** LS4 (J188): Copy diagnostics replaces Hold at loading screen once the game is ready, and after a failure. */
  private showCopy(): void {
    if (this.copyButton !== null || this.scope.disposed) return;
    const body = this.root.querySelector<HTMLElement>('.ws-load-body');
    if (body === null) return;
    this.root.querySelector('.ws-load-hold')?.remove();
    const button = document.createElement('button');
    button.type = 'button'; button.className = 'ws-load-copy'; button.textContent = engineString('s_loading_copy');
    body.append(button); this.copyButton = button;
    listenTap(this.scope, button, () => {
      void copyText(this.diagnosticsText()).then(ok => { set(button, engineString(ok ? 's_loading_copied' : 's_loading_copy_failed')); return undefined; });
    });
  }

  /**
   * Complete the path and preserve its exclusive stage times. Developer's hold
   * keeps a completed initial load until PLAY; scoped cell loads still fade.
   * Resolves only after the panel leaves, so every entry path uses the same gate.
   * it used to hold that for 350 ms and fade for 700 — a second of nothing between a built world and
   * the title menu, on every launch. The fade (loading.css) is 250 ms; the menu is live under it.
   */
  done(): Promise<void> {
    if (this.completion !== undefined) return this.completion;
    if (this.downloadSource !== undefined && !this.downloadSource.snapshot().complete) {
      this.completion = this.downloadSource.ready.then(() => {
        if (this.scope.disposed || this.scope.disposing) throw new DOMException('Loading retired', 'AbortError');
        this.completion = undefined; return this.done();
      });
      return this.completion;
    }
    bootMark('app:control-ready');
    this.readyAt = diagnosticNow(); if (!(this.downloadEndAt >= 0) && this.downloadSource !== undefined) this.downloadEndAt = this.readyAt;
    this.tickClock(); this.clockScope.dispose();
    this.finished = true; finishLoadingWait(this.waitId); this.phase?.end(); this.phase = undefined;
    set(this.els.kicker, engineString('s_loading_ready_kicker'));
    if (this.view !== null) this.paint(this.view);
    else this.dirty = true;
    this.paintNow();
    // LS2: the ready card drops the step footer; an error keeps its reason there.
    if (!this.view?.error && this.failedReason === null) set(this.els.foot, '');
    this.completion = this.holdRequested
      ? this.waitForPlay().then(() => this.fade()) : this.fade();
    if (!this.scoped) void this.completion.then(() => { bootTiming()?.finish(); return undefined; }, () => { bootMark('app:loader-failed'); return undefined; });
    return this.completion;
  }

  private waitForPlay(): Promise<void> {
    // Freeze the elapsed clock and completed rows, not the game's draw loop.
    this.tickClock(); this.clockScope.dispose();
    this.root.dataset['ready'] = 'true';
    this.root.dataset['hold'] = 'true';
    const play = document.createElement('button');
    play.type = 'button'; play.className = 'ws-load-play'; play.textContent = engineString('s_loading_play');
    const body = this.root.querySelector<HTMLElement>('.ws-load-body');
    const foot = this.root.querySelector('.ws-load-foot');
    if (body === null || foot === null) throw new Error('Loading: missing completed body or footer');
    body.dataset['scroll'] = 'true';
    this.showCopy();
    this.root.insertBefore(play, foot);
    return new Promise<void>((resolve, reject) => {
      let waiting = true;
      const proceed = (playRequested = false): void => {
        if (!waiting || this.scope.disposed || this.scope.disposing) return;
        this.playPicked = playRequested;
        waiting = false; play.disabled = true;
        delete this.root.dataset['ready']; resolve();
      };
      listenTap(this.scope, play, () => { proceed(true); });
      withOwner(this.scope, () => {
        this.scope.onDispose(onDev(() => { if (!isDev()) proceed(); }));
        this.scope.onDispose(onSetting('holdLoading', (hold) => { if (!hold) proceed(); }));
      });
      this.scope.onDispose(() => {
        if (waiting) { waiting = false; reject(new DOMException('Loading was disposed before PLAY', 'AbortError')); }
      });
      play.focus({ preventScroll: true });
    });
  }

  /** An explicit PLAY choice also enters direct loads that would otherwise reopen their title. */
  get playRequested(): boolean { return this.playPicked; }

  /** Initial-session callers keep their gameplay frame gate closed during the completed-panel hold. */
  get holdRequested(): boolean { return !this.scoped && isDev() && getSetting('holdLoading'); }

  private fade(): Promise<void> {
    if (this.scope.disposed || this.scope.disposing) return Promise.reject(new DOMException('Loading was disposed before entry', 'AbortError'));
    return new Promise((resolve, reject) => {
      let complete = false;
      this.scope.onDispose(() => { if (!complete) reject(new DOMException('Loading was disposed before entry', 'AbortError')); });
      // Two animation callbacks put a painted completion frame between the
      // final DOM update and the fade, even when done runs inside a frame.
      this.scope.raf(() => { this.scope.raf(() => {
        this.root.classList.add('hide');
        this.scope.timeout(250, () => { complete = true; this.scope.dispose(); resolve(); });
      }); });
    });
  }
}

/** Begin before product hydration; the session adopts this same panel and clock when its plan becomes available. */
export function beginLoading(chunk: { id: string; name: string; trace?: boolean }): Loading {
  if (currentLoading?.id === chunk.id && !currentLoading.loading.scope.disposed) return currentLoading.loading;
  currentLoading?.loading.scope.dispose();
  const loading = new Loading(chunk);
  currentLoading = { id: chunk.id, loading };
  loading.scope.onDispose(() => { if (currentLoading?.loading === loading) currentLoading = null; });
  return loading;
}
