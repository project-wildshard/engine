/** Internal standing draw/anchor executor; public intake is FigureRows' strict JSON. */
import * as THREE from 'three';
import type { BoxSpec } from '@wildshard/engine/physics/box';
import type { FigureRow } from '@wildshard/format/figures';
import type { SceneHandles } from '../../shardfile/sceneHandles';
import type { FigureRig } from './figureSkins';

export interface FigureSkinState { pending: FigureRig | null; owned: { dispose: () => void }[] }
interface StandingFigure {
  group: THREE.Group; talkPoint: THREE.Vector3; collider: BoxSpec; talking: boolean;
  lod: (distance: number) => void; walkTo: (x: number, y: number, z: number) => void;
  update: (dt: number, time: number, player: THREE.Vector3) => void;
}
export function standingFigure(group: THREE.Group, resources: SceneHandles, input: FigureRow, rigSource: FigureSkinState): StandingFigure {
  const row = input.motion, fallback = input.fallback;
  if (row === undefined || fallback === undefined) throw new Error('Missing standing figure rows');
  const feet = { x: input.feet[0], y: input.feet[1], z: input.feet[2] }, yaw = input.yaw;
  group.name = input.name;
  group.position.set(feet.x, feet.y, feet.z);
  group.rotation.y = yaw;
  const mesh = new THREE.Mesh(resources.geometry(fallback.geometry), resources.material(fallback.material));
  mesh.castShadow = true; mesh.receiveShadow = true;
  group.add(mesh);
  const glass = fallback.glass !== null ? new THREE.Mesh(resources.geometry(fallback.glass), resources.material(fallback.glow)) : null;
  if (glass) group.add(glass);
  let rig: FigureRig | null = null, shown: THREE.Mesh = mesh;
  let talkK = 0, pointK = 0, talkT = 0;
  const adopt = (r: FigureRig): void => {
    rig = r; rigSource.pending = null;
    group.remove(mesh); if (glass) group.remove(glass);
    r.mesh.castShadow = mesh.castShadow;
    group.add(r.mesh);
    shown = r.mesh;
    if (r.lanternAt) {
      const f = row.flame;
      const flame = new THREE.Mesh(new THREE.SphereGeometry(f.radius, f.widthSegments, f.heightSegments), resources.material(fallback.glow));
      flame.position.copy(r.lanternAt).sub(r.handAt);
      const col = new Float32Array(flame.geometry.getAttribute('position').count * 3);
      for (let i = 0; i < col.length; i += 3) { col[i] = f.color[0]; col[i + 1] = f.color[1]; col[i + 2] = f.color[2]; }
      flame.geometry.setAttribute('color', new THREE.BufferAttribute(col, 3));
      flame.castShadow = false; rigSource.owned.push(flame.geometry);
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
  let lodState = -1, unposed = false;
  const held: Parameters<FigureRig['pose']> = [0, 0, 0, 0, 0, 0, 0];
  const person = {
    group, talkPoint, collider, talking: false,
    lod: (d: number) => {
      const st = d > row.drawDistance ? 0 : d > row.shadowDistance ? 1 : 2;
      if (st === lodState) return;
      lodState = st; group.visible = st > 0; shown.castShadow = st === 2; mesh.castShadow = st === 2;
      if (st > 0 && rig !== null && unposed) { rig.pose(...held); unposed = false; }
    },
    walkTo: (x: number, y: number, z: number) => {
      walk = { from: new THREE.Vector3(pos.x, pos.y, pos.z), to: new THREE.Vector3(x, y, z), done: 0 };
    },
    update: (dt: number, t: number, player: THREE.Vector3) => {
      const heading = stepWalk(dt);
      const dx = player.x - pos.x, dz = player.z - pos.z, near = heading === null && dx * dx + dz * dz < notice * notice;
      const want = heading ?? (near ? Math.atan2(dx, dz) : home);
      let d = want - cur; d = Math.atan2(Math.sin(d), Math.cos(d));
      cur += d * Math.min(1, dt * (heading === null ? 3 : 6));
      group.rotation.y = cur;
      if (rig === null) { const r = rigSource.pending; if (r) adopt(r); }
      if (rig !== null) {
        // idle / talk / point: the talk eases in and out; a pointing person points toward its spot now and then
        talkK += ((person.talking ? 1 : 0) - talkK) * Math.min(1, dt * 4);
        talkT = person.talking ? talkT + dt : 0;
        const pointing = input.points && person.talking && talkT % pt.period > pt.from && talkT % pt.period < pt.to;
        pointK += ((pointing ? 1 : 0) - pointK) * Math.min(1, dt * 3);
        let py = Math.atan2(input.pointAt[0] - pos.x, input.pointAt[2] - pos.z) - cur;
        py = Math.max(-1, Math.min(1, Math.atan2(Math.sin(py), Math.cos(py))));
        const look = near ? Math.max(-0.6, Math.min(0.6, Math.atan2(Math.sin(want - cur), Math.cos(want - cur)))) : 0;
        // FC: a hidden person keeps its clocks but not its bones; the frame it shows again poses it from these inputs
        if (lodState === 0) { held[0] = t; held[1] = talkK; held[2] = pointK; held[3] = py; held[4] = look; held[5] = walkK; held[6] = phase; unposed = true; }
        else { unposed = false; rig.pose(t, talkK, pointK, py, look, walkK, phase); }
        return;
      }
      mesh.scale.y = 1 + Math.sin(t * sway.breatheRate) * sway.breathe;
      mesh.rotation.z = person.talking ? Math.sin(t * sway.talkRate) * sway.talk : 0;
    },
  };
  const loaded = rigSource.pending;
  if (loaded !== null) adopt(loaded);
  return person;
}
