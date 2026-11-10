import { expect, test, vi } from 'vitest';
import { BufferGeometry, Float32BufferAttribute, MeshBasicMaterial, Texture } from 'three';
import { initializeTier, TIER } from '../src/client/engine/core/tier';
import { PosedDraw } from '../src/client/game/looks/posedInstances';
import type { PosedAssetSet } from '../src/client/game/plugin/geometry';
import { lendLooks } from '../src/client/game/shardfile/lentLooks';
import rows from './fixtures/posed-draw-rows.json' with { type: 'json' };

// CI21 (J232): engine reads no shard source (J65). This is Pine's shipped `look/wildlife-draw.json` row, copied byte for
// byte from the pinned pine-hollow product (revision 2, blob 5dba1513…569c), so the posed-tier law runs on a real row.

for (const tier of ['phone', 'desktop'] as const) test(`cold ${tier} wildlife preparation awaits only its selected bird sources`, async () => {
  const previous = TIER, disposals: (() => void)[] = [];
  initializeTier(tier);
  const geometry = new BufferGeometry().setAttribute('position', new Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0], 3));
  const atlas = new Texture(), material = new MeshBasicMaterial();
  let finish: () => void = () => undefined;
  const wait = new Promise<void>(resolve => { finish = resolve; });
  const load = vi.fn<(input: unknown) => Promise<PosedAssetSet>>(async () => {
    await wait; return { geometry, atlas, ranges: rows.assets.ranges };
  });
  const url = (name: string): string => `/cold-wildlife-${tier}/${name}`;
  lendLooks({ onDispose: run => { disposals.push(run); } }, { materials: new Map([[rows.name, material]]), setParam: () => undefined, setTexture: () => undefined, bindMeshMap: () => material });
  const product = { url, file: () => Promise.resolve(new TextEncoder().encode(JSON.stringify(rows))) };
  try {
    const library = await PosedDraw.library(product, 'draw.json', load);
    expect(load).not.toHaveBeenCalled();
    expect(library.models.map(model => model.id)).toEqual(rows.models.map(model => model.id));
    const prepared = library.preload(); let ready = false;
    void prepared.then(() => { ready = true; return undefined; });
    expect(load).toHaveBeenCalledOnce();
    expect(load).toHaveBeenCalledWith({ ...rows.assets, geometry: url(rows.tiers[tier].geometry), atlas: url(rows.tiers[tier].atlas) });
    expect(ready).toBe(false);
    expect(() => library.draw(1)).toThrow('not loaded');
    finish(); await prepared;
    const view = library.draw(1);
    expect(ready).toBe(true); expect(view.mesh.geometry.getAttribute('position')).toBe(geometry.getAttribute('position'));
    view.mesh.geometry.dispose();
  } finally { finish(); for (const run of disposals) run(); geometry.dispose(); atlas.dispose(); material.dispose(); initializeTier(previous); }
});
