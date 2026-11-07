/** Retained pre-C6 standing executor, an independent exact pose oracle. */
import * as THREE from 'three';
import type { BoxSpec } from '@wildshard/engine/physics/box';
import type { FigureMotionRow as StandInPersonRow } from '@wildshard/format/figures';
/** The rigged person a stand-in gives way to (structural: the shard's rig loader returns one). */
export interface StandInRig {
  readonly mesh: THREE.SkinnedMesh;
  /** a lantern's flame spot (mesh-local, rides the right hand), or null */
  readonly lanternAt: THREE.Vector3 | null;
  /** the right hand bone (the flame hangs off it) */
  readonly handR: THREE.Bone;
  /** poses the rig: talk and point weights, the point's yaw and the head's look (mesh-local), the walk's weight and phase */
  pose: (t: number, talk: number, point: number, pointYaw: number, look: number, walk?: number, phase?: number) => void;
  /** m/s at which the walk's feet stay planted */
  readonly walkSpeed: number;
  /** metres travelled per walk cycle */
  readonly walkCycle: number;
}

/** One person to stand up: where, its stand-in parts and materials, its rig source and where it points. */
export interface StandInPersonSpec {
  /** the group's name */
  readonly name: string;
  readonly feet: { readonly x: number; readonly y: number; readonly z: number };
  readonly yaw: number;
  readonly body: THREE.BufferGeometry;
  readonly bodyMaterial: THREE.Material;
  /** a glowing stand-in part (lantern glass), or null */
  readonly glass: THREE.BufferGeometry | null;
  /** the glow material (the glass and the rig's flame), asked for when one is first needed */
  readonly glowMaterial: () => THREE.Material;
  /** the rig once it is ready, else null (asked each frame until it answers) */
  readonly rig: () => StandInRig | null;
  /** the spot the rig points toward (world x / z) */
  readonly pointAt: { readonly x: number; readonly z: number };
  /** whether this person points while talking */
  readonly points: boolean;
  readonly row: StandInPersonRow;
}

/** A standing person's handle: what a quest reads and drives. */
export interface StandInPerson {
  readonly group: THREE.Group;
  /** where the talk prompt sits (world, the head) */
  readonly talkPoint: THREE.Vector3;
  readonly collider: BoxSpec;
  talking: boolean;
  update: (dt: number, t: number, player: THREE.Vector3) => void;
  /** draw distance and shadow by `d`, metres from the camera */
  lod: (d: number) => void;
  /** walks to (x, y, z) at the walk pace, then faces its post's way again; the collider and talk point go along */
  walkTo: (x: number, y: number, z: number) => void;
}

/** Stands a person up at `spec.feet` facing `spec.yaw`: the stand-in, swapped for the rig on the first frame it is ready. */
export function standInPerson(spec: StandInPersonSpec): StandInPerson {
  const { feet, yaw, row } = spec;
  const group = new THREE.Group();
  group.name = spec.name;
  group.position.set(feet.x, feet.y, feet.z);
  group.rotation.y = yaw;
  const mesh = new THREE.Mesh(spec.body, spec.bodyMaterial);
  mesh.castShadow = true; mesh.receiveShadow = true;
  group.add(mesh);
  const glass = spec.glass ? new THREE.Mesh(spec.glass, spec.glowMaterial()) : null;
  if (glass) group.add(glass);
  let rig: StandInRig | null = null, shown: THREE.Mesh = mesh;
  let talkK = 0, pointK = 0, talkT = 0;
  const adopt = (r: StandInRig): void => {
    rig = r;
    group.remove(mesh); if (glass) group.remove(glass);
    r.mesh.castShadow = mesh.castShadow;
    group.add(r.mesh);
    shown = r.mesh;
    if (r.lanternAt) {
      const f = row.flame;
      const flame = new THREE.Mesh(new THREE.SphereGeometry(f.radius, f.widthSegments, f.heightSegments), spec.glowMaterial());
      const hand = new THREE.Vector3().setFromMatrixPosition(r.handR.matrixWorld).applyMatrix4(new THREE.Matrix4().copy(group.matrixWorld).invert());
      flame.position.copy(r.lanternAt).sub(hand);
      const col = new Float32Array(flame.geometry.getAttribute('position').count * 3);
      for (let i = 0; i < col.length; i += 3) { col[i] = f.color[0]; col[i + 1] = f.color[1]; col[i + 2] = f.color[2]; }
      flame.geometry.setAttribute('color', new THREE.BufferAttribute(col, 3));
      flame.castShadow = false;
      r.handR.add(flame);
    }
  };
  const box = row.collider;
  const pos = { x: feet.x, y: feet.y, z: feet.z };
  const collider: BoxSpec = { x: pos.x, z: pos.z, hw: box.half, hd: box.half, rot: 0, yTop: pos.y + box.top, yBottom: pos.y - box.bottom };
  const talkPoint = new THREE.Vector3(pos.x, pos.y + row.talkHeight, pos.z);
  // the walk: from → to, `walkK` easing the clip in and out, `phase` advanced by the distance walked
  let walk: { from: THREE.Vector3; to: THREE.Vector3; done: number } | null = null, walkK = 0, phase = 0;
  const stepWalk = (dt: number): number | null => {
    const speed = rig?.walkSpeed ?? row.walk.speed, cycle = rig?.walkCycle ?? row.walk.cycle;
    walkK += ((walk ? 1 : 0) - walkK) * Math.min(1, dt * 5);
    if (!walk) return null;
    const len = walk.from.distanceTo(walk.to);
    walk.done = Math.min(len, walk.done + speed * walkK * dt);
    phase = (phase + (speed * walkK * dt) / Math.max(0.01, cycle)) % 1;
    const k = len > 1e-6 ? walk.done / len : 1;
    pos.x = walk.from.x + (walk.to.x - walk.from.x) * k; pos.y = walk.from.y + (walk.to.y - walk.from.y) * k; pos.z = walk.from.z + (walk.to.z - walk.from.z) * k;
    group.position.set(pos.x, pos.y, pos.z);
    collider.x = pos.x; collider.z = pos.z; collider.yTop = pos.y + box.top; collider.yBottom = pos.y - box.bottom;
    talkPoint.set(pos.x, pos.y + row.talkHeight, pos.z);
    const heading = Math.atan2(walk.to.x - walk.from.x, walk.to.z - walk.from.z);
    if (walk.done >= len) walk = null;
    return heading;
  };
  const home = yaw, notice = row.noticeRadius, pt = row.point, sway = row.sway;
  let cur = yaw;
  let lodState = -1;
  const person: StandInPerson = {
    group, talkPoint, collider, talking: false,
    lod: (d) => {
      const st = d > row.drawDistance ? 0 : d > row.shadowDistance ? 1 : 2;
      if (st === lodState) return;
      lodState = st; group.visible = st > 0; shown.castShadow = st === 2; mesh.castShadow = st === 2;
    },
    walkTo: (x, y, z) => {
      walk = { from: new THREE.Vector3(pos.x, pos.y, pos.z), to: new THREE.Vector3(x, y, z), done: 0 };
    },
    update: (dt, t, player) => {
      const heading = stepWalk(dt);
      const dx = player.x - pos.x, dz = player.z - pos.z, near = heading === null && dx * dx + dz * dz < notice * notice;
      const want = heading ?? (near ? Math.atan2(dx, dz) : home);
      let d = want - cur; d = Math.atan2(Math.sin(d), Math.cos(d));
      cur += d * Math.min(1, dt * (heading === null ? 3 : 6));
      group.rotation.y = cur;
      if (rig === null) { const r = spec.rig(); if (r) adopt(r); }
      if (rig !== null) {
        // idle / talk / point: the talk eases in and out; a pointing person points toward its spot now and then
        talkK += ((person.talking ? 1 : 0) - talkK) * Math.min(1, dt * 4);
        talkT = person.talking ? talkT + dt : 0;
        const pointing = spec.points && person.talking && talkT % pt.period > pt.from && talkT % pt.period < pt.to;
        pointK += ((pointing ? 1 : 0) - pointK) * Math.min(1, dt * 3);
        let py = Math.atan2(spec.pointAt.x - pos.x, spec.pointAt.z - pos.z) - cur;
        py = Math.max(-1, Math.min(1, Math.atan2(Math.sin(py), Math.cos(py))));
        const look = near ? Math.max(-0.6, Math.min(0.6, Math.atan2(Math.sin(want - cur), Math.cos(want - cur)))) : 0;
        rig.pose(t, talkK, pointK, py, look, walkK, phase);
        return;
      }
      mesh.scale.y = 1 + Math.sin(t * sway.breatheRate) * sway.breathe;
      mesh.rotation.z = person.talking ? Math.sin(t * sway.talkRate) * sway.talk : 0;
    },
  };
  const loaded = spec.rig();
  if (loaded !== null) adopt(loaded);
  return person;
}
