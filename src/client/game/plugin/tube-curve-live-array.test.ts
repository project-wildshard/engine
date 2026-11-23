import { expect, test } from 'vitest';
import { BufferAttribute, BufferGeometry, DynamicDrawUsage, Mesh, MeshBasicMaterial } from 'three';
import { createClientChannelView } from './clientChannelView';

// QA 11-23 row 13: Signal Dunes' thrown lash drew as a zero-size tube. The Memory saver released the static position array
// once drawn and read it back into a new array; the tube writer kept writing the array it captured at bind time.
const program = {
  id: 'lash.cord', reads: ['reach'],
  nodes: [{ op: 'constant', value: 0 }, { op: 'read', index: 0 }, { op: 'neg', a: 1 }, { op: 'constant', value: 1 }, { op: 'constant', value: 0.1 }],
  channels: [],
  geometry: { kind: 'tubeCurve', target: 'cord', segments: 2, radial: 3, from: [0, 0, 0], to: [0, 0, 2], extent: 3, wave: 4,
    bend: [Math.PI, 0.7], ripple: [9, 40, 0.25], drop: [3.1, 0.05], radius: [0.0045, 2.5, 0.0022, 0.93, 0.002] },
};

test('a tube is dynamic and writes the live position array, even after it is replaced', () => {
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(9 * 3), 3));
  geometry.setAttribute('normal', new BufferAttribute(new Float32Array(9 * 3), 3));
  const mesh = new Mesh(geometry, new MeshBasicMaterial());
  const view = createClientChannelView(program, new Map([['cord', mesh]]));
  const position = geometry.getAttribute('position'), normal = geometry.getAttribute('normal');
  if (!(position instanceof BufferAttribute) || !(normal instanceof BufferAttribute)) throw new Error('plain attributes');
  expect(position.usage).toBe(DynamicDrawUsage);
  expect(normal.usage).toBe(DynamicDrawUsage);
  // what the Memory saver's restore does to a released attribute: a new array of the same length
  const restored = new Float32Array(9 * 3);
  position.array = restored;
  view.evaluate({ time: 0, delta: 1 / 60, values: [7] });
  // the far ring reaches out to z = -7 (the tube runs from the origin toward -reach)
  expect(Math.min(...restored)).toBeLessThan(-6.9);
  expect(geometry.boundingSphere?.radius ?? 0).toBeGreaterThan(3);
});
