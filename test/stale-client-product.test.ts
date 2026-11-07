import { expect, test, vi } from 'vitest';
import { hashImmutableBytes } from '../src/shared/host/immutable';
import { readIndexBytes, StaleClientError, type ProductOptions } from '../src/client/game/shardfile/product';
import { staleClientRecovery } from '../src/client/engine/boot/stuck';

const hash = (bytes: Uint8Array): Promise<string> => Promise.resolve(hashImmutableBytes(bytes));
const known = new TextEncoder().encode('{"format":"known"}');
// Newer products may carry fields an old client rejects; the stale path must never parse them.
const newer = new TextEncoder().encode('{"feature":"population.wildlife"');
function options(firstParty: boolean, stale = vi.fn(() => Promise.resolve())): { options: ProductOptions; stale: typeof stale } {
  return { stale, options: { base: 'https://example.test/shardfiles/a/', offline: false, firstParty, hash,
    fetch: () => Promise.reject(new Error('unused')), built: { indexes: new Set([hashImmutableBytes(known)]), stale } } };
}

test('an index this build validated is admitted without recovery', async () => {
  const { options: opts, stale } = options(true);
  expect(await readIndexBytes(known, opts)).toEqual({ format: 'known' });
  expect(stale).not.toHaveBeenCalled();
});

test('a newer index recovers once before parsing and then refuses with the typed error', async () => {
  const { options: opts, stale } = options(true);
  await expect(readIndexBytes(newer, opts)).rejects.toBeInstanceOf(StaleClientError);
  expect(stale).toHaveBeenCalledOnce();
  // A recovery that navigates never lets the caller admit or report the response.
  const pending = options(true, vi.fn(() => new Promise<void>(() => { /* navigating */ }))).options;
  expect(await Promise.race([readIndexBytes(newer, pending).then(() => 'settled', () => 'settled'), new Promise(resolve => { setTimeout(resolve, 20, 'pending'); })])).toBe('pending');
});

test('dev, unbundled and third-party products are never checked', async () => {
  const third = options(false);
  await expect(readIndexBytes(newer, third.options)).rejects.toBeInstanceOf(SyntaxError);
  expect(third.stale).not.toHaveBeenCalled();
  const { built: _built, ...unbundled } = options(true).options;
  expect(await readIndexBytes(known, unbundled)).toEqual({ format: 'known' });
});

test('stale recovery reloads once and a second miss after that reload does not loop', async () => {
  const reloads: number[] = [], recover = vi.fn(() => { reloads.push(Date.now()); return Promise.resolve(); });
  const first = staleClientRecovery(() => reloads.length, recover);
  expect(await Promise.all([first(), first()])).toEqual([true, true]);
  expect(recover).toHaveBeenCalledOnce();
  // The reloaded page, still on a build older than its product, sees the counted reload and stops.
  const second = staleClientRecovery(() => reloads.length, recover);
  expect(await second()).toBe(false);
  expect(recover).toHaveBeenCalledOnce();
});
