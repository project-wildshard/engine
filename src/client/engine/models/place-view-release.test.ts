// @vitest-environment happy-dom
import { expect, test } from 'vitest';
import { BoxGeometry, MeshStandardMaterial } from 'three';
import { defineModel, modelContext } from './model';
import { place } from './place';
import { WorldRegistry } from '../world/registry';
import { withOwner } from '../../../shared/engine/app/ownership';
import { Scope } from '../../../shared/engine/app/scope';

// O18: a view-lifetime specimen's release was held by the ambient owner (the page's scope after an await), so every
// visit's placement (its registry and context) lived as long as the page. Its registry's retirement now releases it.
test('a view specimen placed into a registry leaves its owner when the registry retires', () => {
  const page = new Scope('page-like'), registry = new WorldRegistry(), material = new MeshStandardMaterial();
  const model = defineModel({ id: 'shared/view-release-fixture', name: 'View release fixture', category: 'props', pipeline: 'code',
    file: 'src/client/engine/models/place-view-release.test.ts', defaults: {}, specimenLifetime: 'view', build: () => [{ geometry: new BoxGeometry(1, 1, 1), material }] });
  try {
    const before = page.census.disposers;
    withOwner(page, () => { place(model, [{ x: 0, y: 0, z: 0 }], { ctx: modelContext(null), draw: 'single', registry }); });
    expect(page.census.disposers).toBeGreaterThan(before);
    registry.retire();
    expect(page.census.disposers).toBe(before);
  } finally { page.dispose(); }
});
