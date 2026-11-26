// @vitest-environment happy-dom
// QA-FEEDBACK 11-24 row 36 (Jake, 15:05 Cancún: "server latency and ping as a dev chip somewhere at the top, so fps, memory and
// server latency"): the dock's ping chip shows the live rooms round trip, and "--" offline, in a preview or on a dropped link.
// The chips' fit on PAUSE's row before the minimap at 402 x 874 is measured in a real browser: src/scripts/hud-worst.mjs --check.
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { Scope } from '../../../shared/engine/app/scope';
import { ROOMS_PING_EVENT, roomsPingMs } from '../net/roomsPing';
import { PING_ORDER, installPingChip } from './pingChip';

let clock = 0;
beforeEach(() => { vi.useFakeTimers(); clock = 0; });
afterEach(() => { vi.useRealTimers(); document.body.replaceChildren(); });
const wait = (ms: number): void => { clock += ms; vi.advanceTimersByTime(ms); };
const say = (rttMs: number | null): void => { document.dispatchEvent(new CustomEvent(ROOMS_PING_EVENT, { detail: { rttMs } })); };

test('row 36: the chip shows the live round trip, "--" with no link, and goes back to "--" when the link falls quiet', () => {
  const scope = new Scope('ping-chip.test');
  try {
    const chip = installPingChip(scope, () => clock);
    expect(chip.closest('.ws-perf-dock')).not.toBeNull();
    expect(chip.style.order).toBe(String(PING_ORDER));
    expect(chip.textContent).toBe('--');
    say(48); expect(chip.textContent).toBe('48'); expect(chip.getAttribute('aria-label')).toBe('Server ping 48 ms');
    wait(1000); say(52); expect(chip.textContent).toBe('52');
    say(null); expect(chip.textContent).toBe('--');
    say(61); wait(3000); expect(chip.textContent).toBe('--'); // no word for 2.5 s: the link dropped or the page is offline
  } finally { scope.dispose(); }
});

test('row 36: the link reports whole ms, and nothing while it is not live or has no pong', () => {
  expect(roomsPingMs(47.6, true)).toBe(48);
  expect(roomsPingMs(47.6, false)).toBeNull();
  expect(roomsPingMs(0, true)).toBeNull();
  expect(roomsPingMs(Number.NaN, true)).toBeNull();
  expect(roomsPingMs(undefined, true)).toBeNull();
});
