import { expect, test } from 'vitest';
import { BufferGeometry, Float32BufferAttribute } from 'three';
import { addSlabTriangles, compareSlabTriangles, newSlabTriangleProof } from './fixtures/slabJoinProof';

function pair(): BufferGeometry {
  return new BufferGeometry().setAttribute('position', new Float32BufferAttribute([-0, 0, 0, 1, 0, 0, 0, 1, 0, 2, 0, 0, 3, 0, 0, 2, 1, 0], 3)).setIndex([0, 1, 2, 3, 4, 5]);
}
test('literal-word multiset comparison ignores order but preserves multiplicity and signed zero', () => {
  const original = pair(), reordered = pair(), missing = pair(), changed = pair();
  try {
    reordered.setIndex([3, 4, 5, 0, 1, 2]); missing.setIndex([0, 1, 2, 0, 1, 2]); changed.getAttribute('position').setX(0, 0);
    const proof = (geometry: BufferGeometry) => { const result = newSlabTriangleProof(); addSlabTriangles(result, geometry); return result; };
    expect(() => compareSlabTriangles(proof(original), proof(reordered))).not.toThrow();
    expect(() => compareSlabTriangles(proof(original), proof(missing))).toThrow('words');
    expect(() => compareSlabTriangles(proof(original), proof(changed))).toThrow('words');
    changed.setIndex([0, 1, 99]); expect(() => proof(changed)).toThrow('outside source');
  } finally { original.dispose(); reordered.dispose(); missing.dispose(); changed.dispose(); }
});
