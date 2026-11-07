import { expect, test } from 'vitest';
import { BoxGeometry, Group, Mesh, MeshBasicMaterial } from 'three';
import { Scope } from '../../../shared/engine/app/scope';
import { coarseTileMask } from './coarseTileMask';

// NF2 / NF18: a classic material keeps one masked variant per coarse tile (its tile in its own defines); the variant
// goes with its tile's scope and the drawable wears its source again
test('classic materials keep one masked variant per tile', () => {
  const base = new MeshBasicMaterial(), geometry = new BoxGeometry(), first = new Scope('classic-a'), second = new Scope('classic-b');
  const rootA = new Group(), rootB = new Group(), a = new Mesh(geometry, base), b = new Mesh(geometry, base);
  rootA.add(a); rootB.add(b);
  coarseTileMask(rootA, 0, 0, first); coarseTileMask(rootB, 1, 0, second);
  expect(a.material).not.toBe(b.material); expect(a.material).not.toBe(base); expect(b.material).not.toBe(base);
  first.dispose(); expect(a.material).toBe(base); expect(b.material).not.toBe(base);
  second.dispose(); expect(b.material).toBe(base);
  geometry.dispose(); base.dispose();
});
