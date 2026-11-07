/**
 * The ambient-flock host (G466 H6): one posed draw of a flock row's birds, driven by the platform.
 *
 *   const gulls = createAmbientFlock(rows, { name, geometry, material }, perches);   // data + the look's GPU objects
 *   installAmbientFlock(ctx, gulls, player);                                          // the row's system ticks it
 *   gulls.guide(player.position, tx, tz);                                             // a guide pass (PlaceGuide's fly)
 *
 * The row (`@wildshard/format/ambientLife#AmbientFlockSchema`) carries the motion (perch / wheel / flush / guide), the
 * wingbeats, the squawk cue (played through `app.audio.cue(id, { point })`), the system order and how each bird's pose
 * packs into the look's per-instance channels (`channels`: a pose name or a constant per vec4 lane). No callback
 * crosses it (G454). Users: Driftwood's gulls, Pine Hollow's breadcrumb ravens.
 */
import * as THREE from 'three';
import { app } from '@wildshard/engine/app/runtime';
import { AmbientGroup, type AmbientVisitorPlayer } from '../../../shared/game/ambient/flock';
import { parseAmbientFlock, type AmbientFlockData } from '@wildshard/format/ambientLife';
import type { ShardContext } from '../plugin/context';
import { PosedDraw } from '../looks/posedInstances';
import type { PosedBufferPool } from '../looks/posedBufferPool';

interface Point { x: number; y: number; z: number }
/** the flock's look: the authored bird and the posed material (its vertex stage reads `attributes`) */
export interface AmbientFlockLook { readonly name: string; readonly geometry: THREE.BufferGeometry; readonly material: THREE.Material; readonly castShadow?: boolean; readonly yaw?: number; readonly buffers?: PosedBufferPool }

/** A flock row and its one posed draw. */
export class AmbientFlockDraw {
  readonly flock: AmbientGroup;
  readonly mesh: THREE.InstancedMesh;
  /** the draw's parent (add this to the scene) */
  readonly group: THREE.Group = new THREE.Group();
  private readonly point = new THREE.Vector3();
  private readonly posed: PosedDraw;
  readonly row: AmbientFlockData;
  constructor(row: AmbientFlockData, look: AmbientFlockLook, perches: readonly Point[]) {
    this.row = row;
    this.flock = new AmbientGroup(row, perches);
    const [, second] = row.attributes;
    this.posed = new PosedDraw({ name: look.name, attributes: second === null ? [row.attributes[0]] : [row.attributes[0], second], channels: row.channels[1] === null ? [row.channels[0]] : [row.channels[0], row.channels[1]], scale: row.scale, yaw: look.yaw }, row.count, look.geometry, look.material, look.buffers);
    this.mesh = this.posed.mesh;
    this.mesh.castShadow = look.castShadow ?? false; this.mesh.receiveShadow = false;
    this.group.add(this.mesh);
    this.draw();
  }
  /** one frame: the motion, the squawks, the draw */
  update(dt: number, player: AmbientVisitorPlayer): void {
    this.flock.update(dt, player);
    for (const p of this.flock.calls) app.audio?.cue(p.cue, { point: this.point.set(p.x, p.y, p.z) });
    this.draw();
  }
  /** a guide pass toward (tx, tz) past `player` (false: none free) */
  guide(player: Point, tx: number, tz: number): boolean { return this.flock.guide(player, tx, tz); }
  private draw(): void {
    const posed = this.posed;
    posed.begin();
    for (const bird of this.flock.birds) {
      if (bird.state === 0) continue;
      posed.add(bird);
    }
    posed.commit();
  }
}

/** Validate a flock row and build its draw (the caller adds `group` to its scene). */
export function createAmbientFlock(input: unknown, look: AmbientFlockLook, perches: readonly Point[] = []): AmbientFlockDraw {
  return new AmbientFlockDraw(parseAmbientFlock(input), look, perches);
}
/** Tick the flock in the row's system slot, at the player's position. */
export function installAmbientFlock(ctx: ShardContext, draw: AmbientFlockDraw, player: { readonly position: Point }): void {
  const { id, after, before } = draw.row.system;
  ctx.system({ id, phase: 'update', after: [...after], before: [...before], run: (dt) => { draw.update(dt, player.position); } });
}
