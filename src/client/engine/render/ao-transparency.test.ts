import * as THREE from 'three';
import { expect, test } from 'vitest';
import { prepassBits } from './aoTransparency';

const material = (transparent: boolean, depthWrite: boolean): THREE.Material => new THREE.MeshBasicMaterial({ transparent, depthWrite });

test('n8ao pre-pass bits: an opaque sits both out, a depth-free transparent draws in the first, a depth writer in the second', () => {
  expect(prepassBits(material(false, true), {}, false)).toBe(0);
  expect(prepassBits(material(true, false), {}, false)).toBe(1);
  expect(prepassBits(material(true, true), {}, false)).toBe(2);
  expect(prepassBits(material(true, true), { treatAsOpaque: true }, false)).toBe(0);
  expect(prepassBits(material(false, true), { cannotReceiveAO: true }, false)).toBe(1);
});

test('DF14: with opaque depth writers, water (transparent, writing depth) takes AO as an opaque does; nothing else moves', () => {
  expect(prepassBits(material(true, true), {}, false, true)).toBe(0);
  expect(prepassBits(material(true, false), {}, false, true)).toBe(1);
  expect(prepassBits(material(true, true), { cannotReceiveAO: true }, false, true)).toBe(1);
  expect(prepassBits(material(true, false), {}, true, true)).toBe(0); // cut 1 still takes the depth-free transparents
});
