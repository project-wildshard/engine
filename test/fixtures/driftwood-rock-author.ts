import { hashImmutableBytes } from '../../src/shared/host/immutable';
import { BufferAttribute, type BufferGeometry } from 'three';
import { driftwoodIslandFactsFrom } from '../../src/shards/driftwood-isle/generators/islandFacts';
import { driftwoodIslandPlan } from '../../src/shards/driftwood-isle/generators/productPageFiles';
import { shoreBoulderFacts } from '../../src/shards/driftwood-isle/generators/shoreBoulders';
import { bakeRockScenes } from '../../src/shards/driftwood-isle/generators/rockScenes';

/** Observe every native rock channel and contact before any transport codec runs. */
export async function originalRockObservation(read: (url: string) => Uint8Array) {
  const base = '/assets/models/driftwood-blender/';
  const facts = await driftwoodIslandFactsFrom(read);
  const plan = driftwoodIslandPlan(read(`${base}placements.bin`), read(`${base}island.json`), 'phone', facts);
  const bake = bakeRockScenes(shoreBoulderFacts().placements, plan.smallRocks);
  const channel = (row: BufferAttribute) => ({ width: row.itemSize, normalized: row.normalized,
    count: row.count, storage: row.array.constructor.name,
    hash: hashImmutableBytes(new Uint8Array(row.array.buffer, row.array.byteOffset, row.array.byteLength)) });
  const geometry = (row: BufferGeometry) => ({ attributes: Object.entries(row.attributes).map(([name, data]) => {
    if (!(data instanceof BufferAttribute)) throw new Error('Unexpected interleaved rock output');
    const attr = { name }; return Object.assign(attr, channel(data));
  }), index: row.index === null ? null : channel(row.index), box: row.boundingBox === null ? null : [...row.boundingBox.min, ...row.boundingBox.max],
  sphere: row.boundingSphere === null ? null : [...row.boundingSphere.center, row.boundingSphere.radius], groups: row.groups });
  try {
    const json = JSON.stringify({ world: bake.world, catalogue: bake.catalogue, colliders: bake.shoreColliders },
      (_key: string, value: unknown) => value instanceof Float32Array ? [...value] : value);
    return { shore: bake.world.shore.length, small: bake.world.small.length, contacts: bake.shoreColliders.length,
      geometry: [...bake.geometry].map(([name, row]) => ({ name, ...geometry(row) })),
      metadataBytes: new TextEncoder().encode(json).byteLength, metadataHash: hashImmutableBytes(new TextEncoder().encode(json)) };
  } finally { for (const row of bake.geometry.values()) row.dispose(); }
}
