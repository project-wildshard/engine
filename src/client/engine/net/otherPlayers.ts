// E7.6 (Q87): everyone else in this world, drawn from their rows. A body walks, runs and stands by how fast its row moves, rides its
// board by the row's word and holds what the row says. The body is the castaway (RP2, models/castawayBody.ts), one shared mesh on
// a skeleton of its own, its limbs moved here, and its Name over it.
import * as THREE from 'three';
import type { Scope } from '../../../shared/engine/app/scope';
import { PLAYER_CLASS } from '../../../shared/engine/net/netSchemas';
import type { DummyJoint, DummyJoints } from '../practice/TrainingDummy';
import { castawayBody, groundContact, type CastawayBody } from '../models/castawayBody';
import { AnimMachine } from '../anim/machine';
import { buildHoverboard } from '../render/hoverboardGeometry';
import type { NetClient } from './client';
import { talkerKey, voiceNear, type Talker } from './voiceNear';

const column = (name: string): number => PLAYER_CLASS.row.findIndex(entry => entry.name === name);
const X = column('x'), Y = column('y'), Z = column('z'), YAW = column('yaw'), BOARD = column('board'), HELD = column('held'), HP = column('hp');
/** Over this a row's body is walking, and over this it runs, in m/s. */
const WALKS = 0.4, RUNS = 5;
/** Metres a whole stride covers, walking and running. */
const STRIDE = 1.6, RUN_STRIDE = 2.6;
/** How far a leg and an arm swing at a walk and a run, in radians. */
const WALK_SWING = 0.55, RUN_SWING = 0.95;
/** A body's speed settles at this rate, so one late row is no stumble. */
const SETTLE = 8;
const NAME_HEIGHT = 2.05, NAME_WIDTH = 1.5, NAME_RATIO = 4;
/** VOICE-POLISH V8: the ring over a talking player's Name, its size in metres, and how fast and far it breathes. */
const TALK_HEIGHT = 2.62, TALK_SIZE = 0.5, TALK_PULSE = 9, TALK_SWELL = 0.1;
/** How far a board floats, with its rider on it. */
const BOARD_LIFT = 0.22;
/** How high a rider's feet sit over the row, which stands at the horse's own feet. */
const SADDLE_LIFT = 0.85;
/** A blade's length and where it sits along the hand. */
const BLADE = 0.8;
/** A rider's knees, in radians. The row it rides moves the body. */
const SEAT = 1.2;
const SWUNG: readonly DummyJoint[] = ['leftThigh', 'rightThigh', 'leftShin', 'rightShin', 'leftUpperArm', 'rightUpperArm', 'spine'];
const AXIS = new THREE.Vector3(1, 0, 0), turn = new THREE.Quaternion();

/** A Name as a sprite: it reads the same on any shard, and it needs no DOM over the canvas. */
function nameTag(name: string): THREE.Sprite {
  const canvas = document.createElement('canvas'), { width, height } = Object.assign(canvas, { width: 320, height: 320 / NAME_RATIO }), pen = canvas.getContext('2d');
  if (pen !== null) {
    pen.font = '600 44px system-ui, sans-serif'; pen.textAlign = 'center'; pen.textBaseline = 'middle';
    const wide = Math.min(width, pen.measureText(name).width + 32);
    pen.fillStyle = 'rgba(8, 14, 24, 0.62)'; pen.beginPath(); pen.roundRect((width - wide) / 2, 6, wide, height - 12, 14); pen.fill();
    pen.fillStyle = '#fff'; pen.fillText(name, width / 2, height / 2, width - 24);
  }
  const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
  const tag = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false, fog: false }));
  tag.scale.set(NAME_WIDTH, NAME_WIDTH / NAME_RATIO, 1); tag.position.y = NAME_HEIGHT;
  return tag;
}

/** VOICE-POLISH V8: who is talking, over their head: voice's cyan ring round a mic, as the chat's mic button draws it. */
function talkRing(): THREE.Sprite {
  const canvas = Object.assign(document.createElement('canvas'), { width: 128, height: 128 }), pen = canvas.getContext('2d');
  if (pen !== null) {
    pen.fillStyle = 'rgba(9, 22, 36, 0.8)'; pen.beginPath(); pen.arc(64, 64, 50, 0, Math.PI * 2); pen.fill();
    pen.strokeStyle = '#8fe3ff'; pen.lineWidth = 9; pen.beginPath(); pen.arc(64, 64, 52, 0, Math.PI * 2); pen.stroke();
    pen.lineWidth = 7; pen.lineCap = 'round'; pen.fillStyle = '#8fe3ff';
    pen.beginPath(); pen.roundRect(52, 30, 24, 42, 12); pen.fill();
    pen.beginPath(); pen.arc(64, 60, 24, 0.15 * Math.PI, 0.85 * Math.PI); pen.stroke();
    pen.beginPath(); pen.moveTo(64, 84); pen.lineTo(64, 96); pen.stroke();
  }
  const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
  const ring = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false, fog: false }));
  ring.scale.setScalar(TALK_SIZE); ring.position.y = TALK_HEIGHT; ring.visible = false; ring.name = 'Talking';
  return ring;
}

/** What a page drew of another player. */
export interface OtherShown { readonly name: string; readonly x: number; readonly y: number; readonly z: number; readonly speed: number; readonly gait: string; readonly board: boolean; readonly mounted: boolean; readonly held: number; readonly hp: number; readonly modelled: boolean; readonly model: string; readonly talking: boolean }

/** One other player on screen. */
class OtherBody {
  readonly group: THREE.Group = new THREE.Group();
  private readonly board = new THREE.Group();
  private readonly tag: THREE.Sprite;
  private readonly ring: THREE.Sprite = talkRing();
  private talkPhase = 0;
  private readonly rest = new Map<DummyJoint, THREE.Quaternion>();
  private joints: DummyJoints = {};
  private figure: THREE.Group | null = null;
  private blade: THREE.Mesh | null = null;
  /** Plays the body's idle slot on the chest and head, which no pose here drives. */
  private anim: AnimMachine | null = null;
  /** Where the figure stands so its soles are on the ground. */
  private feet = 0;
  private speed = 0;
  private phase = 0;
  /** Whether a row has put it anywhere yet. */
  placed = false;
  shown: OtherShown = { name: '', x: 0, y: 0, z: 0, speed: 0, gait: 'idle', board: false, mounted: false, held: 0, hp: 0, modelled: false, model: '', talking: false };
  /** Its player row's id, which voice names its talker by. */
  readonly id: string;
  constructor(name: string, id: string) {
    this.id = id;
    this.shown = { ...this.shown, name };
    this.tag = nameTag(name);
    buildHoverboard(this.board);
    this.board.visible = false; this.board.position.y = BOARD_LIFT; this.group.name = `Player · ${name}`;
    this.group.add(this.tag, this.ring, this.board);
  }
  /** Stops its idle, when the body goes. */
  undress(): void { this.anim?.dispose(); this.anim = null; }
  /** RP2: the castaway's body, standing on the ground (its soles are at its root), the blade in its right grip, its idle playing. */
  dress(model: CastawayBody): void {
    this.figure = model.root; this.joints = model.joints; this.feet = 0; model.root.position.y = 0;
    this.group.add(model.root, groundContact()); this.shown = { ...this.shown, modelled: true, model: model.id };
    const blade = new THREE.Mesh(new THREE.BoxGeometry(0.05, BLADE, 0.015), new THREE.MeshStandardMaterial({ color: 0xb8c0c8, metalness: 0.7, roughness: 0.4 }));
    this.blade = blade; blade.position.y = BLADE / 2; blade.visible = false; model.mounts.rightHand.add(blade);
    for (const joint of SWUNG) { const bone = model.joints[joint]; if (bone !== undefined) this.rest.set(joint, bone.quaternion.clone()); }
    this.anim = new AnimMachine({ states: {}, loops: ['idle'] }, model.rig); this.anim.base('idle');
  }
  /** Where the row is now, and the limbs that go with it. */
  show(row: Float64Array, dt: number, mounted: boolean): void {
    const x = row[X] ?? 0, y = row[Y] ?? 0, z = row[Z] ?? 0, { group } = this;
    const moved = this.placed && dt > 0 ? Math.hypot(x - group.position.x, z - group.position.z) / dt : 0;
    this.speed += (moved - this.speed) * Math.min(1, dt * SETTLE);
    this.placed = true;
    // A row's yaw is where a player looks, down -z at 0, and the figure faces +z.
    group.position.set(x, y, z); group.rotation.y = (row[YAW] ?? 0) + Math.PI;
    const riding = row[BOARD] === 1, gait = this.speed < WALKS || riding || mounted ? 'idle' : this.speed < RUNS ? 'walk' : 'run';
    this.board.visible = riding;
    if (this.blade !== null) this.blade.visible = !riding && !mounted;
    if (this.figure !== null) this.figure.position.y = this.feet + (riding ? BOARD_LIFT : mounted ? SADDLE_LIFT : 0);
    this.anim?.update(dt);
    this.pose(gait, this.speed, dt);
    if (mounted) { this.bend('leftThigh', SEAT); this.bend('rightThigh', SEAT); this.bend('leftShin', -SEAT); this.bend('rightShin', -SEAT); }
    const { talking: keys } = voiceNear, talking = keys.has(this.id) || keys.has(talkerKey({ body: null, name: this.shown.name }));
    this.ring.visible = talking;
    if (talking) { this.talkPhase = (this.talkPhase + dt * TALK_PULSE) % (Math.PI * 2); this.ring.scale.setScalar(TALK_SIZE * (1 + TALK_SWELL * Math.sin(this.talkPhase))); }
    this.shown = { ...this.shown, x, y, z, speed: this.speed, gait, board: riding, mounted, held: row[HELD] ?? 0, hp: row[HP] ?? 0, talking };
  }
  private bend(joint: DummyJoint, angle: number): void {
    const bone = this.joints[joint], rest = this.rest.get(joint);
    if (bone !== undefined && rest !== undefined) bone.quaternion.copy(rest).multiply(turn.setFromAxisAngle(AXIS, angle));
  }
  private pose(gait: string, speed: number, dt: number): void {
    const running = gait === 'run', swing = gait === 'idle' ? 0 : running ? RUN_SWING : WALK_SWING;
    this.phase = (this.phase + (speed * dt) / (running ? RUN_STRIDE : STRIDE)) % 1;
    const stride = Math.sin(this.phase * Math.PI * 2) * swing, knee = Math.max(0, -stride);
    this.bend('leftThigh', stride); this.bend('rightThigh', -stride);
    this.bend('leftShin', knee); this.bend('rightShin', Math.max(0, stride));
    this.bend('leftUpperArm', -stride * 0.7); this.bend('rightUpperArm', stride * 0.7);
    this.bend('spine', running ? 0.18 : 0);
  }
}

/** Every other player's body, kept to the client's rows. */
export class OtherPlayers {
  private readonly bodies = new Map<number, OtherBody>();
  private readonly client: NetClient;
  private readonly scene: THREE.Object3D;
  private readonly row = new Float64Array(PLAYER_CLASS.row.length);
  /** Where this page's own player stands, for voice's distances (VOICE-POLISH V7); without it voice can't measure. */
  private readonly me: Readonly<THREE.Vector3> | null;
  constructor(client: NetClient, scene: THREE.Object3D, scope: Scope, me: Readonly<THREE.Vector3> | null = null) {
    this.client = client; this.scene = scene; this.me = me;
    scope.onDispose(() => { for (const handle of this.bodies.keys()) this.drop(handle); });
    if (me !== null) scope.onDispose(voiceNear.lend({ distanceTo: talker => this.distanceTo(talker) }));
  }
  /** Metres to a talker's body, as drawn: the body with its row's id, or, from a server that names none, the nearest with its Name. */
  distanceTo(talker: Talker): number | null {
    const { me } = this;
    if (me === null) return null;
    let nearest: number | null = null;
    for (const body of this.bodies.values()) {
      const { shown } = body;
      if ((talker.body === null ? shown.name !== talker.name : body.id !== talker.body) || !body.placed) continue;
      const metres = Math.hypot(shown.x - me.x, shown.y - me.y, shown.z - me.z);
      if (nearest === null || metres < nearest) nearest = metres;
    }
    return nearest;
  }
  /** What a proof reads. */
  get shown(): readonly OtherShown[] { return [...this.bodies.values()].map(body => body.shown); }
  frame(renderTick: number, dt: number): void {
    const { client, bodies, row } = this, own = client.welcome?.handle ?? 0;
    for (const handle of bodies.keys()) if (!client.entities.has(handle)) this.drop(handle);
    for (const [handle, info] of client.entities) {
      if (info.cls.cls !== PLAYER_CLASS.cls || handle === own || !client.interpolator.sample(handle, renderTick, row)) continue;
      (bodies.get(handle) ?? this.enter(handle, String(info.initial['name'] ?? ''), info.id)).show(row, dt, client.riders.has(handle));
    }
  }
  /** RP2: a body is dressed as it enters, from the one shared build; one that fails to build stands with its Name alone. */
  private enter(handle: number, name: string, id: string): OtherBody {
    const body = new OtherBody(name, id);
    this.bodies.set(handle, body); this.scene.add(body.group);
    try { body.dress(castawayBody()); } catch (error) { console.error('[other players]', error); }
    return body;
  }
  private drop(handle: number): void {
    const body = this.bodies.get(handle);
    if (body === undefined) return;
    this.bodies.delete(handle); this.scene.remove(body.group); body.undress();
    // The castaway's mesh and contact disc are shared by every body (userData.shared): only a body's own are freed, its skeleton's
    // bone texture with them. A sprite's geometry is three's own, shared by every sprite.
    body.group.traverse(node => {
      if (node instanceof THREE.SkinnedMesh) node.skeleton.dispose();
      if (node instanceof THREE.Mesh) { const geometry = node.geometry as THREE.BufferGeometry; if (geometry.userData['shared'] !== true) geometry.dispose(); }
      if (node instanceof THREE.Mesh || node instanceof THREE.Sprite) { for (const material of [node.material].flat() as THREE.Material[]) { if (material.userData['shared'] === true) continue; if (material instanceof THREE.SpriteMaterial) material.map?.dispose(); material.dispose(); } }
    });
  }
}
