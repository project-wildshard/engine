import { BufferAttribute, type BufferGeometry } from 'three';
import { hashImmutableBytes } from '../../src/shared/host/immutable';
import { wingGeo, halfBirdGeo, buildMarmotGeometry } from '../../src/shards/nalati-grasslands/generators/ambientGeometry';

/** Observe all original ambient channels, storage, topology and authored bounds before any codec. */
export function nalatiAmbientObservation() {
  const channel = (data: BufferAttribute) => ({ size: data.itemSize, normalized: data.normalized,
    count: data.count, storage: data.array.constructor.name,
    hash: hashImmutableBytes(new Uint8Array(data.array.buffer, data.array.byteOffset, data.array.byteLength)) });
  const observe = (make: () => BufferGeometry) => {
    const geometry = make();
    try {
      return { attributes: Object.entries(geometry.attributes).map(([name, data]) => {
        if (!(data instanceof BufferAttribute)) throw new Error('Unexpected interleaved ambient channel');
        return { name, ...channel(data) };
      }), index: geometry.index === null ? null : channel(geometry.index), groups: geometry.groups,
      box: geometry.boundingBox === null ? null : [...geometry.boundingBox.min, ...geometry.boundingBox.max],
      sphere: geometry.boundingSphere === null ? null : [...geometry.boundingSphere.center, geometry.boundingSphere.radius] };
    } finally { geometry.dispose(); }
  };
  return { wing: observe(wingGeo), bird: observe(halfBirdGeo), marmot: observe(buildMarmotGeometry) };
}
