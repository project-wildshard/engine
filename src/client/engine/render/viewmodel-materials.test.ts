import { expect, test } from 'vitest';
import { BufferGeometry, Mesh, MeshBasicMaterial, type Material } from 'three';
import { ViewmodelRoot } from './viewmodel';

test('opaque viewmodel copies preserve shader receivers, keys, colors and warmed identities', () => {
  const root = new ViewmodelRoot(), geometry = new BufferGeometry();
  const opaque = new MeshBasicMaterial({ color: 0x456789 }), transparent = new MeshBasicMaterial({ transparent: true });
  let compiled: readonly unknown[] | undefined;
  opaque.onBeforeCompile = function onBeforeCompile(this: Material, shader, renderer): void { compiled = [this, shader, renderer]; };
  opaque.customProgramCacheKey = function customProgramCacheKey(this: Material): string { return this.uuid; };
  const source = [opaque, transparent], model = new Mesh(geometry, source);
  root.add(model);
  const mapped = model.material, copy = mapped[0]; if (copy === undefined) throw new Error('Missing opaque material copy');
  try {
    expect(mapped).not.toBe(source); expect(copy).not.toBe(opaque); expect(mapped[1]).toBe(transparent);
    expect(copy.transparent).toBe(true); expect(opaque.transparent).toBe(false);
    expect(copy.color.getHex()).toBe(opaque.color.getHex());
    // The hook must forward opaque arguments unchanged and bind the actual copy.
    const shader = {}, renderer = {};
    const compile: unknown = Reflect.get(copy, 'onBeforeCompile');
    if (typeof compile !== 'function') throw new Error('Missing native shader hook');
    Reflect.apply(compile, copy, [shader, renderer]);
    expect(compiled).toEqual([copy, shader, renderer]);
    expect(copy.customProgramCacheKey()).toBe(opaque.uuid);
    for (let frame = 0; frame < 8; frame++) { root.syncClearer(); expect(model.material).toBe(mapped); expect(model.material[0]).toBe(copy); }
    const single = new Mesh(geometry, opaque); root.add(single); expect(single.material).toBe(copy);
    const ready = [transparent], readyModel = new Mesh(geometry, ready); root.add(readyModel);
    for (let frame = 0; frame < 8; frame++) { root.syncClearer(); expect(readyModel.material).toBe(ready); }
  } finally { copy.dispose(); opaque.dispose(); transparent.dispose(); geometry.dispose(); }
});
