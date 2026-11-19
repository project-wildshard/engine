// @vitest-environment happy-dom
import { afterEach, expect, test } from 'vitest';
import { Scope } from '../../../shared/engine/app/scope';
import { jsonSlot } from '../saves/slots';
import { IDLE_HUD_ATTRIBUTE, IDLE_HUD_SLOT, idleHudRelease, installIdleHudRelease } from './idleHudRelease';

afterEach(() => { jsonSlot(IDLE_HUD_SLOT, 'device').write(null); document.documentElement.removeAttribute(IDLE_HUD_ATTRIBUTE); });

test('the idle HUD release is off by default and off the phone', () => {
  expect(idleHudRelease(true)).toBe(false);
  jsonSlot(IDLE_HUD_SLOT, 'device').write(true);
  expect(idleHudRelease(false)).toBe(false);
  expect(idleHudRelease(true)).toBe(true);
});

test('the switch marks the document for its scope only', () => {
  const off = new Scope('idle-hud-off');
  installIdleHudRelease(off, true);
  expect(document.documentElement.hasAttribute(IDLE_HUD_ATTRIBUTE)).toBe(false);
  off.dispose();
  jsonSlot(IDLE_HUD_SLOT, 'device').write(true);
  const on = new Scope('idle-hud-on');
  installIdleHudRelease(on, true);
  expect(document.documentElement.hasAttribute(IDLE_HUD_ATTRIBUTE)).toBe(true);
  on.dispose();
  expect(document.documentElement.hasAttribute(IDLE_HUD_ATTRIBUTE)).toBe(false);
});
