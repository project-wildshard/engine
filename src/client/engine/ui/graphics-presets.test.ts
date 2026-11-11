// @vitest-environment happy-dom
import { afterEach, expect, test } from 'vitest';
import { Scope } from '../../../shared/engine/app/scope';
import { withOwner } from '../../../shared/engine/app/ownership';
import { jsonSlot } from '../saves/slots';
import { saveGraphicsMode } from '../core/graphicsMode';
import { applyPreset, currentValues, noteShipped, presetLabel, presetValues, resetKnobs, saveDensity, saveFlag } from '../core/graphicsQuality';
import { graphicsRow } from './graphicsBlock';

// MG8, Jake 2026-11-10 ~23:05 and ~23:45 Cancún: Low · High · Custom over Pixel density, Sun shadows, Bloom, Sun rays and
// Anti-aliasing. One test per rule.
const DRIFTWOOD = { bloom: false, rays: false, aa: true } as const; // what yesterday's phone Driftwood ran
const scopes: Scope[] = [];
afterEach(() => { for (const scope of scopes.splice(0)) scope.dispose(); resetKnobs(); saveGraphicsMode('high'); document.body.replaceChildren(); });
const tap = (el: Element | null): void => { el?.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true })); el?.dispatchEvent(new PointerEvent('pointerup', { bubbles: true })); el?.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 })); };

test('rule 1: pressing High sets every control to High\'s values, yesterday\'s game (2×, AA on, shadows on, bloom off, rays off)', () => {
  noteShipped(DRIFTWOOD);
  saveDensity(1.25); saveFlag('shadows', false); saveFlag('bloom', true); saveFlag('rays', true); saveFlag('aa', false);
  expect(applyPreset('high')).toBe(true);
  expect(currentValues(DRIFTWOOD)).toEqual({ density: 2, shadows: true, bloom: false, rays: false, aa: true });
  expect(presetLabel(DRIFTWOOD)).toBe('high');
});

test('rule 2: pressing Low sets every control to Low\'s values: 1×, no sun shadows, the rest as shipped', () => {
  saveDensity(1.5); saveFlag('bloom', true); saveFlag('aa', false);
  expect(applyPreset('low')).toBe(true);
  expect(currentValues(DRIFTWOOD)).toEqual({ density: 1, shadows: false, bloom: false, rays: false, aa: true });
  expect(presetLabel(DRIFTWOOD)).toBe('low');
});

test('rule 3: touching any single control switches the label to Custom', () => {
  const touches: (() => void)[] = [() => { saveDensity(1.5); }, () => { saveFlag('shadows', false); },
    () => { saveFlag('bloom', true); }, () => { saveFlag('rays', true); }, () => { saveFlag('aa', false); }];
  for (const touch of touches) {
    applyPreset('high'); expect(presetLabel(DRIFTWOOD)).toBe('high');
    touch(); expect(presetLabel(DRIFTWOOD)).toBe('custom');
  }
});

test('rule 4: Custom is an indicator: lit when the values match neither preset, disabled, and a tap does nothing', () => {
  noteShipped(DRIFTWOOD);
  const scope = new Scope('presets'); scopes.push(scope);
  const chooser = withOwner(scope, () => graphicsRow('modeCards', scope));
  document.body.append(chooser.root);
  const card = (mode: string): HTMLButtonElement | null => chooser.root.querySelector<HTMLButtonElement>(`[data-mode="${mode}"]`);
  expect(card('high')?.classList.contains('active')).toBe(true);
  expect(card('custom')?.disabled).toBe(true);
  saveFlag('shadows', false); chooser.paint();
  expect(card('custom')?.classList.contains('active')).toBe(true);
  expect(card('high')?.classList.contains('active')).toBe(false);
  tap(card('custom')); chooser.paint();
  expect(presetLabel(DRIFTWOOD)).toBe('custom'); // nothing changed
  tap(card('low')); chooser.paint();
  expect(presetLabel(DRIFTWOOD)).toBe('low');
  expect(card('low')?.classList.contains('active')).toBe(true);
});

test('rule 5: hand-setting every control to a preset\'s values shows that preset again', () => {
  applyPreset('high');
  saveDensity(1); saveFlag('shadows', false);
  expect(presetLabel(DRIFTWOOD)).toBe('low'); // every value is Low's, set by hand
  saveDensity(2); saveFlag('shadows', true);
  expect(presetLabel(DRIFTWOOD)).toBe('high');
  expect(presetValues('high', DRIFTWOOD).density).toBe(2); // High never draws more than yesterday's 2×
});

test('rule 7: the controls\' values are what is saved; the label is read off them, never stored', () => {
  applyPreset('high'); saveFlag('shadows', false);
  expect(jsonSlot('gfx.knob.shadows', 'device').read()).toBe(false);
  expect(presetLabel(DRIFTWOOD)).toBe('custom');
  saveFlag('shadows', true);
  expect(presetLabel(DRIFTWOOD)).toBe('high'); // no stored label to go stale
});
