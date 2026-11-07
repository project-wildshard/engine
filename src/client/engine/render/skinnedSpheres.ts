/**
 * An unculled skinned mesh's sphere without skinning it. three's render sort reads `object.boundingSphere` of every drawn
 * object, culled or not, and a SkinnedMesh computes it by skinning every vertex on the CPU, once, at its first draw: the
 * Nalati camp people (42k vertices) cost 84 ms of one phone-4x frame, the first-person arms 27 ms, Driftwood's rope deck
 * 10 ms. With `frustumCulled` off the sphere only places the sort and raycasting's early-out, so it is the bones' centroid
 * (in the mesh's space) with an unbounded radius: never a missed ray or a culled draw. The bind-pose sphere would not
 * do: the camp's bones place every person around the camp, far from where their vertices sit at bind. A culled
 * skinned mesh keeps three's own exact sphere.
 */
import { Matrix4, Sphere, SkinnedMesh, Vector3 } from 'three';

const point = new Vector3(), inverse = new Matrix4();
let installed = false;

export function installSkinnedSortSpheres(): void {
  if (installed) return;
  installed = true;
  const exact: unknown = Reflect.get(SkinnedMesh.prototype, 'computeBoundingSphere');
  if (typeof exact !== 'function') throw new Error('Three SkinnedMesh has no bounding-sphere method');
  SkinnedMesh.prototype.computeBoundingSphere = function computeBoundingSphere(this: SkinnedMesh): void {
    if (this.frustumCulled) { Reflect.apply(exact, this, []); return; }
    const sphere = this.boundingSphere ??= new Sphere();
    const bones = this.skeleton.bones;
    inverse.copy(this.matrixWorld).invert();
    sphere.center.set(0, 0, 0);
    for (const bone of bones) sphere.center.add(point.setFromMatrixPosition(bone.matrixWorld).applyMatrix4(inverse));
    if (bones.length > 0) sphere.center.divideScalar(bones.length);
    sphere.radius = Infinity;
  };
}
