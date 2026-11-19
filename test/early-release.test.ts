// @vitest-environment happy-dom
import { afterEach, expect, test, vi } from 'vitest';
// oxlint-disable-next-line import/no-nodejs-modules -- A real signed release exercises verification and retry.
import { generateKeyPairSync, sign } from 'node:crypto';
import { Scope } from '../src/shared/engine/app/scope';
import { beginRelease, takeRelease } from '../src/client/host/online/earlyRelease';
import { releaseScreens } from '../src/client/host/online/releaseScreens';
import { releaseToDial, type ReleaseToDial } from '../src/client/host/online/release';

// TEMPLATE-E2E TR-4b (T1 K): a world build's release file is read from the boot's data step, so a 503 shows "Can't find the
// world" within seconds of the tap. Read only at the server step, the page said so only after its whole load (19.6 s of
// local SwiftShader, about 49 s hosted), and a load stalled before that step never said so at all.
afterEach(() => { vi.restoreAllMocks(); document.body.replaceChildren(); });
const shown = (): HTMLElement | null => document.querySelector<HTMLElement>('[data-failmode]');
const URL_AT = 'https://world.example/__release.json';

function signedRelease(): { key: string; text: string } {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const body = JSON.stringify({ channel: 'staging', serial: 7, engineBuild: 'tr4b', saveEpoch: 1,
    shards: [{ slug: 'brasscap-mesa', revision: 1 }], socket: 'wss://rooms.example/' });
  return { key: publicKey.export({ type: 'spki', format: 'der' }).toString('hex'),
    text: JSON.stringify({ body, signature: sign(null, Buffer.from(body), privateKey).toString('hex') }) };
}

test('an early 503 shows its page before the server step, and the server step takes the healed read over', async () => {
  const { key, text } = signedRelease(), scope = new Scope('early-release');
  let healthy = false, reads = 0;
  const read: typeof fetch = () => { reads++; return Promise.resolve(healthy ? new Response(text) : new Response('busy', { status: 503 })); };
  const dial = (): Promise<ReleaseToDial> => releaseToDial(URL_AT, key, { keep: { read: () => null, write: () => undefined }, fetch: read,
    wait: releaseScreens(scope, { title: () => undefined, doctor: () => undefined }) });
  try {
    beginRelease(URL_AT, dial);
    // the boot is still loading: nothing has asked to dial yet, and the page already says why it can't
    await vi.waitFor(() => { expect(shown()?.dataset['failmode']).toBe('release-5xx'); });
    expect(reads).toBe(1);
    healthy = true;
    document.querySelector<HTMLButtonElement>('[data-failmode] button.go')?.click();
    // the server step reads nothing again: it dials what the early read heard
    const later = vi.fn(dial);
    await expect(takeRelease(URL_AT, later)).resolves.toMatchObject({ file: { engineBuild: 'tr4b', serial: 7 }, fresh: null });
    expect(later).not.toHaveBeenCalled();
    expect(reads).toBe(2);
    expect(shown()).toBeNull();
    // a later dial on this page (a redial, a gate's adoption) reads afresh
    await expect(takeRelease(URL_AT, later)).resolves.toMatchObject({ file: { serial: 7 } });
    expect(later).toHaveBeenCalledTimes(1);
  } finally { scope.dispose(); }
});

test('one early read per release address, and a read the player left still rejects at the server step', async () => {
  const left = new Error('The player left the release wait for the title');
  const first = vi.fn((): Promise<ReleaseToDial> => Promise.reject(left));
  const second = vi.fn((): Promise<ReleaseToDial> => Promise.reject(new Error('a second read')));
  beginRelease(URL_AT, first);
  beginRelease(URL_AT, second);
  expect(first).toHaveBeenCalledTimes(1);
  expect(second).not.toHaveBeenCalled();
  await expect(takeRelease(URL_AT, second)).rejects.toBe(left);
  expect(second).not.toHaveBeenCalled();
});
