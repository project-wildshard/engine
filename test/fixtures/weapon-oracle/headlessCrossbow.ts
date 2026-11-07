import { worldHit } from '../../../src/shared/engine/physics/query';
import * as v from 'valibot';
import { Vector3 } from 'three';
import type { SimHost } from '../../../src/server/engine/sim';
import type { AnimalSim } from '../../../src/shared/engine/entities/AnimalSim';
import type { DamageRequest } from '../../../src/shared/engine/combat/pipeline';
import { shotSpread } from '../../../src/shared/engine/combat/shotSpread';
import { smoothstep } from '../../../src/shared/engine/core/noise';
import { sticksIn } from '../../../src/shared/engine/physics/query';
import { CROSSBOW_PROFILE } from './crossbowProfile';
import { projectileFlightStep } from '../../../src/shared/engine/combat/projectileFlight';
/** The flight multipliers a bolt carries (the ammo's, the weather's): 1 / 1 is the plain bolt. */
export interface BoltFlight { gravity: number; drag: number }
const PLAIN_FLIGHT: BoltFlight = { gravity: 1, drag: 1 };
import { aimAt, bodyHit } from './headlessRanged';
import { leadPlayer } from '@wildshard/engine/sim/leadPlayer';
type BoltKind = 'iron' | 'pitch' | 'broadhead';
const boltDamage = (kind: BoltKind, animal: string): number => kind === 'broadhead' && (animal === 'deer' || animal === 'boar') ? 1.4 : 1;
/** Frozen shipping flight law, independent of the adopted item rows. */
export function boltFlight(kind: BoltKind, rain: number): BoltFlight {
  const r = Math.min(1, Math.max(0, rain)), gravity = kind === 'pitch' ? 0.8 : kind === 'broadhead' ? 1.08 : 1, drag = kind === 'pitch' ? 0.7 : kind === 'broadhead' ? 1.1 : 1;
  return kind === 'pitch' ? { gravity, drag } : { gravity: gravity * (1 + 0.2 * r), drag: drag * (1 + 0.9 * r) };
}

/** The crossbow's fixed-step id; its continuation is the bow's state and every bolt in flight. */
export const CROSSBOW_STEP = 'pine.crossbow';
/** Crossbow.ts: the bolt starts this far down the aim line, flies in four substeps a tick, dies past the chunk or after 12 s. */
const MUZZLE = 0.35, SUBSTEPS = 4, MAX_AGE = 12, BOUND = 250 + 60, FLOOR = -150;
/** Crossbow.ts's glance off a hard surface: lift off it, keep a little of the speed, a small bounce, a speed cap. */
const GLANCE_LIFT = 0.02, GLANCE_KEEP = 0.25, GLANCE_BOUNCE = 0.15, GLANCE_MAX = 6;
const CONE = { radius: 'linear', axisScale: 2 } as const;

/** One bolt slot (Crossbow.ts's pool of `maxFlying`): in flight while `active`. */
interface Bolt { active: boolean; pos: Vector3; vel: Vector3; age: number; glanced: boolean; ammo: BoltKind }
/** The most shots a tick reads (the tick's command allowance). */
const MAX_FLYING = 8, MAX_SHOTS = 1024, NO_SHOTS: readonly string[] = [];

const finite = v.pipe(v.number(), v.finite());
const Saved = v.strictObject({ loaded: v.boolean(), quiver: finite, reloading: v.boolean(), reloadT: finite, cooldown: finite, sinceFire: finite,
  bolts: v.pipe(v.array(v.strictObject({ active: v.boolean(), pos: v.tuple([finite, finite, finite]), vel: v.tuple([finite, finite, finite]), age: finite, glanced: v.boolean(), ammo: v.optional(v.picklist(['iron', 'pitch', 'broadhead']), 'iron') })),
    v.length(CROSSBOW_PROFILE.maxFlying)) });

/** What the crossbow is lent: the tick's shots (the body each is aimed at), whether its trigger is live (held, not mid-swap,
 *  not locked by a boss intro) and the bodies a bolt can hit. */
export interface PineCrossbowPorts {
  readonly shots: () => readonly string[];
  readonly enabled: () => boolean;
  readonly bodies: () => readonly AnimalSim[];
  /** the tick's aim share along the target's body (headlessRanged.ts `aimAt`; absent: its middle) */
  readonly aim?: () => number;
  readonly adsBlend?: () => number;
  /** The one weather/ammunition owner supplies the page's flight multipliers for each actual substep. */
  readonly flight?: (kind: BoltKind) => BoltFlight;
  /** Captured at launch; changing the rail later cannot change an already flying bolt's flight or damage. */
  readonly ammunition?: () => BoltKind;
}

/**
 * PINE HOLLOW'S CROSSBOW in a renderer-free host (SF72): a real projectile item, as the page's Crossbow
 * (runtime/weapons/crossbow/Crossbow.ts) flies it. A player command's `attack` pulls the trigger aimed at that body's chest
 * (the page aims along the camera; the tape aims at a body): fired when loaded and off its 0.3 s cooldown, else a dry pull
 * starts the reload; a spent bow reloads itself 1.4 s after the shot (1.35 s); a 30-bolt quiver. The bolt leaves 0.35 m down
 * the aim line from the eye at 62 m/s with the page's hip spread (0.75°, from the host's gameplay stream: four draws as
 * the page's gameplayRandom) and flies the page's own law (the engine's `projectileFlightStep`: gravity, drag) in four substeps a tick, each tested
 * against the world (a 3 cm ball swept through it, edges passed) and the creatures' hitboxes short of the wall: a body
 * takes the damage model's blow (`damageFor`: head ×2.5, range falloff) through the host's combat pipeline (its rules: the
 * King's bark and ribcage, a boss's shield, the elites' own); wood and ground keep the bolt, stone glances it. The
 * intro of a boss locks it (BossPorts.lockInput), and only the held weapon's trigger is live (runtime/weapons/headlessLoadout.ts);
 * a stowed bow still reloads itself and its bolts fly on, as the page updates every weapon. Stuck bolts are the page's view alone.
 */
export function installPineCrossbow(host: SimHost, ports: PineCrossbowPorts): { readonly state: { loaded: boolean; quiver: number; reloading: boolean }; readonly flying: () => number; readonly addBolts: (count: number) => void } {
  const p = CROSSBOW_PROFILE, random = (): number => host.rng.stream('gameplay').next(), player = leadPlayer(host);
  if (p.maxFlying !== MAX_FLYING) throw new Error('Pine crossbow profile changed its bolt pool');
  const state = { loaded: true, quiver: p.quiver, reloading: false, reloadT: 0, cooldown: 0, sinceFire: 99 };
  const bolts: Bolt[] = Array.from({ length: p.maxFlying }, () => ({ active: false, pos: new Vector3(), vel: new Vector3(), age: 0, glanced: false, ammo: 'iron' }));
  const reload = (): void => { if (!state.reloading && !state.loaded && state.quiver > 0) { state.reloading = true; state.reloadT = 0; } };
  const eye = new Vector3(), fwd = new Vector3(), side = new Vector3(), dir = new Vector3(), prev = new Vector3(), seg = new Vector3(), n = new Vector3();
  const fire = (target: AnimalSim): void => {
    state.loaded = false; state.quiver = Math.max(0, state.quiver - 1); state.cooldown = p.cooldown; state.sinceFire = 0;
    aimAt(host, target, eye, fwd, ports.aim?.());
    // the page's hip spread: a random axis across the line, a random fraction of 0.75°
    const spread = (0.15 + (1 - smoothstep(0, 1, ports.adsBlend?.() ?? 0)) * 0.6) * (Math.PI / 180);
    dir.copy(fwd);
    shotSpread(dir, spread, random, CONE, side);
    // a free slot, else the oldest bolt's (Crossbow.ts spawnBolt)
    let b: Bolt | undefined;
    for (let i = 0; i < MAX_FLYING; i++) {
      const x = bolts[i];
      if (x === undefined) break;
      if (!x.active) { b = x; break; }
      if (b === undefined || x.age > b.age) b = x;
    }
    if (b === undefined) return;
    b.active = true; b.age = 0; b.glanced = false; b.ammo = ports.ammunition?.() ?? 'iron';
    b.pos.copy(eye).addScaledVector(fwd, MUZZLE); b.vel.copy(dir).multiplyScalar(p.speed);
  };
  // one request, refilled per hit (the pipeline copies the contact frame and the tags)
  const req: DamageRequest = { source: player.health, sourceTags: ['weapon.crossbow', 'dmg.ranged', 'cover.checked'], target: player.health, amount: 0, point: new Vector3(), dir: seg, headshot: false };
  /** the step prev → bolt: the nearer of a body and the world; true when the bolt stopped */
  const testHit = (b: Bolt): boolean => {
    seg.subVectors(b.pos, prev);
    const len = seg.length();
    if (len < 1e-6) return false;
    seg.multiplyScalar(1 / len);
    const wall = worldHit(host.physics, prev, b.pos, p.radius);
    const hit = bodyHit(ports.bodies(), prev, seg, wall ? wall.distance : len), body = hit?.body ?? null;
    if (hit !== null && body !== null) {
      // the pipeline copies the contact frame (its scratch vectors are reused)
      req.target = body.combatActor(); req.amount = body.damageFor(hit.head, hit.point.distanceTo(player.position)) * boltDamage(b.ammo, body.kind);
      req.point.copy(hit.point); req.headshot = hit.head;
      host.combat.hit(req);
      return true;
    }
    if (!wall) return false;
    n.set(wall.normal.x, wall.normal.y, wall.normal.z);
    if (n.dot(seg) > 0) n.negate();
    if (b.glanced && n.y >= 0.5) return true; // a spent bolt lies where it lands
    if (!b.glanced && sticksIn(wall.material)) return true;
    const vn = b.vel.dot(n);
    b.vel.addScaledVector(n, -vn).multiplyScalar(GLANCE_KEEP).addScaledVector(n, -vn * GLANCE_BOUNCE);
    if (b.vel.length() > GLANCE_MAX) b.vel.setLength(GLANCE_MAX);
    b.pos.set(wall.point.x, wall.point.y, wall.point.z).addScaledVector(n, GLANCE_LIFT);
    b.glanced = true;
    return false;
  };
  const fly = (b: Bolt, dt: number): void => {
    b.age += dt;
    const h = dt / SUBSTEPS;
    for (let s = 0; s < SUBSTEPS; s++) { prev.copy(b.pos); const mod = ports.flight?.(b.ammo) ?? PLAIN_FLIGHT; projectileFlightStep(b.pos, b.vel, h, { gravity: p.gravity * mod.gravity, drag: p.drag * mod.drag, windCoupling: 0 }); if (testHit(b)) { b.active = false; return; } }
    if (Math.abs(b.pos.x) > BOUND || Math.abs(b.pos.z) > BOUND || b.pos.y < FLOOR || b.age > MAX_AGE) b.active = false;
  };
  host.onStep(CROSSBOW_STEP, dt => {
    const shots = ports.enabled() ? ports.shots() : NO_SHOTS;
    for (let i = 0; i < MAX_SHOTS; i++) {
      const id = shots[i];
      if (id === undefined) break;
      const target = host.entities.get(id);
      if (target === undefined || state.reloading || state.cooldown > 0) continue;
      if (!state.loaded) { reload(); continue; }
      fire(target);
    }
    state.cooldown = Math.max(0, state.cooldown - dt); state.sinceFire += dt;
    if (!state.loaded && !state.reloading && state.quiver > 0 && state.sinceFire > p.autoReload) reload();
    if (state.reloading) { state.reloadT += dt; if (state.reloadT >= p.reload) { state.reloading = false; state.loaded = true; } }
    for (let i = 0; i < MAX_FLYING; i++) { const b = bolts[i]; if (b?.active === true) fly(b, dt); }
  }, {
    snapshot: () => ({ ...state, bolts: bolts.map(b => ({ active: b.active, pos: [b.pos.x, b.pos.y, b.pos.z], vel: [b.vel.x, b.vel.y, b.vel.z], age: b.age, glanced: b.glanced, ...(b.ammo === 'iron' ? {} : { ammo: b.ammo }) })) }),
    restore: value => {
      const saved = v.parse(Saved, value);
      Object.assign(state, { loaded: saved.loaded, quiver: saved.quiver, reloading: saved.reloading, reloadT: saved.reloadT, cooldown: saved.cooldown, sinceFire: saved.sinceFire });
      saved.bolts.forEach((s, i) => { const b = bolts[i]; if (b !== undefined) { b.active = s.active; b.pos.set(...s.pos); b.vel.set(...s.vel); b.age = s.age; b.glanced = s.glanced; b.ammo = s.ammo; } });
    },
  }, 'afterBodies');
  return { state, flying: () => bolts.filter(b => b.active).length, addBolts: count => {
    if (!Number.isFinite(count) || count < 0) throw new RangeError('Invalid native Pine bolt grant');
    state.quiver = Math.min(p.quiver, state.quiver + count);
  } };
}
