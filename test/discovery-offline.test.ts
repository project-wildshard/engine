// @vitest-environment happy-dom
// STAGING-BUGBASH SB28 (meta docs/plans/STAGING-BUGBASH-PLAN.md): offline for 5 s while a cold Enter World read the world's
// discovery document ended on SOMETHING BROKE at `app:selected-discovery` ("TypeError: Failed to fetch"), and stayed there once
// the network was back. The read now waits on the loading card's RETRY like every other content read (QA 11-12 row 36), and
// goes again by itself when the device is back online.
import { afterEach, expect, test } from 'vitest';
import { readDiscovery } from '../src/client/game/shard/discovery';

afterEach(() => { document.body.replaceChildren(); });

test('SB28: a discovery read that fails offline waits, then reads again when the network is back', async () => {
  let calls = 0;
  const read: typeof fetch = () => {
    calls++;
    return calls <= 2 ? Promise.reject(new TypeError('Failed to fetch')) : Promise.resolve(new Response('{}'));
  };
  const reading = readDiscovery({ slug: 'driftwood-isle', discovery: 'https://packs.test/discovery/driftwood-isle.json' }, read);
  let settled: unknown = 'pending';
  reading.then(() => { settled = 'read'; }, (error: unknown) => { settled = error; });
  await new Promise(resolve => { setTimeout(resolve, 50); });
  expect(settled, 'offline: the read waits instead of failing the boot').toBe('pending');
  expect(calls).toBe(2);
  window.dispatchEvent(new Event('online'));
  await expect(reading).rejects.toThrow(/Invalid discovery document/u);
  expect(calls).toBe(3);
});
