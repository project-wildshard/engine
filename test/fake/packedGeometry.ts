// oxlint-disable-next-line import/no-nodejs-modules -- Exercise the exact committed compressed pack through the runtime fetch port.
import { readFileSync } from 'node:fs';
import { vi, type MockInstance } from 'vitest';

/** Fetch fixture for the actual compressed payload, without replacing its decoder. */
export function mockPackedFetch(url: string, bytes?: Uint8Array): MockInstance<typeof fetch> {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(input => {
    if (input !== url) throw new Error('Unexpected geometry fetch');
    return Promise.resolve(new Response(Uint8Array.from(bytes ?? readFileSync(`public${url}`))));
  });
}
