import type { Vector3, Matrix4, Quaternion } from 'three';
import { shotRandom } from './shotSpread';
import { Equipment, type WeaponId, type EquipmentRow, type EquipContext } from './Equipment';
import type { AimCommand, FightCommand } from '../input/commands';
import type { WeaponChargePhase } from '../../../client/engine/combat/cues';

export type ImpactSurface = 'wood' | 'ground' | 'flesh';
export interface ViewFrame { matrixWorld: Matrix4; getWorldDirection: (dir: Vector3) => Vector3 }
/** Minimal view port; simulation does not import the renderer's scene types. */
export interface EquipmentView { visible: boolean; parent: ViewFrame | null; removeFromParent: () => void }

export interface WeaponState {
  ammo: number | undefined; magazine: number; reserve: number;
  loaded: boolean; reloading: boolean; reloadProgress: number; ads: boolean;
  /** Compatibility for the existing quiver/bolt source code, removed with the ranged family move. */
  bolts?: number;
}
export interface AimInfo { kind: string; distance: number }
/** A blow of this client's that the server settled (J47), in the page's terms. `at` is where its shooter saw it land. */
export interface OwnHit { readonly kind: string; readonly at: Vector3; readonly head: boolean; readonly killed: boolean; readonly amount: number; readonly seq: number }
/** A held weapon's line to the server when one owns its player (P1-E5.3-E1): what its next command should carry. */
export interface WeaponWire {
  /** An attack press. `started`: it started here, which the server confirms or
   * refuses. `heavy` marks this one command without changing the held draw. */
  readonly press: (started: boolean, heavy?: boolean) => void;
  /** A held item's own second action, pressed: a fan's gust. */
  readonly secondary?: () => void;
  /** The heavy, or a draw: held down this step. */
  readonly hold: (heavy: boolean) => void;
  /** A launcher's trigger, at this aim. The server's slot is the one it says this player holds. */
  readonly fire: (ads: number) => void;
  /** Run this once the next command has stepped: the server's seat starts a lunge after the tick's move, so a dash here waits too. */
  readonly afterStep: (run: () => void) => void;
  /** Commands this frame has sent: a swing's clock takes one step for each, so it keeps the server's count (P1-E5.3-E1). */
  readonly steps: () => number;
  /** A reload this weapon started by itself or on a button: the server starts its own, for the slot it says this player holds. */
  readonly reload: () => void;
  /** The `seq` the next command takes. */
  readonly nextSeq: () => number;
  /** A shot that left on a command already gone (a loose, on the step that let go): the server must confirm or refuse it. */
  readonly shot: (seq: number) => void;
  /** This row is now in hand here. The server hears of it, and the weapon it answers with is the one this player holds. */
  readonly equip: (row: string) => void;
  /** FM4: may a player's swap start now? An online page says no while its link is down, so the swap isn't sent late. */
  readonly mayEquip?: () => boolean;
  /** The player used this named interaction, which the server judges. */
  readonly interact: (id: string) => void;
}
export interface WeaponHooks {
  onFire?: (() => void) | undefined;
  onHit?: ((kind: string, headshot: boolean, killed: boolean) => void) | undefined;
  onImpact?: ((surface: ImpactSurface, point: Vector3) => void) | undefined;
  onReloadStart?: (() => void) | undefined;
  onReloadEnd?: (() => void) | undefined;
  onDry?: (() => void) | undefined;
}
export abstract class Weapon extends Equipment implements WeaponHooks {
  readonly slot = 'main';
  override readonly id: WeaponId;
  constructor(row: EquipmentRow) {
    super(row);
    if (row.legacySlot === undefined) throw new Error(`Equipment ${row.id} has no main slot`);
    this.id = row.legacySlot;
  }
  private commandedAim: AimCommand | null = null;
  private aimSource: (() => AimCommand) | null = null;
  /** Live input edge supplies command data; recorded fights set an explicit command instead. */
  setAimSource(source: () => AimCommand): void { this.aimSource = source; }
  setAimCommand(command: AimCommand | null): void {
    this.commandedAim = command === null ? null : { origin: { ...command.origin }, direction: { ...command.direction } };
  }
  executeCommand(command: FightCommand): void {
    this.setAimCommand(command.aim);
    try {
      if (command.action === 'attack') this.tryFire(); else this.reload();
    } finally { this.setAimCommand(null); }
  }
  abstract readonly model: EquipmentView;
  abstract readonly state: WeaponState;
  abstract adsHeld: boolean;
  altHeld = false;
  abstract aimInfo: AimInfo | null;
  declare readonly reach?: number;
  get charge(): number | undefined { return undefined; }
  ammoSelect?: (() => void) | undefined;
  onFire?: WeaponHooks['onFire']; onHit?: WeaponHooks['onHit']; onImpact?: WeaponHooks['onImpact'];
  /** Set where a server owns the player; null on a page, whose own contact settles every blow. */
  wire: WeaponWire | null = null;
  onReloadStart?: WeaponHooks['onReloadStart']; onReloadEnd?: WeaponHooks['onReloadEnd']; onDry?: WeaponHooks['onDry'];
  override install(ctx: EquipContext): void {
    super.install(ctx);
    ctx.scope.onDispose(() => { this.model.visible = false; this.model.removeFromParent(); });
  }
  get hasAmmo(): boolean { return this.row.ui.ammo !== undefined; }
  get ammoLabel(): string { return this.row.ui.ammo?.label ?? ''; }
  get segments(): number { return this.row.ui.ammo?.segments ?? 0; }
  chargeEvent(phase: WeaponChargePhase, value?: number): void {
    this.equipEvents?.emit('weapon.charge', { id: this.row.id, phase, ...(value === undefined ? {} : { value }) });
  }
  abstract tryFire(): void;
  /** The server's word on this weapon's blow, where one owns the player (J47): what a contact plays here without one. */
  serverHit(hit: OwnHit): void { this.onHit?.(hit.kind, hit.head, hit.killed); this.onImpact?.('flesh', hit.at); }
  /** The server refused the start this weapon predicted (P1-E5.3-E5). */
  attackRefused(): void { /* A weapon with no running start has nothing to let go of. */ }
  /** A shot's random draws: its own off the wire, so client and server fly one shot (P1-E5.3-E4), else the world's. */
  shotDraws(world: () => number): () => number { return this.wire === null ? world : shotRandom(this.wire.nextSeq()); }
  reload(): void { /* Melee weapons and tools have no reload action. */ }
  addBolts(_n: number): void { /* Ammo families override the refill. */ }
  /** What the server says this weapon holds: a server's count is the count. */
  mirrorArrows(_count: number): void { /* Only a bow's arrows are counted on the wire. */ }
  aimRay(origin: Vector3, dir: Vector3): Vector3 {
    const aim = this.commandedAim ?? this.aimSource?.();
    if (aim === undefined) throw new Error(`Equipment ${this.row.id} has no aim command source`);
    origin.copy(aim.origin); return dir.copy(aim.direction);
  }
  /** Rotation of the commanded heading, for authored sweep/launch offsets (no presentation roll). */
  aimPose(origin: Vector3, rotation: Quaternion): void {
    const aim = this.commandedAim ?? this.aimSource?.();
    if (aim === undefined) throw new Error(`Equipment ${this.row.id} has no aim command source`);
    origin.copy(aim.origin);
    const yaw = Math.atan2(-aim.direction.x, -aim.direction.z);
    const pitch = Math.asin(Math.max(-1, Math.min(1, aim.direction.y)));
    const cy = Math.cos(yaw / 2), sy = Math.sin(yaw / 2), cp = Math.cos(pitch / 2), sp = Math.sin(pitch / 2);
    rotation.set(sp * cy, cp * sy, -sp * sy, cp * cy);
  }
  setActive(on: boolean): void { this.model.visible = on; if (!on) this.enabled = false; }
}
/** Keep the actual bolt/quiver object: legacy code mutates bolts while the service/HUD reads ammo. */
export function quiverState(state: { bolts: number; loaded: boolean; reloading: boolean; reloadProgress: number; ads: boolean }, magazine: number): WeaponState & { bolts: number; ammo: number } {
  const result = Object.assign(state, { ammo: state.bolts, magazine, reserve: 0 });
  Object.defineProperty(result, 'ammo', { enumerable: true, get: () => state.bolts, set: (n: number) => { state.bolts = n; } });
  return result;
}
