/**
 * CI12: a cloud body (encounterView.ts CloudBody) without drawing, for a Node simulation of the fight it embodies. Its
 * scene's nodes become plain rig parts with the same transforms and parents, its root takes the body's scale, and the same
 * channel programs pose the same parts from the same pose and ports, so `focusWorld` (the heart's place, what the
 * fight's target and lock read) is the page body's. The puffs, materials, ring and strip are drawn only and are absent;
 * a scene the rig cannot mirror exactly (an imported object, an anchor, a gate, a mesh without its geometry) refuses.
 *
 *   const body = new HeadlessCloudBody(rows, pose, ports);   // OpenArenaViews.body for a native fight
 */
import { Color, Euler, Matrix4, Quaternion, Vector3 } from 'three';
import type { ViewCamera } from '@wildshard/engine/script/viewProgram';
import { parsePrivateScene } from '@wildshard/format/clientChannels';
import type { CloudBodyRows } from '@wildshard/format/encounterRows';
import { installChannelPrograms } from '@wildshard/engine/game/plugin/channelPrograms';

/** One rig part: a scene node's transform and parent, which is all a pose program writes and the focus reads. */
class RigPart {
  /** three's own marker: a channel's numeric ports admit a scene node by it */
  readonly isObject3D = true;
  name = ''; visible = true; parent: RigPart | null = null;
  readonly children: RigPart[] = [];
  readonly position: Vector3 = new Vector3(); readonly rotation: Euler = new Euler(); readonly scale: Vector3 = new Vector3(1, 1, 1);
  readonly matrixWorld: Matrix4 = new Matrix4();
  private readonly turn = new Quaternion(); private readonly local = new Matrix4();
  add(child: RigPart): void { child.parent = this; this.children.push(child); }
  private compose(): void {
    this.local.compose(this.position, this.turn.setFromEuler(this.rotation), this.scale);
    if (this.parent === null) this.matrixWorld.copy(this.local); else this.matrixWorld.multiplyMatrices(this.parent.matrixWorld, this.local);
  }
  private settle(): void { this.parent?.settle(); this.compose(); }
  updateMatrixWorld(): void { this.compose(); for (const child of this.children) child.updateMatrixWorld(); }
  getWorldPosition(out: Vector3): Vector3 { this.settle(); return out.setFromMatrixPosition(this.matrixWorld); }
}

/** The scene's parts (createClientScene's transforms, visibility and child order), by node id. */
function rigParts(input: unknown, geometry: ReadonlySet<string>): ReadonlyMap<string, RigPart> {
  const row = parsePrivateScene(input), parts = new Map<string, RigPart>();
  for (const node of row.nodes) {
    if (node.kind !== 'group' && node.kind !== 'mesh') throw new Error(`Cloud rig cannot mirror a ${node.kind} node`);
    if ('when' in node || 'whenTexture' in node || node.visibleWhen !== undefined) throw new Error('Cloud rig cannot mirror a gated node');
    if (node.kind === 'mesh' && !geometry.has(node.geometry)) throw new Error(`Cloud rig mesh has no geometry ${node.geometry}`);
    const object = new RigPart();
    if (node.name !== undefined) object.name = node.name;
    if (node.position !== undefined) object.position.set(...node.position);
    if (node.rotation !== undefined) object.rotation.set(...node.rotation, node.order ?? object.rotation.order);
    if (node.scale !== undefined) object.scale.set(...node.scale);
    if (node.visible !== undefined) object.visible = node.visible;
    parts.set(node.id, object);
  }
  for (const node of row.nodes) {
    const parent = parts.get(node.id); if (parent === undefined) continue;
    for (const id of node.children) { const child = parts.get(id); if (child !== undefined) parent.add(child); }
  }
  if (!parts.has(row.root)) throw new Error('Cloud rig root unavailable');
  return parts;
}

/** The fight's body port (OpenArenaViews.body) for a Node simulation: CloudBody's pose, visibility and focus, no draw. */
export class HeadlessCloudBody {
  readonly alpha = { value: 1 }; readonly flash = { value: 0 }; readonly glow = { value: 0.4 };
  readonly fogColour: Color = new Color(0.3, 0.32, 0.4);
  readonly focusPoint: Vector3 = new Vector3();
  visible = false;
  private readonly rows: CloudBodyRows;
  private readonly pose: Readonly<Record<string, number>>;
  private readonly parts: ReadonlyMap<string, RigPart>;
  private readonly draw: ReturnType<typeof installChannelPrograms>;
  constructor(input: CloudBodyRows, pose: Readonly<Record<string, number>>, ports: ReadonlyMap<string, unknown> = new Map()) {
    const rows = this.rows = input; this.pose = pose;
    this.parts = rigParts(rows.scene, new Set(Object.keys(rows.geometry)));
    this.part(rows.root).scale.setScalar(rows.scale);
    this.draw = installChannelPrograms(rows.poses, rows.group, new Map<string, unknown>([...this.parts, ...ports, ['pose', this.pose]]));
    this.setVisible(false);
  }
  part(key: string): RigPart { const object = this.parts.get(key); if (object === undefined) throw new Error(`Missing cloud body part ${key}`); return object; }
  setVisible(on: boolean): void {
    this.visible = on;
    for (const key of this.rows.shown) this.part(key).visible = on;
    if (!on) { this.part(this.rows.focus.ring).visible = false; this.part(this.rows.focus.dome).visible = false; }
  }
  /** The strip toward the struck spear is drawn only. */
  aim(_target: Vector3 | null, _alpha: number): void { /* drawn only */ }
  /** CloudBody.update's pose: the channel programs at `t`, the world matrices, the focus and the ring's shown state. */
  update(t: number, _camera: ViewCamera): void {
    const rows = this.rows, f = rows.focus, open = this.pose[f.open] ?? 0;
    this.draw.evaluate({ time: t, delta: 0, values: {} });
    this.part(rows.root).updateMatrixWorld();
    this.focusWorld(this.focusPoint);
    this.part(f.ring).visible = this.visible && open > 0.02;
  }
  /** the focus's world position (after `update`) */
  focusWorld(out: Vector3): Vector3 { return this.part(this.rows.focus.part).getWorldPosition(out); }
}
