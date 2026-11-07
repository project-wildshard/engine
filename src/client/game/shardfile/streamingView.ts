import { Frustum, Matrix4, Vector3, type Object3D, type PerspectiveCamera } from 'three';
import { FrameCamera } from '@wildshard/engine/world/frameCamera';

export interface StreamingBounds {
  readonly min: readonly [number, number, number];
  readonly max: readonly [number, number, number];
}
export interface StreamingPoint { readonly x: number; readonly y?: number; readonly z: number; readonly bounds?: StreamingBounds }
/** Cell-local, numeric camera facts. A queue consumes them synchronously before
 * its next yield; the camera and its rendering remain with their original owner. */
export interface StreamingView {
  readonly eye: { readonly x: number; readonly y: number; readonly z: number };
  readonly planes: readonly { readonly normal: { readonly x: number; readonly y: number; readonly z: number }; readonly constant: number }[];
}

/** The real page eye in the content root's frame, including a grid cell's
 * translation/rotation. Reuses its matrices, frustum and result without a clock. */
export class StreamingCamera {
  private readonly frame: FrameCamera;
  private readonly frustum = new Frustum();
  private readonly matrix = new Matrix4();
  private readonly rootMatrix = new Matrix4();
  private readonly cameraMatrix = new Matrix4();
  private readonly projection = new Matrix4();
  private current = false;
  private readonly eye = new Vector3();
  private readonly view: StreamingView;
  constructor(private readonly root: Object3D, private readonly camera: () => PerspectiveCamera) {
    this.frame = new FrameCamera(root);
    this.view = { eye: this.eye, planes: this.frustum.planes };
  }
  read(): StreamingView {
    this.root.updateWorldMatrix(true, false);
    const page = this.camera(); page.updateWorldMatrix(true, false);
    if (this.current && this.rootMatrix.equals(this.root.matrixWorld) && this.cameraMatrix.equals(page.matrixWorld)
      && this.projection.equals(page.projectionMatrix)) return this.view;
    const local = this.frame.of(page);
    this.eye.setFromMatrixPosition(local.matrixWorld);
    this.matrix.multiplyMatrices(local.projectionMatrix, local.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.matrix);
    if (!Number.isFinite(this.eye.x) || !Number.isFinite(this.eye.y) || !Number.isFinite(this.eye.z)) throw new Error('Invalid streaming camera');
    for (const plane of this.frustum.planes) if (!Number.isFinite(plane.normal.x) || !Number.isFinite(plane.normal.y)
      || !Number.isFinite(plane.normal.z) || !Number.isFinite(plane.constant)) throw new Error('Invalid streaming camera');
    this.rootMatrix.copy(this.root.matrixWorld); this.cameraMatrix.copy(page.matrixWorld); this.projection.copy(page.projectionMatrix); this.current = true;
    return this.view;
  }
}

/** Squared 3-D distance to the nearest part of a published box, or to a point
 * when the job has no spatial extent. Never invent a tile's height from x/z. */
export function streamingDistance(at: StreamingPoint, view: StreamingView): number {
  const eye = view.eye, bounds = at.bounds;
  const x = bounds === undefined ? at.x : Math.max(bounds.min[0], Math.min(bounds.max[0], eye.x));
  const y = bounds === undefined ? at.y ?? 0 : Math.max(bounds.min[1], Math.min(bounds.max[1], eye.y));
  const z = bounds === undefined ? at.z : Math.max(bounds.min[2], Math.min(bounds.max[2], eye.z));
  return (x - eye.x) ** 2 + (y - eye.y) ** 2 + (z - eye.z) ** 2;
}

/** Conservative box/frustum intersection: a wide tile is visible when any of
 * its declared extent meets the view, even if its centre is behind the eye. */
export function streamingVisible(at: StreamingPoint, view: StreamingView): boolean {
  const bounds = at.bounds;
  for (const plane of view.planes) {
    const n = plane.normal;
    const x = bounds === undefined ? at.x : n.x > 0 ? bounds.max[0] : bounds.min[0];
    const y = bounds === undefined ? at.y ?? 0 : n.y > 0 ? bounds.max[1] : bounds.min[1];
    const z = bounds === undefined ? at.z : n.z > 0 ? bounds.max[2] : bounds.min[2];
    if (n.x * x + n.y * y + n.z * z + plane.constant < 0) return false;
  }
  return true;
}

/** Visible work first, then the eye's actual 3-D distance. The caller retains
 * its original deterministic order when both scores tie. */
export function streamingOrder(a: StreamingPoint, b: StreamingPoint, view: StreamingView): number {
  return Number(streamingVisible(b, view)) - Number(streamingVisible(a, view))
    || streamingDistance(a, view) - streamingDistance(b, view);
}
