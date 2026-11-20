// @vitest-environment happy-dom
import { expect, test } from 'vitest';
import { BufferGeometry, Float32BufferAttribute, Group, Mesh, MeshBasicMaterial } from 'three';
import { Scope } from '@wildshard/engine/app/scope';
import { saveGraphicsMode } from '@wildshard/engine/core/graphicsMode';
import { jsonSlot } from '@wildshard/engine/saves/slots';
import { drawnSurface, SHADOW_LAYER } from '@wildshard/engine/core/shadowLayer';
import { bakedPropBatchEnabled, installBakedPropBatch } from './bakedTiles';
import { propMerge } from './groundMerge';

test('an opted-in Cove shares one view draw only at Low and keeps the original pick and shadow surfaces', async () => {
  const slot = jsonSlot('debug.bakedPropBatch', 'device');
  const resident = new Scope('cove');
  const group = new Group(), material = new MeshBasicMaterial();
  const sources = [10, 20].map(x => {
    const geometry = new BufferGeometry().setAttribute('position', new Float32BufferAttribute([x, 0, 0, x + 1, 0, 0, x, 0, 1], 3));
    const mesh = new Mesh(geometry, material);
    mesh.castShadow = true;
    group.add(mesh);
    return mesh;
  });
  try {
    expect(bakedPropBatchEnabled('cove')).toBe(false);
    slot.write('cove');
    expect(bakedPropBatchEnabled('cove')).toBe(true);
    expect(bakedPropBatchEnabled('another-row')).toBe(false);
    saveGraphicsMode('high');
    installBakedPropBatch(group, sources, resident);
    expect(group.children).toEqual(sources);

    saveGraphicsMode('low');
    await Promise.resolve();
    const merged = propMerge(group, material, { receive: false, order: 0 }).mesh;
    if (merged === null) throw new Error('missing shared view draw');
    expect(group.children).toContain(merged);
    expect(merged.geometry.getIndex()?.count).toBe(6);
    expect(merged.material).toBe(material);
    expect(merged.castShadow).toBe(false);
    for (const original of sources) {
      expect(original.layers.isEnabled(SHADOW_LAYER)).toBe(true);
      expect(original.castShadow).toBe(true);
      expect(drawnSurface(original, merged.layers)).toBe(true);
    }

    saveGraphicsMode('high');
    await Promise.resolve();
    expect(group.children).toEqual(sources);
    expect(sources.map(mesh => mesh.layers.mask)).toEqual([1, 1]);
  } finally {
    resident.dispose();
    slot.write(null);
    saveGraphicsMode('high');
  }
});
