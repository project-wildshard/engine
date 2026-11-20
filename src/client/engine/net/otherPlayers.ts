// E7.6 (Q87): everyone else in this world, drawn from their rows. A body walks, runs and stands by how fast its row moves, rides its
// board by the row's word and holds what the row says. The body is the castaway (RP2, models/castawayBody.ts), one shared mesh on
// a skeleton of its own, its limbs moved here, and its Name over it.
import * as THREE from 'three';
import type { Scope } from '../../../shared/engine/app/scope';
import { PLAYER_CLASS, roadPlaceOf } from '../../../shared/engine/net/netSchemas';
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
import { HeldInHand, heldOnOthers } from './heldOnOthers';
import type { NetClient, NetEntityInfo } from './client';
import { othersOnMap } from './othersOnMap';
import { talkerKey, voiceNear, type Talker } from './voiceNear';
import { SoftCollide, type SoftBody, type SoftSelf } from './softCollide';
import { warmDrawn, warmPaceOn } from './warmPace';

const column = (name: string): number => PLAYER_CLASS.row.findIndex(entry => entry.name === name);
const X = column('x'), Y = column('y'), Z = column('z'), YAW = column('yaw'), BOARD = column('board'), HELD = column('held'), HP = column('hp'), SWIM = column('swim');
/** RP9: the row's airborne bit (RP6); a build without the column reads no data. */
const AIR = column('air');
/**
 * MMO-PLAN MP1.5b: a row on a road (frame 0, the world's) carries its place in `roadX`/`roadZ`, where `x`/`z` clamp at ±260 m. A cell's
 * rows send zero, and a room older than wire 1.2 sends neither, which reads as the node's floor, -2,048 m, outside the grid.
 */
const ROAD_X = column('roadX'), ROAD_Z = column('roadZ');
/** Where a row stands across the ground, its road place when it has one. */
export function placeOf(row: ArrayLike<number>): { readonly x: number; readonly z: number } {
  return roadPlaceOf(row[ROAD_X], row[ROAD_Z]) ?? { x: row[X] ?? 0, z: row[Z] ?? 0 };
}
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
/** MIRROR-SALT-ZONE MSZ10: a seated body's thighs (forward) and knees, its upper arms and elbows holding a wheel or a tiller
 *  at chest height, in radians (the rig has no sit clip yet); its hips `lift` m over the seat's base. A `stand` seat (the
 *  land-sail's) gives its knees a little give (`stand`) and the same hands. Blind look board, 2026-11-19: the first arms
 *  reached straight out flat and the hips sat 10 cm low. */
const SIT = { thigh: 1.45, shin: -1.45, upperArm: 0.55, foreArm: 1.35, lift: 0.11 } as const;
const STAND = { thigh: 0.18, shin: -0.36 } as const;
/** MSZ10: another player in a vehicle's seat, as the page's vehicles say it: the vehicle's heading and the seat's pose. */
export interface OtherSeat { readonly yaw: number; readonly pose: 'sit' | 'stand' }
const AXIS = new THREE.Vector3(1, 0, 0), turn = new THREE.Quaternion();
/** Row 54: s another body is drawn behind this page's present past the interpolation delay (its own commands' trip to the
 *  server); the soft collision leads it by both. */
const LINK_LEAD = 0.05;

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
  readonly death: DeathPhase;
  /** MSZ10: its seat's pose in a vehicle ('sit', 'stand'), or '' out of one. */
  readonly seated: '' | OtherSeat['pose'] }

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
  /** MSZ10: its hips over its soles at rest: a seat's base is where they sit. */
  private hips = 0.9;
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
  shown: OtherShown = { name: '', x: 0, y: 0, z: 0, speed: 0, gait: 'idle', board: false, mounted: false, held: 0, hp: 0, modelled: false, model: '', talking: false, item: '', air: '', attack: '', death: '', seated: '' };
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
    const thigh = model.joints.leftThigh;
    if (thigh !== undefined) { model.root.updateMatrixWorld(true); this.hips = thigh.getWorldPosition(new THREE.Vector3()).y - model.root.getWorldPosition(new THREE.Vector3()).y; }
  }
  /** Where the row is now, and the limbs that go with it. */
  show(row: Float64Array, dt: number, mounted: boolean, seat: OtherSeat | null = null): void {
    // RP11: a dead body holds where it fell and a return or a teleport snaps (remoteDeath.ts), so neither slides nor runs.
    const place = placeOf(row), at = this.death.place(place.x, row[Y] ?? 0, place.z, row[YAW] ?? 0, row[HP] ?? 0, dt), { x, y, z } = at, { group } = this, alive = this.death.phase === '';
    const moved = this.placed && dt > 0 && !at.snap ? Math.hypot(x - group.position.x, z - group.position.z) / dt : 0;
    if (at.snap) this.speed = 0;
    this.speed += (moved - this.speed) * Math.min(1, dt * SETTLE);
    this.placed = true;
    // A row's yaw is where a player looks, down -z at 0, and the figure faces +z.
    // MSZ10: a seated body faces its vehicle's heading, wherever its player looks
    const seated = alive && seat !== null ? seat.pose : '';
    group.position.set(x, y, z); group.rotation.y = (seated !== '' && seat !== null ? seat.yaw : at.yaw) + Math.PI;
    // RP4: a rider's legs stand still whatever the row's speed; on foot the speed picks and blends the clip.
    const riding = alive && row[BOARD] === 1, still = riding || mounted || seated !== '', onFoot = still ? 0 : this.speed, gait = gaitOf(onFoot);
    const held = row[HELD] ?? 0;
    this.hand?.show(held, alive && !still && row[SWIM] !== 1, dt); // RP5: nothing in hand on a board, in a saddle, a seat or swimming
    this.anim?.update(dt);
    const air = this.air.update(AIR < 0 || Number.isNaN(row[AIR] ?? Number.NaN) ? undefined : row[AIR] === 1, y, dt, still || !alive); // RP9
    if (this.shown.air !== air) this.shown = { ...this.shown, air };
    const drop = this.pose(onFoot, dt);
    if (this.figure !== null) this.figure.position.y = this.feet + (riding ? BOARD_LIFT : mounted ? SADDLE_LIFT : seated === 'sit' ? SIT.lift - this.hips : seated === 'stand' ? -0.03 : -drop);
    if (mounted) { this.bend('leftThigh', SEAT); this.bend('rightThigh', SEAT); this.bend('leftShin', -SEAT); this.bend('rightShin', -SEAT); }
    if (seated !== '') this.sit(seated);
    this.strike.show(row, alive && !still && row[SWIM] !== 1, dt, this.joints, this.rest); // RP7: after the gait and air poses
    this.board.show(riding, at.yaw, this.speed, dt, this.figure, this.joints); // RP8: the deck, banked, the rider side-on on it
    this.death.layer(group, this.figure, this.tag); // RP11: last, laid down, faded, its Name dimmed
    this.hurt.update(dt); // RP10
    const { talking: keys } = voiceNear, talking = alive && (keys.has(this.id) || keys.has(talkerKey({ body: null, name: this.shown.name })));
    this.ring.visible = talking;
    if (talking) { this.talkPhase = (this.talkPhase + dt * TALK_PULSE) % (Math.PI * 2); this.ring.scale.setScalar(TALK_SIZE * (1 + TALK_SWELL * Math.sin(this.talkPhase))); }
    this.shown = { ...this.shown, x, y, z, speed: this.speed, gait, board: riding, mounted, held, hp: row[HP] ?? 0, talking, item: this.hand?.row ?? '', attack: this.strike.playing, death: this.death.phase, seated };
  }
  /** MSZ10: a seat's pose over the still gait: knees bent on a seat (`sit`) or softly standing, and either way both hands on the controls. */
  private sit(pose: OtherSeat['pose']): void {
    const legs = pose === 'sit' ? SIT : STAND;
    this.bend('leftThigh', legs.thigh); this.bend('rightThigh', legs.thigh); this.bend('leftShin', legs.shin); this.bend('rightShin', legs.shin);
    this.bend('leftUpperArm', SIT.upperArm); this.bend('rightUpperArm', SIT.upperArm); this.bend('leftForeArm', SIT.foreArm); this.bend('rightForeArm', SIT.foreArm);
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
/** A body leaving: the castaway's mesh and contact disc are shared by every body (userData.shared), so only its own are freed, its
 *  skeleton's bone texture with them. A sprite's geometry is three's own, shared by every sprite. Its held item, the kit's copy,
 *  is let go of first (`undress`). */
function freeBody(group: THREE.Object3D): void {
  group.traverse(node => {
    if (node instanceof THREE.SkinnedMesh) node.skeleton.dispose();
    if (node instanceof THREE.Mesh) { const geometry = node.geometry as THREE.BufferGeometry; if (geometry.userData['shared'] !== true) geometry.dispose(); }
    if (node instanceof THREE.Mesh || node instanceof THREE.Sprite) { for (const material of [node.material].flat() as THREE.Material[]) { if (material.userData['shared'] === true) continue; if (material instanceof THREE.SpriteMaterial) material.map?.dispose(); material.dispose(); } }
  });
}

/** NET-LAG NL4: the warm body's depth under the world, out of every view; its slots tried for the kit's held items. */
const WARM_DEPTH = -1000, WARM_SLOTS = 16;
/**
 * NET-LAG NL4 (Jake's 60 ms frames in Driftwood): the first other player to come into view linked its body's programs inside
 * that frame, the castaway's skinned body, its contact disc, its Name and the held item in the world's light (the item's
 * first-person program is another): 4 programs in a 200 ms frame, 20 in a 440 ms one, on desktop Chromium's Metal. One body
 * of the same build is drawn from the start, under the world, never culled, so the boot's in-play warm-up links those
 * programs paced and every body after it draws with programs already built (three keys a program by its material's settings,
 * so a body's own deck materials share the warm deck's). It holds every slot of the kit lent now, and
 * takes the new kit's items when a crossing lends one (the old copies are freed with their kit).
 */
class WarmBody {
  readonly group = new THREE.Group();
  private readonly hand: THREE.Object3D | null;
  private readonly items = new THREE.Group();
  private kit = -1;
  constructor(onFilled?: (group: THREE.Group) => void) {
    this.onFilled = onFilled;
    this.group.name = 'other-player-warm'; this.group.position.y = WARM_DEPTH;
    const model = castawayBody(), board = new BoardUnder();
    board.deck.visible = true; // a rider's deck, shown here so its programs warm too
    this.group.add(model.root, groundContact(), nameTag('warm'), board.deck);
    this.hand = model.mounts.rightHand;
    this.hand.add(this.items);
    this.unculled();
  }
  private slot = WARM_SLOTS;
  /** DF10: drawn on a pace once settled (warmPace.ts); frames since its hand filled, -1 before */
  private readonly paced = warmPaceOn();
  private filled = -1;
  /** NET-LAG NL15: asked for the body's road (exterior) variants once a kit's items are all in its hand. */
  private readonly onFilled: ((group: THREE.Group) => void) | undefined;
  /** Each frame: a newly lent kit's items replace the last's, one slot a frame (each first copy clones a first-person model).
   *  Filled, the body asks for its road variants: the items came after the boot's road warm-up took its inventory, and on the
   *  road (no environment) the held sword linked its opaque program inside one frame (283 to 450 ms, Driftwood's boost). */
  frame(): void {
    if (this.kit !== heldOnOthers.lent) { this.kit = heldOnOthers.lent; this.items.clear(); this.slot = 0; this.filled = -1; }
    if (this.paced) { if (this.filled >= 0) this.filled++; this.group.visible = this.filled < 0 || warmDrawn(true, this.filled); }
    if (this.slot >= WARM_SLOTS) return;
    const held = heldOnOthers.prop(this.slot++);
    if (held !== null) { const item = held.prop.clone(); item.traverse(node => { node.frustumCulled = false; }); this.items.add(item); }
    if (this.slot === WARM_SLOTS) { this.filled = 0; this.onFilled?.(this.group); }
  }
  /** Drawn wherever the camera looks, so the warm-up and every frame count its programs as used. */
  private unculled(): void { this.group.traverse(node => { node.frustumCulled = false; }); }
  dispose(): void { this.group.removeFromParent(); this.items.clear(); freeBody(this.group); }
}

export class OtherPlayers {
  private readonly bodies = new Map<number, OtherBody>();
  private readonly warm: WarmBody | null = null;
  private readonly client: NetClient;
  private readonly scene: THREE.Object3D;
  private readonly row = new Float64Array(PLAYER_CLASS.row.length);
  /** MSZ10: a player's seat in a vehicle, by its row's id, as the page's vehicles say it; none by default. */
  seats: (id: string) => OtherSeat | null = () => null;
  /** Where this page's own player stands, for voice's distances (VOICE-POLISH V7); without it voice can't measure. */
  private readonly me: Readonly<THREE.Vector3> | null;
  /** `warmRoad`: link these roots' road (exterior) variants in play, paced (Game.warmExteriorRoots); the warm body asks once
   *  its hand holds the lent kit. */
  constructor(client: NetClient, scene: THREE.Object3D, scope: Scope, me: Readonly<THREE.Vector3> | null = null,
    warmRoad?: (roots: readonly THREE.Object3D[]) => void) {
    this.client = client; this.scene = scene; this.me = me;
    scope.onDispose(() => { for (const handle of this.bodies.keys()) this.drop(handle); });
    try { const warm = new WarmBody(warmRoad === undefined ? undefined : group => { warmRoad([group]); }); scene.add(warm.group); this.warm = warm; scope.onDispose(() => { warm.dispose(); }); }
    catch (error) { console.error('[other players] warm body', error); }
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
  /** QA-FEEDBACK-2026-11-19 row 54: this page's player doesn't walk through these bodies (softCollide.ts). The page asks it to
   *  bend each step's move (`soft.bend`) and calls `collide` once a frame, after `frame`. */
  readonly soft: SoftCollide = new SoftCollide();
  private readonly solid: SoftBody[] = [];
  /** Once a frame, after `frame`: the soft collision reads every body where it is drawn now (its interpolated row, never a raw
   *  snapshot), placed, alive and not in a saddle. `active` false (this player on a board, in water, in a saddle) lets go. */
  collide(self: SoftSelf, dt: number, active: boolean): void {
    const { solid } = this;
    let count = 0;
    if (active) for (const [key, { placed, shown }] of this.bodies) {
      if (!placed || shown.mounted || shown.death !== '' || shown.hp <= 0) continue;
      const at = solid[count] ??= { key: 0, x: 0, y: 0, z: 0 };
      at.key = key; at.x = shown.x; at.y = shown.y; at.z = shown.z; count++;
    }
    solid.length = count;
    this.soft.frame(self, solid, dt, active, this.client.clock.delayMs / 1000 + LINK_LEAD);
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
  /** @frame */
  frame(renderTick: number, dt: number): void {
    this.warm?.frame();
    const { client, bodies } = this;
    if (bodies.size > 0) for (const handle of bodies.keys()) if (!client.entities.has(handle)) this.drop(handle);
    // STR20: every net entity (creatures and movers too) is visited each frame; `forEach` with one made visitor walks the
    // map with no entry pairs, where `for ... of` made one per entity
    this.tick = renderTick; this.dt = dt; this.own = client.welcome?.handle ?? 0;
    client.entities.forEach(this.visit);
    othersOnMap.update(bodies.values()); // REMOTE-PLAYERS RP3: the minimap draws each body where it stands, facing its way
  }
  private tick = 0;
  private dt = 0;
  private own = 0;
  /** one entity of `frame`'s walk: a player's body follows its sampled row @frame */
  private readonly visit = (info: NetEntityInfo, handle: number): void => {
    const { client, bodies, row } = this;
    if (info.cls.cls !== PLAYER_CLASS.cls || handle === this.own || !client.interpolator.sample(handle, this.tick, row)) return;
    (bodies.get(handle) ?? this.enter(handle, String(info.initial['name'] ?? ''), info.id)).show(row, this.dt, client.riders.has(handle), this.seats(info.id));
  };
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
    freeBody(body.group);
  }
}
