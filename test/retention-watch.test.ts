// @vitest-environment node
import { afterEach, expect, test, vi } from 'vitest';
// oxlint-disable-next-line import/no-nodejs-modules -- the owned fixture key signs as the page publisher does (src/scripts/code-retention.mjs)
import { generateKeyPairSync, sign } from 'node:crypto';
import { Scope } from '../src/shared/engine/app/scope';
import { fetchCodeRetention } from '../src/client/host/online/codeRetention';
import { retentionWatch, type RetentionView } from '../src/client/host/online/retentionWatch';

// FM5b1 (meta MMO-FAILURE-MODES-PLAN mode 24): the page learns its own code was retired by reading the signed `/code-retention.json`
// against a fresh verified release, at boot and on each update poll. Only a verified, matching file can say retired.
const pair = generateKeyPairSync('ed25519'), other = generateKeyPairSync('ed25519');
const publicKey = pair.publicKey.export({ type: 'spki', format: 'der' }).toString('hex');
const RUNNING = 'a1b2c3d', CURRENT = 'f9e8d7c';
const signed = (body: object, key = pair.privateKey): string => { const text = JSON.stringify(body); return JSON.stringify({ body: text, signature: sign(null, Buffer.from(text), key).toString('hex') }); };
const file = (keptBuilds: string[], extra: object = {}): object => ({ purpose: 'code-retention', channel: 'production', engineBuild: CURRENT, keptBuilds, issuedAt: 1, ...extra });
const served = (status: number, text = ''): typeof fetch => vi.fn<typeof fetch>(() => Promise.resolve(new Response(status === 404 ? 'missing' : text, { status })));

let scope: Scope | undefined;
afterEach(() => { scope?.dispose(); scope = undefined; });
function watch(read: typeof fetch, release: { channel: 'production' | 'staging' | 'preview'; engineBuild: string } = { channel: 'production', engineBuild: CURRENT }) {
  scope = new Scope('test.retention');
  const views: RetentionView[] = [], releases = vi.fn(() => Promise.resolve(release));
  const watcher = retentionWatch(scope, { build: RUNNING, release: releases, retention: expected => fetchCodeRetention(publicKey, expected, read), changed: view => { views.push(view); } });
  return { watcher, views, releases };
}

test('a verified file that keeps this build says kept; one that left it out says retired, with a deadline only when one was signed', async () => {
  const kept = watch(served(200, signed(file([CURRENT, RUNNING]))));
  expect(await kept.watcher.check()).toEqual({ availability: 'kept', retireAt: null });
  const retired = watch(served(200, signed(file([CURRENT]))));
  expect(await retired.watcher.check()).toEqual({ availability: 'retired', retireAt: null });
  const scheduled = watch(served(200, signed(file([CURRENT], { retireAt: 1_900_000_000_000 }))));
  expect(await scheduled.watcher.check()).toEqual({ availability: 'retired', retireAt: 1_900_000_000_000 });
  expect(scheduled.views).toEqual([{ availability: 'retired', retireAt: 1_900_000_000_000 }]);
});

test('a missing legacy file, a bad signature, another channel or another build is unknown, never retired', async () => {
  expect(await watch(served(404)).watcher.check()).toEqual({ availability: 'unknown', retireAt: null });
  expect(await watch(served(200, signed(file([CURRENT]), other.privateKey))).watcher.check()).toEqual({ availability: 'unknown', retireAt: null });
  expect(await watch(served(200, signed(file([CURRENT]))), { channel: 'staging', engineBuild: CURRENT }).watcher.check()).toEqual({ availability: 'unknown', retireAt: null });
  expect(await watch(served(200, signed(file([CURRENT]))), { channel: 'production', engineBuild: 'b0b0b0b' }).watcher.check()).toEqual({ availability: 'unknown', retireAt: null });
  expect(await watch(served(503)).watcher.check()).toEqual({ availability: 'unknown', retireAt: null });
});

test('a verified retirement stays until a verified file keeps the build again; a failed read changes nothing', async () => {
  let answer = { status: 200, text: signed(file([CURRENT])) };
  const read = vi.fn<typeof fetch>(() => Promise.resolve(new Response(answer.text, { status: answer.status })));
  const { watcher, views } = watch(read);
  expect((await watcher.check()).availability).toBe('retired');
  answer = { status: 503, text: '' };
  expect((await watcher.check()).availability).toBe('retired');
  answer = { status: 200, text: signed(file([CURRENT]), other.privateKey) };
  expect((await watcher.check()).availability).toBe('retired');
  answer = { status: 200, text: signed(file([CURRENT, RUNNING])) };
  expect((await watcher.check()).availability).toBe('kept');
  expect(views.map(view => view.availability)).toEqual(['retired', 'kept']);
});

test('the update poll drives it: each live-build read checks once, and a check under way answers the next', async () => {
  const read = served(200, signed(file([CURRENT, RUNNING])));
  const { watcher, releases } = watch(read);
  const first = watcher.check(), second = watcher.check();
  expect(first).toBe(second);
  await first;
  expect(releases).toHaveBeenCalledOnce();
  expect(read).toHaveBeenCalledOnce();
});
