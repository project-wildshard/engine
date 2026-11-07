/** Raw local inputs, kept separate because keyboard holds and analog strength can select different motion. */
export interface LocalSteer { readonly keyX: number; readonly keyY: number; readonly stickX: number; readonly stickY: number }
/** A traversal's last consumed local controls, sampled without asking live device state again.
 * Uses the existing version-1 fields; the caller detaches the raw axes before recording. */
export interface RideCommandSample { readonly steer: LocalSteer; readonly sprint: boolean; readonly jump: boolean }
/** Additive raw-input protocol. New fields require version 1; absent fields retain legacy command bytes. */
export interface LocalMovementCommand {
  readonly commandVersion?: 1;
  readonly steer?: LocalSteer;
  readonly sprint?: boolean;
  readonly crouch?: boolean;
}
/** Reject malformed/new-version movement before a host changes clocks or physics. */
export function validateLocalMovement(command: { readonly commandVersion?: number; readonly steer?: unknown; readonly sprint?: unknown; readonly crouch?: unknown }): void {
  if (command.commandVersion !== undefined && command.commandVersion !== 1) throw new RangeError('Unsupported movement command version');
  if ((command.steer !== undefined || command.sprint !== undefined || command.crouch !== undefined) && command.commandVersion !== 1) throw new RangeError('Raw movement requires commandVersion 1');
  if ((command.sprint !== undefined && typeof command.sprint !== 'boolean') || (command.crouch !== undefined && typeof command.crouch !== 'boolean')) throw new RangeError('Invalid held movement');
  const steer = command.steer;
  if (steer !== undefined && (steer === null || typeof steer !== 'object' || Object.keys(steer).length !== 4
    || !('keyX' in steer) || !('keyY' in steer) || !('stickX' in steer) || !('stickY' in steer)
    || ![steer.keyX, steer.keyY, steer.stickX, steer.stickY].every(axis => typeof axis === 'number' && Number.isFinite(axis) && axis >= -1 && axis <= 1))) throw new RangeError('Invalid raw movement axes');
}

/** World-space aim is command data, independent of camera shake, bob and render interpolation. */
export interface AimCommand {
  readonly origin: { readonly x: number; readonly y: number; readonly z: number };
  readonly direction: { readonly x: number; readonly y: number; readonly z: number };
}

/** Weapon action plus its detached world-space aim, shared by live input and replay. */
export interface FightCommand {
  readonly aim: AimCommand;
  readonly action: 'attack' | 'reload';
}
