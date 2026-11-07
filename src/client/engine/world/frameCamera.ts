import * as THREE from 'three';

/**
 * A camera's stand-in in a frame's own space (SHARD-PLATFORM SF63, E435). Content that culls against the view compares the
 * camera with data it measured in its own frame: placed copies' boxes (`place`), a herd's positions, a shard's tile rects.
 * Standalone that frame is the scene's. A grid region's content stands under its view root at the cell's render offset,
 * while the page camera is in the page's space, so the same test runs a whole offset away: copies beside the player
 * were dropped as out of range and out of view, and their shadows with them.
 *
 * `of(camera)` returns the camera itself while the frame's world matrix is the identity (standalone: the same object, the
 * same decisions), else this stand-in posed at the camera seen from the frame: its world matrix is the frame's inverse
 * times the camera's, with the camera's projection, field of view, zoom, aspect and clip planes. Posed once per `stamp`;
 * allocates nothing per call. Never rendered or parented: it only answers the questions a culler asks of a camera.
 */
export class FrameCamera {
  private readonly frame: THREE.Object3D;
  private readonly local = new THREE.PerspectiveCamera();
  private readonly inv = new THREE.Matrix4();
  private readonly m = new THREE.Matrix4();
  private stamp = -1;
  private posedFor: THREE.Camera | null = null;
  constructor(frame: THREE.Object3D) {
    this.frame = frame;
    this.local.matrixAutoUpdate = true;
    this.local.name = `frame-camera:${frame.name}`;
  }

  /** true while the frame stands at the scene's own origin, unrotated and unscaled */
  get identity(): boolean {
    const e = this.frame.matrixWorld.elements;
    return e[0] === 1 && e[5] === 1 && e[10] === 1 && e[12] === 0 && e[13] === 0 && e[14] === 0
      && e[1] === 0 && e[2] === 0 && e[4] === 0 && e[6] === 0 && e[8] === 0 && e[9] === 0;
  }

  /** `camera` seen from the frame (`camera` itself at the identity); `stamp`: re-posed only when it changes (−1: always) */
  of<C extends THREE.Camera>(camera: C, stamp = -1): C | THREE.PerspectiveCamera {
    if (this.identity) return camera;
    if (stamp !== -1 && stamp === this.stamp && this.posedFor === camera) return this.local;
    this.stamp = stamp; this.posedFor = camera;
    return this.pose(camera);
  }

  /** Pose the stand-in at `camera` seen from the frame, at the identity too: one camera object a pass reads every frame. */
  pose(camera: THREE.Camera): THREE.PerspectiveCamera {
    // the camera's own world matrix (and its inverse), not its children's: the page camera carries the viewmodel, whose
    // whole subtree `updateMatrixWorld` re-posed on each of a frame's poses (Nalati interior, phone 4x: 87 ms of 6 s)
    camera.updateWorldMatrix(true, false);
    this.inv.copy(this.frame.matrixWorld).invert();
    this.m.multiplyMatrices(this.inv, camera.matrixWorld);
    const l = this.local;
    this.m.decompose(l.position, l.quaternion, l.scale);
    if (camera instanceof THREE.PerspectiveCamera) { l.fov = camera.fov; l.zoom = camera.zoom; l.aspect = camera.aspect; l.near = camera.near; l.far = camera.far; }
    l.projectionMatrix.copy(camera.projectionMatrix);
    l.projectionMatrixInverse.copy(camera.projectionMatrixInverse);
    l.updateMatrixWorld(true);
    return l;
  }
}
