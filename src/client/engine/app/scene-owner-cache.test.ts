import { expect, test } from 'vitest';
import { Group, Mesh } from 'three';
import { Scope } from '../../../shared/engine/app/scope';
import { ownSceneTree, sceneObjectOwner, linkStandIn } from './sceneOwnership';
import { AssetService } from './assets';

test('moving an ancestor refreshes cached descendant ownership, including a nested existing owner', () => {
  const first = new Scope('first'), second = new Scope('second'), assets = new AssetService();
  const a = new Group(), b = new Group(), branch = new Group(), leaf = new Mesh();
  branch.add(new Group().add(leaf)); a.add(branch, b);
  ownSceneTree(a, first, assets); ownSceneTree(b, second, assets);
  try {
    expect(sceneObjectOwner(leaf)).toBe(first); expect(sceneObjectOwner(leaf)).toBe(first);
    b.add(branch); expect(sceneObjectOwner(leaf)).toBe(second);
    a.add(branch); expect(sceneObjectOwner(leaf)).toBe(first);
    branch.removeFromParent(); expect(sceneObjectOwner(leaf)).toBeNull();
    b.add(branch); expect(sceneObjectOwner(leaf)).toBe(second);
  } finally { first.dispose(); second.dispose(); }
});

test('new nested declarations and retirement invalidate both owned and unowned results', () => {
  const outer = new Scope('outer'), inner = new Scope('inner'), assets = new AssetService();
  const root = new Group(), branch = new Group(), leaf = new Mesh(); root.add(branch); branch.add(leaf);
  expect(sceneObjectOwner(leaf)).toBeNull();
  ownSceneTree(root, outer, assets); expect(sceneObjectOwner(leaf)).toBe(outer);
  ownSceneTree(branch, inner, assets); expect(sceneObjectOwner(leaf)).toBe(inner);
  inner.dispose(); expect(sceneObjectOwner(leaf)).toBeNull();
  root.add(leaf); expect(sceneObjectOwner(leaf)).toBe(outer);
  outer.dispose(); expect(sceneObjectOwner(leaf)).toBeNull();
});

test('stand-in relinking and source reparenting retain the current source authority', () => {
  const first = new Scope('first'), second = new Scope('second'), assets = new AssetService();
  const a = new Group(), b = new Group(), source = new Mesh(), copy = new Mesh(); a.add(source);
  ownSceneTree(a, first, assets); ownSceneTree(b, second, assets);
  try {
    expect(sceneObjectOwner(copy)).toBeNull(); linkStandIn(copy, source);
    expect(sceneObjectOwner(copy)).toBe(first); b.add(source); expect(sceneObjectOwner(copy)).toBe(second);
    linkStandIn(copy, a); expect(sceneObjectOwner(copy)).toBe(first);
  } finally { first.dispose(); second.dispose(); }
});
