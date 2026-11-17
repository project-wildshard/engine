// @vitest-environment happy-dom
import { afterEach, expect, test } from 'vitest';
import { Scope } from '../src/shared/engine/app/scope';
import { trapFocus } from '../src/client/engine/ui/focusTrap';
import { newBuildPanel } from '../src/client/host/online/reconnectStrip';

// FM4 (meta MMO-FAILURE-MODES-PLAN, a focus trap in cards): every card that stops play keeps Tab and Shift+Tab inside its own controls.
afterEach(() => { document.body.replaceChildren(); });
const tab = (target: Element | null, shiftKey = false): KeyboardEvent => {
  const event = new KeyboardEvent('keydown', { code: 'Tab', shiftKey, bubbles: true, cancelable: true });
  target?.dispatchEvent(event);
  return event;
};

test('Tab wraps from the last control to the first and Shift+Tab back; disabled buttons are skipped; focus outside comes in', () => {
  const scope = new Scope('test.trap'), root = document.createElement('div'), outside = document.createElement('button');
  const first = document.createElement('button'), off = document.createElement('button'), last = document.createElement('button'), details = document.createElement('details'), summary = document.createElement('summary');
  off.disabled = true; details.append(summary); root.append(first, off, last, details);
  document.body.append(outside, root);
  trapFocus(scope, root);
  summary.focus();
  expect(tab(summary).defaultPrevented).toBe(true);
  expect(document.activeElement).toBe(first);
  expect(tab(first, true).defaultPrevented).toBe(true);
  expect(document.activeElement).toBe(summary);
  // between the ends, the browser's own Tab moves on
  last.focus();
  expect(tab(last).defaultPrevented).toBe(false);
  scope.dispose();
  summary.focus();
  expect(tab(summary).defaultPrevented).toBe(false);
});

test('the new-build page (version-skew) is modal: it takes focus and keeps Tab on its Reload', () => {
  const scope = new Scope('test.new-build');
  newBuildPanel(scope, () => Promise.resolve(false), () => undefined);
  const panel = document.getElementById('ws-new-build'), reload = panel?.querySelector('button') ?? null;
  expect(panel?.getAttribute('aria-modal')).toBe('true');
  expect(document.activeElement).toBe(reload);
  expect(tab(reload).defaultPrevented).toBe(true);
  expect(document.activeElement).toBe(reload);
  scope.dispose();
});
