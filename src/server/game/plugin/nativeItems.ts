import { wetFlight } from '@wildshard/engine/combat/ammo';
import * as v from 'valibot';
import { Vector3 } from 'three';
import type { SimHost, SimValue } from '@wildshard/engine/sim';
import type { AnimalSim } from '@wildshard/engine/entities/AnimalSim';
import type { DamageRequest } from '@wildshard/engine/combat/pipeline';
import { RangedAction } from '@wildshard/engine/combat/Firearm';
import { BowDraw } from '@wildshard/engine/combat/bowDraw';
import { ProjectileSlots, projectileFlightStep, type FlightSlot } from '@wildshard/engine/combat/projectileFlight';
import { ProjectileContact, StoppedProjectileSlots, stoppedProjectileSaved } from '@wildshard/engine/combat/projectileContact';
import { drawnSpreadDegrees, instantSpreadDegrees, shotRandom, shotSpread } from '@wildshard/engine/combat/shotSpread';
import { smoothstep } from '@wildshard/engine/core/noise';
import { worldHit, floorBelow } from '@wildshard/engine/physics/query';
import { fieldGustAt, type WindFieldSpec } from '@wildshard/engine/world/windField';
import { BowWeaponProfileSchema, parseNativeFirearmProfile } from '@wildshard/format/weaponProfiles';
import { NativeRangedRowSchema } from '@wildshard/format/nativeItems';
import { createNativeTargetQueries, type NativeTargetPose, type NativeTargetHit } from './simulation';
import { installNativeSweptMelee, type NativeSweptMeleeOwner } from './nativeSwept';
import { seenBodies, seenRay, seenRequest, seenShift } from './nativeRewind';
import { playerSeats } from './playerSeats';
import { actRoutes } from '@wildshard/engine/sim/actRoutes';
import type { PlayerSim } from '@wildshard/engine/sim/playerSim';

/** A bounded native launcher input. Its slot must resolve to an installed bolt
 * owner; aim is held for this input, fire/reload are presses, never state writes. */
export interface NativeLauncherInput {readonly slot:number;readonly ads:number;readonly pitch:number;readonly fire?:true;readonly reload?:true}
/** Mutable tick data owned by the native input boundary. It contains no clocks or executable shard hooks. */
export interface NativeCombatFrame {
  launchers: NativeLauncherInput[]; attacks: string[]; heavy: { readonly targetId?: string | undefined } | null;
  melee: { attack: string | null; heavy: boolean; heavyTarget: string | null; swing: boolean; pitch: number | null; sprint: boolean; seq: number; viewTick: number };
  /** The command `seq` this tick, which a shot fired on it confirms (J47); 0 off the wire. */
  seq: number;
  /** The tick this command saw the world at (J50); 0 rewinds nothing. */
  viewTick: number;
  /** P1-E3.5: every other player's frame, by id. The lead's holds them; each is filled for its player alone. */
  readonly others: Map<string, NativeCombatFrame>;
  /** Told of each other player's frame as it is read, so that player's motion feeds it (installCombatMotion). */
  seated?: (id: string, own: NativeCombatFrame) => void;
  scripts: Map<string, number>; moveX: number; moveZ: number; yaw: number;
  /** The look pitch a free shot leaves along (P1-E3.2). */
  pitch: number;
  live: Set<number>;
  /** The slots a trigger pull lands on: what is in hand, a swap or no swap (J112: the page's fire disc doesn't wait for one). */
  armed: Set<number>;
  aim: number; adsBlend: number; aimed: number; speedFactor: number | null;
  extraSpread: number; mountSpread: number; ammo: string; rain: number;
  wind: { clock: Readonly<{ time: number; gust: number }>; field: WindFieldSpec; base: number; scale: number } | null;
}
/** A fresh released input frame; a resident fills its same arrays at lend(), never retains a previous tick. */
export function createNativeCombatFrame(): NativeCombatFrame {
  return { launchers: [], attacks: [], heavy: null, melee: { attack: null, heavy: false, heavyTarget: null, swing: false, pitch: null, sprint: false, seq: 0, viewTick: 0 }, seq: 0, viewTick: 0, others: new Map(), scripts: new Map(),
    moveX: 0, moveZ: 0, yaw: 0, pitch: 0, live: new Set(), armed: new Set(), aim: 0.5, adsBlend: 0, aimed: 0,
    speedFactor: 0, extraSpread: 0, mountSpread: 0, ammo: '', rain: 0, wind: null };
}
/** Another player's frame, made on first use. The weather is the world's, read off the lead's. */
export function otherCombatFrame(frame: NativeCombatFrame, id: string): NativeCombatFrame {
  let own = frame.others.get(id);
  if (own === undefined) { own = createNativeCombatFrame(); frame.others.set(id, own); }
  own.rain = frame.rain; own.wind = frame.wind; frame.seated?.(id, own);
  return own;
}
function motion(frame: NativeCombatFrame): number {
  if (frame.speedFactor === null) throw new Error('Native ranged motion requires an authoritative player sample');
  return frame.speedFactor;
}
/** Published numeric contact points. A live joint query cannot overwrite this separate frame. */
export interface NativeRangedVolumes { readonly head: Vector3; readonly rear: Vector3; readonly front: Vector3; readonly left: Vector3; readonly right: Vector3 }
const publications = new WeakMap<AnimalSim, NativeRangedVolumes>();
/** Bind borrowed numeric points, updated by the existing pose publication owner. No callback or pose clock is installed. */
export function bindNativeRangedVolumes(host: SimHost, id: string, points: NativeRangedVolumes): void {
  const body = host.entities.get(id); if (body === undefined) throw new Error('Missing published native item target');
  publications.set(body, points);
}
function published(body: AnimalSim): NativeTargetPose {
  const points = publications.get(body); if (points === undefined) return body;
  return { headWorld: out => out.copy(points.head),
    bodyCapsule: (rear, front) => { rear.copy(points.rear); front.copy(points.front); },
    foreCapsule: (left, right) => { left.copy(points.left); right.copy(points.right); return true; } };
}
const targetQueries = createNativeTargetQueries<AnimalSim>({ pose: published });
/** Same bounded ray/nearest-volume law, reading published contacts in roster order. */
export const nativeRangedHit: (bodies: readonly AnimalSim[], origin: Vector3, direction: Vector3, max: number) => NativeTargetHit<AnimalSim> | null = targetQueries.ray;
type BodyHit = NonNullable<ReturnType<typeof nativeRangedHit>> & { readonly seen?: Vector3 };
const capRear = new Vector3(), capFront = new Vector3();
function hasRibs(body: AnimalSim): body is AnimalSim & { ribsWorld: (out: Vector3) => Vector3 } {
  return 'ribsWorld' in body && typeof body.ribsWorld === 'function';
}
/** Aim at a capsule share or its declared chest. The default keeps the original half-sum arithmetic. */
export function nativeRangedAim(player: PlayerSim, target: AnimalSim, eye: Vector3, forward: Vector3, along = 0.5, height = 1.68, shift: Vector3 | null = null): void {
  const p = player.position; eye.set(p.x, p.y + height, p.z); target.bodyCapsule(capRear, capFront);
  if (along === 2 && hasRibs(target)) target.ribsWorld(forward);
  else if (along === 0.5) forward.addVectors(capRear, capFront).multiplyScalar(0.5);
  else forward.copy(capRear).lerp(capFront, along);
  if (shift !== null) forward.add(shift); // a named body stands where this command saw it (J50)
  forward.sub(eye).normalize();
}
type Policy = v.InferOutput<typeof NativeRangedRowSchema>;
const finite = v.pipe(v.number(), v.finite()), count = v.pipe(finite, v.integer(), v.minValue(0)), vec = v.tuple([finite, finite, finite]);
const queryBodies = new WeakMap<SimHost, AnimalSim[]>();
function bodies(host: SimHost): AnimalSim[] {
  let buffer = queryBodies.get(host); if (buffer === undefined) { buffer = []; queryBodies.set(host, buffer); }
  buffer.length = 0; for (const body of host.entities.values()) buffer.push(body); return buffer;
}
/** The first body along a ray, as `viewTick` saw them or where they stand. Only world geometry stays in the present. */
function bodyAlong(host: SimHost, viewTick: number, from: Vector3, direction: Vector3, distance: number): BodyHit | null {
  const seen = seenBodies(host, viewTick);
  return seen === null ? nativeRangedHit(bodies(host), from, direction, distance) : seenRay(seen, from, direction, distance);
}
/** A free shot's line (P1-E3.2): from the server's own eye, along the commanded look. The client's aim origin is not trusted. */
function lookAlong(player: PlayerSim, frame: NativeCombatFrame, height: number, eye: Vector3, dir: Vector3): void {
  const p = player.position, level = Math.cos(frame.pitch);
  eye.set(p.x, p.y + height, p.z); dir.set(-Math.sin(player.yaw) * level, Math.sin(frame.pitch), -Math.cos(player.yaw) * level);
}
/** A shot left on `seq`: the owner block says so, which is how a client tells a confirmed start from a refused one (P1-E5.3-E5). */
function noteShot(player: PlayerSim, seq: number): void { player.swung(seq, false); }
function windAt(frame: NativeCombatFrame, x: number, z: number, out: Vector3): Vector3 | null {
  const wind = frame.wind; if (wind === null) return null;
  const speed = wind.base + wind.scale * fieldGustAt(x, z, wind.clock.time, wind.clock.gust, wind.field);
  out.x = wind.field.x * speed; out.z = wind.field.z * speed; return out;
}

/** Each ranged item's seats, keyed by the first player's item: how an owner reaches another player's own. */
const seatedBolts = new WeakMap<NativeBoltItem, (player: PlayerSim) => NativeBoltItem>();
const seatedCycles = new WeakMap<NativeCycleItem, (player: PlayerSim) => NativeCycleItem>();
const seatedBows = new WeakMap<NativeBowItem, (player: PlayerSim) => NativeBowItem>();
const seated = <T extends object>(book: WeakMap<T, (player: PlayerSim) => T>, item: T, player: PlayerSim): T => {
  const of = book.get(item); if (of === undefined) throw new Error('Native item has no seats'); return of(player);
};
export function seatedBolt(item: NativeBoltItem, player: PlayerSim): NativeBoltItem { return seated(seatedBolts, item, player); }
export function seatedCycle(item: NativeCycleItem, player: PlayerSim): NativeCycleItem { return seated(seatedCycles, item, player); }
export function seatedBow(item: NativeBowItem, player: PlayerSim): NativeBowItem { return seated(seatedBows, item, player); }

function boltItem(host: SimHost, frame: NativeCombatFrame, row: Policy, input: unknown) : { state: { loaded: boolean; quiver: number; reloading: boolean; reloadProgress: number; ammo: undefined; reserve: number; bolts: number; }; flying: () => number; addBolts: (amount: number) => void; } {
  const raw = parseNativeFirearmProfile(input, 'bolt'), projectile = raw.projectile;
  if (projectile.muzzle === undefined || raw.spreadAxisScale === undefined) throw new Error('Missing bolt launch');
  const p = { ...raw, quiver: raw.magazine + raw.reserve, cooldown: raw.interval, speed: projectile.speed, radius: projectile.radius, muzzle: projectile.muzzle, substeps: projectile.substeps, lifetime: projectile.lifetime, maxFlying: projectile.pool, gravity: projectile.flight.gravity, drag: projectile.flight.drag, spreadAxisScale: raw.spreadAxisScale }, random = (): number => host.rng.stream('gameplay').next();
  const Saved = v.strictObject({ loaded: v.boolean(), quiver: finite, reloading: v.boolean(), reloadT: finite, cooldown: finite, sinceFire: finite,
  bolts: v.pipe(v.array(v.strictObject({ active: v.boolean(), pos: v.tuple([finite, finite, finite]), vel: v.tuple([finite, finite, finite]), age: finite, glanced: v.boolean(), ammo: v.optional(v.picklist(row.ammunition.map(ammo => ammo.id)), row.defaultAmmo), seq: v.optional(count, 0) })),
    v.length(p.maxFlying)) });
  const cone = { radius: p.spreadRadius, axisScale: p.spreadAxisScale };
  const seats = playerSeats(host, (player, first) => {
  const own = first ? frame : otherCombatFrame(frame, player.id);
  if (own.ammo === '') own.ammo = row.defaultAmmo;
  const state = { loaded: true, quiver: p.quiver, reloading: false, reloadProgress: 0, ammo: undefined, reserve: 0,
    get bolts() { return this.quiver; }, set bolts(value: number) { this.quiver = value; } };
  const action = new RangedAction({ state }, { mode: 'quiver', maximum: p.quiver, interval: p.cooldown, reload: p.reload, autoReload: p.autoReload, autoFrom: 'shot' });

  const eye = new Vector3(), fwd = new Vector3(), side = new Vector3(), dir = new Vector3(), seg = new Vector3(), shift = new Vector3();
  /** The view a contact reads: a shot's first tick has the shooter's, and after that it flies the present (§6.2). */
  let view = 0;
  // one request, refilled per hit (the pipeline copies the contact frame and the tags)
  const req: DamageRequest = { source: player.health, sourceTags: row.tags, target: player.health, amount: 0, point: new Vector3(), dir: seg, headshot: false };
  const contacts = new ProjectileContact<Bolt, BodyHit>({
    glance: { lift: row.glance.lift, keep: row.glance.keep, bounce: row.glance.bounce, maxSpeed: row.glance.maxSpeed },
    spentRest: 'upward', impactAfterLift: false, impactOnRepeatedGlance: false,
  }, {
    world: (from, to, radius) => worldHit(host.physics, from, to, radius),
    target: (from, direction, distance) => { const hit = bodyAlong(host, view, from, direction, distance); return hit?.body === null ? null : hit; },
    hit: (bolt, hit, direction) => {
      const body = hit.body; if (body === null) return;
      req.target = body.combatActor(); req.amount = body.damageFor(hit.head, hit.point.distanceTo(player.position)) * ammoDamage(row, bolt.ammo, body.kind) * p.damageScale;
      req.point.copy(hit.point); req.dir.copy(direction); req.headshot = hit.head; req.attackSeq = bolt.seq;
      host.combat.hit(seenRequest(req, hit));
    },
    stop: () => { /* native bolts have no stopped display */ }, rest: () => { /* the spent flight ends here */ },
    impact: () => { /* page-only dust and sound */ }, expire: bolt => { bolt.active = false; },
  });
  const pool = new ProjectileSlots<{ ammo: string; seq: number; firedOn: number }>(p.maxFlying, () => ({ ammo: row.defaultAmmo, seq: 0, firedOn: -1 }), {
    substeps: p.substeps, extent: row.extent, floor: row.floor, lifetime: p.lifetime,
    integrate: (slot, h) => { const mod = ammoFlight(row, slot.ammo, own.rain);
      slot.vel.y -= p.gravity * mod.gravity * h;
      slot.vel.multiplyScalar(1 - p.drag * mod.drag * h * slot.vel.length() * 0.1);
      slot.pos.addScaledVector(slot.vel, h); },
    contact: (bolt, previous) => { view = bolt.firedOn === host.state.tick ? own.viewTick : 0; return contacts.step(bolt, previous, p.radius, 0); },
  });
  const bolts = pool.slots;
  const fire = (target: AnimalSim | null, aimInput?:NativeLauncherInput): void => {
    action.shot();
    if(target!==null)nativeRangedAim(player, target, eye, fwd, own.aim, row.eye, seenShift(host, own.viewTick, target, shift));
    else {
      if(aimInput===undefined)throw new Error('Free launch requires admitted aim');
      eye.copy(player.position);eye.y+=row.eye;
      const horizontal=Math.cos(aimInput.pitch);
      fwd.set(-Math.sin(player.yaw)*horizontal,Math.sin(aimInput.pitch),-Math.cos(player.yaw)*horizontal);
    }
    // the page's hip spread: a random axis across the line, a random fraction of 0.75°
    const spread = (p.spreadAds + (1 - smoothstep(0, 1, aimInput?.ads ?? own.adsBlend)) * (p.spreadHip - p.spreadAds)) * (Math.PI / 180);
    dir.copy(fwd);
    shotSpread(dir, spread, own.seq === 0 ? random : shotRandom(own.seq), cone, side);
    noteShot(player, own.seq);
    const b = pool.take(); b.ammo = own.ammo; b.seq = own.seq; b.firedOn = host.state.tick;
    b.pos.copy(eye).addScaledVector(fwd, p.muzzle); b.vel.copy(dir).multiplyScalar(p.speed);
  };
  return { item: { state, flying: () => bolts.filter(b => b.active).length, addBolts: (amount: number): void => {
    if (!Number.isFinite(amount) || amount < 0) throw new RangeError('Invalid native bolt grant');
    state.quiver = Math.min(p.quiver, state.quiver + amount);
  } }, step: (dt: number): void => {
    const shots = own.armed.has(row.slot) ? own.attacks : [];
    for (let i = 0; i < 1024; i++) {
      const id = shots[i];
      if (id === undefined) break;
      const target = host.entities.get(id);
      if (target !== undefined && action.trigger()) fire(target);
    }
    if(own.armed.has(row.slot))for(const control of own.launchers){
      if(control.slot!==row.slot)continue;
      if(control.reload===true)action.reload();
      if(control.fire===true&&action.trigger())fire(null,control);
    }
    action.advance(dt);
    pool.step(dt);
  },
    snapshot: (): SimValue => ({ loaded: state.loaded, quiver: state.quiver, reloading: state.reloading, ...action.snapshot(), bolts: bolts.map(b => ({ active: b.active, pos: [b.pos.x, b.pos.y, b.pos.z], vel: [b.vel.x, b.vel.y, b.vel.z], age: b.age, glanced: b.glanced, ...(b.ammo === row.defaultAmmo ? {} : { ammo: b.ammo }), ...(b.seq === 0 ? {} : { seq: b.seq }) })) }),
    restore: (value: unknown): void => {
      const saved = v.parse(Saved, value);
      Object.assign(state, { loaded: saved.loaded, quiver: saved.quiver, reloading: saved.reloading }); action.restore(saved);
      saved.bolts.forEach((s, i) => { const b = bolts[i]; if (b !== undefined) { b.active = s.active; b.pos.set(...s.pos); b.vel.set(...s.vel); b.age = s.age; b.glanced = s.glanced; b.ammo = s.ammo; b.seq = s.seq; } });
    } };
  });
  host.onStep(row.step, seats.step, seats.adapter, 'afterBodies');
  seatedBolts.set(seats.lead.item, player => seats.of(player).item);
  return seats.lead.item;
}

function cycleItem(host: SimHost, frame: NativeCombatFrame, row: Policy, input: unknown): NativeCycleItem {
  const profile = parseNativeFirearmProfile(input, 'lever');
  const { lever } = profile;
  if (lever === undefined) throw new Error('Missing cycle profile');
  const Saved = v.strictObject({ tube: v.pipe(count, v.maxValue(profile.magazine - 1)), chambered: v.boolean(), caseInChamber: v.boolean(), hammerCocked: v.boolean(),
  phase: v.picklist(['idle', 'beat', 'cycle', 'reload']), phaseT: finite, fed: count, planned: count, stopAfter: v.boolean(), dryAtStart: v.boolean(),
  reloadProgress: finite, reserve: count, sinceEmpty: finite });
  const random = (): number => host.rng.stream('gameplay').next();
  const cone = { radius: profile.spreadRadius, axisScale: 1 } as const;
  const seats = playerSeats(host, (player, first) => {
  const own = first ? frame : otherCombatFrame(frame, player.id);
  const store = { reserve: profile.reserve }, act = new RangedAction.Cycle(store, { magazine: profile.magazine, reload: profile.reload, ...lever });
  let sinceEmpty = 99;
  const eye = new Vector3(), dir = new Vector3(), across = new Vector3(), end = new Vector3(), shift = new Vector3();
  const req: DamageRequest = { source: player.health, sourceTags: row.tags, target: player.health, amount: 0, point: new Vector3(), dir, headshot: false };
  const hitscan = (target: AnimalSim | null): void => {
    if (target !== null) nativeRangedAim(player, target, eye, dir, own.aim, row.eye, seenShift(host, own.viewTick, target, shift));
    else lookAlong(player, own, row.eye, eye, dir);
    const a = smoothstep(0, 1, own.adsBlend);
    const spread = instantSpreadDegrees(profile.spreadAds, profile.spreadHip, a, 0,
      motion(own), profile.movingSpread, profile.movingAimReduction) * (Math.PI / 180);
    shotSpread(dir, spread, own.seq === 0 ? random : shotRandom(own.seq), cone, across);
    noteShot(player, own.seq);
    const wall = worldHit(host.physics, eye, end.copy(eye).addScaledVector(dir, profile.range), 0);
    const hit = bodyAlong(host, own.viewTick, eye, dir, wall ? wall.distance : profile.range), body = hit?.body ?? null;
    if (hit === null || body === null) return;
    req.target = body.combatActor(); req.amount = body.damageFor(hit.head, hit.distance) * profile.damageScale;
    req.point.copy(hit.point); req.headshot = hit.head; req.attackSeq = own.seq;
    host.combat.hit(seenRequest(req, hit));
  };
  const pull = (target: AnimalSim | null): void => {
    if (act.phase === 'reload') { act.triggerWhileReloading(); return; }
    if (act.phase !== 'idle') return;
    if (!act.chambered) { sinceEmpty = 0; if (act.tube > 0) act.throwLever(); else act.beginReload(); return; }
    act.dropHammer();
    hitscan(target);
  };
  return { item: { act, store }, step: (dt: number): void => {
    if (own.live.has(row.slot)) for (const control of own.launchers) if (control.slot === row.slot && control.reload === true) act.beginReload();
    const armed = own.armed.has(row.slot), shots = armed ? own.attacks : [];
    for (let i = 0; i < 1024; i++) {
      const id = shots[i];
      if (id === undefined) break;
      const target = host.entities.get(id);
      if (target !== undefined) pull(target);
    }
    if (armed && own.melee.swing && !own.melee.heavy) pull(null);
    sinceEmpty += dt;
    for (const _event of act.events(dt, act.wantsAutoReload && sinceEmpty > profile.autoReload && sinceEmpty < (lever.autoReloadClose ?? 0) && own.live.has(row.slot))) { /* Native effects have no presentation. */ }
  },
    snapshot: (): SimValue => ({ tube: act.tube, chambered: act.chambered, caseInChamber: act.caseInChamber, hammerCocked: act.hammerCocked, phase: act.phase, phaseT: act.phaseT,
      fed: act.fed, planned: act.planned, stopAfter: act.stopAfter, dryAtStart: act.dryAtStart, reloadProgress: act.reloadProgress, reserve: store.reserve, sinceEmpty }),
    restore: (value: unknown): void => {
      const s = v.parse(Saved, value);
      Object.assign(act, { tube: s.tube, chambered: s.chambered, caseInChamber: s.caseInChamber, hammerCocked: s.hammerCocked, phase: s.phase, phaseT: s.phaseT,
        fed: s.fed, planned: s.planned, stopAfter: s.stopAfter, dryAtStart: s.dryAtStart, reloadProgress: s.reloadProgress });
      store.reserve = s.reserve; sinceEmpty = s.sinceEmpty;
    } };
  });
  host.onStep(row.step, seats.step, seats.adapter, 'afterBodies');
  seatedCycles.set(seats.lead.item, player => seats.of(player).item);
  return seats.lead.item;
}

const bowSaved = (profile: v.InferOutput<typeof BowWeaponProfileSchema>, capacity: number) => v.strictObject({
  draw: v.strictObject({ drawT: finite, holdT: finite, renockT: finite, tiredT: finite, wasHeld: v.boolean(), needLift: v.boolean(), reachedFull: v.boolean() }),
  arrows: v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(profile.quiver)), aim: v.nullable(v.string()),
  flying: v.pipe(v.array(v.strictObject({ active: v.boolean(), pos: vec, vel: vec, origin: vec, age: finite, glanced: v.boolean(), seq: v.optional(count, 0) })), v.length(profile.pool)),
  stuck: stoppedProjectileSaved(capacity),
});

function bowItem(host: SimHost, frame: NativeCombatFrame, row: Policy, input: unknown) : { draw: BowDraw; state: { arrows: number; aim: string | null; }; flying: () => number; stuck: StoppedProjectileSlots<null, string>; } {
  const profile = v.parse(BowWeaponProfileSchema, input);
  if (row.shaft === undefined) throw new Error('Missing stopped projectile policy');
  const shaft = row.shaft;
  const random = (): number => host.rng.stream('gameplay').next();
  const seats = playerSeats(host, (player, first) => {
  const own = first ? frame : otherCombatFrame(frame, player.id);
  const draw = new BowDraw(profile.draw), state: { arrows: number; aim: string | null } = { arrows: profile.quiver, aim: null };

  const eye = new Vector3(), dir = new Vector3(), across = new Vector3(), seg = new Vector3(), wind = new Vector3(), shift = new Vector3();
  /** The view a contact reads: a shot's first tick has the shooter's, and after that it flies the present (§6.2). */
  let view = 0;
  const stuck = new StoppedProjectileSlots<null, string>({ ...shaft, radius: row.radius }, { feet: player.position,
    floorAt: (x, y, z) => floorBelow(host.physics, x, z, y + 0.3, 60) ?? host.groundHeightAt(x, z),
    body: id => host.entities.get(id), canRecover: () => state.arrows < profile.quiver,
    recover: survived => { if (survived) state.arrows = Math.min(profile.quiver, state.arrows + 1); }, random }, () => null);
  const req: DamageRequest = { source: player.health, sourceTags: row.tags, target: player.health, amount: 0, point: new Vector3(), dir: seg, headshot: false };
  const contacts = new ProjectileContact<Arrow, BodyHit>({
    glance: row.glance, spentRest: 'any', impactAfterLift: false, impactOnRepeatedGlance: false,
  }, {
    world: (from, to, radius) => worldHit(host.physics, from, to, radius),
    target: (from, direction, distance) => { const hit = bodyAlong(host, view, from, direction, distance); return hit?.body === null ? null : hit; },
    hit: (arrow, hit, direction) => {
      const body = hit.body; if (body === null) return;
      req.target = body.combatActor(); req.amount = Math.max(1, Math.round(body.damageFor(hit.head, hit.point.distanceTo(arrow.origin)) * profile.damageScale));
      req.point.copy(hit.point); req.dir.copy(direction); req.headshot = hit.head; req.attackSeq = arrow.seq;
      host.combat.hit(seenRequest(req, hit));
      stuck.stop(hit.point, direction, true, body.alive ? body.entityId : null);
      if (!body.alive) stuck.dropLast();
    },
    stop: (_arrow, at, direction) => { stuck.stop(at, direction, false, null); },
    rest: (_arrow, at, direction) => { stuck.settle(at, direction); },
    impact: () => { /* native contacts have no dust or sound */ }, expire: arrow => { arrow.active = false; },
  });
  const pool = new ProjectileSlots<{ origin: Vector3; seq: number; firedOn: number }>(profile.pool, () => ({ origin: new Vector3(), seq: 0, firedOn: -1 }), {
    substeps: profile.substeps, extent: row.extent, floor: row.floor, lifetime: profile.lifetime,
    integrate: (slot, h) => { projectileFlightStep(slot.pos, slot.vel, h, profile.flight,
      windAt(own, slot.pos.x, slot.pos.z, wind)); }, contact: (arrow, previous) => { view = arrow.firedOn === host.state.tick ? own.viewTick : 0; return contacts.step(arrow, previous, row.radius, shaft.length); },
  });
  const arrows = pool.slots;
  const loose = (): void => {
    const target = state.aim === null ? undefined : host.entities.get(state.aim);
    if (target?.alive === true) nativeRangedAim(player, target, eye, dir, own.aim, row.eye, seenShift(host, own.viewTick, target, shift));
    else lookAlong(player, own, row.eye, eye, dir);
    const spread = drawnSpreadDegrees(profile.spread.degrees, profile.spread.aimMultiplier, own.aimed, profile.spread.motion,
      motion(own), own.extraSpread, own.mountSpread);
    shotSpread(dir, spread * (Math.PI / 180), own.seq === 0 ? random : shotRandom(own.seq), profile.spread, across);
    noteShot(player, own.seq);
    const a = pool.take();
    a.pos.copy(eye).addScaledVector(dir, profile.muzzle); a.origin.copy(a.pos); a.vel.copy(dir).multiplyScalar(profile.speedBase + profile.speedDraw); a.seq = own.seq; a.firedOn = host.state.tick;
    state.arrows--;
  };
  return { item: { draw, state, flying: () => arrows.filter(a => a.active).length, stuck }, step: (dt: number): void => {
    const live = own.live.has(row.slot), heavy = live ? own.heavy : null;
    // the hold's named body is the aim the release looses at (a release tick has no hold to name it)
    if (heavy !== null) state.aim = heavy.targetId ?? null;
    if (draw.step(dt, heavy !== null, !live || state.arrows <= 0) === 'loose') loose();
    pool.step(dt);
    stuck.update();
  },
    snapshot: (): SimValue => ({ draw: { ...draw.save() }, arrows: state.arrows, aim: state.aim,
      flying: arrows.map(a => ({ active: a.active, pos: [a.pos.x, a.pos.y, a.pos.z], vel: [a.vel.x, a.vel.y, a.vel.z], origin: [a.origin.x, a.origin.y, a.origin.z], age: a.age, glanced: a.glanced, ...(a.seq === 0 ? {} : { seq: a.seq }) })), stuck: stuck.snapshot(id => id) }),
    restore: (value: unknown): void => {
      const saved = v.parse(bowSaved(profile, shaft.capacity), value);
      draw.load(saved.draw); state.arrows = saved.arrows; state.aim = saved.aim;
      stuck.restore(saved.stuck, id => id);
      saved.flying.forEach((s, i) => { const a = arrows[i]; if (a !== undefined) { a.active = s.active; a.pos.set(...s.pos); a.vel.set(...s.vel); a.origin.set(...s.origin); a.age = s.age; a.glanced = s.glanced; a.seq = s.seq; } });
    } };
  });
  host.onStep(row.step, seats.step, seats.adapter, 'afterBodies');
  seatedBows.set(seats.lead.item, player => seats.of(player).item);
  return seats.lead.item;
}


type Bolt = FlightSlot<{ ammo: string; seq: number; firedOn: number }>;
type Arrow = FlightSlot<{ origin: Vector3; seq: number; firedOn: number }>;
function ammoRow(row: Policy, id: string): Policy['ammunition'][number] {
  const ammo = row.ammunition.find(candidate => candidate.id === id);
  if (ammo === undefined) throw new Error('Undeclared native ammunition');
  return ammo;
}
function ammoFlight(row: Policy, id: string, rain: number): { gravity: number; drag: number } {
  const ammo = ammoRow(row,id);return wetFlight(ammo.flight,ammo.wet,rain);
}
function ammoDamage(row: Policy, id: string, kind: string): number {
  const ammo = ammoRow(row, id); return ammo.targets.includes(kind) ? ammo.damage : 1;
}
/** Existing detached native item handles; their legacy save owners remain independent. */
export type NativeBoltItem = ReturnType<typeof boltItem>;
export interface NativeCycleItem { readonly act: InstanceType<typeof RangedAction.Cycle>; readonly store: { reserve: number } }
export type NativeBowItem = ReturnType<typeof bowItem>;
export type NativeRangedItem = { readonly frame: NativeCombatFrame } & (
  { readonly kind: 'bolt'; readonly item: NativeBoltItem } |
  { readonly kind: 'cycle'; readonly item: NativeCycleItem } |
  { readonly kind: 'bow'; readonly item: NativeBowItem });
const nativeMeleeItems = new WeakMap<SimHost, Map<string, NativeSweptMeleeOwner>>();
export function nativeMeleeItem(host: SimHost, id: string): NativeSweptMeleeOwner {
  const value = nativeMeleeItems.get(host)?.get(id); if (value === undefined) throw new Error('Missing native melee owner'); return value;
}
const nativeRangedItems = new WeakMap<SimHost, Map<number, NativeRangedItem>>();
/** Resolve a native family by its admitted numeric slot. Only the native installer publishes owners. */
/** A slot's installed item, if any: what a net input, which may name any slot, is asked about before it reaches a tick. */
export function nativeRangedItem(host: SimHost, slot: number): NativeRangedItem | undefined { return nativeRangedItems.get(host)?.get(slot); }
export function readNativeRangedItem(host: SimHost, slot: number): NativeRangedItem {
  const item = nativeRangedItems.get(host)?.get(slot);
  if (item === undefined || host.scope.disposed) throw new Error(`Native ranged slot is not installed: ${slot}`);
  return item;
}
/** Data-only installation onto the existing native host. Ranged policies retain the legacy independent save owners;
 * swept policies consume the same frame and synchronously ask the world's existing reaction owner. */
export function installNativeItems(host: SimHost, frame: NativeCombatFrame, row: { readonly kind: 'bolt'; readonly policy: unknown; readonly profile: unknown }): NativeBoltItem;
export function installNativeItems(host: SimHost, frame: NativeCombatFrame, row: { readonly kind: 'cycle'; readonly policy: unknown; readonly profile: unknown }): NativeCycleItem;
export function installNativeItems(host: SimHost, frame: NativeCombatFrame, row: { readonly kind: 'bow'; readonly policy: unknown; readonly profile: unknown }): NativeBowItem;
export function installNativeItems(host: SimHost, frame: NativeCombatFrame, row: { readonly kind: 'swept'; readonly policy: unknown; readonly items: readonly unknown[] }): NativeSweptMeleeOwner;
export function installNativeItems(host: SimHost, frame: NativeCombatFrame, input:
  { readonly kind: 'bolt' | 'cycle' | 'bow'; readonly policy: unknown; readonly profile: unknown } |
  { readonly kind: 'swept'; readonly policy: unknown; readonly items: readonly unknown[] }): NativeBoltItem | NativeCycleItem | NativeBowItem | NativeSweptMeleeOwner {
  if (input.kind === 'swept') {
    const id = v.parse(v.object({ step: v.string() }), input.policy).step, book = nativeMeleeItems.get(host) ?? new Map<string, NativeSweptMeleeOwner>();
    if (book.has(id)) throw new Error('Duplicate native melee owner');
    // opus-slotsync (J293): a page's equip act names a slot in its kit's order; the kit takes the route unless a loadout has it
    const routes = actRoutes(host), swap = routes.equip === null ? (routes.equip = `${id}.equip`) : null;
    const owner = installNativeSweptMelee(host, input.items, input.policy, {
    input: (player, first) => first ? frame.melee : otherCombatFrame(frame, player.id).melee,
    pick: (player, first) => swap === null || routes.equip !== swap ? undefined : (first ? frame : otherCombatFrame(frame, player.id)).scripts.get(swap) ?? null,
    refused: () => { routes.refused++; },
    alarm: () => { host.events.ask('item.reaction', { kind: 'alarm' }); },
    staggered: (actor, strength, running) => { host.events.ask('item.reaction', { kind: 'stagger', actor, strength, running }); },
  });
    book.set(id, owner); nativeMeleeItems.set(host, book); host.scope.onDispose(() => { book.delete(id); }); return owner;
  }
  const row = v.parse(NativeRangedRowSchema, input.policy);
  let entries = nativeRangedItems.get(host);
  if (entries === undefined) { entries = new Map(); nativeRangedItems.set(host, entries); host.scope.onDispose(() => { nativeRangedItems.delete(host); }); }
  if (entries.has(row.slot)) throw new Error(`Native ranged slot is already installed: ${row.slot}`);
  const installed: NativeRangedItem = input.kind === 'bow' ? { kind: 'bow', item: bowItem(host, frame, row, input.profile), frame }
    : input.kind === 'cycle' ? { kind: 'cycle', item: cycleItem(host, frame, row, input.profile), frame }
    : { kind: 'bolt', item: boltItem(host, frame, row, input.profile), frame };
  entries.set(row.slot, installed);
  return installed.item;
}
