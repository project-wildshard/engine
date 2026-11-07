import { Euler, Matrix4, Quaternion, Vector3 } from 'three';

/** Authored YXZ pose; a front correction is applied before composing its matrix. */
export interface ModelPose { readonly x: number; readonly y: number; readonly z: number; readonly yaw: number; readonly scale: number; readonly pitch?: number; readonly roll?: number }
const position = new Vector3(), rotation = new Euler(), orientation = new Quaternion(), size = new Vector3();
/** Compose an authored pose without changing its float operation order. */
export function modelPoseMatrix(pose: ModelPose): Matrix4 {
  // Capture every input before touching private scratch: an accessor may itself
  // compose another pose. Only the fresh returned matrix escapes this call.
  const x = pose.x, y = pose.y, z = pose.z, pitch = pose.pitch ?? 0, yaw = pose.yaw, roll = pose.roll ?? 0,
    sx = pose.scale, sy = pose.scale, sz = pose.scale;
  return new Matrix4().compose(position.set(x, y, z),
    orientation.setFromEuler(rotation.set(pitch, yaw, roll, 'YXZ')), size.set(sx, sy, sz));
}
