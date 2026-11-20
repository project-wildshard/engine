// meta DRIFTWOOD-FPS DF13 (mini-df13): the update cuts' slots and the off-screen view test.
import { describe, expect, test } from 'vitest';
import { PerspectiveCamera, Vector3 } from 'three';
import { inLastView, updateLean, UPDATE_LEAN_PHONE_LOW, UPDATE_LEAN_SLOTS, type UpdateLean } from './updateLean';

describe('updateLean', () => {
  test('a saved boolean wins; unset, phone Low takes its default and everything else is off', () => {
    for (const lean of Object.keys(UPDATE_LEAN_SLOTS) as UpdateLean[]) {
      expect(updateLean(true, false, lean)).toBe(true);
      expect(updateLean(false, true, lean)).toBe(false);
      expect(updateLean(null, true, lean)).toBe(UPDATE_LEAN_PHONE_LOW[lean]);
      expect(updateLean(undefined, false, lean)).toBe(false);
    }
  });
  test('every cut is off until cooled phone pairs decide', () => {
    expect(Object.values(UPDATE_LEAN_PHONE_LOW).every((on) => !on)).toBe(true);
  });
});

describe('inLastView', () => {
  const camera = new PerspectiveCamera(50, 402 / 812, 0.1, 1000);
  camera.position.set(0, 2, 0); camera.lookAt(0, 2, -10); camera.updateMatrixWorld(true);
  const eye = camera.position;
  test('in front is in view, behind is not', () => {
    expect(inLastView(camera, new Vector3(0, 2, -20), 1, eye)).toBe(true);
    expect(inLastView(camera, new Vector3(0, 2, 20), 1, eye)).toBe(false);
  });
  test('the pad keeps a body just past the edge in view', () => {
    // the portrait view's half width at 20 m is about 4.6 m; 6 m to the side is outside a 1 m body, inside its pad
    expect(inLastView(camera, new Vector3(6.5, 2, -20), 0.5, eye)).toBe(true);
    expect(inLastView(camera, new Vector3(30, 2, -20), 0.5, eye)).toBe(false);
  });
});
