import { Weapon, type WeaponWire } from './Weapon';
import { FIXED_STEP } from '../core/fixedStep';
import * as v from 'valibot';

/** Borrow only gameplay state and reload/dry hooks; no equipment or rendering owner is required. */
type RangedPort = Pick<Weapon, 'onDry' | 'onReloadStart' | 'onReloadEnd'> & {
  readonly state: Pick<Weapon['state'], 'loaded' | 'reloading' | 'reloadProgress' | 'bolts' | 'ammo' | 'reserve'>;
};
const finite = v.pipe(v.number(), v.finite());

/** Declared quiver or magazine transfer; per-round cycling uses RangedAction.Cycle. */
export interface RangedReloadRow { readonly mode: 'quiver' | 'magazine' }
/** One source-clock reload progress and transfer owner, using the existing weapon/save envelope. */
export class RangedReload {
  private elapsed = 0;
  private readonly row: RangedReloadRow;
  constructor(row: RangedReloadRow) { this.row = row; }
  begin(weapon: RangedPort, maximum: number): void {
    const state = weapon.state;
    if (state.reloading || (this.row.mode === 'quiver'
      ? state.loaded || (state.bolts ?? 0) <= 0
      : (state.ammo ?? 0) >= maximum || state.reserve <= 0)) return;
    state.reloading = true; this.elapsed = 0; state.reloadProgress = 0;
    weapon.onReloadStart?.();
  }
  progress(weapon: RangedPort, dt: number, duration: number, scale = 1): number {
    this.elapsed += dt / scale;
    const progress = Math.min(1, this.elapsed / duration);
    weapon.state.reloadProgress = progress; return progress;
  }
  finish(weapon: RangedPort, maximum: number): void {
    const state = weapon.state;
    if (this.row.mode === 'magazine') {
      const ammo = state.ammo;
      if (ammo === undefined) throw new Error('Magazine reload requires ammunition');
      const take = Math.min(maximum - ammo, state.reserve);
      state.ammo = ammo + take; state.reserve -= take; state.loaded = state.ammo > 0;
      state.reloadProgress = 0;
    } else state.loaded = true;
    state.reloading = false; weapon.onReloadEnd?.();
  }
  /** Source-clock seconds, independent of any weapon's save envelope. */
  snapshot(): number { return this.elapsed; }
  restore(value: unknown): void { this.elapsed = v.parse(finite, value); }
}

/** Action coefficients on the caller's frame clock; contacts and presentation stay caller-owned. */
export interface RangedActionRow extends RangedReloadRow {
  readonly maximum: number; readonly interval: number; readonly reload: number; readonly autoReload: number;
  readonly autoFrom: 'shot' | 'empty';
}
/** Per-round loading and cycling coefficients, in seconds and normalized cycle phases. */
export interface RangedCycleRow {
  readonly magazine: number; readonly reload: number; readonly reloadIn: number;
  readonly cycleDelay: number; readonly cycleTime: number; readonly ejectAt: number; readonly cockAt: number;
}
/** An ordered phase notification; the host accepts no presentation callbacks. */
export type RangedCycleEvent = 'cycle' | 'eject' | 'chambered' | 'reloadStart' | 'round' | 'reloadEnd';

/** Mutable ammunition/phase data under the caller's existing save envelope. */
class CyclingAction {
  tube: number; chambered = true; caseInChamber = false; hammerCocked = true;
  phase: 'idle' | 'beat' | 'cycle' | 'reload' = 'idle'; phaseT = 0;
  fed = 0; planned = 0; stopAfter = false; dryAtStart = false; reloadProgress = 0;
  readonly tubeMax: number;
  readonly store: { reserve: number };
  private readonly row: RangedCycleRow;
  constructor(store: { reserve: number }, row: RangedCycleRow) {
    if (!Number.isInteger(row.magazine) || row.magazine < 1 || row.magazine > 65536
      || ![row.reload, row.reloadIn, row.cycleDelay, row.cycleTime, row.ejectAt, row.cockAt].every(value => Number.isFinite(value) && value >= 0 && value <= 86400)
      || row.reload === 0 || row.cycleTime === 0 || row.ejectAt > 1 || row.cockAt > 1) throw new RangeError('Invalid ranged cycle row');
    this.store = store; this.row = row; this.tubeMax = row.magazine - 1; this.tube = this.tubeMax;
  }
  get rounds(): number { return this.tube + Number(this.chambered); }
  get cycleU(): number { return this.phase === 'cycle' ? Math.min(1, Math.max(0, this.phaseT / this.row.cycleTime)) : 0; }
  dropHammer(): void { this.chambered = false; this.caseInChamber = true; this.hammerCocked = false; this.phase = 'beat'; this.phaseT = 0; }
  throwLever(): void { this.phase = 'cycle'; this.phaseT = 0; }
  triggerWhileReloading(): void { if (this.fed > 0 || this.tube > 0 || this.chambered) this.stopAfter = true; }
  beginReload(): boolean {
    if (this.phase !== 'idle' || this.tube >= this.tubeMax || this.store.reserve <= 0) return false;
    this.phase = 'reload'; this.phaseT = 0; this.fed = 0; this.stopAfter = false; this.dryAtStart = !this.chambered;
    this.planned = Math.min(this.tubeMax - this.tube, this.store.reserve); this.reloadProgress = 0;
    return true;
  }
  get wantsAutoReload(): boolean { return this.phase === 'idle' && !this.chambered && this.tube === 0 && this.store.reserve > 0; }
  /** Iteration advances state only as far as each effect boundary, preserving observer/reentrant timing. */
  *events(dt: number, autoDue: boolean): Generator<RangedCycleEvent, void, undefined> {
    this.phaseT += dt;
    if (this.phase === 'beat') { if (this.phaseT >= this.row.cycleDelay) { this.throwLever(); yield 'cycle'; } }
    else if (this.phase === 'cycle') {
      const u = this.phaseT / this.row.cycleTime;
      if (this.caseInChamber && u >= this.row.ejectAt) { this.caseInChamber = false; yield 'eject'; }
      if (u >= this.row.cockAt) this.hammerCocked = true;
      if (u >= 1) {
        if (!(this.chambered || this.tube <= 0)) { this.tube--; this.chambered = true; }
        this.phase = 'idle'; this.phaseT = 0; yield 'chambered';
      }
    } else if (this.phase === 'reload') yield* this.reloadEvents();
    else if (autoDue && this.beginReload()) yield 'reloadStart';
  }
  private *reloadEvents(): Generator<RangedCycleEvent, void, undefined> {
    const inT = this.phaseT - this.row.reloadIn, done = Math.max(0, Math.floor(inT / this.row.reload));
    for (let round = 0; round < 1024; round++) {
      if (this.fed >= Math.min(done, this.planned)) break;
      if (!(this.tube >= this.tubeMax || this.store.reserve <= 0)) { this.tube++; this.store.reserve--; }
      this.fed++; yield 'round';
      if (this.stopAfter || this.tube >= this.tubeMax || this.store.reserve <= 0) { this.planned = this.fed; break; }
    }
    this.reloadProgress = this.planned > 0 ? Math.min(1, Math.max(0, inT) / (this.row.reload * this.planned)) : 1;
    if (this.fed >= this.planned && inT >= this.row.reload * this.planned) {
      this.phase = 'idle'; this.phaseT = 0; this.reloadProgress = 0; yield 'reloadEnd';
      if (this.dryAtStart && !this.chambered && this.tube > 0) { this.throwLever(); yield 'cycle'; }
    }
  }
}
/** One frame of an action's clock: all of `dt`, or on a link one fixed step for each command the frame sent, so a round chambers on the command it does on the server (P1-E6). */
export function stepActionClock(dt: number, wire: Pick<WeaponWire, 'steps'> | null, step: (seconds: number) => void): void {
  if (wire === null) { step(dt); return; }
  for (let at = 0, steps = wire.steps(); at < steps; at++) step(FIXED_STEP);
}
/** Trigger, cooldown and automatic reload owner, composing the existing transfer controller. */
export class RangedAction {
  /** Data-only per-round cycle owner; callers consume phase events on their original clock. */
  static readonly Cycle: typeof CyclingAction = CyclingAction;
  private static readonly clocks = v.object({ reloadT: finite, cooldown: finite, sinceFire: finite });
  private cooldown = 0;
  private sinceAction = 99;
  private readonly clock: RangedReload;
  private readonly weapon: RangedPort;
  private readonly row: RangedActionRow;
  constructor(weapon: RangedPort, row: RangedActionRow) {
    if (!Number.isInteger(row.maximum) || row.maximum < 1 || row.maximum > 65536
      || ![row.interval, row.reload, row.autoReload].every(value => Number.isFinite(value) && value >= 0 && value <= 3600)
      || row.reload === 0 || !['quiver', 'magazine'].includes(row.mode) || !['shot', 'empty'].includes(row.autoFrom)) throw new RangeError('Invalid ranged action row');
    this.weapon = weapon; this.row = row; this.clock = new RangedReload(row);
  }
  get ready(): boolean { return this.cooldown <= 0; }
  /** Admit the fire phase after reload/cooldown/loaded refusals. A native caller may fire after a true result instead of lending a callback. */
  trigger(fire?: () => void): boolean {
    const s = this.weapon.state;
    if (s.reloading || !this.ready) return false;
    if (this.row.mode === 'quiver' ? !s.loaded : (s.ammo ?? 0) <= 0) {
      this.weapon.onDry?.();
      if (this.row.autoFrom === 'empty') this.sinceAction = 0;
      this.reload(); return false;
    }
    fire?.(); return true;
  }
  /** Claim consumption at the old shot phase, before recoil, flight and fire callbacks. */
  shot(): void {
    const s = this.weapon.state;
    if (this.row.mode === 'quiver') { s.loaded = false; s.bolts = Math.max(0, (s.bolts ?? 0) - 1); }
    else { if (s.ammo === undefined) throw new Error('Magazine action requires ammunition'); s.ammo--; s.loaded = s.ammo > 0; }
    this.cooldown = this.row.interval;
    if (this.row.autoFrom === 'shot') this.sinceAction = 0;
  }
  reload(): void { this.clock.begin(this.weapon, this.row.maximum); }
  /** Historical source-clock fields; the caller owns ammunition and the surrounding save version. */
  snapshot(): { reloadT: number; cooldown: number; sinceFire: number } { return { reloadT: this.clock.snapshot(), cooldown: this.cooldown, sinceFire: this.sinceAction }; }
  /** Validate all clocks before a silent commit; no reload, transfer, callback or shot runs. Extra owner-envelope fields are ignored. */
  restore(value: unknown): void {
    const saved = v.parse(RangedAction.clocks, value);
    this.clock.restore(saved.reloadT); this.cooldown = saved.cooldown; this.sinceAction = saved.sinceFire;
  }
  /** Observe progress before transfer/end callbacks, preserving the action pose phase. */
  advance(dt: number, scale = 1, active = true, progress?: (value: number) => void): void {
    const s = this.weapon.state;
    this.cooldown = Math.max(0, this.cooldown - dt); this.sinceAction += dt;
    const empty = this.row.mode === 'quiver' ? !s.loaded && (s.bolts ?? 0) > 0 : (s.ammo ?? 0) <= 0 && s.reserve > 0;
    if (!s.reloading && empty && this.sinceAction > this.row.autoReload && active) this.reload();
    if (s.reloading) {
      const value = this.clock.progress(this.weapon, dt, this.row.reload, scale);
      progress?.(value);
      if (value >= 1) this.clock.finish(this.weapon, this.row.maximum);
    }
  }
}

/** The trigger template is shared; custom actions override readiness, cycling and reload hooks. */
export abstract class Firearm extends Weapon {
  protected sinceEmpty = 99;
  tryFire(): void {
    if (this.reloadingAction()) { this.onTriggerWhileReloading(); return; }
    if (!this.actionReady()) return;
    if (!this.roundReady()) { this.onDry?.(); this.sinceEmpty = 0; this.onEmptyTrigger(); return; }
    this.fire();
    this.onShot();
  }
  protected reloadingAction(): boolean { return this.state.reloading; }
  protected abstract actionReady(): boolean;
  protected roundReady(): boolean { return (this.state.ammo ?? 0) > 0; }
  protected onEmptyTrigger(): void { if (this.state.reserve > 0) this.reload(); }
  protected onTriggerWhileReloading(): void { /* magazine reload is uninterrupted */ }
  protected abstract fire(): void;
  protected cycle(_dt: number): void { /* semi-automatic default */ }
  protected reloadStep(_dt: number): void { /* magazine or custom action */ }
  protected animateAction(_t: number, _dt: number): void { /* authored moving parts */ }
  protected onShot(): void { /* custom action hook */ }
  protected autoReloadDue(): boolean { return false; }
}
