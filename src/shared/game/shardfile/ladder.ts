import { Vector3 } from 'three';
import * as v from 'valibot';
import { LadderModeSchema, type LadderMode } from '@wildshard/format/modes';
import type { SimHost } from '@wildshard/engine/sim';
import type { PlayerModes } from '@wildshard/engine/player/modes';
import type { CharacterMotor } from '@wildshard/engine/physics/CharacterMotor';
import type { PlayerSim } from '@wildshard/engine/sim/playerSim';

/** World-space ordinary movement; jump/dodge, swimming, riding and the board hand control back to their owners. */
export interface LadderCommand { x: number; z: number; release: boolean }
/** The page retains its actual Player, controls and registry when lending a simulation. */
export interface LadderClientPorts { modes: Pick<PlayerModes<never>, 'register'>; enabled: () => boolean; command: () => LadderCommand; claimed: () => void }
const Saved: v.GenericSchema<BoundedLadderSaveInput, BoundedLadderSave> = v.strictObject({ recipe: v.pipe(v.string(), v.maxLength(65_536)), route: v.nullable(v.string()), exit: v.boolean(), latched: v.boolean() });
const RoomSaved = v.looseObject({ others: v.exactOptional(v.record(v.string(), v.unknown())) });

/** Fixed-step climb law shared by the real page and Node; every translation goes through the real capsule motor. */
export class LadderDriver {
  private readonly rows: readonly LadderMode[];
  private readonly recipe: string;
  private row: LadderMode | undefined;
  private exiting = false;
  private latched = false;
  private readonly delta = new Vector3();
  constructor(rows: readonly LadderMode[]) {
    if (rows.length > 64) throw new Error('Too many ladder routes');
    this.rows = rows.map(row => v.parse(LadderModeSchema, row));
    this.recipe = JSON.stringify(this.rows);
    if (new Set(rows.map(row => row.id)).size !== rows.length) throw new Error('Duplicate ladder identity');
  }
  /** Read-only attachment state; no prompt, rewards, equipment or presentation are granted. */
  get active(): boolean { return this.row !== undefined; }
  /** Claims the ordinary traversal phase only when attached; colliders still stop every part of the route. */
  step(dt: number, command: LadderCommand, feet: Vector3, motor: Pick<CharacterMotor, 'move'>): boolean {
    if (!Number.isFinite(dt) || dt <= 0 || dt > 0.1 || !Number.isFinite(command.x) || !Number.isFinite(command.z) || typeof command.release !== 'boolean') throw new Error('Invalid ladder command');
    const input = Math.hypot(command.x, command.z);
    if (input < 0.1) this.latched = false;
    if (command.release) { this.row = undefined; this.exiting = false; this.latched = true; return false; }
    if (this.row === undefined && !this.latched) {
      for (const candidate of this.rows) {
        const toward = -(command.x * candidate.normal.x + command.z * candidate.normal.z);
        const bottom = Math.abs(feet.y - candidate.bottom.y) <= 0.3 && Math.hypot(feet.x - candidate.bottom.x, feet.z - candidate.bottom.z) <= candidate.reach;
        const top = Math.abs(feet.y - candidate.top.y) <= 0.3 && Math.hypot(feet.x - candidate.top.x, feet.z - candidate.top.z) <= candidate.reach;
        if ((bottom && toward > 0.2) || (top && toward < -0.2)) { this.row = candidate; break; }
      }
    }
    const row = this.row; if (row === undefined) return false;
    // A displaced body cannot keep an attachment by stale continuation alone.
    if (feet.y < row.bottom.y - 0.3 || feet.y > row.top.y + 0.3 || (!this.exiting && Math.hypot(feet.x - row.bottom.x, feet.z - row.bottom.z) > row.reach + 0.1)) {
      this.row = undefined; this.exiting = false; this.latched = true; return false;
    }
    const speed = row.speed * dt;
    if (this.exiting) {
      this.delta.set(row.exit.x - feet.x, row.exit.y - feet.y, row.exit.z - feet.z).clampLength(0, speed);
      motor.move(feet, this.delta);
      if (feet.distanceTo(row.exit) < 0.03) { this.row = undefined; this.exiting = false; this.latched = true; }
      return true;
    }
    const along = Math.max(-1, Math.min(1, -(command.x * row.normal.x + command.z * row.normal.z)));
    this.delta.set(row.bottom.x - feet.x, Math.max(row.bottom.y, Math.min(row.top.y, feet.y + speed * along)) - feet.y, row.bottom.z - feet.z);
    // Align by sweeping, never snapping the feet onto the ladder.
    const horizontal = Math.hypot(this.delta.x, this.delta.z);
    if (horizontal > speed) { this.delta.x *= speed / horizontal; this.delta.z *= speed / horizontal; }
    motor.move(feet, this.delta);
    if (along > 0 && feet.y >= row.top.y - 0.001) this.exiting = true;
    if (along < 0 && feet.y <= row.bottom.y + 0.03) { this.row = undefined; this.latched = true; }
    return true;
  }
  /** Release a paused/left client without moving the capsule or sampling controls. */
  release(): void { if (this.row !== undefined) this.latched = true; this.row = undefined; this.exiting = false; }
  /** Copied continuation, independent of controls and owned capsule snapshot state. */
  snapshot(): v.InferOutput<typeof Saved> { return { recipe: this.recipe, route: this.row?.id ?? null, exit: this.exiting, latched: this.latched }; }
  /** Validate atomically without moving a body or sampling input; only admitted routes may be restored. */
  restore(value: unknown): void {
    const saved = v.parse(Saved, value), row = this.rows.find(candidate => candidate.id === saved.route);
    if (saved.recipe !== this.recipe || (saved.route !== null && row === undefined) || (saved.exit && row === undefined) || (saved.latched && row !== undefined)) throw new Error('Invalid ladder continuation');
    this.row = row; this.exiting = saved.exit; this.latched = saved.latched;
  }
}

/** One player's hold on the ladders: their own driver and controls on their own capsule. */
interface Climber { readonly player: PlayerSim; readonly driver: LadderDriver }
/** Installs the data-only mode into the existing player phase, one climber a player; no rows means no driver, adapter or
 * snapshot change. A borrowed page lends one player and its controls; an owned host seats each player on their first tick. */
export function installLadders(host: SimHost, rows: readonly LadderMode[], client?: LadderClientPorts): void {
  if (rows.length === 0) return;
  if (host.embedded && client === undefined) throw new Error('Borrowed ladder mode requires its real player controls');
  const climbers = new Map<string, Climber>();
  const climberFor = (player: PlayerSim): Climber => {
    const known = climbers.get(player.id); if (known?.player === player) return known;
    const driver = new LadderDriver(rows), idle: LadderCommand = { x: 0, z: 0, release: false };
    let input = idle;
    if (!host.embedded) player.useDriver({ input: command => {
      idle.x = command?.moveX ?? 0; idle.z = command?.moveZ ?? 0;
      idle.release = command?.jump === true || command?.dodge === true || command?.hover !== undefined || player.board.on || player.swim.on;
      input = idle; return false;
    }, step: () => undefined });
    const traverse = (dt: number): boolean => {
      if (client !== undefined && !client.enabled()) { driver.release(); return false; }
      const claimed = driver.step(dt, client?.command() ?? input, player.position, player.motor);
      if (claimed) { if (client === undefined) { player.velocity.set(0, 0, 0); player.fall.grounded = false; } else client.claimed(); }
      return claimed;
    };
    if (client === undefined) player.modes.register({ id: 'climb', hud: 'none', traverse }, host.scope, { events: host.events });
    else client.modes.register({ id: 'climb', hud: 'none', traverse }, host.scope, { events: host.events });
    const climber = { player, driver }; climbers.set(player.id, climber); return climber;
  };
  const firstPlayer = host.players.values().next();
  if (firstPlayer.done === true) throw new Error('Simulation host has no player');
  const first = climberFor(firstPlayer.value);
  // A client walks up to the rung and the server takes the climb from there: it runs no ladder of its own (J130).
  if (client === undefined) host.leading.push(player => climbers.get(player.id)?.driver.active === true);
  host.onStep('modes.ladder', () => {
    if (client !== undefined) return;
    for (const id of climbers.keys()) if (!host.players.has(id)) climbers.delete(id);
    for (const player of host.players.values()) climberFor(player);
  }, { snapshot: () => {
    const others = [...climbers.values()].filter(climber => climber !== first).map(climber => [climber.player.id, climber.driver.snapshot()]);
    return { ...first.driver.snapshot(), ...(others.length === 0 ? {} : { others: Object.fromEntries(others) }) };
  }, restore: value => {
    const saved = v.parse(RoomSaved, value), { others = {}, ...own } = saved;
    first.driver.restore(own);
    for (const [id, row] of Object.entries(others)) {
      const player = host.players.get(id); if (player === undefined) throw new Error('Invalid ladder continuation');
      climberFor(player).driver.restore(row);
    }
  } });
}

/** Complete admitted data, independent of validator implementation metadata. */
type BoundedLadderSaveInput = BoundedLadderSave;
interface BoundedLadderSaveFields {
    recipe: string;
    route: string | null;
    exit: boolean;
    latched: boolean;
}
type BoundedLadderSave = { [Key in keyof BoundedLadderSaveFields]: BoundedLadderSaveFields[Key] };
