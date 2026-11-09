// @vitest-environment happy-dom
import { afterEach, expect, test, vi } from 'vitest';
import { Scope } from '../../../shared/engine/app/scope';
import { app } from '../app/runtime';
import type { AppState } from '../app/systems';
import { LEAVE_INTENT_MS, markReload, markUnload } from '../boot/lastEnd';
import { installLeaveGuard } from './leaveGuard';

const owners: Scope[] = [];
afterEach(() => { for (const owner of owners.splice(0)) owner.dispose(); vi.useRealTimers(); app.setState('boot'); });

function leave(): Event {
  const event = new Event('beforeunload', { cancelable: true });
  window.dispatchEvent(event);
  return event;
}
function key(code: string, init: KeyboardEventInit = {}): void { window.dispatchEvent(new KeyboardEvent('keydown', { code, ...init })); }

test('KP4 (Jake 2026-11-09, "show leave the game and confirm for command W"): only the world asks, and only after a keyboard', () => {
  vi.useFakeTimers({ now: 1_000_000, toFake: ['Date'] });
  const scope = new Scope('leave-guard'); owners.push(scope);
  const guard = installLeaveGuard(scope);
  app.setState('play');
  // a touch-only phone never pressed a key: no prompt, ever
  expect(guard.armed()).toBe(false); expect(leave().defaultPrevented).toBe(false);
  key('KeyW');
  expect(guard.armed()).toBe(true); expect(leave().defaultPrevented).toBe(true);
  for (const state of ['dead', 'practice', 'playground'] as const) { app.setState(state); expect(guard.armed(), state).toBe(true); }
  for (const state of ['title', 'loading', 'paused', 'error', 'explore', 'boot'] satisfies AppState[]) {
    app.setState(state); expect(guard.armed(), state).toBe(false); expect(leave().defaultPrevented, state).toBe(false);
  }
});

test('RL6 holds (Jake: "i sometimes see confirm reload"): a reload or navigation the player or the game asked for never prompts', () => {
  vi.useFakeTimers({ now: 2_000_000, toFake: ['Date'] });
  const scope = new Scope('leave-guard-reload'); owners.push(scope);
  const guard = installLeaveGuard(scope);
  app.setState('play'); key('KeyW');
  expect(guard.armed()).toBe(true);
  // the reload pill, error reloads, graphics recovery and a stale build all markReload before they navigate
  markReload('update tapped');
  expect(leave().defaultPrevented).toBe(false);
  vi.setSystemTime(Date.now() + LEAVE_INTENT_MS + 1); expect(guard.armed()).toBe(true);
  // shard travel and exit-to-title markUnload
  markUnload('shard switch to pine-hollow (fresh page)');
  expect(leave().defaultPrevented).toBe(false);
  vi.setSystemTime(Date.now() + LEAVE_INTENT_MS + 1); expect(guard.armed()).toBe(true);
  // the browser's own reload keys
  for (const init of [{ code: 'KeyR', metaKey: true }, { code: 'KeyR', ctrlKey: true }, { code: 'KeyR', ctrlKey: true, shiftKey: true }, { code: 'F5' }]) {
    key(init.code, init);
    expect(leave().defaultPrevented, JSON.stringify(init)).toBe(false);
    vi.setSystemTime(Date.now() + LEAVE_INTENT_MS + 1); expect(guard.armed()).toBe(true);
  }
  // ⌘W is not a reload: it still asks
  key('KeyW', { metaKey: true });
  expect(leave().defaultPrevented).toBe(true);
});
