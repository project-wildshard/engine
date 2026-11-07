import { BufferAttribute, type BufferGeometry, Float16BufferAttribute } from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { vi } from 'vitest';
import * as glb from '../../src/sharddev/bake/glb';
import * as sweptKit from '../../src/shards/nine-dragon-stack/generators/kit/sweptKit';
import * as kitx from '../../src/shards/nine-dragon-stack/generators/kitx';
import * as compression from '../../src/sharddev/bake/glbCompression';
import * as compact from '../../src/sharddev/bake/compactGlb';
import { hashImmutableBytes } from '../../src/shared/host/immutable';

/** NR2's former merge: three's merger rebuilt a kit's half aFace / aPat as plain Uint16 words (written as integers). */
function formerMerge(parts: readonly BufferGeometry[]): BufferGeometry {
  const g = mergeGeometries([...parts], false); g.computeBoundingSphere(); return g;
}
/** The corrected merge on a former part: a kit's plain Uint16 aFace / aPat words are its half floats again. */
function correctedHalves(geometry: BufferGeometry): BufferGeometry {
  if (!geometry.hasAttribute('aOff')) return geometry;
  const halves = ['aFace', 'aPat'].filter(name => { const a = geometry.getAttribute(name); return a instanceof BufferAttribute && !(a instanceof Float16BufferAttribute) && a.array instanceof Uint16Array && !a.normalized; });
  if (halves.length === 0) return geometry;
  const copy = geometry.clone();
  for (const name of halves) { const a = copy.getAttribute(name); if (a instanceof BufferAttribute && a.array instanceof Uint16Array) copy.setAttribute(name, new Float16BufferAttribute(a.array, a.itemSize, a.normalized)); }
  return copy;
}

/** Reproduce only the former numeric half-read and kit merge defects, preserving frozen before pins. */
export async function halfFloatBeforeControl<T>(read: () => Promise<T>, observe?: (before: Uint8Array, current: Uint8Array) => void): Promise<T> {
  const write = glb.staticGlb, compress = compression.compressGlb, pack = compact.compactPhoneGlb;
  const corrected = new Map<string, Uint8Array>();
  const record = (legacy: Uint8Array, current: Uint8Array): void => {
    corrected.set(hashImmutableBytes(legacy), current); observe?.(legacy, current);
  };
  const compressed = observe === undefined ? undefined : vi.spyOn(compression, 'compressGlb').mockImplementation(input => {
    const legacy = compress(input), current = corrected.get(hashImmutableBytes(input));
    if (current !== undefined) record(legacy, compress(current));
    return legacy;
  });
  const packed = observe === undefined ? undefined : vi.spyOn(compact, 'compactPhoneGlb').mockImplementation(async (input, options) => {
    const legacy = await pack(input, options), current = corrected.get(hashImmutableBytes(input));
    if (current !== undefined) record(legacy, await pack(current, options));
    return legacy;
  });
  const before = vi.spyOn(glb, 'staticGlb').mockImplementation((parts, name) => {
    const copies = parts.map(part => {
      const geometry = part.geometry.clone();
      for (const attribute of Object.values(geometry.attributes)) if (attribute instanceof Float16BufferAttribute) {
        // The former writer called inherited getComponent, which exposes storage
        // bits (and its normalized storage semantics), rather than axis values.
        attribute.getX = index => attribute.getComponent(index, 0);
        attribute.getY = index => attribute.getComponent(index, 1);
        attribute.getZ = index => attribute.getComponent(index, 2);
        attribute.getW = index => attribute.getComponent(index, 3);
      }
      return { ...part, geometry };
    });
    try {
      const legacy = write(copies, name);
      if (observe !== undefined) {
        const current = parts.map(part => ({ ...part, geometry: correctedHalves(part.geometry) }));
        try { record(legacy, write(current, name)); }
        finally { for (const [i, part] of current.entries()) if (part.geometry !== parts[i]?.geometry) part.geometry.dispose(); }
      }
      return legacy;
    }
    finally { for (const part of copies) part.geometry.dispose(); }
  });
  const merges = [vi.spyOn(sweptKit, 'mergeKits').mockImplementation(formerMerge), vi.spyOn(kitx, 'merge').mockImplementation(formerMerge)];
  try { return await read(); }
  finally { before.mockRestore(); packed?.mockRestore(); compressed?.mockRestore(); for (const merge of merges) merge.mockRestore(); }
}
