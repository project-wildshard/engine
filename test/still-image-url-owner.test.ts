// oxlint-disable-next-line import/no-nodejs-modules -- Read the original admitted PNG bytes, not a synthetic image header.
import { readFileSync } from 'node:fs';
import { expect, test, vi } from 'vitest';
import { Scope } from '../src/shared/engine/app/scope';
import { stillImageObjectUrl } from '../src/client/game/shardfile/stillImage';

const original = Uint8Array.from(readFileSync('test/fixtures/world-source/image.png'));

test('owned image URL preserves offset bytes until its real scope disposes', async () => {
  const storage = new Uint8Array(original.length + 8);
  storage.set(original, 4);
  const scope = new Scope('image'), revoke = vi.spyOn(URL, 'revokeObjectURL');
  const url = stillImageObjectUrl(storage.subarray(4, -4), scope);
  try {
    storage.fill(0);
    const response = await fetch(url);
    expect(response.headers.get('content-type')).toBe('image/png');
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(original);
  } finally { scope.dispose(); }
  scope.dispose();
  expect(revoke.mock.calls).toEqual([[url]]);
  await expect(fetch(url)).rejects.toThrow();
});

test('disposed and retiring ancestor owners refuse before image allocation', () => {
  const create = vi.spyOn(URL, 'createObjectURL');
  const closed = new Scope('closed');
  closed.dispose();
  expect(() => stillImageObjectUrl(original, closed)).toThrow('Image owner retired');
  const parent = new Scope('parent'), child = parent.child('image');
  parent.onDispose(() => undefined);
  const steps = parent.disposeSteps();
  steps.next();
  try {
    expect(parent.disposing).toBe(true);
    expect(child.disposed).toBe(false);
    expect(() => stillImageObjectUrl(original, child)).toThrow('Image owner retired');
  } finally { for (const step of steps) void step; }
  expect(create).not.toHaveBeenCalled();
});

test.each([false, true])('failed disposal registration revokes once (early cleanup %s)', (earlyCleanup) => {
  const failure = new Error('registration failed'), revoke = vi.spyOn(URL, 'revokeObjectURL');
  const create = vi.spyOn(URL, 'createObjectURL');
  const owner = { disposed: false, onDispose(cleanup: () => void): void {
    if (earlyCleanup) cleanup();
    throw failure;
  } };
  expect(() => stillImageObjectUrl(original, owner)).toThrow(failure);
  expect(revoke).toHaveBeenCalledTimes(1);
  expect(revoke).toHaveBeenCalledWith(create.mock.results[0]?.value);
});

test('synchronous retirement never returns an already revoked URL', () => {
  const revoke = vi.spyOn(URL, 'revokeObjectURL');
  const owner = { disposed: false, onDispose(cleanup: () => void): void { cleanup(); } };
  expect(() => stillImageObjectUrl(original, owner)).toThrow('Image owner retired');
  expect(revoke).toHaveBeenCalledTimes(1);
});

test('retirement during registration revokes even when cleanup was not called', () => {
  const revoke = vi.spyOn(URL, 'revokeObjectURL');
  let cleanup: (() => void) | undefined;
  const owner = { disposed: false, onDispose(release: () => void): void {
    cleanup = release;
    this.disposed = true;
  } };
  expect(() => stillImageObjectUrl(original, owner)).toThrow('Image owner retired');
  if (cleanup === undefined) throw new Error('Cleanup was not registered');
  cleanup();
  expect(revoke).toHaveBeenCalledTimes(1);
});

test('validation and URL factory failures never register cleanup', () => {
  const onDispose = vi.fn<(_cleanup: () => void) => void>();
  const create = vi.spyOn(URL, 'createObjectURL');
  const owner = { disposed: false, onDispose };
  expect(() => stillImageObjectUrl(new Uint8Array(4), owner)).toThrow();
  expect(create).not.toHaveBeenCalled();
  const failure = new Error('URL factory failed');
  create.mockImplementation(() => { throw failure; });
  expect(() => stillImageObjectUrl(original, owner)).toThrow(failure);
  expect(onDispose).not.toHaveBeenCalled();
});
