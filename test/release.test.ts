// oxlint-disable-next-line import/no-nodejs-modules -- It signs as the promoter does.
import { generateKeyPairSync, sign } from 'node:crypto';
import { expect, test } from 'vitest';
import { KEPT_RELEASE_MS, RELEASE_DEADLINE_MS, keptRelease, releaseToDial, type KeptRelease, type ReleaseKeep } from '../src/client/host/online/release';

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
