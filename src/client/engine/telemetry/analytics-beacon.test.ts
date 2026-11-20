// @vitest-environment happy-dom
// QA 11-19 row 19: Cloudflare's Web Analytics beacon comes off the `load` path (the launch still waits for `load`): the
// page adds it itself once interactive, on wildshard.io pages only, and never beside an injected one.
import { afterEach, expect, test, vi } from 'vitest';
import { Scope } from '../../../shared/engine/app/scope';
import { armAnalyticsBeacon, BEACON_SRC, beaconWanted, loadAnalyticsBeacon } from './analyticsBeacon';

afterEach(() => { document.head.replaceChildren(); vi.useRealTimers(); });

test('armed, the beacon loads a second after the title or a world is first interactive, once', () => {
  vi.useFakeTimers();
  const scope = new Scope('entry'), loads: string[] = [];
  armAnalyticsBeacon(scope, document, 'staging.wildshard.io', (_doc, host) => { loads.push(host); return true; });
  document.dispatchEvent(new Event('ws:ready'));
  vi.advanceTimersByTime(999);
  expect(loads).toEqual([]);
  vi.advanceTimersByTime(1);
  document.dispatchEvent(new Event('ws:control-ready'));
  vi.advanceTimersByTime(5000);
  expect(loads).toEqual(['staging.wildshard.io']);
  scope.dispose();
});

test('a wildshard.io page gets one deferred beacon carrying the site token', () => {
  expect(loadAnalyticsBeacon(document, 'staging.wildshard.io')).toBe(true);
  const scripts = [...document.querySelectorAll<HTMLScriptElement>('script')];
  expect(scripts).toHaveLength(1);
  expect(scripts[0]?.src).toBe(BEACON_SRC);
  expect(scripts[0]?.defer).toBe(true);
  expect(JSON.parse(scripts[0]?.dataset['cfBeacon'] ?? '{}')).toMatchObject({ token: expect.stringMatching(/^[0-9a-f]{32}$/u), spa: true });
  expect(loadAnalyticsBeacon(document, 'staging.wildshard.io')).toBe(false);
});

test('the zone-injected beacon, another host or a harness page gets none', () => {
  const injected = document.createElement('script');
  injected.src = 'https://static.cloudflareinsights.com/beacon.min.js/v123'; document.head.append(injected);
  expect(beaconWanted(document, 'play.wildshard.io', false)).toBe(false);
  document.head.replaceChildren();
  expect(beaconWanted(document, '127.0.0.1', false)).toBe(false);
  expect(beaconWanted(document, 'wildshard.io.evil.test', false)).toBe(false);
  expect(beaconWanted(document, 'play.wildshard.io', true)).toBe(false);
  expect(beaconWanted(document, 'play.wildshard.io', false)).toBe(true);
});
