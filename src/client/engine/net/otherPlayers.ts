// E7.6 (Q87): everyone else in this world, drawn from their rows. A body walks, runs and stands by how fast its row moves, rides its
// board by the row's word and holds what the row says. The body is the castaway (RP2, models/castawayBody.ts), one shared mesh on
// a skeleton of its own, its limbs moved here, and its Name over it.
import * as THREE from 'three';
import type { Scope } from '../../../shared/engine/app/scope';
import { PLAYER_CLASS } from '../../../shared/engine/net/netSchemas';
import type { DummyJoint, DummyJoints } from '../practice/TrainingDummy';
import { castawayBody, groundContact, type CastawayBody } from '../models/castawayBody';
import { AnimMachine } from '../anim/machine';
import { gaitMix, gaitOf, STRIDE_JOINTS, stridePose, stridePoseAtRest } from './remoteGait';
import { AirPose, type AirPhase } from './remoteAir';
import { BoardUnder, DECK_LIFT } from './remoteBoard';
import { RemoteStrike } from './remoteStrike';
import { NameTag, type NameTagShown } from './nameTag';
import { RemoteDeath, type DeathPhase } from './remoteDeath';
import { RemoteHurt, type HurtShown } from './remoteHurt';
import { HeldInHand } from './heldOnOthers';
import type { NetClient } from './client';
import { othersOnMap } from './othersOnMap';
import { talkerKey, voiceNear, type Talker } from './voiceNear';

const column = (name: string): number => PLAYER_CLASS.row.findIndex(entry => entry.name === name);
const X = column('x'), Y = column('y'), Z = column('z'), YAW = column('yaw'), BOARD = column('board'), HELD = column('held'), HP = column('hp'), SWIM = column('swim');
/** RP9: the row's airborne bit (RP6); a build without the column reads no data. */
const AIR = column('air');
/** A body's speed settles at this rate, so one late row is no stumble. */
const SETTLE = 8;
/** VOICE-POLISH V8: the ring over a talking player's Name, its size in metres, and how fast and far it breathes. */
const TALK_HEIGHT = 2.62, TALK_SIZE = 0.5, TALK_PULSE = 9, TALK_SWELL = 0.1;
/** How far a board floats, with its rider on it (RP8: the deck's own lift). */
const BOARD_LIFT = DECK_LIFT;
/** How high a rider's feet sit over the row, which stands at the horse's own feet. */
const SADDLE_LIFT = 0.85;
/** A rider's knees, in radians. The row it rides moves the body. */
const SEAT = 1.2;
const AXIS = new THREE.Vector3(1, 0, 0), turn = new THREE.Quaternion();

/** A Name as a sprite: it reads the same on any shard, and it needs no DOM over the canvas. RP12: sharp on a phone, sized by
 *  distance within its clamps, clear of the head, gone past 60 m (nameTag.ts). */
function nameTag(name: string): NameTag {
  return new NameTag(name);
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
export interface OtherShown { readonly name: string; readonly x: number; readonly y: number; readonly z: number; readonly speed: number; readonly gait: string; readonly board: boolean; readonly mounted: boolean; readonly held: number; readonly hp: number; readonly modelled: boolean; readonly model: string; readonly talking: boolean;
  /** RP9: its jump, fall or landing ('jump', 'fall', 'land'), or '' on the ground. */
  readonly air: AirPhase;
  /** RP5: the item drawn in the hand for `held` (its row), or '' for an empty hand. */
  readonly item: string;
  /** RP7: the strike playing on its arms ('tap', 'heavy', a bow's 'draw'), or ''. */
  readonly attack: string;
  /** RP11: its death ('fall', 'lie', 'fade', 'gone') and return ('rise'), or '' alive. */
  readonly death: DeathPhase }

/** One other player on screen. */
class OtherBody {
  readonly group: THREE.Group = new THREE.Group();
  /** RP8: the world-scale board under it while its row hovers, banking into turns. */
  private readonly board = new BoardUnder();
  /** RP12: its Name, which fits itself to every draw and says what it drew. */
  readonly tag: NameTag;
  private readonly ring: THREE.Sprite = talkRing();
  private talkPhase = 0;
  private readonly rest = new Map<DummyJoint, THREE.Quaternion>();
  private joints: DummyJoints = {};
  private figure: THREE.Group | null = null;
  /** RP5: the item in its hand, the page's own first-person model of what its row holds. */
  private hand: HeldInHand | null = null;
  /** Plays the body's idle slot on the chest and head, which no pose here drives. */
  private anim: AnimMachine | null = null;
  /** Where the figure stands so its soles are on the ground. */
  private feet = 0;
  private speed = 0;
  /** RP4: where the body is in its stride (0 to 1, the left foot down at 0), and its pose there. */
  private phase = 0;
  private readonly stride = stridePoseAtRest();
  /** RP9: its jump, fall and landing, over the gait (remoteAir.ts). */
  private readonly air = new AirPose();
  /** RP7: its swings, on its arms and spine over the gait. */
  private readonly strike = new RemoteStrike();
  /** RP11: its death where it fell and its return at its checkpoint, last over every other pose. */
  private readonly death = new RemoteDeath();
  /** RP10: its red flash and numbers when something hits it. */
  readonly hurt = new RemoteHurt(this.group);
  /** Whether a row has put it anywhere yet. */
  placed = false;
  shown: OtherShown = { name: '', x: 0, y: 0, z: 0, speed: 0, gait: 'idle', board: false, mounted: false, held: 0, hp: 0, modelled: false, model: '', talking: false, item: '', air: '', attack: '', death: '' };
  /** Its player row's id, which voice names its talker by. */
  readonly id: string;
  constructor(name: string, id: string) {
    this.id = id;
    this.shown = { ...this.shown, name };
    this.tag = nameTag(name);
    this.group.name = `Player · ${name}`;
    this.group.add(this.tag, this.ring, this.board.deck);
  }
  /** Stops its idle and lets go of its item (the page's own, never freed with the body), when the body goes; RP10: frees its flash copy. */
  undress(): void { this.anim?.dispose(); this.anim = null; this.hand?.drop(); this.hurt.dispose(); }
  /** RP2: the castaway's body, standing on the ground (its soles are at its root), its hands ready for the held item (RP5), its idle playing. */
  dress(model: CastawayBody): void {
    this.figure = model.root; this.joints = model.joints; this.feet = 0; model.root.position.y = 0;
    this.group.add(model.root, groundContact()); this.shown = { ...this.shown, modelled: true, model: model.id };
    this.hand = new HeldInHand({ right: model.mounts.rightHand, left: model.mounts.leftHand });
    for (const joint of STRIDE_JOINTS) { const bone = model.joints[joint]; if (bone !== undefined) this.rest.set(joint, bone.quaternion.clone()); }
    this.anim = new AnimMachine({ states: {}, loops: ['idle'] }, model.rig); this.anim.base('idle');
    this.board.fit(model.joints);
  }
  /** Where the row is now, and the limbs that go with it. */
  show(row: Float64Array, dt: number, mounted: boolean): void {
    // RP11: a dead body holds where it fell and a return or a teleport snaps (remoteDeath.ts), so neither slides nor runs.
    const at = this.death.place(row[X] ?? 0, row[Y] ?? 0, row[Z] ?? 0, row[YAW] ?? 0, row[HP] ?? 0, dt), { x, y, z } = at, { group } = this, alive = this.death.phase === '';
    const moved = this.placed && dt > 0 && !at.snap ? Math.hypot(x - group.position.x, z - group.position.z) / dt : 0;
    if (at.snap) this.speed = 0;
    this.speed += (moved - this.speed) * Math.min(1, dt * SETTLE);
    this.placed = true;
    // A row's yaw is where a player looks, down -z at 0, and the figure faces +z.
    group.position.set(x, y, z); group.rotation.y = at.yaw + Math.PI;
    // RP4: a rider's legs stand still whatever the row's speed; on foot the speed picks and blends the clip.
    const riding = alive && row[BOARD] === 1, onFoot = riding || mounted ? 0 : this.speed, gait = gaitOf(onFoot);
    const held = row[HELD] ?? 0;
    this.hand?.show(held, alive && !riding && !mounted && row[SWIM] !== 1, dt); // RP5: nothing in hand on a board, in a saddle or swimming
    this.anim?.update(dt);
    const air = this.air.update(AIR < 0 || Number.isNaN(row[AIR] ?? Number.NaN) ? undefined : row[AIR] === 1, y, dt, riding || mounted || !alive); // RP9
    if (this.shown.air !== air) this.shown = { ...this.shown, air };
    const drop = this.pose(onFoot, dt);
    if (this.figure !== null) this.figure.position.y = this.feet + (riding ? BOARD_LIFT : mounted ? SADDLE_LIFT : -drop);
    if (mounted) { this.bend('leftThigh', SEAT); this.bend('rightThigh', SEAT); this.bend('leftShin', -SEAT); this.bend('rightShin', -SEAT); }
    this.strike.show(row, alive && !riding && !mounted && row[SWIM] !== 1, dt, this.joints, this.rest); // RP7: after the gait and air poses
    this.board.show(riding, at.yaw, this.speed, dt, this.figure, this.joints); // RP8: the deck, banked, the rider side-on on it
    this.death.layer(group, this.figure, this.tag); // RP11: last, laid down, faded, its Name dimmed
    this.hurt.update(dt); // RP10
    const { talking: keys } = voiceNear, talking = alive && (keys.has(this.id) || keys.has(talkerKey({ body: null, name: this.shown.name })));
    this.ring.visible = talking;
    if (talking) { this.talkPhase = (this.talkPhase + dt * TALK_PULSE) % (Math.PI * 2); this.ring.scale.setScalar(TALK_SIZE * (1 + TALK_SWELL * Math.sin(this.talkPhase))); }
    this.shown = { ...this.shown, x, y, z, speed: this.speed, gait, board: riding, mounted, held, hp: row[HP] ?? 0, talking, item: this.hand?.row ?? '', attack: this.strike.playing, death: this.death.phase };
  }
  /** RP11: the server says a blow killed it. */
  killed(): void { this.death.killed(); }
  private bend(joint: DummyJoint, angle: number): void {
    const bone = this.joints[joint], rest = this.rest.get(joint);
    if (bone !== undefined && rest !== undefined) bone.quaternion.copy(rest).multiply(turn.setFromAxisAngle(AXIS, angle));
  }
  /** RP4: the walk and run clips (remoteGait.ts), at a cadence matched to `speed` so a planted foot stays put; the hips' drop. */
  private pose(speed: number, dt: number): number {
    const mix = gaitMix(speed);
    this.phase = (this.phase + (speed * dt) / mix.stride) % 1;
    const { bends, drop } = this.air.layer(stridePose(this.phase, mix, this.stride)); // RP9: the air pose over the gait
    for (const joint of STRIDE_JOINTS) this.bend(joint, bends[joint]);
    this.air.spreadArms(this.joints);
    return drop;
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
  get shown(): readonly (OtherShown & { readonly tag: NameTagShown; readonly hurt: HurtShown })[] {
    const shown: (OtherShown & { readonly tag: NameTagShown; readonly hurt: HurtShown })[] = [];
    for (const body of this.bodies.values()) shown.push({ ...body.shown, tag: body.tag.report, hurt: body.hurt.report }); // RP12: what its Name drew; RP10: its hurt
    return shown;
  }
  /** RP10: something hit the player at `handle` for `amount`: its body flashes and a red number pops; false when none is drawn.
   *  RP11: a blow that `killed` lays it down where it stands. */
  hurt(handle: number, amount: number, killed = false): boolean {
    const body = this.bodies.get(handle);
    body?.hurt.hit(amount);
    if (killed) body?.killed();
    return body !== undefined;
  }
  frame(renderTick: number, dt: number): void {
    const { client, bodies, row } = this, own = client.welcome?.handle ?? 0;
    for (const handle of bodies.keys()) if (!client.entities.has(handle)) this.drop(handle);
    for (const [handle, info] of client.entities) {
      if (info.cls.cls !== PLAYER_CLASS.cls || handle === own || !client.interpolator.sample(handle, renderTick, row)) continue;
      (bodies.get(handle) ?? this.enter(handle, String(info.initial['name'] ?? ''), info.id)).show(row, dt, client.riders.has(handle));
    }
    othersOnMap.update(bodies.values()); // REMOTE-PLAYERS RP3: the minimap draws each body where it stands, facing its way
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
