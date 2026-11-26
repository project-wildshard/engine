// @vitest-environment happy-dom
import { afterEach, expect, test, vi } from 'vitest';
import { titleViewVisible } from '../src/scripts/parity/boot-smoke.mjs';

afterEach(() => { document.body.replaceChildren(); vi.restoreAllMocks(); });

test('capture waits through the two-owner title handoff in one DOM snapshot', () => {
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function(this: Element) {
    return new DOMRect(0, 0, 402, this.hasAttribute('hidden') ? 0 : 100);
  });
  expect(titleViewVisible()).toBe(false);
  const title = document.createElement('div'); title.className = 'ws-main-logo'; title.style.visibility = 'visible'; document.body.append(title);
  expect(titleViewVisible()).toBe(true);
  const preparing = document.createElement('div'); preparing.className = title.className; document.body.append(preparing);
  expect(titleViewVisible()).toBe(false);
  preparing.remove(); title.style.visibility = 'hidden';
  expect(titleViewVisible()).toBe(false);
  title.style.visibility = 'visible';
  const loading = document.createElement('div'); loading.className = 'ws-load'; loading.style.visibility = 'visible'; document.body.append(loading);
  expect(titleViewVisible()).toBe(false);
  loading.hidden = true;
  expect(titleViewVisible()).toBe(true);
});
