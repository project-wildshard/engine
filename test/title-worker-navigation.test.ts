import { expect, test } from 'vitest';
// oxlint-disable-next-line import/no-nodejs-modules -- Run the actual navigation boundary with explicit document ports.
import { readFileSync } from 'node:fs';
// oxlint-disable-next-line import/no-nodejs-modules -- Erase only types from the defining private navigation functions.
import { stripTypeScriptTypes } from 'node:module';
// oxlint-disable-next-line import/no-nodejs-modules -- Navigation is observed without booting a renderer or a real document.
import { runInNewContext } from 'node:vm';

function fixture(active: boolean, tier: 'phone' | 'desktop' = 'phone') {
  const source = readFileSync('src/client/game/travel/travel.ts', 'utf8');
  const start = source.indexOf('function navigate('), end = source.indexOf('\nexport function travel(', start);
  if (start === -1 || end < start) throw new Error('Missing navigation boundary');
  let finish = (): void => { throw new Error('Missing readiness promise'); };
  let fail = (_error: Error): void => { throw new Error('Missing readiness promise'); };
  const ready = new Promise<void>((resolve, reject) => { finish = resolve; fail = reject; });
  const destinations: string[] = [], arrivals: unknown[] = [], unloads: unknown[] = [];
  const ports = { running: active ? {} : null, window: { __ws_sw: { ready } }, URL, arrivalTier: { current: tier },
    location: { href: 'https://example.test/?v=old', replace: (url: string) => { destinations.push(url); } },
    setTitleArrival: (arrival: unknown) => { arrivals.push(arrival); }, findTitleManifest: () => ({ name: 'Fixture' }),
    markUnload: (reason: unknown) => { unloads.push(reason); }, leaveSaved: (go: () => void) => { go(); },
  };
  const navigate: unknown = runInNewContext(stripTypeScriptTypes(`${source.slice(start, end)}\nnavigate`), ports);
  if (typeof navigate !== 'function') throw new Error('Navigation is not callable');
  const go = (): void => { Reflect.apply(navigate, undefined, [{ to: 'fixture', mode: 'enter' }]); };
  return { ports, ready, finish, fail, destinations, arrivals, unloads, go };
}

test('the fresh title waits for first activation before its next controlled document', async () => {
  const f = fixture(false); f.go();
  expect(f.destinations).toEqual([]); expect(f.arrivals).toEqual([]); expect(f.unloads).toEqual([]);
  f.finish(); await f.ready; await Promise.resolve();
  expect(f.destinations).toHaveLength(1);
  expect(new URL(f.destinations[0] ?? '').searchParams.get('chunk')).toBe('fixture');
  expect(f.arrivals).toHaveLength(1); expect(f.unloads).toHaveLength(1);
});

test.each(['phone', 'desktop'] as const)('a running %s world leaves immediately with its tier without waiting for the worker', tier => {
  const f = fixture(true, tier); f.go(); expect(f.destinations).toHaveLength(1);
  expect(f.arrivals).toEqual([{ slug: 'fixture', mode: 'enter', name: 'Fixture', tier }]);
});

test('an unavailable registration still permits navigation while a superseded title cannot leave a running world', async () => {
  const unavailable = fixture(false); unavailable.go(); unavailable.fail(new Error('Storage unavailable'));
  await unavailable.ready.catch(() => undefined); await Promise.resolve(); expect(unavailable.destinations).toHaveLength(1);
  const stale = fixture(false); stale.go(); stale.ports.running = {};
  stale.finish(); await stale.ready; await Promise.resolve(); expect(stale.destinations).toEqual([]);
});
