import type { BufferGeometry } from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

// Three returns null for incompatible attributes, including an empty merge input.
const merge = (parts: BufferGeometry[], groups: boolean): BufferGeometry | null => mergeGeometries(parts, groups);
/** Empty optional groups are legal; material slots remain fur=0, hard=1, eyes=2. Consumes the source parts. */
export function mergeAnimalGeometry(fur: readonly BufferGeometry[], hard: readonly BufferGeometry[], eyes: readonly BufferGeometry[]): BufferGeometry {
  const sources = [fur, hard, eyes], combined: BufferGeometry[] = [], materials: number[] = [];
  try {
    for (const [material, parts] of sources.entries()) {
      if (parts.length === 0) continue;
      const geometry = merge([...parts], false);
      if (geometry === null) throw new Error('Incompatible species geometry attributes');
      combined.push(geometry); materials.push(material);
    }
    if (combined.length === 0) throw new Error('A species needs at least one geometry part');
    const geometry = merge(combined, true);
    if (geometry === null) throw new Error('Incompatible species geometry groups');
    for (const [index, group] of geometry.groups.entries()) {
      const material = materials[index];
      if (material === undefined) throw new Error('Missing species geometry material');
      group.materialIndex = material;
    }
    return geometry;
  } finally {
    for (const parts of sources) for (const geometry of parts) geometry.dispose();
    for (const geometry of combined) geometry.dispose();
  }
}
