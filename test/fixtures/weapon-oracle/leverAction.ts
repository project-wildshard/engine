import type { FirearmProfile } from './firearmProfile';
import { AR15 } from './pineFirearmProfile';

/** The tube's rounds; one more rides in the chamber (7 in the gun). */
export const TUBE_MAX = 6;
/** Rounds in a full gun (the tube and the chamber) and the reserve a fresh rifle carries. */
export const MAGAZINE = TUBE_MAX + 1, RESERVE_START = 21;
/** s from the shot to the lever starting down; s for the full throw (open + close); s per cartridge through the gate */
export const CYCLE_DELAY = 0.12, LEVER_TIME = 0.56, ROUND_TIME = 0.4;
/** s to roll into / out of the loading pose (a reload's first round goes in RELOAD_IN after it starts) */
export const RELOAD_IN = 0.22, RELOAD_OUT = 0.2;
/** s after a dry pull on an empty gun before it reloads itself (and the window closes 5 s after it) */
export const AUTO_RELOAD_DELAY = 0.35;

/** The lever-action's numbers: the hitscan (damage, range, spread) and the presentation's. */
export const LEVER_PROFILE: FirearmProfile = {
  ...AR15, action: 'lever', magazine: 7, reserve: 21, interval: 0.68, reload: 0.4,
  damageScale: 1.5, range: 320, kick: 1.25 * (Math.PI / 180), spreadAds: 0.06, spreadHip: 0.9,
  spreadRadius: 'sqrt', bloomShot: 0, bloomMax: 0, movingSpread: 0.5, movingAimReduction: 0.6,
  brass: { count: 4, life: 1.8 }, tracer: { count: 2, life: 0.09, width: 3 },
  ads: { blend: 0.17, motion: 0.3, nearMargin: 0.03, sightY: 0.045, rearZ: -0.13, frontZ: -0.512, muzzleZ: -0.535 },
};

/** Rounds-left maths for the tube + chamber (pure; test/shards/pine-hollow/pine-loadout.test.ts) */
export interface ActionState { tube: number; chambered: boolean; reserve: number }
/** after a cycle: the chamber takes a round from the tube if it has one */
export function cycleAction(a: ActionState): ActionState {
  if (a.chambered || a.tube <= 0) return { ...a };
  return { ...a, tube: a.tube - 1, chambered: true };
}
/** one round through the gate: from the reserve into the tube, if both allow */
export function feedRound(a: ActionState): ActionState {
  if (a.tube >= TUBE_MAX || a.reserve <= 0) return { ...a };
  return { ...a, tube: a.tube + 1, reserve: a.reserve - 1 };
}

/** idle; the beat between the shot and the throw; the lever's throw; a reload through the gate */
export type LeverPhase = 'idle' | 'beat' | 'cycle' | 'reload';
/** What the action tells its owner as it runs (the page's view and sounds; a headless runtime ignores most). */
export interface LeverHooks {
  /** the lever is thrown (a cycle starts) */
  cycle: () => void;
  /** the spent case leaves the port (a third into the throw) */
  eject: () => void;
  /** the throw is done: the chamber took a round from the tube, if it had one */
  chambered: () => void;
  /** a reload started (a trigger on an empty gun, `R`, or the auto reload) */
  reloadStart: () => void;
  /** a cartridge went through the gate */
  round: () => void;
  /** the reload is done */
  reloadEnd: () => void;
}

/**
 * THE LEVER-ACTION'S ACTION, renderer-free (SF72): the page's LeverRifle (runtime/weapons/LeverRifle.ts) and the headless
 * lever (runtime/weapons/headlessLever.ts) both run their rifle through it. TUBE_MAX rounds in the tube + one chambered. A
 * shot fires the chambered round and drops the hammer; after CYCLE_DELAY the lever is thrown (LEVER_TIME: the case leaves a
 * third of the way through, the hammer cocks at a fifth, and the lever closes chambering the next round from the tube). No
 * second shot until the cycle is done. A reload goes THROUGH THE GATE, ONE ROUND AT A TIME (ROUND_TIME each, the first
 * RELOAD_IN after it starts); a trigger pull mid-reload stops it after the round in hand; a gun run dry is cycled at the end
 * to chamber one. The reserve lives on the owner's store (the page's HUD state; a pickup adds to it).
 */
export class LeverAction {
  tube = TUBE_MAX; chambered = true; caseInChamber = false; hammerCocked = true;
  phase: LeverPhase = 'idle'; phaseT = 0;
  /** reload: rounds pushed this reload, the rounds it means to push, whether to stop after the round in hand, whether the
   *  gun was run dry (chamber at the end) */
  fed = 0; planned = 0; stopAfter = false; dryAtStart = false;
  /** 0..1 through the reload's rounds */
  reloadProgress = 0;
  readonly store: { reserve: number };
  constructor(store: { reserve: number }) { this.store = store; }

  /** the action as the pure helpers see it */
  get action(): ActionState { return { tube: this.tube, chambered: this.chambered, reserve: this.store.reserve }; }
  /** rounds in the gun (the tube and the chamber) */
  get rounds(): number { return this.tube + (this.chambered ? 1 : 0); }
  /** 0..1 through the lever's throw (0 when it is shut) */
  get cycleU(): number { return this.phase === 'cycle' ? Math.min(1, Math.max(0, this.phaseT / LEVER_TIME)) : 0; }

  /** the chambered round goes: the hammer drops, the case stays in the chamber until the throw */
  dropHammer(): void { this.chambered = false; this.caseInChamber = true; this.hammerCocked = false; this.phase = 'beat'; this.phaseT = 0; }
  /** the lever is thrown (the hook is the owner's to call: a dry pull throws it at once) */
  throwLever(): void { this.phase = 'cycle'; this.phaseT = 0; }
  /** a trigger pull while reloading: stop after the round in hand (once there is anything to fire) */
  triggerWhileReloading(): void { if (this.fed > 0 || this.tube > 0 || this.chambered) this.stopAfter = true; }
  /** start a reload, when idle with room in the tube and a reserve: false when refused */
  beginReload(): boolean {
    if (this.phase !== 'idle' || this.tube >= TUBE_MAX || this.store.reserve <= 0) return false;
    this.phase = 'reload'; this.phaseT = 0; this.fed = 0; this.stopAfter = false; this.dryAtStart = !this.chambered;
    this.planned = Math.min(TUBE_MAX - this.tube, this.store.reserve);
    this.reloadProgress = 0;
    return true;
  }
  /** an idle, empty gun with a reserve (the owner adds its own window: the dry pull's delay, held and enabled) */
  get wantsAutoReload(): boolean { return this.phase === 'idle' && !this.chambered && this.tube === 0 && this.store.reserve > 0; }

  /** One step of `dt` s: the beat, the throw, the reload, else (idle) the auto reload when `autoDue` (the owner's window, read
   *  before the step: nothing in an idle step changes it). */
  step(dt: number, autoDue: boolean, hooks: LeverHooks): void {
    this.phaseT += dt;
    if (this.phase === 'beat') { if (this.phaseT >= CYCLE_DELAY) { this.throwLever(); hooks.cycle(); } }
    else if (this.phase === 'cycle') {
      const u = this.phaseT / LEVER_TIME;
      if (this.caseInChamber && u >= 0.34) { this.caseInChamber = false; hooks.eject(); }
      if (u >= 0.2) this.hammerCocked = true;
      if (u >= 1) {
        const next = cycleAction(this.action);
        this.tube = next.tube; this.chambered = next.chambered;
        this.phase = 'idle'; this.phaseT = 0;
        hooks.chambered();
      }
    } else if (this.phase === 'reload') this.reloadStep(hooks);
    else if (autoDue && this.beginReload()) hooks.reloadStart();
  }

  private reloadStep(hooks: LeverHooks): void {
    const inT = this.phaseT - RELOAD_IN;
    const done = Math.max(0, Math.floor(inT / ROUND_TIME));
    while (this.fed < Math.min(done, this.planned)) {
      const next = feedRound(this.action);
      this.tube = next.tube; this.store.reserve = next.reserve; this.fed++;
      hooks.round();
      if (this.stopAfter || this.tube >= TUBE_MAX || this.store.reserve <= 0) { this.planned = this.fed; break; }
    }
    this.reloadProgress = this.planned > 0 ? Math.min(1, Math.max(0, inT) / (ROUND_TIME * this.planned)) : 1;
    if (this.fed >= this.planned && inT >= ROUND_TIME * this.planned) {
      this.phase = 'idle'; this.phaseT = 0; this.reloadProgress = 0;
      hooks.reloadEnd();
      if (this.dryAtStart && !this.chambered && this.tube > 0) { this.throwLever(); hooks.cycle(); } // run dry: work the lever to chamber one
    }
  }
}
