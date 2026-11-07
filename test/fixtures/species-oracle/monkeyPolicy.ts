import type { AnimalRigContext } from '@wildshard/engine/entities/animalRig';
import { numericCreaturePose } from '@wildshard/engine/game/plugin/channelPrograms';
import { parse, tuple, unknown } from 'valibot';
import { MathUtils, Vector3 } from 'three';
import { selectCreatureSites } from '@wildshard/engine/game/plugin/brain';
import type { AnimalSim } from '@wildshard/engine/entities/AnimalSim';
import { StrikeRunner, type StrikeSpec } from '@wildshard/engine/ai/strikes';

/**
 * The Coconut Monkey's renderer-free policy pieces (./monkey.ts has the rig, the look, the species row and the shipping
 * decision with its shared cooldown stream): perch choice, the bite / coconut strike and the brain shell, over any native
 * body, so the browser's Animal (through ThinkCtx) and a trusted headless host's body (through its ports) run the same code.
 */
export interface MonkeyMem extends Record<string, number> {
  init: number; cd: number; under: number; hitT: number; fled: number; onGround: number; st: number; hx: number; hz: number;
  perch: number; px: number; pz: number; bx: number; bz: number; perchH: number;
  drop: number; vy: number; land: number; climb: number; bite: number; hit: number; gt: number; fleeTo: number; bit: number;
}

export const ST_PERCH = 0, ST_GROUND_IDLE = 1, ST_ATTACK = 2, ST_DROP = 3, ST_GROUND = 4, ST_RETURN = 5, ST_CLIMB = 6;
export const THROW_R = 14, THROW_DUR = 1.0, THROW_RELEASE = 0.62, BITE_R = 1.3, BITE_DAMAGE = 6, BITE_DUR = 0.9 /* the bite lands at 0.45 → a 0.41 s readable wind-up */, UNDER_R = 2.6, UNDER_T = 2.0, RUN = 3.2;
/** E297 fight rules: a monkey on the sand waiting its turn (two others attacking) hangs back this far (m) */
export const HOLD_R = 3.4;

/** What perch choice reads: the palm crowns and trunk feet, the troop, the decision stream and the ground. */
export interface MonkeyPerchPorts<A extends AnimalSim> {
  readonly world: { readonly perches?: readonly A['position'][] | undefined; readonly perchBases?: readonly A['position'][] | undefined };
  readonly herd: readonly A[] | null;
  /** the decision stream (the manager's Rng in the browser) */
  readonly rng: { next: () => number };
  heightAt: (x: number, z: number) => number;
}
/** What the strike reads: the contact ports, the sound and the coconut lob (the shard's projectile owner). */
export interface MonkeyStrikePorts<A extends AnimalSim> {
  readonly player: A['position'];
  reach: (actor: A) => boolean;
  hurt: (damage: number) => void;
  sound: (name: string) => void;
  readonly world: { readonly throwCoconut?: ((from: A['position'], target: A['position'], thrower: A) => void) | undefined };
}

export function pickPerch<A extends AnimalSim>(a: A, c: MonkeyPerchPorts<A>, minD: number, maxD: number, awayFrom?: A['position']): number {
  return selectCreatureSites(c.world.perches ?? [], { count: 1, origin: a.position, minDistance: minD, maxDistance: maxD }, (p, i, d) => {
    const taken = c.herd?.some((h) => h !== a && h.alive && h.mem['perch'] === i) ? 1 : 0;
    const away = awayFrom ? Math.hypot(p.x - awayFrom.x, p.z - awayFrom.z) : 0;
    return away * 0.5 - d * 0.3 - taken * 30 + c.rng.next() * 3;
  }).at(0)?.index ?? -1;
}
export function setPerch<A extends AnimalSim>(a: A, c: MonkeyPerchPorts<A>, i: number): void {
  const m = a.mem as MonkeyMem;
  const p = c.world.perches?.[i];
  if (p === undefined) throw new Error(`monkey: no perch ${i}`);   // i came from pickPerch
  const base = c.world.perchBases?.[i] ?? p;
  m.perch = i; m.px = p.x; m.pz = p.z; m.bx = base.x; m.bz = base.z;
  m.perchH = Math.max(0.5, p.y - c.heightAt(p.x, p.z) + 0.05);
}

const _from = new Vector3(), _to = new Vector3();
const contact = new StrikeRunner();
/** Existing bite contact; the caller's declared memory gate claims the strike first. */
export function biteMonkey<A extends AnimalSim>(a: A, c: MonkeyStrikePorts<A>, bite: StrikeSpec): void {
  if (contact.contains(bite, { actor: { position: a.position, scale: a.scale, yaw: a.yaw }, target: c.player }) && (bite.tags.includes('cover.exempt') || c.reach(a))) {
    c.hurt(bite.damage); c.sound('monkey_shriek');
  }
}
/** Existing coconut owner and target heights; no random draw or projectile clock is added. */
export function throwMonkeyCoconut<A extends AnimalSim>(a: A, c: MonkeyStrikePorts<A>): void {
  _from.set(a.position.x, a.position.y + 0.95 * a.scale, a.position.z);
  _to.set(c.player.x, c.player.y + 0.9, c.player.z);
  c.world.throwCoconut?.(_from, _to, a);
}

/** Authoritative root transition stays shard-owned, at the existing near-pose phase. */
export function stepMonkeyRoot(a: Pick<AnimalSim, 'mem' | 'position' | 'yOffset'>, dt: number): void {
  const m = a.mem as MonkeyMem;
  if (m.drop) {
    m.vy = (m.vy || 0) - 9.8 * dt;
    a.yOffset += m.vy * dt;
    if (a.yOffset <= 0) { a.yOffset = 0; m.drop = 0; m.vy = 0; m.land = 0.35; }
  } else if (m.climb && m.perchH > 0) {
    a.yOffset = Math.min(m.perchH, a.yOffset + 2.2 * dt);
    const k = m.perchH > 0.01 ? a.yOffset / m.perchH : 1;
    a.position.x = MathUtils.lerp(m.bx, m.px, k); a.position.z = MathUtils.lerp(m.bz, m.pz, k);
    if (a.yOffset >= m.perchH - 1e-3) { m.climb = 0; a.position.x = m.px; a.position.z = m.pz; }
  }
  m.land = Math.max(0, (m.land || 0) - dt);
}

/** Admit both ordered passes from the built product, before the page/native owner spawns a rig. */
export function createMonkeyAnimation(input: unknown): (c: AnimalRigContext) => void {
  const poses = parse(tuple([unknown(), unknown()]), input).map(numericCreaturePose);
  return c => { stepMonkeyRoot(c.animal, c.dt); for (const pose of poses) pose(c); };
}
