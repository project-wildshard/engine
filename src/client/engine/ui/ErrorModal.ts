import type { UiHandle } from './layers';
import { uiScope, mountUi } from './ownership';
import { engineString } from '../../../shared/engine/strings';
import { saveStorage } from '../saves/slots';
import { terrainDatum } from '../../../shared/engine/world/terrainHeight';
import { app } from '../app/runtime';
/**
 * ErrorModal — what the player sees when the game hits an error, and the wiring that reports every error (E133).
 *
 *   installErrorModal();              // once, before anything else runs (main.ts)
 *   showError('what', 'detail…');     // explicit: a fatal error (main().catch — the boot failed)
 *
 * Every error is reported to the server (src/client/engine/core/errorReport.ts → api/errors.ts → `pnpm inbox:pull`). With Developer
 * on (G880 / G901) every reported error opens the modal; with it off only a play-breaking one does, and a recoverable one
 * shows the quiet chip ("A glitch was reported ✓", once a session, fading by itself). The modal, in the game's glass:
 * the boot failed, a core system stopped the loop, a frame-loop system skipped a failed frame, or an
 * uncaught error / rejection. One line says what failed (the system and the error's first line). RELOAD HERE (back where
 * the player stood: `?at=` + `?glreload`, the GPU-recovery reload, src/client/engine/core/GpuRecovery.ts), TITLE SCREEN, and
 * KEEP PLAYING while the loop is still alive; a collapsed DETAILS with the system, message, stack and the report's
 * `/api/errors` id for testers; "Report sent ✓" once the server has it.
 *
 * It can never loop: nothing reloads by itself; a second fatal error just ticks the counter; and after RELOADS_MAX
 * reloads from here inside RELOAD_WINDOW_MS (a crash right after RELOAD HERE, maybe tied to the spot) RELOAD HERE
 * becomes a plain reload at the spawn. Self-contained styles (the stylesheet that failed may be the problem); every
 * entry point is wrapped so the modal itself never throws.
 */
import { DescribedError, describeError, emitFault, loopState, onFault, type Fault } from '../../../shared/engine/core/faults';
import { isDev } from '../core/devMode';
import { ErrorReporter, lastReportId, safeUrl, sendReport as send, type ReportOutcome } from '../core/errorReport';
import { RELOAD_PARAM } from '../core/GpuRecovery';
import { currentPose } from './ReloadPrompt';
import { hasOnlineWorld, openDoctorPage } from './errorScreen';
import { activeLevel } from '../../../shared/engine/level/selection';
import { TIER } from '../core/tier';
import { leaveSaved, markReload, markUnload } from '../boot/lastEnd';
import { leftByPlayer } from '../boot/dropNotice';
import { showReloading } from './reloadCover';
import { leaveAfterPaint } from '../boot/leaveAfterPaint';
import { captureBrowserError, flushScreenReports, type ErrorScreen } from '../telemetry/browserErrors';
import { bootDiagnostic, bootDiagnosticJson } from '../boot/bootTrace';
// reloads from this modal (and the boot's stuck-loader recovery, src/client/engine/boot/stuck.ts) inside RELOAD_WINDOW_MS before
// RELOAD HERE stops returning to the spot: one shared budget
import { RELOADS_MAX, countReload, recentReloads } from '../core/reloadGuard';


const scope = uiScope('ErrorModal', app.engineScope);
let fatalLayer: UiHandle | null = null;

declare const __BUILD_ID__: string; // vite.config.ts define

let root: HTMLElement | null = null;
const closeFatal = (): void => { fatalLayer?.dispose(); fatalLayer = null; root?.remove(); root = null; };
let count = 0;
let firstText = '';
const CHIP_MS = 7000;
let chipShown = false;
let reporter: ErrorReporter | null = null;
// lib.dom says these always exist; they don't (clipboard needs a secure context, older Safari has no hardwareConcurrency)
const nav: { clipboard?: Clipboard | undefined; hardwareConcurrency?: number | undefined } = navigator;

function buildId(): string { try { return __BUILD_ID__; } catch { return ''; } }
function q(el: ParentNode, sel: string): HTMLElement { const e = el.querySelector<HTMLElement>(sel); if (!e) throw new Error(`ErrorModal: no ${sel}`); return e; }
function session(): ReturnType<typeof saveStorage> { return saveStorage('session'); }
function local(): ReturnType<typeof saveStorage> { return saveStorage('device'); }

const STYLE = `
  #wserr { position: fixed; inset: 0; z-index: calc(var(--ws-layer-error, 2147482500) + 0); display: flex; align-items: center; justify-content: center; box-sizing: border-box; padding: max(16px, env(safe-area-inset-top)) 16px max(16px, env(safe-area-inset-bottom)); background: rgba(4, 9, 14, 0.62); -webkit-backdrop-filter: blur(6px); backdrop-filter: blur(6px); color: #e6f2f8; font: 12px/1.5 "JetBrains Mono", ui-monospace, Menlo, monospace; }
  #wserr .box { position: relative; box-sizing: border-box; width: min(440px, 100%); max-height: 100%; overflow: auto; padding: 22px 18px 16px; background: rgba(13, 27, 38, 0.82); border: 1px solid rgba(143, 227, 255, 0.35); box-shadow: 0 24px 80px rgba(0, 0, 0, 0.55); -webkit-backdrop-filter: blur(14px); backdrop-filter: blur(14px); }
  #wserr .br { position: absolute; width: 12px; height: 12px; border: 0 solid #8fe3ff; pointer-events: none; }
  #wserr .br.tl { top: -1px; left: -1px; border-top-width: 2px; border-left-width: 2px; }
  #wserr .br.tr { top: -1px; right: -1px; border-top-width: 2px; border-right-width: 2px; }
  #wserr .br.bl { bottom: -1px; left: -1px; border-bottom-width: 2px; border-left-width: 2px; }
  #wserr .br.bra { bottom: -1px; right: -1px; border-bottom-width: 2px; border-right-width: 2px; }
  #wserr .tag { margin: 0 0 10px; font-size: 10px; letter-spacing: 0.32em; text-transform: uppercase; color: #8fe3ff; }
  #wserr .tag::before { content: ''; display: inline-block; width: 6px; height: 6px; margin: 0 10px 1px 0; background: #ffb86b; box-shadow: 0 0 8px #ffb86b; vertical-align: middle; }
  #wserr h1 { margin: 0 0 8px; font: 700 22px/1.15 Rajdhani, "JetBrains Mono", sans-serif; letter-spacing: 0.1em; text-transform: uppercase; color: #fff; }
  #wserr-chip { position: fixed; left: 50%; top: calc(22vh + env(safe-area-inset-top, 0px)); z-index: calc(var(--ws-layer-error, 2147482500) + -100); transform: translateX(-50%); display: flex; align-items: center; gap: 8px; padding: 6px 11px; background: rgba(13, 27, 38, 0.72); border: 1px solid rgba(143, 227, 255, 0.35); color: rgba(230, 242, 248, 0.85); font: 10px/1.2 "JetBrains Mono", ui-monospace, monospace; letter-spacing: 0.2em; text-transform: uppercase; white-space: nowrap; cursor: pointer; transition: opacity 0.4s ease; -webkit-user-select: none; user-select: none; }
  #wserr-chip::before { content: ''; width: 5px; height: 5px; background: #ffb86b; box-shadow: 0 0 6px #ffb86b; }
  #wserr-chip.out { opacity: 0; pointer-events: none; }
  #wserr-chip b { color: #7ef0b0; font-weight: 400; }
  #wserr .what { margin: 0 0 10px; font-size: 13px; line-height: 1.45; color: #ffb86b; overflow-wrap: anywhere; }
  #wserr .line { margin: 0 0 16px; font-size: 12.5px; line-height: 1.55; color: rgba(230, 242, 248, 0.82); }
  #wserr .rule { height: 1px; margin: 0 0 14px; background: rgba(143, 227, 255, 0.18); }
  #wserr .col { display: flex; flex-direction: column; gap: 8px; }
  #wserr button { appearance: none; -webkit-appearance: none; box-sizing: border-box; width: 100%; padding: 13px 16px; cursor: pointer; font: 700 12px/1 "JetBrains Mono", monospace; letter-spacing: 0.24em; text-transform: uppercase; border: 1px solid rgba(143, 227, 255, 0.35); background: rgba(143, 227, 255, 0.06); color: #8fe3ff; }
  #wserr button.go { border-color: #8fe3ff; background: rgba(143, 227, 255, 0.18); color: #fff; box-shadow: 0 0 18px rgba(143, 227, 255, 0.18); }
  #wserr button:active { background: rgba(143, 227, 255, 0.26); }
  #wserr button[hidden] { display: none; }
  #wserr .sent { margin: 12px 0 0; font-size: 10px; letter-spacing: 0.22em; text-transform: uppercase; color: rgba(230, 242, 248, 0.55); }
  #wserr .sent.ok { color: #7ef0b0; }
  #wserr details { margin-top: 12px; border-top: 1px solid rgba(143, 227, 255, 0.14); padding-top: 10px; }
  #wserr summary { cursor: pointer; font-size: 10px; letter-spacing: 0.26em; text-transform: uppercase; color: rgba(143, 227, 255, 0.7); list-style: none; }
  #wserr summary::-webkit-details-marker { display: none; }
  #wserr summary::before { content: '+ '; }
  #wserr details[open] summary::before { content: '− '; }
  #wserr .msg { margin: 10px 0 6px; color: #fff; font-weight: 700; white-space: pre-wrap; word-break: break-word; -webkit-user-select: text; user-select: text; }
  #wserr pre { margin: 0 0 8px; padding: 8px; max-height: 32vh; overflow: auto; background: rgba(4, 9, 14, 0.7); border: 1px solid rgba(143, 227, 255, 0.14); color: #b9c4d3; white-space: pre-wrap; word-break: break-word; font-size: 10.5px; -webkit-user-select: text; user-select: text; }
  #wserr .meta { margin-bottom: 8px; color: rgba(230, 242, 248, 0.45); font-size: 10px; white-space: pre-wrap; word-break: break-word; -webkit-user-select: text; user-select: text; }
  #wserr .n { color: #ffb86b; font-size: 10px; letter-spacing: 0.12em; }
  #wserr button.copy { width: auto; padding: 9px 12px; font-size: 10px; }
`;

function ensureStyle(): void {
  if (document.getElementById('wserr-style')) return;
  const s = document.createElement('style');
  s.id = 'wserr-style';
  s.textContent = STYLE;
  const doc: { head: HTMLElement | null } = document;
  (doc.head ?? document.documentElement).append(s);
}

function mount(el: HTMLElement): void {
  const doc: { body: HTMLElement | null } = document; // null when we run from <head>
  mountUi(el, scope, doc.body ?? document.documentElement);
}

function meta(): string {
  return [`build ${buildId() || 'unknown'} · ${new Date().toISOString()} · loop ${loopState()}`, safeUrl(location.href), navigator.userAgent, `${innerWidth}×${innerHeight} · dpr ${devicePixelRatio} · cores ${nav.hardwareConcurrency ?? '?'}`].join('\n');
}

// ── reloads ──
/** the address without the params that must not follow a reload: a forced crash, the cache-buster */
function cleanHref(): URL { const u = new URL(location.href); u.searchParams.delete('crash'); u.searchParams.delete('v'); return u; }

/** RELOAD HERE: back where the player stood, paused (the GPU-recovery reload's path); at the spawn after a crash loop */
function reloadHere(atSpot: boolean): void {
  showReloading(); // RL3: the full-page RELOADING cover in the tap's own turn, before the save
  countReload();
  const url = cleanHref();
  const pose = atSpot ? currentPose() : null;
  url.searchParams.delete('at'); url.searchParams.delete(RELOAD_PARAM);
  if (pose) {
    url.searchParams.set('at', [pose.x, pose.y - terrainDatum(), pose.z, pose.yaw, pose.pitch].map((v) => (Math.round(v * 100) / 100).toString()).join(','));
    url.searchParams.set(RELOAD_PARAM, '1'); // index.html's RESUMING screen from the first paint; main.ts skips the title and pauses
  }
  leaveSaved(() => { leaveAfterPaint(() => { leftByPlayer(); markReload(`error modal: ${atSpot ? 'reload here' : 'reload at spawn'} (${firstText.slice(0, 80)})`); location.replace(url.toString()); }); });
}
function toTitle(): void {
  leaveSaved(() => { leftByPlayer(); markUnload(`error modal: title screen (${firstText.slice(0, 80)})`); location.replace(new URL('/', location.origin).toString()); });
}

function build(): HTMLElement {
  ensureStyle();
  const el = document.createElement('div');
  el.id = 'wserr';
  el.setAttribute('role', 'alertdialog');
  el.setAttribute('aria-modal', 'true');
  el.innerHTML = engineString('s_43c4efa7fd98');
  const here = el.querySelector<HTMLButtonElement>('.here');
  if (!here) throw new Error('ErrorModal: no .here');
  const looped = recentReloads().length >= RELOADS_MAX;
  const pose = currentPose();
  if (looped) here.textContent = engineString('s_078b1e7bbe5e');
  else if (!pose) here.textContent = engineString('s_bdc090ec61e3');
  scope.listen(here, 'click', () => { here.disabled = true; here.textContent = engineString('s_ea456dcf3d90'); reloadHere(!looped); });
  scope.listen(q(el, '.title'), 'click', () => { toTitle(); });
  // E7.5 prep: a failed join on an online build offers the Connection doctor beside Title screen
  if (hasOnlineWorld()) {
    const doctor = document.createElement('button');
    doctor.type = 'button'; doctor.className = 'doctor'; doctor.textContent = engineString('s_doctor_failed');
    q(el, '.title').after(doctor);
    scope.listen(doctor, 'click', () => { doctor.disabled = true; openDoctorPage('failed-join'); });
  }
  // a dead loop can't be played on: KEEP PLAYING only acts while the loop still runs (it is hidden otherwise)
  scope.listen(q(el, '.keep'), 'click', () => { if (loopState() !== 'running') return; closeFatal(); document.dispatchEvent(new Event('ws:error-keep')); });
  const copyBtn = q(el, '.copy');
  const copy = async (): Promise<void> => {
    const clip = nav.clipboard; if (!clip) return;
    const text = `${q(el, '.msg').textContent}\n\n${q(el, '.stack').textContent}\n\n${q(el, '.meta').textContent}`;
    try { await clip.writeText(text); copyBtn.textContent = engineString('s_8d525e5f158b'); } catch { copyBtn.textContent = engineString('s_5b50e7a693fe'); }
  };
  scope.listen(copyBtn, 'click', () => { void copy(); });
  return el;
}

function setSent(o: ReportOutcome): void {
  if (!root) return;
  const s = root.querySelector<HTMLElement>('.sent');
  if (!s) return;
  s.textContent = o === 'sent' || o === 'dup' ? engineString('s_de6e9efdb28e') : o === 'queued' ? engineString('s_ce2f127a2459') : engineString('s_0dad33e4803c');
  s.classList.toggle('ok', o === 'sent' || o === 'dup');
  const id = lastReportId(), m = root.querySelector<HTMLElement>('.meta');
  if (id !== '' && m !== null && !(m.textContent ?? '').includes(id)) m.textContent = engineString('s_err_report_id', [id, m.textContent ?? '']);
}

/** The fatal modal (first error wins the headline; later ones tick the counter). */
function showFatal(message: string, stack: string, sent: Promise<ReportOutcome> | null, system = 'boot'): void {
  try {
    count++;
    if (!root) {
      root = build();
      mount(root);
      fatalLayer = app.ui.push('error', { root, order: 1000, back: () => { if (loopState() === 'running') closeFatal(); } }, scope);
      firstText = message;
      // what failed, in one line: the system and the error's first line
      const first = (message.split('\n')[0] ?? '').trim();
      q(root, '.what').textContent = engineString('s_err_what', [system, first.length > 140 ? `${first.slice(0, 139)}…` : first]);
      q(root, '.msg').textContent = message;
      q(root, '.stack').textContent = stack || engineString('s_79b59ea37a9c');
      q(root, '.meta').textContent = engineString('s_err_system', [system, meta()]);
      if (document.pointerLockElement) document.exitPointerLock();
      // the world pauses under it (a no-op on the title / the boot); the HUD remembers this pause for KEEP PLAYING
      document.dispatchEvent(new Event('ws:error-pause'));
      document.dispatchEvent(new Event('ws:background'));
      if (sent) void sent.then(setSent); else setSent('dropped');
    }
    // every report refreshes the verdict: a later fault can stop the loop under an open modal (sp-x1, MF6), and then
    // KEEP PLAYING goes and the line says it can't recover
    const alive = loopState() === 'running';
    const looped = recentReloads().length >= RELOADS_MAX;
    q(root, '.line').textContent = looped
      ? engineString('s_1a66f8e11f0a')
      : alive
        ? engineString('s_94fef1ec7b83')
        : loopState() === 'boot' ? engineString('s_d80080606a96') : engineString('s_da009164dfc2');
    q(root, '.keep').hidden = !alive;
    q(root, '.n').textContent = count > 1 ? engineString('s_ffd7f4e8c95a', [count - 1, firstText.slice(0, 40)]) : '';
  } catch { /* the modal must never throw */ }
}

/** the quiet chip for a non-fatal error: once a session, fades by itself, a tap dismisses it */
function showChip(sent: Promise<ReportOutcome>): void {
  if (chipShown || root) return;
  chipShown = true;
  try {
    ensureStyle();
    const chip = document.createElement('div');
    chip.id = 'wserr-chip';
    chip.setAttribute('role', 'status');
    chip.textContent = engineString('s_f589420f0639');
    const out = (): void => { chip.classList.add('out'); scope.timeout(500, () => { chip.remove(); }); };
    scope.listen(chip, 'click', out);
    mount(chip);
    scope.timeout(CHIP_MS, out);
    void (async () => { const o = await sent; if (o === 'sent' || o === 'dup') { const b = document.createElement('b'); b.textContent = engineString('s_456509849d2d'); chip.append(b); } })();
  } catch { /* never throw from here */ }
}

/** `screen` (SENTRY-TRIAGE S13): the screen this report opens; only the report that opens it names it, so a screen is one event */
function report(system: string, error: unknown, flags: { fatal?: boolean; disabled?: boolean; stall?: Record<string, unknown>; screen?: ErrorScreen }): Promise<ReportOutcome> {
  if (system !== 'lifecycle') {
    let level = '';
    try { level = activeLevel().id; } catch { /* the registry may not be ready during early boot */ }
    captureBrowserError(error, {
      system,
      build: buildId(),
      shard: level,
      bootStage: document.querySelector<HTMLElement>('.ws-load')?.dataset['step'] ?? loopState(),
      fatal: flags.fatal === true,
      diagnostic: flags.stall === undefined ? bootDiagnostic() : { ...bootDiagnostic(), stall: flags.stall },
      ...(flags.screen === undefined ? {} : { screen: flags.screen }),
    });
  }
  const inbox = { ...(flags.fatal === undefined ? {} : { fatal: flags.fatal }), ...(flags.disabled === undefined ? {} : { disabled: flags.disabled }) };
  try { return reporter?.report(system, error, inbox) ?? Promise.resolve('dropped'); } catch { return Promise.resolve('dropped'); }
}

/** a fault from the frame loop or the window: report it and open the modal (G880: every reported error) */
function handle(f: Fault): void {
  const fatal = f.verdict === 'fatal' || (f.verdict === 'uncaught' && loopState() === 'boot');
  // S13: the screen this fault opens, if any: the modal (first one), the chip (once a session), or none (a later fault, a retry)
  const shows = !fatal && f.verdict !== 'uncaught' ? null : !fatal && !isDev() ? 'glitch-chip' : 'error-modal';
  const screen = shows === 'glitch-chip' ? (chipShown || root ? undefined : shows) : shows === 'error-modal' && !root ? shows : undefined;
  const sent = report(f.system, f.error, { fatal, ...(screen === undefined ? {} : { screen }) });
  if (!fatal && f.verdict !== 'uncaught') return; // internal retry bookkeeping is not a separate report
  // G901 (refines G880): with Developer on every error opens the modal; with it off only a play-breaking one does (the loop
  // stopped, or the boot failed), and a recoverable error (the system goes on, MF6) gets the quiet chip
  if (!fatal && !isDev()) { showChip(sent); return; }
  const d = describeError(f.error); showFatal(d.message, d.stack, sent, f.system);
}

/** Show the fatal modal explicitly (main().catch: the boot failed) and report it. */
/** `stall`: S4's context for a stuck or failed start (stuckStep.ts stuckContext); it rides the report as `stall`. */
export function showError(message: string, stack = '', stall?: Record<string, unknown>): void {
  app.setState('error');
  try {
    const screen: ErrorScreen | undefined = root ? undefined : stall === undefined ? 'error-modal' : 'stuck-step';
    showFatal(message, stack, report('boot', new DescribedError(message, stack), { fatal: true, ...(stall === undefined ? {} : { stall }), ...(screen === undefined ? {} : { screen }) }));
  } catch { /* the modal must never throw */ }
}

function context(): Record<string, string | number | boolean | number[] | null> {
  const pose = currentPose();
  let level = ''; try { level = activeLevel().id; } catch { /* before the registry */ }
  const touch = (typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches) || new URLSearchParams(location.search).has('touch');
  return {
    build: buildId(), shard: level, tier: TIER, touch, url: safeUrl(location.href),
    pos: pose ? [pose.x, pose.y, pose.z] : null, yaw: pose?.yaw ?? null, pitch: pose?.pitch ?? null,
    viewport: `${innerWidth}x${innerHeight}`, loop: loopState(),
    bootDiagnostic: bootDiagnosticJson(),
  };
}

/** Hook `error` + `unhandledrejection` and the frame loop's faults; start the reporter. Idempotent. */
export function installErrorModal(): void {
  const w = window as unknown as { __wsErrorModal?: boolean };
  if (w.__wsErrorModal) return;
  w.__wsErrorModal = true;
  reporter = new ErrorReporter({ send, context, session: session(), local: local(), now: () => performance.now() });
  onFault(handle);
  scope.listen(window, 'error', (e) => {
    const err: unknown = e.error;
    // An opaque cross-origin error ("Script error.", no file, no error object) is never ours: every game script is
    // same-origin. On iOS it comes from a Safari extension / content blocker injected into the page — log it, keep playing.
    if ((err === undefined || err === null) && e.filename === '' && /^script error\.?$/iu.test(e.message.trim())) {
      console.warn('[error-modal] ignored an opaque cross-origin "Script error." (a browser extension, not the game)');
      return;
    }
    const error = err ?? Object.assign(new Error(e.message), { stack: `${e.filename.split('/').pop() ?? ''}:${e.lineno}:${e.colno}` });
    emitFault({ system: 'window', error, verdict: 'uncaught' });
  });
  scope.listen(window, 'unhandledrejection', (e) => { emitFault({ system: 'promise', error: e.reason, verdict: 'uncaught' }); });
  // what an offline page queued goes once the network is back (and a little after boot, off the critical path)
  scope.listen(window, 'online', () => { void reporter?.flushQueue(); });
  scope.timeout(8000, () => { void reporter?.flushQueue(); flushScreenReports(); });
}
