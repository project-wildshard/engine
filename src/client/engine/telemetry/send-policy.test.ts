import { expect, test } from 'vitest';
import type { ErrorEvent } from '@sentry/browser';
import { admitEvent, AGENT_SAMPLE_RATE, agentSampled, emptyLedger, environmentSends, eventFingerprint, parseLedger, SESSION_EVENTS_MAX } from './sendPolicy';
import { browserErrorNoise } from './browserErrors';

// SENTRY-ZERO SZ2 (Jake, 2026-11-23: "Everything in sentry MUST be a bug, and it must be fixed and it must be low frequency").

test('only production and staging send, with their automation twins; preview, local and development never do', () => {
  for (const environment of ['production', 'staging', 'production-automation', 'staging-automation']) expect(environmentSends(environment), environment).toBe(true);
  for (const environment of ['preview', 'preview-automation', 'development', 'local', '']) expect(environmentSends(environment), environment).toBe(false);
});

test('an agent session draws once at AGENT_SAMPLE_RATE, and a reload keeps the draw', () => {
  const ledger = emptyLedger();
  expect(agentSampled(ledger, () => AGENT_SAMPLE_RATE + 0.001)).toBe(false);
  expect(agentSampled(ledger, () => 0)).toBe(false); // the draw is kept, not redrawn
  const lucky = emptyLedger();
  expect(agentSampled(lucky, () => AGENT_SAMPLE_RATE / 2)).toBe(true);
  expect(agentSampled(parseLedger(JSON.stringify(lucky)), () => 0.99)).toBe(true);
});

test('a fingerprint folds numbers and hashes, so one kind under another hash or count is one kind', () => {
  const a = eventFingerprint({ screen: 'error-modal', system: 'read', message: 'Read failed: /content/6d8e7d209eee67f7/shard.json · HTTP 404' });
  const b = eventFingerprint({ screen: 'error-modal', system: 'read', message: 'Read failed: /content/c37e5a1385f0fd29/shard.json · HTTP 404' });
  expect(a).toBe(b);
  expect(eventFingerprint({ message: "Couldn't reconnect: 90 dials" })).toBe(eventFingerprint({ message: "Couldn't reconnect: 28 dials" }));
  expect(eventFingerprint({ system: 'a', message: 'x' })).not.toBe(eventFingerprint({ system: 'b', message: 'x' }));
});

test('warnings and info never send', () => {
  const ledger = emptyLedger();
  for (const level of ['warning', 'info', 'log', 'debug']) expect(admitEvent(ledger, { id: level, level, fingerprint: level })).toEqual({ send: false, reason: 'level' });
  expect(ledger.sent).toBe(0);
});

test('one event per fingerprint a session; the repeats ride later events', () => {
  const ledger = emptyLedger();
  expect(admitEvent(ledger, { id: 'a1', level: 'error', fingerprint: 'A' })).toMatchObject({ send: true, count: 1 });
  for (let i = 2; i <= 4; i++) expect(admitEvent(ledger, { id: `a${String(i)}`, level: 'error', fingerprint: 'A' })).toEqual({ send: false, reason: 'duplicate' });
  expect(admitEvent(ledger, { id: 'b1', level: 'fatal', fingerprint: 'B' })).toEqual({ send: true, count: 1, repeats: { A: 4 } });
});

test('a resend of an admitted event id goes again (the outbox waits for its acknowledgement) without counting twice', () => {
  const ledger = emptyLedger();
  admitEvent(ledger, { id: 'same', level: 'error', fingerprint: 'A' });
  expect(admitEvent(ledger, { id: 'same', level: 'error', fingerprint: 'A' }).send).toBe(true);
  expect(ledger.sent).toBe(1);
  expect(ledger.seen['A']).toBe(1);
});

test('nothing past SESSION_EVENTS_MAX a session', () => {
  const ledger = emptyLedger();
  for (let i = 0; i < SESSION_EVENTS_MAX; i++) expect(admitEvent(ledger, { id: `e${String(i)}`, level: 'error', fingerprint: `F${String(i)}` }).send).toBe(true);
  expect(admitEvent(ledger, { id: 'over', level: 'fatal', fingerprint: 'new' })).toEqual({ send: false, reason: 'cap' });
});

test('a malformed stored ledger reads as a fresh one', () => {
  expect(parseLedger('{')).toEqual(emptyLedger());
  expect(parseLedger('null')).toEqual(emptyLedger());
  expect(parseLedger(JSON.stringify({ sent: 'x', ids: [1, 'a'], seen: { A: 2, B: 'x' } }))).toEqual({ sent: 0, ids: ['a'], seen: { A: 2 } });
});

const thrown = (value: string, frames: readonly { filename: string; function?: string }[] = [{ filename: 'https://play.example.invalid/b/c/x.js' }]): ErrorEvent => ({
  type: undefined, exception: { values: [{ type: 'Error', value, stacktrace: { frames: frames.map((frame) => ({ ...frame, lineno: 1, colno: 1 })) } }] },
});
const page = { environment: 'staging' };
test.each([
  ['Playwright probing a getter (WILDSHARD-GAME-BG)', thrown("Failed to read the 'closed' property from 'WebTransport': Illegal invocation", [{ filename: '<anonymous>', function: 'UtilityScript.evaluate' }]), 'tool'],
  ['Safari Web Inspector (WILDSHARD-GAME-AA)', thrown('J205 refused a non-staging socket', [{ filename: 'web-inspector://bootstrap.js', function: 'construct' }]), 'tool'],
  ['a read the game names as the connection\'s (WILDSHARD-GAME-9B)', thrown('Read failed: /shardfiles/mirror-salt/shard.json · connection unavailable'), 'network'],
  ['a stopped download (WILDSHARD-GAME-A1)', thrown('Read failed: /assets/spawn/parts/25500f56cd377ff9.pack.br · the download stopped'), 'network'],
  ['a bare fetch failure (WILDSHARD-GAME-88)', thrown('Failed to fetch'), 'network'],
  ['Safari\'s module load failure (WILDSHARD-GAME-BT)', thrown('Importing a module script failed.'), 'network'],
  ['the service worker\'s load failure (WILDSHARD-GAME-AF)', thrown('FetchEvent.respondWith received an error: TypeError: Load failed'), 'network'],
  ['a failed start wrapping the service worker\'s load failure (WILDSHARD-GAME-AC)', thrown('The game failed to start at step "modules" (TypeError: FetchEvent.respondWith received an error: TypeError: Load failed)'), 'network'],
  ['a wrapped connection read', thrown('The game stopped loading (Read failed: /x.json · connection unavailable)'), 'network'],
] as const)('SZ2 drops %s', (_name, event, reason) => {
  expect(browserErrorNoise(event, page)).toBe(reason);
});
test.each([
  ['a read that answered 404 (a missing file is a bug)', thrown('Read failed: /shardfiles/pine-hollow/blobs/wasm/07e4.wasm · HTTP 404')],
  ['a real TypeError', thrown("Cannot set properties of undefined (setting 'n')")],
])('SZ2 keeps %s', (_name, event) => {
  expect(browserErrorNoise(event, page)).toBeNull();
});
