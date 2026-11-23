// @vitest-environment happy-dom
// SENTRY-TRIAGE S21 (opus-sentry, 2026-11-17): Nalati's error card on staging v0.1.33 and v0.1.34 (`grid.runtime.<cell>.animals`
// "reading 'bones'", then the core `render` "reading 'update'", the loop dead at frame 9) reached the /api/errors inbox
// ("REPORT SENT") and never Sentry: the only pages that entered Nalati were agent proofs (Playwright: navigator.webdriver,
// HeadlessChrome), and the old gate kept every automated page off Sentry altogether. Now a system that throws, a core system
// that stops the loop and the card it opens reach Sentry from every allowed origin; an automated page reports under
// `<environment>-automation`, so a player's environment stays the players'.
// SENTRY-ZERO SZ2 (2026-11-23): an agent's tab session sends only on a 1% sample (these tests preset the draw), every session sends
// one event per kind and at most SESSION_EVENTS_MAX, warnings never send, and preview sends nothing.
import { afterEach, beforeEach, expect, test, vi } from 'vitest';

const sdk = vi.hoisted(() => {
  const state = {
    inits: [] as Record<string, unknown>[],
    sent: [] as { message: string; tags: Record<string, string>; level: string; environment: string; contexts: Record<string, unknown> }[],
    refused: 0,
  };
  return state;
});
vi.mock('@sentry/browser', () => {
  let options: Record<string, unknown> = {};
  let tags: Record<string, string> = {};
  let level = '';
  const listeners = new Set<(event: { event_id: string }, response: { statusCode: number }) => void>();
  let n = 0;
  return {
    init: (o: Record<string, unknown>) => { options = o; sdk.inits.push(o); },
    httpContextIntegration: () => ({ name: 'HttpContext' }),
    getClient: () => ({ on: (_name: string, fn: (event: { event_id: string }, response: { statusCode: number }) => void) => { listeners.add(fn); return () => { listeners.delete(fn); }; } }),
    setContext: () => undefined,
    setTags: () => undefined,
    withScope: (fn: (scope: unknown) => void) => {
      tags = {}; level = '';
      fn({ setTags: (t: Record<string, string>) => { tags = { ...tags, ...t }; }, setLevel: (l: string) => { level = l; }, setContext: () => undefined });
    },
    captureException: (error: Error, hint?: { event_id?: string }) => {
      const id = hint?.event_id ?? (++n).toString(16).padStart(32, '0');
      const event = { event_id: id, tags, level, contexts: {} as Record<string, unknown>, exception: { values: [{ type: error.name, value: error.message }] } };
      const beforeSend = options['beforeSend'] as ((e: typeof event) => unknown) | undefined;
      const kept = beforeSend === undefined ? event : beforeSend(event);
      if (kept === null) sdk.refused++;
      else {
        sdk.sent.push({ message: error.message, tags: event.tags, level, environment: String(options['environment']), contexts: event.contexts });
        for (const fn of listeners) fn(event, { statusCode: 200 });
      }
      return id;
    },
  };
});

const desktop = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';
/** SZ2: `sampled` presets this tab session's agent draw (unset: the page draws its own) */
function page(opts: { automated: boolean; reports?: boolean; agent?: string; sampled?: boolean }): void {
  Object.defineProperty(navigator, 'webdriver', { value: opts.automated, configurable: true });
  Object.defineProperty(navigator, 'userAgent', { value: opts.agent ?? desktop, configurable: true });
  Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
  if (opts.sampled !== undefined) sessionStorage.setItem('wildshard.sentry.session', JSON.stringify({ agent: opts.sampled, sent: 0, ids: [], seen: {} }));
}
async function install(reports = true, environment = 'staging') {
  const { installAppIdentity } = await import('../src/shared/engine/app/identity');
  installAppIdentity({
    name: 'S21', wordmark: '', tagline: '', savePrefix: 's21.', saveFormat: '', fileSlug: 'wildshard', exposeProbe: () => undefined, harness: () => undefined,
    errorReportOrigins: reports ? [location.origin] : [], errorReportEnvironments: { [location.origin]: environment },
  });
  const { setDev } = await import('../src/client/engine/core/devMode');
  setDev(false);
  const faults = await import('../src/shared/engine/core/faults');
  const { installErrorModal } = await import('../src/client/engine/ui/ErrorModal');
  installErrorModal(); faults.setLoopState('running');
  return faults;
}
const settle = async (): Promise<void> => { for (let i = 0; i < 40; i++) await new Promise((r) => setTimeout(r, 0)); };

/** Nalati's two throws as Game.ts's per-system catch meets them: one content system, then the core render three frames running */
function nalati(faults: Awaited<ReturnType<typeof install>>): void {
  const animals = faults.makeSystem(null, 'grid.runtime.nalati-grasslands.animals', false, 'animals');
  const render = faults.makeSystem(null, 'render', true, 'render');
  faults.systemFault(animals, new TypeError("Cannot read properties of undefined (reading 'bones')"), 7, 100);
  for (const frame of [7, 8, 9]) faults.systemFault(render, new TypeError("Cannot read properties of undefined (reading 'update')"), frame, 100 + frame);
}

beforeEach(() => {
  sdk.inits.length = 0; sdk.sent.length = 0; sdk.refused = 0;
  vi.resetModules();
  vi.stubEnv('VITE_SENTRY_DSN', 'https://public@o0.ingest.example.invalid/1');
  vi.stubGlobal('__BUILD_ID__', 's21-build');
  vi.stubGlobal('__ENGINE_RELEASE__', { version: '0.1.35' });
  vi.stubGlobal('fetch', () => Promise.resolve(Response.json({ id: 'report-1' })));
  (window as unknown as { __wsErrorModal?: boolean }).__wsErrorModal = false;
  localStorage.clear(); sessionStorage.clear();
  document.body.replaceChildren();
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

test('a sampled automated page: the system that throws, the core render that stops the loop and its card all reach Sentry, as automation', async () => {
  page({ automated: true, agent: desktop.replace('Chrome/', 'HeadlessChrome/'), sampled: true });
  nalati(await install());
  // the reports go out after the telemetry module's lazy imports: a cold module graph (the push gate's clean copy) takes
  // more than settle()'s 40 turns (mini-ninemem, 2026-11-17), so wait for them, bounded
  await vi.waitFor(() => { expect(sdk.sent.filter((s) => s.tags['system'] !== undefined).length).toBeGreaterThanOrEqual(3); }, { timeout: 5000 });
  await settle();
  expect(document.querySelector('#wserr')).not.toBeNull(); // the card the proof saw
  expect(sdk.inits.map((o) => o['environment'])).toEqual(['staging-automation']);
  const bySystem = new Map(sdk.sent.map((s) => [s.tags['system'], s]));
  expect(bySystem.get('grid.runtime.nalati-grasslands.animals')).toMatchObject({ message: "Cannot read properties of undefined (reading 'bones')", level: 'error' });
  expect(bySystem.get('render')).toMatchObject({ message: "Cannot read properties of undefined (reading 'update')", level: 'fatal' });
  expect(sdk.sent.some((s) => s.tags['screen'] === 'error-modal')).toBe(true);
  expect(sdk.sent.every((s) => s.tags['agent'] === 'sampled')).toBe(true);
});

test('SZ2: an automated page outside the 1% sample loads no SDK and sends nothing', async () => {
  page({ automated: true, sampled: false });
  nalati(await install());
  await settle();
  expect(document.querySelector('#wserr')).not.toBeNull(); // the agent still sees the card
  expect(sdk.inits).toEqual([]);
  expect(sdk.sent).toEqual([]);
});

test('SZ2: preview sends nothing, player or agent', async () => {
  page({ automated: false });
  nalati(await install(true, 'preview'));
  await settle();
  expect(sdk.inits).toEqual([]);
  expect(sdk.sent).toEqual([]);
});

test('SZ2: the same fault again in the session is one event; the next kind carries the repeat count', async () => {
  page({ automated: false });
  const faults = await install();
  for (let i = 0; i < 5; i++) faults.emitFault({ system: 'grid.runtime.x.animals', error: new Error(`boom at frame ${String(i)}`), verdict: 'retry' });
  await vi.waitFor(() => { expect(sdk.sent.length).toBe(1); }, { timeout: 5000 });
  await settle();
  expect(sdk.sent).toHaveLength(1);
  expect(sdk.sent[0]?.tags['session_count']).toBe('1');
  faults.emitFault({ system: 'grid.runtime.y.animals', error: new Error('another'), verdict: 'retry' });
  await vi.waitFor(() => { expect(sdk.sent.length).toBe(2); }, { timeout: 5000 });
  expect(sdk.sent[1]?.contexts['session_repeats']).toEqual({ '|grid.runtime.x.animals|boom at frame #': 5 });
});

test('SZ2: a warning screen never sends; it rides the next real event as context', async () => {
  page({ automated: false });
  const faults = await install();
  const { captureBrowserError, engineScreenTags, recentWarnings } = await import('../src/client/engine/telemetry/browserErrors');
  for (let i = 0; i < 50; i++) captureBrowserError(new Error('Missing world map tile: mossgate'), engineScreenTags('map-tile-missing', 'grid', 'playing'));
  await settle();
  expect(sdk.sent).toEqual([]);
  expect(recentWarnings()).toHaveLength(20);
  faults.emitFault({ system: 'render', error: new Error('a real fault'), verdict: 'retry' });
  await vi.waitFor(() => { expect(sdk.sent.length).toBe(1); }, { timeout: 5000 });
  expect(sdk.sent[0]?.contexts['warnings']).toMatchObject({ recent: expect.arrayContaining(['map-tile-missing: Missing world map tile: mossgate']) });
});

test('SZ2: the loading card\'s 20 s "Loading slow" note is never an event (the 60 s stuck step is)', async () => {
  page({ automated: false });
  const faults = await install();
  const { recentWarnings } = await import('../src/client/engine/telemetry/browserErrors');
  faults.emitFault({ system: 'boot.slow', error: new Error('Loading slow at step "home" (no progress for 20 s)'), verdict: 'retry' });
  await settle();
  expect(sdk.sent).toEqual([]);
  expect(recentWarnings()).toContain('boot.slow: Loading slow at step "home" (no progress for 20 s)');
});

test('a player on the same page reports the same faults under the plain environment', async () => {
  page({ automated: false });
  nalati(await install());
  await vi.waitFor(() => { expect(sdk.sent.length).toBeGreaterThanOrEqual(3); }, { timeout: 5000 });
  await settle();
  expect(sdk.inits.map((o) => o['environment'])).toEqual(['staging']);
  expect(sdk.sent.map((s) => s.tags['system']).sort()).toEqual(['grid.runtime.nalati-grasslands.animals', 'render', 'render']); // render: its first throw, then the stop
});

test('SZ2: a session sends at most SESSION_EVENTS_MAX events, screens included, so no session can spend the quota', async () => {
  page({ automated: true, sampled: true });
  const faults = await install();
  const { SESSION_EVENTS_MAX } = await import('../src/client/engine/telemetry/sendPolicy');
  for (let i = 0; i < SESSION_EVENTS_MAX + 5; i++) faults.emitFault({ system: `s${String(i)}`, error: new Error(`boom ${String(i)}`), verdict: 'retry' });
  await vi.waitFor(() => { expect(sdk.sent.length + sdk.refused).toBe(SESSION_EVENTS_MAX + 5); }, { timeout: 5000 });
  expect(sdk.sent).toHaveLength(SESSION_EVENTS_MAX);
  // past the cap, the card's own report stops too
  faults.emitFault({ system: 'render', error: new Error('the render stopped'), verdict: 'fatal' });
  await settle();
  expect(sdk.sent).toHaveLength(SESSION_EVENTS_MAX);
});

test('an origin off the list sends nothing, automated or not', async () => {
  page({ automated: true });
  nalati(await install(false));
  await settle();
  expect(sdk.inits).toEqual([]);
  expect(sdk.sent).toEqual([]);
});
