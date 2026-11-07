import { expect, test } from 'vitest';
import * as THREE from 'three';
import { DomePuffs } from './groundFx';

test('a dome puff pool swells, fades and parks its spheres, refusing an unbounded pool', () => {
  const root = new THREE.Group(), puffs = new DomePuffs(root, 0xffffff, 2, [8, 6], 5);
  expect(root.children).toHaveLength(2); expect(root.children.every(mesh => !mesh.visible && mesh.renderOrder === 5)).toBe(true);
  puffs.burst(new THREE.Vector3(1, 2, 3), 0.5, 2, 1, 0.8); puffs.update(0.5, 0.5);
  const [first] = root.children; expect(first?.visible).toBe(true); expect(first?.position.toArray()).toEqual([1, 2, 3]);
  expect(first?.scale.x).toBeCloseTo(0.5 + 1.5 * 0.75); puffs.update(0.6, 1.1); expect(first?.visible).toBe(false);
  expect(() => new DomePuffs(root, 0xffffff, 17)).toThrow('outside'); puffs.dispose(); expect(root.children).toHaveLength(0);
});
