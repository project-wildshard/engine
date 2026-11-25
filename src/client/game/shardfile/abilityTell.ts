import type { Scene } from 'three';
import { GroundTell } from '@wildshard/engine/fx/groundTell';
import type { PageAbility } from './clientRecipes';

/** A strike's ground tell at one moment: what `drawTell` draws (an elite's heard tell, a creature's running ability). */
export interface TellDraw { readonly tell?: string | undefined; readonly phase: string; readonly time: number; readonly windup: number; readonly x0: number; readonly z0: number; readonly x1: number; readonly z1: number; readonly width: number; readonly radius: number }
/** A strike's ground tell, as its windup and active time have it (the elite page's, shared since CC11b3). */
export function drawTell(tell: Pick<GroundTell, 'lane' | 'ring' | 'hide'>, strike: TellDraw, t: number, bodyX: number, bodyZ: number): void {
  if (strike.tell === 'lane' && strike.phase === 'windup') {
    const k = Math.min(1, strike.time / Math.max(0.001, strike.windup)); tell.lane(strike.x0, strike.z0, strike.x1, strike.z1, strike.width, 0.35 + 0.55 * k * (0.75 + 0.25 * Math.sin(t * 22)));
  } else if (strike.tell === 'lane' && strike.phase === 'active') tell.lane(strike.x0, strike.z0, strike.x1, strike.z1, strike.width, Math.max(0, 0.6 - strike.time * 1.2));
  else if (strike.tell === 'ring' && strike.phase === 'windup') { const k = Math.min(1, strike.time / Math.max(0.001, strike.windup)); tell.ring(bodyX, bodyZ, strike.radius * (0.7 + 0.3 * k), 0.35 + 0.6 * k * (0.7 + 0.3 * Math.sin(t * 20))); }
  else tell.hide();
}

/** A running ability's ground tell at one moment, in `drawTell`'s terms. */
export interface AbilityTellDraw extends TellDraw { readonly tell: 'lane' | 'ring'; readonly phase: 'windup' | 'active' | 'done' }

/**
 * ONE-FORMAT CC11b3: the tell a declared ability shows, from its row (`tell`, timing, shape) and how far through it the
 * server says it is (`abilityT`, over windup + active + recover, as the server's runner counts it). An ability with no
 * `tell` shows none; a ring stands on the body, a lane runs ahead of it along `yaw`.
 */
export function abilityTell(ability: PageAbility, progress: number, x: number, z: number, yaw: number): AbilityTellDraw | null {
  const tell = ability.tell;
  if (tell === undefined) return null;
  const total = Math.max(0.05, ability.windup + ability.active + ability.recover), at = Math.max(0, progress) * total;
  const phase = at < ability.windup ? 'windup' : at < ability.windup + ability.active ? 'active' : 'done';
  const time = phase === 'windup' ? at : at - ability.windup;
  const reach = ability.reach, dx = Math.sin(yaw) * reach, dz = Math.cos(yaw) * reach;
  return { tell, phase, time, windup: ability.windup, x0: x, z0: z, x1: x + dx, z1: z + dz, width: ability.width, radius: reach };
}

/** The colour a creature's running-ability tell draws in. */
const TELL_COLOUR = 0xff5a36;
/**
 * CC11b3: the ground tells one scene's row bodies draw this frame, from a pool that grows to the most drawn at once.
 * `begin` each frame, `show` per body; a pooled tell not shown since `begin` hides.
 */
export class AbilityTells {
  private readonly pool = { ring: [] as GroundTell[], lane: [] as GroundTell[] };
  private used = { ring: 0, lane: 0 };
  private readonly scene: Scene;
  constructor(scene: Scene) {
    this.scene = scene;}
  /** The tells drawn now, by kind, for a test or a probe. */
  get drawn(): { readonly ring: number; readonly lane: number } { return { ...this.used }; }
  begin(): void {
    for (const kind of ['ring', 'lane'] as const) for (let i = this.used[kind]; i < this.pool[kind].length; i++) this.pool[kind][i]?.hide();
    this.used = { ring: 0, lane: 0 };
  }
  show(ability: PageAbility | undefined, progress: number, x: number, z: number, yaw: number, t: number): void {
    const draw = ability === undefined ? null : abilityTell(ability, progress, x, z, yaw);
    if (draw === null || draw.phase === 'done') return;
    const at = this.used[draw.tell]++, tell = this.pool[draw.tell][at] ?? new GroundTell(this.scene, draw.tell, TELL_COLOUR);
    this.pool[draw.tell][at] = tell;
    drawTell(tell, draw, t, x, z);
  }
}
