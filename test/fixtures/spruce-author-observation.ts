import type { BufferGeometry } from 'three';
import { withPortableMath } from '../../src/commons/bake/portableMath';
import { hashImmutableBytes } from '../../src/shared/host/immutable';
import { spruceGeometry } from '../../src/shards/nalati-grasslands/generators/spruceGeometry';

function identity(geometry: BufferGeometry) {
  const index = geometry.getIndex();
  const channels = [...Object.entries(geometry.attributes), ...(index === null ? [] : [['index', index] as const])];
  return { channels: channels.map(([name, value]) => ({ name, storage: value.array.constructor.name, width: value.itemSize,
    normalized: value.normalized, bytes: value.array.byteLength, hash: hashImmutableBytes(new Uint8Array(value.array.buffer, value.array.byteOffset, value.array.byteLength)) })),
    groups: geometry.groups, box: geometry.boundingBox, sphere: geometry.boundingSphere === null ? null : {
      center: geometry.boundingSphere.center.toArray(), radius: geometry.boundingSphere.radius } };
}

/** All original tree channels on the portable before-control; shipped Math is unchanged. */
export function spruceAuthorObservation() {
  return withPortableMath(() => spruceGeometry().map(row => {
    const parts = ['trunk', 'cardsHi', 'cardsLo', 'twigs', 'far'] as const;
    try { return { height: row.height, trunkRadius: row.trunkRadius,
      parts: parts.map(name => ({ name, ...identity(row[name]) })) }; }
    finally { for (const part of parts) row[part].dispose(); }
  }));
}
