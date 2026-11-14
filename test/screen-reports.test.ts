// @vitest-environment happy-dom
// SENTRY-TRIAGE S13 (Jake, 2026-11-13 ~10:15 Cancún: "Every time an error modal opens, are we writing something to Sentry that we can
// pull down and audit?"). Walks the inventory: every screen in ERROR_SCREENS has a case here that opens it the way the game does and
// sees exactly one report naming it. The outbox keeps each report until Sentry acknowledges it, so a page that leaves still delivers.
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import type { Json } from '../src/client/engine/saves/slots';
import type { BrowserErrorTags, ErrorScreen } from '../src/client/engine/telemetry/browserErrors';

const reports: { error: unknown; tags: BrowserErrorTags }[] = [];
vi.mock('../src/client/engine/telemetry/browserErrors', async (actual) => ({
  ...await actual<typeof import('../src/client/engine/telemetry/browserErrors')>(),
  captureBrowserError: (error: unknown, tags: BrowserErrorTags) => { reports.push({ error, tags }); },
}));

const opened = (): (ErrorScreen | undefined)[] => reports.map((r) => r.tags.screen);
const covered = new Set<ErrorScreen>();
const walk = (screen: ErrorScreen, name: string, run: () => Promise<void>): void => {
  covered.add(screen);
  test(`${screen}: ${name}`, run);
};

beforeEach(() => {
  reports.length = 0;
  vi.resetModules();
  vi.stubGlobal('__BUILD_ID__', 'fixture');
  vi.stubGlobal('fetch', () => Promise.resolve(Response.json({ id: 'report-1' })));
  (window as unknown as { __wsErrorModal?: boolean }).__wsErrorModal = false;
  document.body.replaceChildren();
});
afterEach(() => { vi.unstubAllGlobals(); });

async function modal(developer: boolean) {
  const { setDev } = await import('../src/client/engine/core/devMode');
  setDev(developer);
  const faults = await import('../src/shared/engine/core/faults');
  const errorModal = await import('../src/client/engine/ui/ErrorModal');
  errorModal.installErrorModal(); faults.setLoopState('running');
  return { ...faults, ...errorModal };
}

walk('error-modal', 'a fatal fault opens the modal and reports it once; a second fault under it is not a second screen', async () => {
  const { emitFault } = await modal(false);
  emitFault({ system: 'render', error: new Error('the render stopped'), verdict: 'fatal' });
  emitFault({ system: 'render', error: new Error('and again'), verdict: 'fatal' });
  expect(document.querySelector('#wserr')).not.toBeNull();
  expect(opened()).toEqual(['error-modal', undefined]);
  expect(reports[0]?.tags).toMatchObject({ system: 'render', build: 'fixture', fatal: true, bootStage: 'running' });
});

walk('glitch-chip', 'a recoverable error shows the chip once a session and reports that open once', async () => {
  const { emitFault } = await modal(false);
  emitFault({ system: 'crossbow', error: new Error('a recoverable error'), verdict: 'uncaught' });
  emitFault({ system: 'crossbow', error: new Error('another one'), verdict: 'uncaught' });
  expect(document.querySelector('#wserr-chip')).not.toBeNull();
  expect(opened()).toEqual(['glitch-chip', undefined]);
});

walk('stuck-step', "the stuck-step watchdog's modal names itself, apart from a failed boot", async () => {
  const { showError } = await modal(false);
  showError('The game stopped loading at step "world" (no progress for 61 s)', '', { step: 'world', stuckMs: 61_000 });
  expect(document.querySelector('#wserr')).not.toBeNull();
  expect(opened()).toEqual(['stuck-step']);
  expect(reports[0]?.tags.diagnostic).toMatchObject({ stall: { step: 'world' } });
});

test('error-modal: a failed boot (showError with no stall) is the error modal', async () => {
  const { showError } = await modal(false);
  showError('The game failed to start at step "start"');
  expect(opened()).toEqual(['error-modal']);
});

walk('load-failure', "the shard's load-failure page reports with its screen, and a recovery's quiet failure does not claim it", async () => {
  // session.ts is the only caller that shows the page: its report names the screen exactly when it shows it
  const session = readFileSync('src/client/game/session/session.ts', 'utf8');
  expect(session).toMatch(/report: \(failure\) => reportError\(options\.recovery === undefined \? \{ \.\.\.failure, tags: \{ \.\.\.failure\.tags, screen: 'load-failure' \} \} : failure\)/u);
  expect(session).toMatch(/show: \(failure\) => \{ if \(options\.recovery !== undefined\) return;[^\n]*showLoadFailure\(failure\)/u);
  // and reportError hands that tag to the tracker
  const { reportError } = await import('../src/client/engine/core/errorReport');
  const seen: BrowserErrorTags[] = [];
  void reportError({ kind: 'shard-load', context: {}, tags: { system: 'shard-load', build: 'fixture', shard: 'driftwood-isle', bootStage: 'world', fatal: true, screen: 'load-failure' },
    name: 'Driftwood Isle', build: 'fixture', stage: 'world', message: 'world.bin: 404', stack: '' }, (_error, tags) => { seen.push(tags); });
  expect(seen.map((t) => t.screen)).toEqual(['load-failure']);
});

walk('title-drop', 'the drop modal reports as it opens, with the step and the world', async () => {
  const { showDropModal } = await import('../src/client/app/dropModal');
  const { Scope } = await import('../src/shared/engine/app/scope');
  const scope = new Scope('test');
  showDropModal({ kind: 'restart', what: 'Unexpectedly back at the title', reason: 'The page left Driftwood Isle for the title', step: 'Playing', world: 'driftwood-isle',
    name: 'Driftwood Isle', message: '', code: '', stack: '', end: '', trail: '', routeStack: '', at: 1, build: 'fixture' }, scope, { dev: false });
  expect(document.getElementById('wsdrop')).not.toBeNull();
  expect(opened()).toEqual(['title-drop']);
  expect(reports[0]?.tags).toMatchObject({ system: 'title-drop', shard: 'driftwood-isle', bootStage: 'Playing', fatal: true });
  scope.dispose();
});

for (const [screen, state, why] of [['link-lost', 'lost', undefined], ['link-refused', 'ended', 'kicked']] as const) {
  walk(screen, `the online stop card for "${state}" reports as it opens`, async () => {
    const { linkScreens } = await import('../src/client/host/online/linkScreens');
    const { Scope } = await import('../src/shared/engine/app/scope');
    const scope = new Scope('test');
    const seen: (ErrorScreen | undefined)[] = [];
    const screens = linkScreens(scope, { retry: () => undefined, dialNow: () => undefined, reload: () => undefined, why: () => 'closed',
      progress: () => ({ dials: 3, nextDialMs: null, downMs: 120_000 }), report: (_error, tags) => { seen.push(tags.screen); } });
    screens.link(state, why);
    expect(seen).toEqual([screen]);
    scope.dispose();
  });
}

walk('stale-build', "the next build that boots reports an earlier page's stale-build screen once, and clears its note", async () => {
  const { reportStaleBuild } = await import('../src/client/engine/telemetry/staleBuildReport');
  const day = 86_400_000, at = Date.UTC(2026, 9, 1);
  // the note as index.html's data-stale-build script writes it, before the update
  localStorage.setItem('ws-stale-build', JSON.stringify({ build: 'old-build', at, server: 'new-build', tries: 1, seen: at + 23 * day }));
  reportStaleBuild(); reportStaleBuild();
  expect(opened()).toEqual(['stale-build']);
  expect(localStorage.getItem('ws-stale-build')).toBeNull();
  expect(reports[0]?.tags).toMatchObject({ system: 'stale-build', build: 'old-build', fatal: false, bootStage: 'title',
    diagnostic: { server: 'new-build', tries: 1, builtAt: '2026-10-01T00:00:00.000Z' } });
  expect(String((reports[0]?.error as Error).message)).toContain('23 days old');
});

walk('loading-stall', "a content read past its own retry offers the card's RETRY and reports that once, at warning level (S18)", async () => {
  const { readContent } = await import('../src/client/engine/boot/contentRead');
  const { loadingWaitState } = await import('../src/shared/engine/boot/loadingWaits');
  const { browserErrorLevel } = await import('../src/client/engine/telemetry/browserErrors');
  const url = 'https://example.test/shardfiles/island/shape.bin', other = 'https://example.test/shardfiles/island/sky.bin';
  let calls = 0;
  // each read tries twice before it parks: two rounds of two reads fail, then everything answers
  const failing = (): Promise<Response> => { calls++; return Promise.resolve(calls <= 8 ? new Response(null, { status: 503 }) : new Response(new Uint8Array([1, 2, 3]))); };
  const first = readContent(url, 3, { fetch: failing }), second = readContent(other, 3, { fetch: failing });
  const offered = (resource: string) => [...loadingWaitState().pending.values()].find(row => row.resource === resource);
  await vi.waitFor(() => { expect(offered(url)?.retry).toBeTypeOf('function'); expect(offered(other)?.retry).toBeTypeOf('function'); });
  // two reads stalled behind one RETRY: one screen, one report
  expect(opened()).toEqual(['loading-stall']);
  expect(reports[0]?.tags).toMatchObject({ system: 'content-read', fatal: false, diagnostic: { url } });
  expect(browserErrorLevel(reports[0]?.error, false, 'loading-stall')).toBe('warning');
  // a RETRY while still offline parks them again: the page reported its stall already
  offered(url)?.retry?.();
  await vi.waitFor(() => { expect(calls).toBe(8); expect(offered(url)?.retry).toBeTypeOf('function'); expect(offered(other)?.retry).toBeTypeOf('function'); });
  offered(url)?.retry?.();
  expect(await first).toEqual(new Uint8Array([1, 2, 3])); expect(await second).toEqual(new Uint8Array([1, 2, 3]));
  expect(opened()).toEqual(['loading-stall']);
});

walk('stale-reload', "a build whose files are gone puts up RELOADING and reports it once, before the reload (S18)", async () => {
  sessionStorage.clear();
  // the reload waits on the cover and a painted frame: the walk holds it, and sees the report came first
  const leaves: number[] = [];
  vi.doMock('../src/client/engine/boot/leaveAfterPaint', () => ({ leaveAfterPaint: () => { leaves.push(reports.length); } }));
  (await import('../src/client/engine/saves/view/storage')).installBrowserSaveEnvironment(); // its once-per-build claim is in session storage
  vi.stubGlobal('fetch', () => Promise.resolve(Response.json({ build: 'live-build' })));
  const { reloadIfStaleBuild } = await import('../src/client/engine/boot/browserChunkRecovery');
  const { browserErrorLevel } = await import('../src/client/engine/telemetry/browserErrors');
  expect(await reloadIfStaleBuild()).toBe(true);
  // once per build and tab: a second failure on the same build neither reloads nor reports again
  expect(await reloadIfStaleBuild()).toBe(false);
  expect(opened()).toEqual(['stale-reload']);
  expect(reports[0]?.tags).toMatchObject({ system: 'chunk-recovery', build: 'fixture', fatal: false, diagnostic: { live: 'live-build' } });
  expect(browserErrorLevel(reports[0]?.error, false, 'stale-reload')).toBe('warning');
  await vi.waitFor(() => { expect(leaves).toEqual([1]); });
  // the same live build is no stale screen
  reports.length = 0; sessionStorage.clear();
  vi.stubGlobal('fetch', () => Promise.resolve(Response.json({ build: 'fixture' })));
  expect(await reloadIfStaleBuild()).toBe(false);
  expect(opened()).toEqual([]);
  vi.doUnmock('../src/client/engine/boot/leaveAfterPaint');
});

walk('self-reload', "index.html's 12 s self-reload is reported by the page it reloaded into, and only that page (S18)", async () => {
  const { reportSelfReload, selfReloadClaim } = await import('../src/client/engine/telemetry/staleBuildReport');
  const started = 1_800_000_000_000;
  reportSelfReload(() => String(started - 400), started);
  expect(opened()).toEqual(['self-reload']);
  expect(reports[0]?.tags).toMatchObject({ system: 'boot', fatal: false, bootStage: 'loading' });
  // an older claim (an earlier page's), a later one, chunk recovery's '1', nothing: no report
  for (const value of [String(started - 3000), String(started + 500), '1', null]) reportSelfReload(() => value, started);
  expect(selfReloadClaim(() => { throw new Error('no session storage'); })).toBeNull();
  // stuck.ts's retry stamps a time too, but marks its reload: bootTrace passes no claim then (one report a page)
  const trace = readFileSync('src/client/engine/boot/bootTrace.ts', 'utf8');
  expect(trace).toMatch(/if \(firstCall\) reportSelfReload\(\(\) => \(self\.marked \? null : self\.claim\)\)/u);
  expect(readFileSync('src/client/engine/boot/lastEnd.ts', 'utf8')).toMatch(/inspectPreviousBoot\(this\.thisEnd\.kind === 'intentional' && this\.thisEnd\.player !== true/u);
  expect(opened()).toEqual(['self-reload']);
});

walk('save-failed', 'SAVE FAILED, RETRY at a border reports the first time a session shows it, naming both cells (S18)', async () => {
  const { saveFailedReporter } = await import('../src/client/game/grid/screenReports');
  const { browserErrorLevel } = await import('../src/client/engine/telemetry/browserErrors');
  const report = saveFailedReporter((id) => (id === 'a' ? 'driftwood-isle' : id === 'b' ? 'nalati' : ''));
  const failed = { current: 'a', target: 'b', phase: 'save-failed', issue: 'quota' } as const;
  report('saving', { ...failed, phase: 'save-pending', issue: null });
  report(null, failed);
  report('failed', failed); report('failed', failed);
  expect(opened()).toEqual(['save-failed']);
  expect(reports[0]?.tags).toMatchObject({ system: 'grid', shard: 'driftwood-isle', bootStage: 'playing', fatal: false, diagnostic: { phase: 'save-failed', target: 'nalati' } });
  expect(browserErrorLevel(reports[0]?.error, false, 'save-failed')).toBe('error');
});

walk('cell-unavailable', 'an UNAVAILABLE neighbour on Shard Select reports once per cell a session, at warning level (S18)', async () => {
  const { refusalReporter } = await import('../src/client/game/grid/screenReports');
  const { browserErrorLevel } = await import('../src/client/engine/telemetry/browserErrors');
  const report = refusalReporter();
  report('cell-1', 'nalati', 'incompatible', new Error('wrong format'));
  report('cell-1', 'nalati', 'incompatible', new Error('wrong format again'));
  report('cell-2', 'driftwood-isle', 'missing', 'a 404');
  expect(opened()).toEqual(['cell-unavailable', 'cell-unavailable']);
  expect(reports.map((r) => r.tags.shard)).toEqual(['nalati', 'driftwood-isle']);
  expect(reports[1]?.tags.diagnostic).toEqual({ refusal: 'missing', cell: 'cell-2' });
  expect(browserErrorLevel(reports[0]?.error, false, 'cell-unavailable')).toBe('warning');
});

test('a stale-build note that is not the inline script\'s shape is dropped, never reported', async () => {
  const { parseStaleBuildNote, takeStaleBuildNote } = await import('../src/client/engine/saves/staleBuildNote');
  for (const raw of [null, '', 'junk', '[]', '{"build":"b"}', JSON.stringify({ build: 1, at: 0, server: '', tries: 0, seen: 0 }), '{"build":"b","at":1e300,"server":"","tries":0,"seen":0}']) expect(parseStaleBuildNote(raw)).toBeNull();
  localStorage.setItem('ws-stale-build', '{"build":');
  expect(takeStaleBuildNote()).toBeNull();
  expect(localStorage.getItem('ws-stale-build')).toBeNull();
  // storage that refuses the removal: no report, so a stuck note can't report on every boot
  expect(takeStaleBuildNote({ getItem: () => JSON.stringify({ build: 'b', at: 0, server: '', tries: 0, seen: 0 }), removeItem: () => { throw new Error('denied'); } })).toBeNull();
});

test('the player\'s own outcomes open no reporting screen: "Playing somewhere else", "The world is full", a reload end', async () => {
  const { linkScreens } = await import('../src/client/host/online/linkScreens');
  const { Scope } = await import('../src/shared/engine/app/scope');
  const scope = new Scope('test');
  const seen: unknown[] = [];
  const screens = linkScreens(scope, { retry: () => undefined, dialNow: () => undefined, reload: () => undefined, why: () => 'closed',
    progress: () => ({ dials: 1, nextDialMs: 1000, downMs: 0 }), report: (_error, tags) => { seen.push(tags.screen); } });
  screens.link('ended', 'replaced'); screens.link('full'); screens.link('ended', 'reload');
  expect(seen).toEqual([]);
  scope.dispose();
});

test('the walk covers every screen in ERROR_SCREENS', async () => {
  const { ERROR_SCREENS } = await import('../src/client/engine/telemetry/browserErrors');
  expect([...covered].sort()).toEqual([...ERROR_SCREENS].sort());
});

// ── the outbox: survives the page leaving, resends with the same event id, drops on acknowledgement ──
function store(): { value: Json; read: () => Json; write: (v: Json) => void } {
  const s = { value: null as Json, read: () => s.value, write: (v: Json) => { s.value = v; } };
  return s;
}
const owed = (id: string, at = 1000) => ({ id, at, message: 'Unexpectedly back at the title: …', stack: '',
  tags: { system: 'title-drop', build: 'fixture', shard: 'driftwood-isle', bootStage: 'Playing', fatal: true, screen: 'title-drop' as const } });

test('the outbox keeps a report across pages until Sentry acknowledges it, resending the same event id', async () => {
  const { ScreenOutbox, flushScreenOutbox } = await import('../src/client/engine/telemetry/screenOutbox');
  const device = store();
  // page 1 opens the drop modal and leaves before the SDK answers: the report is on the device
  new ScreenOutbox(device, () => 2000).add(owed('a'.repeat(32)));
  // page 2: the first delivery fails (offline), the second is acknowledged
  const sent: string[] = [];
  const outbox = new ScreenOutbox(device, () => 3000);
  await flushScreenOutbox(outbox, (_e, _t, id) => { sent.push(id); return Promise.resolve(false); }, new Set());
  expect(outbox.pending()).toHaveLength(1);
  await flushScreenOutbox(outbox, (error, tags, id) => { sent.push(id); expect(tags.screen).toBe('title-drop'); expect(error.message).toContain('Unexpectedly'); return Promise.resolve(true); }, new Set());
  expect(sent).toEqual(['a'.repeat(32), 'a'.repeat(32)]);
  expect(outbox.pending()).toEqual([]);
});

test('the outbox is bounded: at most 8 reports, none older than a week, nothing malformed', async () => {
  const { ScreenOutbox } = await import('../src/client/engine/telemetry/screenOutbox');
  const device = store();
  const outbox = new ScreenOutbox(device, () => 8 * 24 * 60 * 60_000);
  device.value = [owed('old', 0), { id: 'bad' }, 'junk'];
  expect(outbox.pending()).toEqual([]);
  for (let i = 0; i < 10; i++) outbox.add(owed(`id${String(i)}`, 8 * 24 * 60 * 60_000 - 1));
  expect(outbox.pending().map((p) => p.id)).toEqual(['id2', 'id3', 'id4', 'id5', 'id6', 'id7', 'id8', 'id9']);
});

test('an event id is 32 hex characters, and works without crypto.randomUUID (a plain-http page)', async () => {
  const { screenEventId } = await import('../src/client/engine/telemetry/browserErrors');
  expect(screenEventId()).toMatch(/^[0-9a-f]{32}$/u);
  expect(screenEventId(() => { throw new Error('no crypto'); })).toMatch(/^[0-9a-f]{32}$/u);
});
