import * as schema from 'valibot';
import type { Vector3 } from 'three';
import type { HeldDecision } from './heldDecision';

/** A mounted sabre's pass law as numbers only (Nalati's mounted blade): the 10 Hz decision that, from the rider's speed,
 *  the attack and charge inputs and the nearest targets either side, picks a left or right pass slash, its damage and
 *  the chain and cooldown clocks. No rig, view or input: the page's MountedSword (mountedBlade.ts) and the Node
 *  simulation (CI12's Nalati tape) swing the pass it returns. */

/** A body the pass may cut (an aim target): its place and whether it can be struck. */
export interface MountedPassTarget { readonly alive: boolean; readonly hidden?: boolean; readonly position: Vector3 }
/** The sabre profile's mounted rows (format/weaponProfiles `mounted`). */
export interface MountedPassRows {
  readonly chainWindow: number; readonly sense: number; readonly behind: number; readonly speedDivisor: number;
  readonly chainMax: number; readonly chainStep: number; readonly cooldown: number;
}
/** What a decision reads: the rider (feet, view yaw), the horse (speed, heading; null on foot), the heavy charge, the
 *  sabre's base damage and mounted rows, and the live aim targets. */
export interface MountedPassInputs {
  readonly player: { readonly position: Vector3; readonly yaw: number }; readonly mount: { readonly speed: number; readonly yaw: number } | null;
  readonly charging: boolean; readonly baseDamage: number; readonly rows: MountedPassRows; readonly targets: Iterable<MountedPassTarget>;
}
/** A pass to swing: its side (-1 left, 1 right) and the damage of its one swing. */
export interface MountedPassStrike { readonly side: number; readonly damage: number }

const finite=schema.pipe(schema.number(),schema.finite());
const PassState=schema.strictObject({passChain:finite,chainT:finite,mountCd:finite,pendingAttack:schema.boolean(),
  pendingHits:schema.pipe(finite,schema.integer(),schema.minValue(0)),elapsed:schema.pipe(finite,schema.minValue(0))});
/** Every pending edge and clock, independent of the caller's decision owner. */
export interface MountedPassState {readonly passChain:number;readonly chainT:number;readonly mountCd:number;
 readonly pendingAttack:boolean;readonly pendingHits:number;readonly elapsed:number}

export class MountedPassLaw {
  /** hits in the running chain (0: none), for the HUD's chip */
  passChain = 0;
  chainT = 0; mountCd = 0;
  private pendingAttack = false; private pendingHits = 0; private elapsed = 0;
  /** `law`: the sabre's admitted 10 Hz decision (a HeldDecision over its program) */
  constructor(private readonly law: Pick<HeldDecision, 'update'>) {}
  /** Snapshot the complete input/cadence state, without consuming an attack. */
  snapshot():MountedPassState{return {passChain:this.passChain,chainT:this.chainT,mountCd:this.mountCd,
    pendingAttack:this.pendingAttack,pendingHits:this.pendingHits,elapsed:this.elapsed};}
  /** Check the whole cursor before replacing any accepted state. */
  restore(input:unknown):void{const saved=schema.parse(PassState,input);this.passChain=saved.passChain;this.chainT=saved.chainT;
    this.mountCd=saved.mountCd;this.pendingAttack=saved.pendingAttack;this.pendingHits=saved.pendingHits;this.elapsed=saved.elapsed;}
  /** Keep a swapped-out sabre's chain and cooldown. */
  carry(previous: MountedPassLaw): void { this.passChain = previous.passChain; this.chainT = previous.chainT; this.mountCd = previous.mountCd; }
  /** An attack press while mounted (taken by the next decision). */
  attack(): void { this.pendingAttack = true; }
  /** A pass slash landed (counted into the next decision). */
  hit(): void { this.pendingHits++; }
  /** One frame: on a decision frame (every 0.1 s) the pass to swing, if any; else null. */
  decide(dt: number, input: MountedPassInputs): MountedPassStrike | null {
    this.elapsed += dt; if (this.elapsed < .1 - 1e-9) return null;
    const m = input.mount, p = input.player.position, yaw = m?.yaw ?? input.player.yaw, fx = -Math.sin(yaw), fz = -Math.cos(yaw), rx = Math.cos(yaw), rz = -Math.sin(yaw), rows = input.rows;
    const candidates: Record<string, number>[] = [];
    for (const target of [...input.targets].filter(body => body.alive && body.hidden !== true).sort((a, b) => a.position.distanceToSquared(p) - b.position.distanceToSquared(p))) {
      if (candidates.length >= 8) break; const dx = target.position.x - p.x, dz = target.position.z - p.z;
      candidates.push({ live: Number(target.alive && target.hidden !== true), distance: Math.hypot(dx, dz), forward: dx * fx + dz * fz, side: dx * rx + dz * rz >= 0 ? 1 : -1 });
    }
    const v = this.law.update(this.elapsed, { mode: 1, cooldown: this.mountCd, chain: this.chainT, links: this.passChain, hits: this.pendingHits, chainWindow: rows.chainWindow,
      attack: Number(this.pendingAttack), charging: Number(input.charging), mounted: Number(m !== null), sense: rows.sense, behind: rows.behind,
      look: Math.atan2(Math.sin(input.player.yaw - yaw), Math.cos(input.player.yaw - yaw)), baseDamage: input.baseDamage, speed: m?.speed ?? 0,
      speedDivisor: rows.speedDivisor, chainMax: rows.chainMax, chainStep: rows.chainStep, passCooldown: rows.cooldown }, candidates);
    this.elapsed = 0; if (v === null) return null; this.pendingAttack = false; this.pendingHits = 0;
    this.mountCd = v['cooldown'] ?? 0; this.chainT = v['chain'] ?? 0; this.passChain = v['links'] ?? 0;
    const side = v['side'];
    return side !== 0 && side !== undefined ? { side, damage: v['damage'] ?? input.baseDamage } : null;
  }
}
