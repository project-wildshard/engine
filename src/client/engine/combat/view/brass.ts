import { app } from '../../app/runtime';
import * as THREE from 'three';
import { terrainHeight as heightAt } from '../../../../shared/engine/world/terrainHeight';
import { floorBelow } from '../../../../shared/engine/physics/query';

function brassFloor(p: THREE.Vector3, v: THREE.Vector3): number {
  const physics = app.physics;
  if (physics === null) return heightAt(p.x, p.z);
  const f0 = floorBelow(physics, p.x, p.z, p.y, 8) ?? heightAt(p.x, p.z);
  const t = (v.y + Math.sqrt(v.y * v.y + 2 * 9.8 * Math.max(0, p.y - f0))) / 9.8;
  const x = p.x + v.x * t, z = p.z + v.z * t;
  return floorBelow(physics, x, z, p.y, 8) ?? heightAt(x, z);
}

export interface BrassCase { mesh: THREE.Mesh; vel: THREE.Vector3; spin: THREE.Vector3; life: number; down: boolean; floor: number }
export function stepBrass(cases: readonly BrassCase[], dt: number): void {
  for (const b of cases) {
    if (b.life <= 0) continue;
    b.life -= dt;
    if (b.life <= 0) { b.mesh.visible = false; continue; }
    if (b.down) continue;
    b.vel.y -= 9.8 * dt;
    b.mesh.position.addScaledVector(b.vel, dt);
    b.mesh.rotation.x += b.spin.x * dt; b.mesh.rotation.y += b.spin.y * dt; b.mesh.rotation.z += b.spin.z * dt;
    if (b.mesh.position.y < b.floor) { b.mesh.position.y = b.floor; b.down = true; b.mesh.rotation.set(0, app.rng.stream('cosmetic').next() * Math.PI, Math.PI / 2 + (app.rng.stream('cosmetic').next() - 0.5) * 0.3); }
  }
}

/** Authored ejection in ordered camera axes: velocity base + random scale, then spin. */
export interface BrassEjectionRow {
  readonly velocity: readonly [readonly ['right' | 'up' | 'forward', number, number], readonly ['right' | 'up' | 'forward', number, number], readonly ['right' | 'up' | 'forward', number, number]];
  readonly spin: readonly [readonly [number, number, number], readonly [number, number, number], readonly [number, number, number]];
  readonly rotation: readonly [number, number, number, number]; readonly floorOffset: number;
}
/** Allocate the original independent cases; geometry/material stay borrowed and shared. */
export function brassRoster(scene: THREE.Scene, geometry: THREE.BufferGeometry, material: THREE.Material, count: number): BrassCase[] {
  if (!Number.isInteger(count) || count < 1 || count > 128) throw new RangeError('Invalid brass roster');
  const cases: BrassCase[] = [];
  for (let i = 0; i < count; i++) {
    const mesh = new THREE.Mesh(geometry, material); mesh.visible = false; mesh.frustumCulled = false; scene.add(mesh);
    cases.push({mesh,vel:new THREE.Vector3(),spin:new THREE.Vector3(),life:0,down:false,floor:0});
  }
  return cases;
}
/** Recycle the first expired/oldest case, preserving six cosmetic draws and the live floor query.
 * Scratch vectors/quaternion are borrowed from the caller; no extra effect buffers are allocated.
 */
export function ejectBrass(cases: readonly BrassCase[], row: BrassEjectionRow, model: THREE.Object3D, camera: THREE.Camera,
  port: THREE.Vector3, life: number, right: THREE.Vector3, up: THREE.Vector3, forward: THREE.Vector3, rotation: THREE.Quaternion): void {
  if (cases.length === 0 || cases.length > 128) throw new RangeError('Invalid brass roster');
  const first = cases[0]; if (first === undefined) throw new Error('Missing brass case');
  const b = cases.find(next => next.life <= 0) ?? cases.reduce((oldest, next) => next.life < oldest.life ? next : oldest, first);
  model.updateMatrixWorld(); model.localToWorld(b.mesh.position.copy(port));
  right.set(1,0,0).applyQuaternion(camera.quaternion); up.set(0,1,0).applyQuaternion(camera.quaternion); camera.getWorldDirection(forward);
  const axis = (name: 'right' | 'up' | 'forward'): THREE.Vector3 => name === 'right' ? right : name === 'up' ? up : forward;
  const [a,c,d] = row.velocity;
  b.vel.copy(axis(a[0])).multiplyScalar(a[1] + app.rng.stream('cosmetic').next() * a[2])
    .addScaledVector(axis(c[0]),c[1] + app.rng.stream('cosmetic').next() * c[2])
    .addScaledVector(axis(d[0]),d[1] + app.rng.stream('cosmetic').next() * d[2]);
  const [x,y,z] = row.spin;
  b.spin.set(x[0] + (app.rng.stream('cosmetic').next() + x[1]) * x[2],y[0] + (app.rng.stream('cosmetic').next() + y[1]) * y[2],z[0] + (app.rng.stream('cosmetic').next() + z[1]) * z[2]);
  const [rx,ry,rz,angle] = row.rotation;
  b.mesh.quaternion.copy(camera.quaternion).multiply(rotation.setFromAxisAngle(right.set(rx,ry,rz),angle));
  b.life = life; b.down = false; b.mesh.visible = true; b.floor = brassFloor(b.mesh.position,b.vel) + row.floorOffset;
}
