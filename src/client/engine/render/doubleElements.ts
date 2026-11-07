/**
 * Keeps every matrix's numbers unboxed. V8 stores a three matrix's elements as raw doubles only while its array has
 * double elements. A plain array built by a parser, `map` or JSON (generic elements) handed to three's `fromArray`
 * teaches that function's optimised code to widen each array it reads to generic elements, the matrices' own included
 * (`clone`, `setFromMatrixColumn`), and the widening spreads through every three method that touches them: from then on
 * each multiply and compose boxes its results (Nalati settled: every scene matrix generic, ~100 MiB of numbers in 20 s).
 * So a plain array is first copied by a builtin into a double scratch, and three's `fromArray` reads only typed arrays.
 * The values read are unchanged.
 */
import * as THREE from 'three';

interface ReadsArray<T> { fromArray: (this: ReadsArray<T>, array: ArrayLike<number>, offset?: number) => T }

function guard<T>(proto: ReadsArray<T>, size: number): void {
  const read = proto.fromArray, scratch = new Float64Array(size);
  proto.fromArray = function fromArray(this: ReadsArray<T>, array: ArrayLike<number>, offset = 0): T {
    // a typed array (an attribute, a page record) is read as before; so is a short array, whose missing slots three reads
    if (!Array.isArray(array) || array.length < offset + size) return read.call(this, array, offset);
    // a loop here would teach this function the same widening; the builtin copy and slice read any array kind as is
    scratch.set(offset === 0 && array.length === size ? array : array.slice(offset, offset + size));
    return read.call(this, scratch, 0);
  };
}

let installed = false;
/** Route plain arrays given to `Matrix4`, `Matrix3` and `Vector3` `fromArray` through a double scratch (once per page). */
export function installDoubleElements(): void {
  if (installed) return;
  installed = true;
  guard(THREE.Matrix4.prototype, 16);
  guard(THREE.Matrix3.prototype, 9);
  guard(THREE.Vector3.prototype, 3);
}
