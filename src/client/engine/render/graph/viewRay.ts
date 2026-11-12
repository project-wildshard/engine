/**
 * The `viewRay` post input's feed (meta TEMPLATE-E2E-PLAN LF2-3): the scene camera's world ray per pixel, as three vec3
 * uniforms the graph's lowering (`glsl.ts`) reads. Both post executors call it each frame: the shard's own post stack
 * (`ClassicPostPass`) and the scaled post (`game/looks/scaledPost.ts`).
 */
import * as THREE from 'three';

const RAY = new THREE.Vector3(), BASIS = new THREE.Matrix3();
/** the world direction through NDC (x, y), scaled so its view-space z is −1: the image plane at unit depth */
function unitDepthRay(camera: THREE.PerspectiveCamera, x: number, y: number, into: THREE.Vector3): THREE.Vector3 {
  RAY.set(x, y, 0.5).applyMatrix4(camera.projectionMatrixInverse);
  return into.copy(RAY).divideScalar(-RAY.z).applyMatrix3(BASIS);
}
/**
 * `viewRay`'s inputs, when a post graph reads it (LF2-3): from the scene camera's own projection (a view offset or an
 * off-centre crop included) and world rotation, the ray through the centre (forward) and the steps to the right and top
 * edges, all on the image plane at unit depth, so forward + (uv·2 − 1) along them is the pixel's world ray. Any post
 * executor that draws a graph calls this each frame; a graph that never reads `viewRay` has none of the uniforms.
 */
export function feedViewRay(uniforms: Readonly<Record<string, THREE.IUniform>>, camera: THREE.Camera): void {
  const forward = uniforms['wsViewForward'], right = uniforms['wsViewRight'], up = uniforms['wsViewUp'];
  if (forward === undefined || right === undefined || up === undefined || !(camera instanceof THREE.PerspectiveCamera)) return;
  const f = forward.value as THREE.Vector3, r = right.value as THREE.Vector3, u = up.value as THREE.Vector3;
  BASIS.setFromMatrix4(camera.matrixWorld);
  unitDepthRay(camera, 0, 0, f);
  unitDepthRay(camera, 1, 0, r).sub(f);
  unitDepthRay(camera, 0, 1, u).sub(f);
}
