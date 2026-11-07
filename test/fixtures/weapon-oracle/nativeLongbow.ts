// Frozen native installer at 28bc7527b, before data-frame adoption. Test oracle only.
import { BOW_PROFILE } from '../../../src/shards/pine-hollow/generators/bowProfile';
import { BowWeaponProfileSchema } from '@wildshard/format/weaponProfiles';
import * as v from 'valibot';
import { Vector3 } from 'three';
import type { SimHost } from '@wildshard/engine/sim';
import type { AnimalSim } from '@wildshard/engine/entities/AnimalSim';
import type { DamageRequest } from '@wildshard/engine/combat/pipeline';
import { BowDraw } from '@wildshard/engine/combat/bowDraw';
import { projectileFlightStep, ProjectileSlots, type FlightSlot } from '@wildshard/engine/combat/projectileFlight';
import { ProjectileContact, StoppedProjectileSlots, stoppedProjectileSaved } from '@wildshard/engine/combat/projectileContact';
import { drawnSpreadDegrees, shotSpread } from '@wildshard/engine/combat/shotSpread';
import { worldHit, floorBelow } from '@wildshard/engine/physics/query';
import { EYE, aimAt, bodyHit, type BodyHit } from './headlessRanged';
import { leadPlayer } from '@wildshard/engine/sim/leadPlayer';

/** The longbow's fixed-step id; its continuation is the draw, the quiver, the aim and every arrow in flight. */
export const LONGBOW_STEP = 'pine.longbow';
/** The arrow pool's loop bound (ARROW_MAX_FLYING slots, well under it). Bow.ts launchFrom: the arrow starts this far down the aim line; the loose's cone (°, hip, standing). Projectiles: four
 *  substeps a tick, the broadhead's 2 cm ball, dead past the chunk + 80 m, below -150 m or after 12 s. */
const RADIUS = 0.02, BOUND = 250 + 80, FLOOR = -150;
/** Projectiles' glance off a hard surface: lift off it, keep a little of the speed, a small bounce, a speed cap. */
const GLANCE_LIFT = 0.03, GLANCE_KEEP = 0.35, GLANCE_BOUNCE = 0.25, GLANCE_MAX = 9;
const GLANCE = { lift: GLANCE_LIFT, keep: GLANCE_KEEP, bounce: GLANCE_BOUNCE, maxSpeed: GLANCE_MAX };

type Arrow = FlightSlot<{ origin: Vector3 }>;

const finite = v.pipe(v.number(), v.finite()), vec = v.tuple([finite, finite, finite]);
const savedSchema = (profile: v.InferOutput<typeof BowWeaponProfileSchema>) => v.strictObject({
  draw: v.strictObject({ drawT: finite, holdT: finite, renockT: finite, tiredT: finite, wasHeld: v.boolean(), needLift: v.boolean(), reachedFull: v.boolean() }),
  arrows: v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(profile.quiver)), aim: v.nullable(v.string()),
  flying: v.pipe(v.array(v.strictObject({ active: v.boolean(), pos: vec, vel: vec, origin: vec, age: finite, glanced: v.boolean() })), v.length(profile.pool)),
  stuck: stoppedProjectileSaved(48),
});

/** What the longbow is lent: this tick's HEAVY hold (null when up; its target, if it names one), whether it is live (held,
 *  not mid-swap, not locked by a boss intro) and the bodies an arrow can hit. */
export interface PineLongbowPorts {
  /** Full hosts pass the admitted item row; isolated callers use the same authored default. */
  readonly profile?: v.InferOutput<typeof BowWeaponProfileSchema>;
  readonly heavy: () => { readonly targetId?: string | undefined } | null;
  readonly enabled: () => boolean;
  readonly bodies: () => readonly AnimalSim[];
  /** the loosing tick's aim share along the target's body (headlessRanged.ts `aimAt`; absent: its middle) */
  readonly aim?: () => number;
  /** The ONE world/weather owner; an isolated installer without it explicitly keeps still air. */
  readonly wind?: { vecAt: (x: number, z: number, out: Vector3) => Vector3 };
  /** Actual combat-input samples, not inferred from corrected displacement. Missing samples remain standing/hip. */
  readonly aimed?: () => number;
  readonly speedFactor?: () => number;
  readonly extraSpread?: () => number;
  readonly mountSpread?: () => number;
}

/**
 * PINE HOLLOW'S LONGBOW in a renderer-free host (SF72), drawn as the page draws it (the engine's Bow on `bowDraw.ts`
 * `BowDraw`): the HEAVY hold is the draw (0.75 s to full), a release at full looses (the only way an arrow leaves), early
 * lets down, a long hold tires the arms; nothing draws while it is not live or the quiver (20, the King's reward) is empty.
 * The loose aims at the hold's last named body (else along the player's facing), with the page's 0.3° cone (√ radius, four
 * draws from the host's gameplay stream), from 0.55 m down the aim line at 32 + 30 m/s, and flies the arrow's own law
 * (engine combat/projectileFlight.ts with weapons/longbowFlight.ts's numbers) in four substeps a tick, each tested against
 * the world (a 2 cm ball) and the creatures' hitboxes short of the wall: a body takes max(1, round(the damage model's blow
 * from the loose point × 1.35)) through the host's combat pipeline; wood and ground keep the arrow, stone glances it and a
 * glanced arrow lies on the next surface it meets.
 *
 * The full Pine installer lends its single serialized weather/gust owner and authoritative motion sample. Isolated
 * callers without these ports keep still air/standing input. The native clock is explicit; equivalence to a variable
 * page frame clock requires the same sampled deltas. Pickup checks follow the page's eight-update clock, saved with
 * every stopped shaft. Aimed and mounted spread remain explicit input ports.
 */
export function installPineLongbow(host: SimHost, ports: PineLongbowPorts): { readonly draw: BowDraw; readonly state: { arrows: number; aim: string | null }; readonly flying: () => number; readonly stuck: StoppedProjectileSlots<null, string> } {
  const profile = v.parse(BowWeaponProfileSchema, ports.profile ?? BOW_PROFILE);
  const random = (): number => host.rng.stream('gameplay').next(), player = leadPlayer(host);
  const draw = new BowDraw(profile.draw), state: { arrows: number; aim: string | null } = { arrows: profile.quiver, aim: null };

  const eye = new Vector3(), dir = new Vector3(), across = new Vector3(), seg = new Vector3(), wind = new Vector3();
  const stuck = new StoppedProjectileSlots<null, string>({ capacity: 48, length: 0.76, bury: 0.09, radius: RADIUS,
    reach: { radius: 1.25, up: 2.1, down: 1.2 }, recover: 0.7, recoveryStride: 8 }, { feet: player.position,
    floorAt: (x, y, z) => floorBelow(host.physics, x, z, y + 0.3, 60) ?? host.groundHeightAt(x, z),
    body: id => host.entities.get(id), canRecover: () => state.arrows < profile.quiver,
    recover: survived => { if (survived) state.arrows = Math.min(profile.quiver, state.arrows + 1); }, random }, () => null);
  const req: DamageRequest = { source: player.health, sourceTags: ['weapon.longbow', 'dmg.ranged', 'cover.checked'], target: player.health, amount: 0, point: new Vector3(), dir: seg, headshot: false };
  const contacts = new ProjectileContact<Arrow, BodyHit>({
    glance: GLANCE, spentRest: 'any', impactAfterLift: false, impactOnRepeatedGlance: false,
  }, {
    world: (from, to, radius) => worldHit(host.physics, from, to, radius),
    target: (from, direction, distance) => { const hit = bodyHit(ports.bodies(), from, direction, distance); return hit?.body === null ? null : hit; },
    hit: (arrow, hit, direction) => {
      const body = hit.body; if (body === null) return;
      req.target = body.combatActor(); req.amount = Math.max(1, Math.round(body.damageFor(hit.head, hit.point.distanceTo(arrow.origin)) * profile.damageScale));
      req.point.copy(hit.point); req.dir.copy(direction); req.headshot = hit.head;
      host.combat.hit(req);
      stuck.stop(hit.point, direction, true, body.alive ? body.entityId : null);
      if (!body.alive) stuck.dropLast();
    },
    stop: (_arrow, at, direction) => { stuck.stop(at, direction, false, null); },
    rest: (_arrow, at, direction) => { stuck.settle(at, direction); },
    impact: () => { /* native contacts have no dust or sound */ }, expire: arrow => { arrow.active = false; },
  });
  const pool = new ProjectileSlots<{ origin: Vector3 }>(profile.pool, () => ({ origin: new Vector3() }), {
    substeps: profile.substeps, extent: BOUND, floor: FLOOR, lifetime: profile.lifetime,
    integrate: (slot, h) => { projectileFlightStep(slot.pos, slot.vel, h, profile.flight,
      ports.wind === undefined ? null : ports.wind.vecAt(slot.pos.x, slot.pos.z, wind)); }, contact: (arrow, previous) => contacts.step(arrow, previous, RADIUS, 0.76),
  });
  const arrows = pool.slots;
  const loose = (): void => {
    const target = state.aim === null ? undefined : host.entities.get(state.aim);
    if (target?.alive === true) aimAt(host, target, eye, dir, ports.aim?.());
    else { const p = player.position; eye.set(p.x, p.y + EYE, p.z); dir.set(-Math.sin(player.yaw), 0, -Math.cos(player.yaw)); }
    const spread = drawnSpreadDegrees(profile.spread.degrees, profile.spread.aimMultiplier, ports.aimed?.() ?? 0, profile.spread.motion,
      ports.speedFactor?.() ?? 0, ports.extraSpread?.() ?? 0, ports.mountSpread?.() ?? 0);
    shotSpread(dir, spread * (Math.PI / 180), random, profile.spread, across);
    const a = pool.take();
    a.pos.copy(eye).addScaledVector(dir, profile.muzzle); a.origin.copy(a.pos); a.vel.copy(dir).multiplyScalar(profile.speedBase + profile.speedDraw);
    state.arrows--;
  };
  host.onStep(LONGBOW_STEP, dt => {
    const live = ports.enabled(), heavy = live ? ports.heavy() : null;
    // the hold's named body is the aim the release looses at (a release tick has no hold to name it)
    if (heavy !== null) state.aim = heavy.targetId ?? null;
    if (draw.step(dt, heavy !== null, !live || state.arrows <= 0) === 'loose') loose();
    pool.step(dt);
    stuck.update();
  }, {
    snapshot: () => ({ draw: { ...draw.save() }, arrows: state.arrows, aim: state.aim,
      flying: arrows.map(a => ({ active: a.active, pos: [a.pos.x, a.pos.y, a.pos.z], vel: [a.vel.x, a.vel.y, a.vel.z], origin: [a.origin.x, a.origin.y, a.origin.z], age: a.age, glanced: a.glanced })), stuck: stuck.snapshot(id => id) }),
    restore: value => {
      const saved = v.parse(savedSchema(profile), value);
      draw.load(saved.draw); state.arrows = saved.arrows; state.aim = saved.aim;
      stuck.restore(saved.stuck, id => id);
      saved.flying.forEach((s, i) => { const a = arrows[i]; if (a !== undefined) { a.active = s.active; a.pos.set(...s.pos); a.vel.set(...s.vel); a.origin.set(...s.origin); a.age = s.age; a.glanced = s.glanced; } });
    },
  }, 'afterBodies');
  return { draw, state, flying: () => arrows.filter(a => a.active).length, stuck };
}
