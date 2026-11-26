import { Scope } from '../../../shared/engine/app/scope';
import { installedIdentity } from '../../../shared/engine/app/identity';
import { classifyActor, type ActorFacts } from '../../../shared/engine/app/actor';
import { pageActor } from './pageActor';
import { pageScope } from '../../../shared/engine/app/resources';
import { jsonSlot, type Json } from '../saves/slots';
/** Optional, error-only Sentry channel. The existing /api/errors report remains the primary local inbox. */
import type { captureException, ErrorEvent, getClient, httpContextIntegration, init, withScope } from '@sentry/browser';
import type { StaleBuildNote } from '../saves/staleBuildNote';
import { admitEvent, agentSampled, emptyLedger, environmentSends, eventFingerprint, parseLedger, WARNING_TRAIL_MAX, type SessionLedger } from './sendPolicy';

declare const __BUILD_ID__: string;
/** vite.config.ts: package.json's version (src/scripts/changelog.mjs); absent under Node */
declare const __ENGINE_RELEASE__: { readonly version: string } | undefined;

export interface BrowserErrorTags {
  readonly system: string;
  readonly build: string;
  readonly shard: string;
  readonly bootStage: string;
  readonly fatal: boolean;
  /** Small, explicit diagnostics supplied by the caller; never browser storage or request headers. */
  readonly diagnostic?: Record<string, unknown>;
  /** SENTRY-TRIAGE S13: the error screen this report opened. Set only by the call that opens it, so each screen is one event. */
  readonly screen?: ErrorScreen;
  /** J501: why play ended (src/client/engine/boot/endPlay.ts): `exit_code`, `zone`, `revision`, `room`, `step` tags; '' is left out */
  readonly exit?: { readonly code: string; readonly zone: string; readonly revision: string; readonly room: string; readonly step: string };
}

/**
 * SENTRY-TRIAGE S13 (Jake, 2026-11-13: "Every time an error modal opens, are we writing something to Sentry that we can pull down and
 * audit?"): every screen a player sees that means something went wrong, as its Sentry `screen` tag. Query: `screen:title-drop`.
 *   error-modal   the fatal modal (src/client/engine/ui/ErrorModal.ts showFatal: a fault, the boot failed, Developer's every error)
 *   stuck-step    the same modal opened by the stuck-step watchdog (showError with S4's stall, src/client/app/entry.ts)
 *   glitch-chip   "A glitch was reported" (ErrorModal.ts showChip, once a session)
 *   load-failure  the shard's load-failure page (src/client/engine/ui/errorScreen.ts showLoadFailure, src/client/game/session/session.ts)
 *   title-drop    the drop modal, "Unexpectedly back at the title" (src/client/app/dropModal.ts showDropModal)
 *   link-lost     the online stop card "Couldn't reconnect" (src/client/host/online/linkScreens.ts)
 *   link-refused  the online stop card "The world turned this connection away" (the same file)
 *   stale-build   the stale-build screen (index.html data-stale-build, STALE-BUILD SB6), reported by the next build that boots
 *                 (telemetry/staleBuildReport.ts) since that page stops before Sentry can load
 *   loading-stall the loading card's RETRY for a content read that failed past its own retry (boot/contentRead.ts
 *                 retryFromCard, SENTRY-TRIAGE S18), once per page; a common screen, so it reports at warning level
 *   old-tab-updated  fix-preview PV11: "Wildshard was updated", the one card for an old tab whose code, pack or book is
 *                 gone from the server (boot/oldTab.ts, browserChunkRecovery.ts oldTabMissed); one event per card, which the
 *                 outbox carries across the reload; it replaced stale-reload's RELOADING cover
 *   day-logout    fix-preview PV12: a client open 24 hours signs out and reloads (boot/oldTab.ts armDayLogout)
 *   self-reload   index.html's 12 s self-reload of a page whose entry never arrived, reported by the page it reloads into
 *                 (telemetry/staleBuildReport.ts reportSelfReload), since the inline script has no Sentry; warning
 *   save-failed   the grid's SAVE FAILED, RETRY at a border (game/grid/screenReports.ts), once a session
 *   cell-unavailable   a Shard Select UNAVAILABLE card: a neighbour cell that can't load (game/grid/session.ts refuse),
 *                 once per cell a session; warning
 *   map-tile-missing   a full-map cell the world map atlas has no tile for, drawn as a plain plot or its own map instead
 *                 (game/grid/mapAtlas.ts; QA-FEEDBACK 2026-11-13 row 44), once per slug a page; warning
 *   boot-fail     index.html's card when the page's game code never loaded and its one self-reload is spent (J501, QA 11-23-b
 *                 row 22): "Couldn't start · Code BOOT-FAIL" with a Retry; the inline script stores it in the outbox and the next
 *                 page that boots sends it, since that page has no Sentry
 *   release-unsigned   FM5 mode 39's page, "Couldn't check the world": the release file failed its signature, so the page dials
 *                 nothing (host/online/releaseScreens.ts), once a page
 * Not screens of a fault, so never reported: the player's own reload, back or exit (QA 11-12 row 35), "Playing somewhere else",
 * "The world is full", the reconnect banner (counted in `net` telemetry), title refusal lines and the Connection doctor.
 */
export const ERROR_SCREENS = ['error-modal', 'stuck-step', 'glitch-chip', 'load-failure', 'title-drop', 'link-lost', 'link-refused', 'stale-build',
  'loading-stall', 'self-reload', 'save-failed', 'cell-unavailable', 'map-tile-missing', 'release-unsigned', 'boot-fail',
  // fix-preview PV11, PV12: an old tab's cards, one event each (boot/oldTab.ts)
  'old-tab-updated', 'day-logout'] as const;
/** S18: screens common enough on a bad network that each is a Sentry warning, never an error */
export const WARNING_SCREENS: readonly ErrorScreen[] = ['loading-stall', 'self-reload', 'cell-unavailable', 'map-tile-missing'];
export type ErrorScreen = typeof ERROR_SCREENS[number];

// A DSN is a public browser endpoint, not an auth token. Only real production pages report.
const productionDsn = 'https://ccaf25bcd6baa389433fb9efe0117c9b@o4512161165410304.ingest.us.sentry.io/4512161184088064';
const dsn = String(import.meta.env['VITE_SENTRY_DSN'] ?? (import.meta.env.PROD ? productionDsn : '')).trim();
interface BrowserSdk {
  init: typeof init; withScope: typeof withScope; captureException: typeof captureException; getClient: typeof getClient;
  httpContextIntegration: typeof httpContextIntegration;
}

/** SENTRY-TRIAGE S5: the release is the app's version (`wildshard@0.1.7`); the build id rides as `dist` and the build tag. */
export function browserErrorRelease(slug: string | undefined, version: string | undefined): string | undefined {
  return slug && version ? `${slug}@${version}` : undefined;
}
/** Sentry keeps a dist of at most 64 characters; a longer build id stays in the build tag only. */
export function browserErrorDist(build: string): string | undefined {
  return build !== '' && build.length <= 64 ? build : undefined;
}
let sdk: Promise<BrowserSdk | null> | null = null;
/** S13: deliveries waiting on an event that beforeSend refused (noise, a page that stopped reporting): that event is done, not owed */
const refusedListeners = new Set<(id: string) => void>();
const refused = (id: string | undefined): null => { for (const listener of refusedListeners) listener(id ?? ''); return null; };

/**
 * Who a page that may report is: a `player`, or `automation` (navigator.webdriver, harness pins, or a headless or Playwright user
 * agent, since a CDP-attached agent may not set webdriver). Null: this origin never reports. External delivery is opt-in by exact
 * app origin. SENTRY-TRIAGE S21: automation reports too, under its own environment (`browserErrorEnvironment`), because Nalati's
 * error card on staging v0.1.33 and v0.1.34 was met only by agent proofs and so never reached Sentry.
 */
export type BrowserErrorAudience = 'player' | 'automation';
export function browserErrorAudience(environment: ActorFacts & { readonly origin: string; readonly automated: boolean },
  origins: readonly string[]): BrowserErrorAudience | null {
  if (!origins.includes(environment.origin)) return null;
  return classifyActor({ ...environment, webdriver: environment.automated }).actor === 'agent' ? 'automation' : 'player';
}
/** The Sentry environment an allowed origin reports as: its entry in the identity's map, else `production`; an automated page
 *  reports as `<environment>-automation` (S21), so `environment:staging` stays the players'. */
export function browserErrorEnvironment(origin: string, environments: Readonly<Record<string, string>>, audience: BrowserErrorAudience = 'player'): string {
  const environment = Object.hasOwn(environments, origin) ? environments[origin] ?? 'production' : 'production';
  return audience === 'automation' ? `${environment}-automation` : environment;
}

const EXTENSION_FRAME = /^(?:chrome-extension|moz-extension|safari-extension|safari-web-extension|webkit-masked-url):/u;
/**
 * SZ2: the network, not the game: a read the game itself names as the connection's (`· connection unavailable`, `· the download
 * stopped`), and the browsers' bare fetch and module-load failures. The player's card and the /api/errors inbox keep them.
 */
const NETWORK_MESSAGE = /· connection unavailable(?:$|\))|· the download stopped(?:$|\))|^(?:TypeError: )?(?:Failed to fetch|Load failed|NetworkError when attempting to fetch resource\.)$|^Importing a module script failed\.$|FetchEvent\.respondWith received an error: TypeError: Load failed/u;
/**
 * SZ2: systems whose reports are early warnings, never bugs: `boot.slow` is the loading card's 20 s "Loading slow" note
 * (app/entry.ts); the 60 s stuck-step report that may follow it is the bug report (WILDSHARD-GAME-AJ, -AE, -BR, -AG).
 */
const QUIET_SYSTEMS: ReadonlySet<string> = new Set(['boot.slow']);

/**
 * Why an event is noise and must not reach Sentry, or null to keep it (SENTRY-TRIAGE S6). Pure, so each case is tested:
 * extension-only stacks, the debug probe's harness error (a tool on a real page), QB8's deliberate error outside staging,
 * ResizeObserver loop warnings and an opaque "Script error." with no frames. An automation user agent is not noise since S21:
 * `browserErrorAudience` sends it under its own environment.
 */
export function browserErrorNoise(event: ErrorEvent, page: { readonly environment: string }): string | null {
  const exceptions = event.exception?.values ?? [];
  const messages = [event.message ?? '', ...exceptions.map((value) => value.value ?? '')].map((message) => message.trim());
  // Every frame counts, a nameless or <anonymous> one too: only a stack that is all extension is the extension's.
  const files = exceptions.flatMap((value) => value.stacktrace?.frames ?? []).map((frame) => frame.filename ?? '');
  if (files.length > 0 && files.every((file) => EXTENSION_FRAME.test(file))) return 'extension';
  const frames = exceptions.flatMap((value) => value.stacktrace?.frames ?? []);
  // SZ2: a tool driving the page, not the page: Safari's Web Inspector (WILDSHARD-GAME-AA), Playwright's evaluate probing every getter
  // of a built-in (WILDSHARD-GAME-AY to -BH, "Illegal invocation")
  if (frames.some((frame) => (frame.filename ?? '').startsWith('web-inspector:') || (frame.function ?? '').startsWith('UtilityScript.'))) return 'tool';
  if (messages.some((message) => NETWORK_MESSAGE.test(message))) return 'network';
  if (messages.some((message) => message.startsWith('Probe control requires the harness pins'))) return 'probe';
  if (page.environment !== 'staging' && messages.some((message) => message.startsWith('QB8 capture:'))) return 'qb8';
  if (messages.some((message) => message.startsWith('ResizeObserver loop'))) return 'resize-observer';
  if (files.length === 0 && messages.some((message) => /^script error\.?$/iu.test(message))) return 'script-error';
  return null;
}

/**
 * Known, designed refusals of an old browser: the player was told what to do, so they are warnings, never fatal (SENTRY-TRIAGE,
 * WILDSHARD-GAME-8F). J171 keeps signature code out of the page, so a browser with no WebCrypto Ed25519 can't join the online world.
 */
const UNSUPPORTED_BROWSER = ['This browser is too old for the online world'] as const;

/** The Sentry level an error reports at: `warning` for a designed old-browser refusal, else `fatal` or `error`. Pure, so it is tested. */
export function browserErrorLevel(error: unknown, fatal: boolean, screen?: ErrorScreen): 'warning' | 'error' | 'fatal' {
  if (screen !== undefined && WARNING_SCREENS.includes(screen)) return 'warning';
  const message = error instanceof Error ? error.message
    : typeof error === 'object' && error !== null && 'message' in error && typeof error.message === 'string' ? error.message : String(error);
  // includes, not startsWith: a title drop reports it as `<what>: <reason>` (src/client/app/entry.ts showDrop).
  if (UNSUPPORTED_BROWSER.some((phrase) => message.includes(phrase))) return 'warning';
  return fatal ? 'fatal' : 'error';
}

function pageAudience(): BrowserErrorAudience | null {
  if (typeof location === 'undefined' || typeof navigator === 'undefined') return null;
  if (installedIdentity()?.errorReportOrigins?.includes(location.origin) !== true) return null;
  return pageActor().actor === 'agent' ? 'automation' : 'player';
}
/**
 * SENTRY-ZERO SZ2: whether this page sends at all: an allowed origin whose environment sends (production, staging; never preview
 * or local), and for an agent's page only the 1% of tab sessions the sample drew. A page that does not send never loads the SDK.
 */
function productionPage(): boolean {
  const audience = pageAudience();
  if (audience === null) return false;
  if (!environmentSends(browserErrorEnvironment(location.origin, installedIdentity()?.errorReportEnvironments ?? {}, audience))) return false;
  if (audience === 'player') return true;
  const ledger = readLedger(), sampled = agentSampled(ledger, () => (crypto.getRandomValues(new Uint32Array(1))[0] ?? 0) / 2 ** 32);
  writeLedger(ledger);
  return sampled;
}

// ── SZ2: the tab session's ledger (sendPolicy.ts), in sessionStorage so a reload loop is one session, else this page's memory ──
const LEDGER_KEY = 'wildshard.sentry.session';
let pageLedger: SessionLedger | null = null;
function readLedger(): SessionLedger {
  // oxlint-disable-next-line wildshard/no-raw-save -- a tab-scoped send ledger; telemetry loads before (and without) the save store
  try { const raw = sessionStorage.getItem(LEDGER_KEY); if (raw !== null) return parseLedger(raw); } catch { /* the page's copy */ }
  return pageLedger ?? emptyLedger();
}
function writeLedger(ledger: SessionLedger): void {
  pageLedger = ledger;
  // oxlint-disable-next-line wildshard/no-raw-save -- the same tab-scoped ledger
  try { sessionStorage.setItem(LEDGER_KEY, JSON.stringify(ledger)); } catch { /* kept for this page only */ }
}
/** SZ2: the warnings this page met, newest last: never events of their own, they ride the next real event as context */
const warningTrail: string[] = [];
function noteWarning(error: unknown, tags: BrowserErrorTags): void {
  warningTrail.push(`${tags.screen ?? tags.system}: ${asError(error).message.slice(0, 200)}`);
  if (warningTrail.length > WARNING_TRAIL_MAX) warningTrail.splice(0, warningTrail.length - WARNING_TRAIL_MAX);
}
/** SZ2, for tests: the warnings this page holds */
export function recentWarnings(): readonly string[] { return [...warningTrail]; }

function loadSdk(): Promise<BrowserSdk | null> {
  if (!productionPage()) return Promise.resolve(null);
  sdk ??= import('@sentry/browser').then(async (sentry) => {
    const audience = pageAudience() ?? 'player';
    const environment = browserErrorEnvironment(location.origin, installedIdentity()?.errorReportEnvironments ?? {}, audience);
    const version = typeof __ENGINE_RELEASE__ === 'object' ? __ENGINE_RELEASE__.version : undefined;
    sentry.init({
      dsn,
      release: browserErrorRelease(installedIdentity()?.fileSlug, version) ?? __BUILD_ID__,
      dist: browserErrorDist(__BUILD_ID__),
      environment,
      // ErrorModal already owns window errors and rejections. Keep the SDK out of the boot's
      // hot path and do not install click/fetch breadcrumbs, tracing, profiling or replay. S5: the page's URL and
      // user agent only (browser, OS and device tags). No dedupe: deliverBrowserError retries an identical event and
      // waits for its acknowledgement, which dedupe would swallow.
      defaultIntegrations: false,
      integrations: [sentry.httpContextIntegration()],
      tracesSampleRate: 0,
      replaysSessionSampleRate: 0,
      replaysOnErrorSampleRate: 0,
      maxBreadcrumbs: 0,
      normalizeDepth: 6, // context -> checkpoint array -> checkpoint -> facts
      beforeSend(event) {
        if (pageAudience() !== audience) return refused(event.event_id); // stopped reporting, or became automated after the SDK loaded
        if (browserErrorNoise(event, { environment }) !== null) return refused(event.event_id);
        // SZ2: one event per kind a tab session, none past the session cap, no warnings (sendPolicy.ts)
        const ledger = readLedger();
        const screen = event.tags?.['screen'], system = event.tags?.['system'];
        const fingerprint = eventFingerprint({ screen: typeof screen === 'string' ? screen : undefined, system: typeof system === 'string' ? system : undefined,
          message: event.exception?.values?.[0]?.value ?? event.message ?? '' });
        const admitted = admitEvent(ledger, { id: event.event_id ?? '', level: event.level ?? 'error', fingerprint });
        writeLedger(ledger);
        if (!admitted.send) return refused(event.event_id);
        event.tags = { ...event.tags, session_count: String(admitted.count), ...(audience === 'automation' ? { agent: 'sampled' } : {}) };
        event.contexts = { ...event.contexts, ...(Object.keys(admitted.repeats).length === 0 ? {} : { session_repeats: { ...admitted.repeats } }),
          ...(warningTrail.length === 0 ? {} : { warnings: { recent: [...warningTrail] } }) };
        if (event.request) {
          event.request.url = `${location.origin}${location.pathname}`;
          // The user agent names the browser, OS and device; no referrer or other header leaves the page.
          const agent = event.request.headers?.['User-Agent'];
          event.request.headers = agent === undefined ? {} : { 'User-Agent': agent };
        }
        return event;
      },
    });
    // DEVICE-TELEMETRY DT2: the device's snapshot as the `device` context and `device.*` tags, loaded with the SDK (never on the title)
    try { const { applySentryDevice, deviceSnapshot } = await import('./deviceSnapshot'); applySentryDevice(sentry, await deviceSnapshot(), dsn); }
    catch { /* a report goes without it */ }
    return sentry;
  // S13: a failed chunk load (a stale page, the network) must not silence every later report on this page; the next one tries again
  }).catch(() => { sdk = null; return null; });
  return sdk;
}

function tagsOf(tags: BrowserErrorTags): Record<string, string> {
  const exit = tags.exit === undefined ? {} : Object.fromEntries(Object.entries({ exit_code: tags.exit.code, zone: tags.exit.zone, revision: tags.exit.revision,
    room: tags.exit.room, step: tags.exit.step }).filter(([, value]) => value !== '').map(([key, value]) => [key, value.slice(0, 200)]));
  return { system: tags.system, build: tags.build, shard: tags.shard, boot_stage: tags.bootStage, ...(tags.screen === undefined ? {} : { screen: tags.screen }), ...exit };
}

async function send(error: unknown, tags: BrowserErrorTags): Promise<void> {
  const sentry = await loadSdk();
  if (sentry === null) return;
  try {
    sentry.withScope((scope) => {
      scope.setTags(tagsOf(tags));
      scope.setLevel(browserErrorLevel(error, tags.fatal));
      if (tags.diagnostic) scope.setContext('boot_diagnostic', tags.diagnostic);
      sentry.captureException(asError(error));
    });
  } catch { /* telemetry must never disrupt the game or its existing error modal */ }
}

function asError(error: unknown): Error {
  if (error instanceof Error) return error;
  if (typeof error === 'object' && error !== null && 'message' in error && typeof error.message === 'string') {
    const described = new Error(error.message);
    if ('stack' in error && typeof error.stack === 'string') described.stack = error.stack;
    return described;
  }
  return new Error(String(error));
}

/**
 * Fire and forget: an absent DSN adds no request or SDK initialization to a player's boot. A report that opens an error screen
 * (`tags.screen`) is durable instead (S13): it is written to the device's screen outbox first, in the screen's own turn, and leaves
 * the outbox only once Sentry acknowledges it, so a page that reloads, goes to the title or dies right after still delivers it
 * (the next page sends it with the same event id, so Sentry keeps one).
 */
/** S18: the tags for a screen engine code opens outside any level (the loading card's RETRY): this page's build, no level */
export function engineScreenTags(screen: ErrorScreen, system: string, bootStage: string, diagnostic?: Record<string, unknown>): BrowserErrorTags {
  let build = ''; try { build = __BUILD_ID__; } catch { /* under Node */ }
  return { system, build, shard: '', bootStage, fatal: false, screen, ...(diagnostic === undefined ? {} : { diagnostic }) };
}

export function captureBrowserError(error: unknown, tags: BrowserErrorTags): void {
  // SZ2: a warning is never an event (it rides the next real one), so it loads no SDK and writes no outbox
  if (QUIET_SYSTEMS.has(tags.system) || browserErrorLevel(error, tags.fatal, tags.screen) === 'warning') { noteWarning(error, tags); return; }
  if (!dsn || !productionPage()) return;
  if (tags.screen !== undefined) { reportScreen(error, tags); return; }
  void send(error, tags);
}

/** Durable diagnostics require a transport acknowledgement, not just captureException's event ID. `eventId`: a fixed id (S13). */
export async function deliverBrowserError(error: Error, tags: BrowserErrorTags, eventId?: string): Promise<boolean> {
  if (!dsn || !productionPage()) return true;
  const sentry = await loadSdk();
  const client = sentry?.getClient();
  if (!sentry || !client) { sdk = null; return false; }
  return new Promise((resolve) => {
    const delivery = new Scope('error.delivery');
    let sentId = '';
    let unsubscribe = (): void => undefined;
    let stopRefused = (): void => undefined;
    delivery.timeout(5000, () => { delivery.dispose(); unsubscribe(); stopRefused(); resolve(false); });
    const finish = (ok: boolean): void => { delivery.dispose(); unsubscribe(); stopRefused(); resolve(ok); };
    const onRefused = (id: string): void => { if (id !== '' && (id === sentId || id === eventId)) finish(true); };
    refusedListeners.add(onRefused);
    stopRefused = (): void => { refusedListeners.delete(onRefused); };
    unsubscribe = client.on('afterSendEvent', (event, response) => {
      if (event.event_id === sentId) finish(response.statusCode !== undefined && response.statusCode >= 200 && response.statusCode < 300);
    });
    try {
      sentry.withScope((scope) => {
        scope.setTags(tagsOf(tags));
        scope.setLevel(browserErrorLevel(error, tags.screen !== undefined && tags.fatal, tags.screen));
        if (tags.diagnostic) scope.setContext('boot_diagnostic', tags.diagnostic);
        sentId = sentry.captureException(error, eventId === undefined ? undefined : { event_id: eventId });
      });
    } catch { finish(false); }
  });
}

/**
 * STALE-BUILD SB6: the stale-build screen (index.html `data-stale-build`) runs before Sentry can load, so the next build that
 * boots reports it, once, as screen `stale-build` through the screen outbox (durable until Sentry acknowledges it). The build
 * tag is the stale build's, not this page's.
 */
export function staleBuildReport(note: StaleBuildNote): { error: Error; tags: BrowserErrorTags } {
  const days = Math.floor((note.seen - note.at) / 86_400_000);
  const error = new Error(`A stale build was stopped at the title and sent to update (${String(days)} days old)`);
  return { error, tags: { system: 'stale-build', build: note.build, shard: '', bootStage: 'title', fatal: false, screen: 'stale-build',
    diagnostic: { builtAt: new Date(note.at).toISOString(), seen: new Date(note.seen).toISOString(), server: note.server, tries: note.tries } } };
}

// ── S13: the screen outbox (its reader and sender, src/client/engine/telemetry/screenOutbox.ts, load only when something is owed) ──
/** one screen report waiting for Sentry's acknowledgement */
export interface ScreenReport {
  /** the Sentry event id (32 hex), fixed when the screen opens so a resend is the same event */
  readonly id: string;
  readonly at: number;
  readonly message: string;
  readonly stack: string;
  readonly tags: BrowserErrorTags & { readonly screen: ErrorScreen };
}
/** where the outbox lives: the device's `screen.reports` slot on a page, a variable in a test */
export interface ScreenStore { read: () => Json; write: (value: Json) => void }
export const OUTBOX_MAX = 8;

let idCount = 0;
/** A fresh event id. getRandomValues works on a plain-http page, where crypto.randomUUID throws (QA 11-13 row 5). */
export function screenEventId(random: (bytes: Uint8Array<ArrayBuffer>) => Uint8Array = (bytes) => crypto.getRandomValues(bytes)): string {
  try { return [...random(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, '0')).join(''); }
  catch { idCount++; return `${Date.now().toString(16)}${idCount.toString(16)}`.padStart(32, '0').slice(-32); }
}

/** the page's outbox: literal jsonSlot calls (test/saves-lock.test.ts reads the key from them) */
const pageStore: ScreenStore = {
  read: () => jsonSlot('screen.reports', 'device').peek(),
  write: (value) => { if (!jsonSlot('screen.reports', 'device').write(value)) throw new Error('screen outbox not saved'); },
};
const sending = new Set<string>();
let flushWired = false;
/** a report as the outbox stores it: JSON, so a diagnostic's undefined fields drop as they would on the wire */
function stored(report: ScreenReport): Json {
  const text = JSON.stringify(report);
  return JSON.parse(text) as Json;
}
async function sendOnce(error: Error, tags: BrowserErrorTags, id: string): Promise<void> {
  sending.add(id);
  try { await deliverBrowserError(error, tags, id); } catch { /* telemetry never throws */ } finally { sending.delete(id); }
}

/** S13: the report of a screen that just opened, on the device before anything awaits, then sent. */
function reportScreen(error: unknown, tags: BrowserErrorTags): void {
  if (tags.screen === undefined) return;
  const e = asError(error);
  // the diagnostic rides along up to 16 KB of JSON; a larger one is cut to a note, so eight stored reports stay small beside the saves
  const diagnostic = tags.diagnostic === undefined ? undefined : JSON.stringify(tags.diagnostic).length <= 16_384 ? tags.diagnostic : { truncated: true };
  const report: ScreenReport = { id: screenEventId(), at: Date.now(), message: e.message.slice(0, 2000), stack: (e.stack ?? '').slice(0, 6000),
    tags: { ...tags, screen: tags.screen, ...(diagnostic === undefined ? {} : { diagnostic }) } };
  let kept = true;
  try {
    const raw = pageStore.read();
    pageStore.write([...(Array.isArray(raw) ? raw : []), stored(report)].slice(-OUTBOX_MAX));
  } catch { kept = false; }
  // storage refused: this page still sends it, once
  if (kept) flushScreenReports(); else void sendOnce(e, report.tags, report.id);
}

/** S13: whether this build can deliver a screen report at all (a DSN is built in), so a build or test without one arms no flush timer */
export function screenReportsEnabled(): boolean { return dsn !== ''; }

/** Send what this page or an earlier one still owes (every document, off the boot's hot path), and again when the network is back. */
export function flushScreenReports(): void {
  if (!dsn || !productionPage()) return;
  if (!flushWired && typeof window !== 'undefined') {
    flushWired = true;
    pageScope.listen(window, 'online', () => { flushScreenReports(); });
  }
  // offline: the `online` listener sends it; a chunk import now would only fail
  if (typeof navigator !== 'undefined' && !navigator.onLine) return;
  let raw: Json = null;
  try { raw = pageStore.read(); } catch { return; }
  if (!Array.isArray(raw) || raw.length === 0) return;
  void import('./screenOutbox').then(({ ScreenOutbox, flushScreenOutbox }) => flushScreenOutbox(new ScreenOutbox(pageStore), deliverBrowserError, sending))
    .catch(() => undefined);
}
