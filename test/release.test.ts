// oxlint-disable-next-line import/no-nodejs-modules -- It signs as the promoter does.
import { generateKeyPairSync, sign } from 'node:crypto';
import { expect, test } from 'vitest';
import { KEPT_RELEASE_MS, RELEASE_DEADLINE_MS, ReleaseReadError, keptRelease, releaseRetryMs, releaseScreen, releaseToDial, retryAfterMs, type KeptRelease, type ReleaseFault, type ReleaseKeep, type ReleaseWait } from '../src/client/host/online/release';

// OFFLINE OF4: the page dials from a verified last-known release file, kept 7 days, and a read never holds it past 8 s.
const URL_AT = 'https://cdn.example/releases/staging.json', DAY = 24 * 60 * 60 * 1000, NOW = Date.UTC(2026, 10, 13, 12);
const key = generateKeyPairSync('ed25519'), publicKey = key.publicKey.export({ type: 'spki', format: 'der' }).toString('hex');
const signed = (serial: number, socket = 'wss://rooms.example/', engineBuild = 'b1'): string => {
  const body = JSON.stringify({ channel: 'staging', serial, engineBuild, saveEpoch: 1, shards: [], socket });
  return JSON.stringify({ body, signature: sign(null, Buffer.from(body), key.privateKey).toString('hex') });
};
const memoryKeep = (start: KeptRelease | null = null): ReleaseKeep & { kept: KeptRelease | null } => {
  const keep = { kept: start, read: () => keep.kept, write: (kept: KeptRelease) => { keep.kept = kept; } };
  return keep;
};
const answering = (text: string): typeof fetch => () => Promise.resolve(new Response(text, { status: 200 }));
const offline: typeof fetch = () => Promise.reject(new TypeError('Failed to fetch'));

test('the deadline is FM5\'s 8 s and the kept copy lasts 7 days', () => {
  expect(RELEASE_DEADLINE_MS).toBe(8000);
  expect(KEPT_RELEASE_MS).toBe(7 * DAY);
});

test('a kept copy is believed only on its signature, for this release, inside 7 days', async () => {
  const good = { of: URL_AT, at: NOW - DAY, text: signed(4) };
  await expect(keptRelease(URL_AT, publicKey, memoryKeep(good), NOW)).resolves.toMatchObject({ serial: 4 });
  await expect(keptRelease(URL_AT, publicKey, memoryKeep({ ...good, text: good.text.replace('"serial\\":4', '"serial\\":9') }), NOW), 'a bad signature').resolves.toBeNull();
  await expect(keptRelease(URL_AT, publicKey, memoryKeep({ ...good, at: NOW - 7 * DAY - 1 }), NOW), 'past 7 days').resolves.toBeNull();
  await expect(keptRelease(URL_AT, publicKey, memoryKeep({ ...good, at: NOW + DAY }), NOW), 'kept in the future').resolves.toBeNull();
  await expect(keptRelease('https://cdn.example/releases/production.json', publicKey, memoryKeep(good), NOW), 'another release').resolves.toBeNull();
  await expect(keptRelease(URL_AT, generateKeyPairSync('ed25519').publicKey.export({ type: 'spki', format: 'der' }).toString('hex'), memoryKeep(good), NOW), 'another key').resolves.toBeNull();
  await expect(keptRelease(URL_AT, publicKey, memoryKeep({ ...good, text: 'not json' }), NOW)).resolves.toBeNull();
});

test('a fresh read replaces the kept one', async () => {
  const keep = memoryKeep({ of: URL_AT, at: NOW - 2 * DAY, text: signed(4) });
  const { file, fresh } = await releaseToDial(URL_AT, publicKey, { keep, fetch: answering(signed(5, 'wss://new.example/')), now: () => NOW });
  expect(file.serial, 'the kept copy dials at once').toBe(4);
  await expect(fresh).resolves.toMatchObject({ serial: 5, socket: 'wss://new.example/' });
  expect(keep.kept).toEqual({ of: URL_AT, at: NOW, text: signed(5, 'wss://new.example/') });
});

test('a fresh read with a bad signature is never kept', async () => {
  const before = { of: URL_AT, at: NOW - DAY, text: signed(4) }, keep = memoryKeep(before);
  const { fresh } = await releaseToDial(URL_AT, publicKey, { keep, fetch: answering(signed(5).replace('"serial\\":5', '"serial\\":6')), now: () => NOW });
  await expect(fresh).resolves.toBeNull();
  expect(keep.kept).toEqual(before);
});

test('an older signed file never replaces a newer kept one', async () => {
  const before = { of: URL_AT, at: NOW - DAY, text: signed(5) }, keep = memoryKeep(before);
  const { file, fresh } = await releaseToDial(URL_AT, publicKey, { keep, fetch: answering(signed(4, 'wss://old.example/')), now: () => NOW });
  expect(file.serial).toBe(5);
  await expect(fresh, 'the dial never moves to the older address').resolves.toBeNull();
  expect(keep.kept).toEqual(before);
});

test('a keep that throws is no copy, and the read still answers', async () => {
  const broken: ReleaseKeep = { read: () => { throw new Error('storage gone'); }, write: () => { throw new Error('storage full'); } };
  await expect(releaseToDial(URL_AT, publicKey, { keep: broken, fetch: answering(signed(3)), now: () => NOW })).resolves.toMatchObject({ file: { serial: 3 }, fresh: null });
});

test('offline, the page dials from the kept copy; with none, the read fails as before', async () => {
  const keep = memoryKeep({ of: URL_AT, at: NOW - 6 * DAY, text: signed(4) });
  const dial = await releaseToDial(URL_AT, publicKey, { keep, fetch: offline, now: () => NOW });
  expect(dial.file.serial).toBe(4);
  await expect(dial.fresh).resolves.toBeNull();
  await expect(releaseToDial(URL_AT, publicKey, { keep: memoryKeep(), fetch: offline, now: () => NOW })).rejects.toThrow('Failed to fetch');
  await expect(releaseToDial(URL_AT, publicKey, { keep: memoryKeep({ of: URL_AT, at: NOW - 8 * DAY, text: signed(4) }), fetch: offline, now: () => NOW }), 'a copy past 7 days dials nothing').rejects.toThrow('Failed to fetch');
});

test('with no kept copy the page waits for the read, and keeps what it read', async () => {
  const keep = memoryKeep();
  const { file, fresh } = await releaseToDial(URL_AT, publicKey, { keep, fetch: answering(signed(7)), now: () => NOW });
  expect(file.serial).toBe(7);
  expect(fresh).toBeNull();
  expect(keep.kept?.at).toBe(NOW);
});

test('a read that hangs past the deadline ends, and the kept copy dials', async () => {
  let aborted = false;
  const hanging: typeof fetch = (_url, init) => new Promise((_resolve, reject) => {
    init?.signal?.addEventListener('abort', () => { aborted = true; reject(new DOMException('The operation was aborted.', 'AbortError')); });
  });
  await expect(releaseToDial(URL_AT, publicKey, { keep: memoryKeep(), fetch: hanging, now: () => NOW, deadlineMs: 20 })).rejects.toThrow(/release file .*20 ms/u);
  expect(aborted).toBe(true);
  const dial = await releaseToDial(URL_AT, publicKey, { keep: memoryKeep({ of: URL_AT, at: NOW, text: signed(4) }), fetch: hanging, now: () => NOW, deadlineMs: 20 });
  expect(dial.file.serial).toBe(4);
  await expect(dial.fresh).resolves.toBeNull();
});

test('a 5xx is a failed read, and the kept copy dials', async () => {
  const fivexx: typeof fetch = () => Promise.resolve(new Response('', { status: 503 }));
  await expect(releaseToDial(URL_AT, publicKey, { keep: memoryKeep(), fetch: fivexx, now: () => NOW })).rejects.toThrow('503');
  await expect(releaseToDial(URL_AT, publicKey, { keep: memoryKeep({ of: URL_AT, at: NOW, text: signed(4) }), fetch: fivexx, now: () => NOW })).resolves.toMatchObject({ file: { serial: 4 } });
});

// FM5 (meta MMO-FAILURE-MODES-PLAN modes 1, 11, 12, 37 to 39): a failed read says what failed, and the page waits by the stated policy
const failing = (response: () => Response | Promise<Response>): typeof fetch => () => Promise.resolve(response());
const faultOf = async (read: typeof fetch, online = true): Promise<ReleaseFault> => {
  const failed: unknown = await releaseToDial(URL_AT, publicKey, { keep: memoryKeep(), fetch: read, now: () => NOW, online: () => online }).then(() => null, (error: unknown) => error);
  if (!(failed instanceof ReleaseReadError)) throw new Error(`not a typed read failure: ${String(failed)}`);
  return failed.fault;
};

test('each failed read is typed by what the page measured, and names its screen', async () => {
  const cases: [typeof fetch, ReleaseFault, string, boolean?][] = [
    [failing(() => new Response('', { status: 503 })), { kind: 'status', status: 503, retryAfterMs: null }, 'release-5xx'],
    [failing(() => new Response('', { status: 429, headers: { 'retry-after': '7' } })), { kind: 'status', status: 429, retryAfterMs: 7000 }, 'release-429'],
    [failing(() => new Response('', { status: 404 })), { kind: 'status', status: 404, retryAfterMs: null }, 'release-404'],
    [answering('<!doctype html><title>Sign in</title>'), { kind: 'portal', why: 'html' }, 'captive-portal'],
    [failing(() => new Response('{}', { headers: { 'content-type': 'text/html; charset=utf-8' } })), { kind: 'portal', why: 'html' }, 'captive-portal'],
    [answering('{"not":"signed"}'), { kind: 'portal', why: 'malformed' }, 'captive-portal'],
    [answering(signed(5).replace('"serial\\":5', '"serial\\":6')), { kind: 'unsigned' }, 'release-unsigned'],
    [offline, { kind: 'network' }, 'release-5xx'],
    [offline, { kind: 'offline' }, 'offline-launch', false],
  ];
  for (const [read, fault, screen, online] of cases) {
    const got = await faultOf(read, online);
    expect(got, screen).toEqual(fault);
    expect(releaseScreen(got)).toBe(screen);
  }
  const hanging: typeof fetch = (_url, init) => new Promise((_resolve, reject) => { init?.signal?.addEventListener('abort', () => { reject(new DOMException('aborted', 'AbortError')); }); });
  await expect(releaseToDial(URL_AT, publicKey, { keep: memoryKeep(), fetch: hanging, now: () => NOW, deadlineMs: 20 })).rejects.toMatchObject({ fault: { kind: 'timeout', ms: 20 } });
});

test('Retry-After is seconds or an HTTP date, bounded; anything else is no answer', () => {
  expect(retryAfterMs('3', NOW)).toBe(3000);
  expect(retryAfterMs(new Date(NOW + 9000).toUTCString(), NOW)).toBe(9000);
  expect(retryAfterMs('-1', NOW)).toBeNull();
  expect(retryAfterMs('soon', NOW)).toBeNull();
  expect(retryAfterMs('3601', NOW), 'past 10 min').toBeNull();
  expect(retryAfterMs(null, NOW)).toBeNull();
});

test('the policy: 2, 4, 8, 16 then 30 s; 429 as told or 20 s first; 404 each minute; offline, portal and bad signature wait for a cause', () => {
  const down: ReleaseFault = { kind: 'status', status: 503, retryAfterMs: null };
  expect([0, 1, 2, 3, 4, 9].map(attempt => releaseRetryMs(down, attempt))).toEqual([2000, 4000, 8000, 16_000, 30_000, 30_000]);
  expect(releaseRetryMs({ kind: 'timeout', ms: 8000 }, 0)).toBe(2000);
  expect(releaseRetryMs({ kind: 'network' }, 5)).toBe(30_000);
  expect(releaseRetryMs({ kind: 'status', status: 429, retryAfterMs: 3000 }, 4)).toBe(3000);
  expect(releaseRetryMs({ kind: 'status', status: 429, retryAfterMs: null }, 0)).toBe(20_000);
  expect(releaseRetryMs({ kind: 'status', status: 429, retryAfterMs: null }, 1)).toBe(4000);
  expect(releaseRetryMs({ kind: 'status', status: 404, retryAfterMs: null }, 3)).toBe(60_000);
  for (const fault of [{ kind: 'offline' }, { kind: 'portal', why: 'html' }, { kind: 'unsigned' }] as const) expect(releaseRetryMs(fault, 0)).toBeNull();
});

test('with a wait, the page reads again by the policy until a verified file answers, then closes what it showed', async () => {
  const answers = [new Response('', { status: 503 }), new Response('', { status: 429, headers: { 'retry-after': '5' } }), new Response(signed(8), { status: 200 })];
  const seen: { fault: ReleaseFault; attempt: number; retryMs: number | null }[] = [];
  let closed = 0;
  const wait: ReleaseWait = { after: (fault, attempt, retryMs) => { seen.push({ fault, attempt, retryMs }); return Promise.resolve(); }, done: () => { closed++; } };
  const keep = memoryKeep(), read: typeof fetch = () => Promise.resolve(answers.shift() ?? new Response('', { status: 500 }));
  const dial = await releaseToDial(URL_AT, publicKey, { keep, fetch: read, now: () => NOW, wait });
  expect(dial.file.serial).toBe(8);
  expect(seen).toEqual([{ fault: { kind: 'status', status: 503, retryAfterMs: null }, attempt: 0, retryMs: 2000 }, { fault: { kind: 'status', status: 429, retryAfterMs: 5000 }, attempt: 1, retryMs: 5000 }]);
  expect(closed).toBe(1);
  expect(keep.kept?.text).toBe(signed(8));
});

test('a kept copy never shows a wait, and the player leaving stops the reads', async () => {
  let shown = 0;
  const showing: ReleaseWait = { after: () => { shown++; return Promise.resolve(); }, done: () => undefined };
  await releaseToDial(URL_AT, publicKey, { keep: memoryKeep({ of: URL_AT, at: NOW, text: signed(4) }), fetch: offline, now: () => NOW, wait: showing });
  expect(shown).toBe(0);
  let reads = 0;
  const leaving: ReleaseWait = { after: () => Promise.reject(new Error('left for the title')), done: () => undefined };
  await expect(releaseToDial(URL_AT, publicKey, { keep: memoryKeep(), fetch: () => { reads++; return Promise.reject(new TypeError('Failed to fetch')); }, now: () => NOW, wait: leaving })).rejects.toThrow('left for the title');
  expect(reads).toBe(1);
});
