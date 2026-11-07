/**
 * The tile grid codec for classic graph programs (RM8.1e, as the retired TSL compiler read it): on a grid-quantized tile
 * primitive (unnormalized Int16 positions that its own node's uniform scale and translation dequantize) a graph's
 * `positionLocal` / `positionGeometry` read the authored metres (origin + step × the grid value) and its model-space
 * offsets are divided back into grid units; any other mesh has step 1 and origin 0. `ClassicCodec` feeds a material's
 * own `wsCodecStep` / `wsCodecOrigin` for the object it draws, re-uploading its uniforms only when they change.
 */
import * as THREE from 'three';
import { arrayReleased } from '../releasedArrays';

/** whether a drawn mesh is a grid-quantized tile primitive; read once per geometry while its arrays are resident */
const grids = new WeakMap<object, boolean>();
export function codecGridded(object: THREE.Object3D): object is THREE.Mesh {
  if (!(object instanceof THREE.Mesh)) return false;
  const geometry: unknown = object.geometry;
  if (!(geometry instanceof THREE.BufferGeometry)) return false;
  const known = grids.get(geometry);
  if (known !== undefined) return known;
  // the grid's 4-byte-strided Int16 positions decode as an interleaved attribute; a plain one is read the same way
  const position: unknown = geometry.getAttribute('position');
  const plain = position instanceof THREE.BufferAttribute, interleaved = position instanceof THREE.InterleavedBufferAttribute;
  if (!plain && !interleaved) return false;
  if (arrayReleased(position) || (interleaved && arrayReleased(position.data))) return false;
  const array: unknown = plain ? position.array : interleaved ? position.data.array : null, normalized = plain || interleaved ? position.normalized : true;
  const s = object.scale, q = object.quaternion;
  const grid = array instanceof Int16Array && !normalized && s.x > 0 && Math.abs(s.y - s.x) < 1e-9 && Math.abs(s.z - s.x) < 1e-9
    && Math.abs(q.x) + Math.abs(q.y) + Math.abs(q.z) < 1e-9;
  grids.set(geometry, grid);
  return grid;
}

/** One material's codec inputs: set for each drawn object, its uniforms re-uploaded only when the values change. */
export class ClassicCodec {
  private step = 1;
  private readonly origin = new THREE.Vector3();
  /** the values `object` decodes with, written into `material`'s own uniforms; true when they changed */
  draw(material: THREE.ShaderMaterial, object: THREE.Object3D): boolean {
    const grid = codecGridded(object), step = grid ? object.scale.x : 1;
    const x = grid ? object.position.x : 0, y = grid ? object.position.y : 0, z = grid ? object.position.z : 0;
    if (step === this.step && x === this.origin.x && y === this.origin.y && z === this.origin.z) return false;
    this.step = step; this.origin.set(x, y, z);
    const stepUniform = material.uniforms['wsCodecStep'], originUniform = material.uniforms['wsCodecOrigin'];
    if (stepUniform !== undefined) stepUniform.value = step;
    if (originUniform !== undefined && originUniform.value instanceof THREE.Vector3) originUniform.value.copy(this.origin);
    material.uniformsNeedUpdate = true;
    return true;
  }
}
