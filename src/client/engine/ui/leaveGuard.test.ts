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

// first: the keyboard a page has seen is page-wide, so a later test's keys would already count
test('a phone\'s soft keyboard (typing into a field, composing, no code) never arms it', () => {
  const scope = new Scope('leave-guard-soft'); owners.push(scope);
  const field = document.createElement('input'); document.body.append(field);
  const guard = installLeaveGuard(scope, () => true);
  app.setState('play');
  field.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyA', bubbles: true }));
  key('', { isComposing: false }); key('KeyA', { isComposing: true });
  expect(guard.armed()).toBe(false);
  field.remove();
});

test('KP4 (Jake 2026-11-09, "show leave the game and confirm for command W"): only the world asks, and only after a keyboard', () => {
  vi.useFakeTimers({ now: 1_000_000, toFake: ['Date'] });
  const scope = new Scope('leave-guard'); owners.push(scope);
  const guard = installLeaveGuard(scope, () => true);
  app.setState('play');
  // a touch-only phone never pressed a key: no prompt, ever
  expect(guard.armed()).toBe(false); expect(leave().defaultPrevented).toBe(false);
  key('KeyW');
  expect(guard.armed()).toBe(true); expect(leave().defaultPrevented).toBe(true);
  for (const state of ['dead', 'practice', 'playground'] as const) { app.setState(state); expect(guard.armed(), state).toBe(true); }
  // the pointer out of the page (toward the toolbar's reload, the tab strip, the menu bar): a click there can't be told
  // from a close, so it doesn't ask; back in the page, it does
  app.setState('play');
  document.documentElement.dispatchEvent(new MouseEvent('mouseout', { bubbles: true, relatedTarget: null }));
  expect(guard.armed()).toBe(false); expect(leave().defaultPrevented).toBe(false);
  document.body.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
  expect(guard.armed()).toBe(true);
  // a menu or overlay over the world (bag, journal, feedback composer)
  const scopeUi = new Scope('leave-guard-ui'); owners.push(scopeUi);
  const root = document.createElement('div'); document.body.append(root);
  app.ui.push('modal', { root, back: () => undefined }, scopeUi);
  expect(app.ui.blocking).toBe(true); expect(guard.armed()).toBe(false);
  scopeUi.dispose(); root.remove();
  expect(guard.armed()).toBe(true);
  for (const state of ['title', 'loading', 'paused', 'error', 'explore', 'boot'] satisfies AppState[]) {
    app.setState(state); expect(guard.armed(), state).toBe(false); expect(leave().defaultPrevented, state).toBe(false);
  }
});

test('RL6 holds (Jake: "i sometimes see confirm reload"): a reload or navigation the player or the game asked for never prompts', () => {
  vi.useFakeTimers({ now: 2_000_000, toFake: ['Date'] });
  const scope = new Scope('leave-guard-reload'); owners.push(scope);
  const guard = installLeaveGuard(scope, () => true);
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
