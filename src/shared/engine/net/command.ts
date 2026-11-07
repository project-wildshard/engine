// P1-E5.2 (E5-REPLICATION §4.2): NetCommand on the wire. One command is about 14 bytes; a bundle carries every sim step
// the client frame ran plus up to 4 older unacked commands, so a lost packet costs no input.
import type { NetAim, NetCommand } from '@wildshard/format/netCommand';
import { NET_BUTTONS } from '../input/netButtons';
import { bitsToFloat, BitReader, floatToBits, NetDecodeError, type BitWriter } from './bits';
import { MSG_CMDS } from './messages';
import type { NetRefs } from './schema';

/** Buttons that fire once on their `seq`, LOCK's toggle among them; the rest are holds, and only holds last through an empty tick. */
export const NET_PRESSES: number = NET_BUTTONS.jump | NET_BUTTONS.dodge | NET_BUTTONS.hover | NET_BUTTONS.lock;
/** The most commands one bundle may carry: MAX_FIXED_STEPS new ones plus 4 redundant copies. */
export const MAX_BUNDLE = 7;
/** Maps a net handle back to its stable id; undefined for a handle the room does not know. */
export type NetIds = (handle: number) => string | undefined;

const TAU = Math.PI * 2, YAW_STEPS = 0x10000, PITCH_TOP = 0xffff, AXIS = 127;
/** True when wrapping `seq` is newer than `than`. */
export function seqAfter(seq: number, than: number): boolean { const gap = (seq - than) & 0xffff; return gap !== 0 && gap < 0x8000; }

const packAxis = (value: number): number => Math.round(value * AXIS) + AXIS + 1;
const unpackAxis = (value: number): number => (value - AXIS - 1) / AXIS;
const writeFloat = (writer: BitWriter, value: number): void => { writer.write(floatToBits(value), 32); };
const readFloat = (reader: BitReader): number => bitsToFloat(reader.read(32));

function writeAim(writer: BitWriter, aim: NetAim): void {
  for (const value of [aim.origin.x, aim.origin.y, aim.origin.z, aim.direction.x, aim.direction.y, aim.direction.z]) writeFloat(writer, value);
}
function readAim(reader: BitReader): NetAim {
  return { origin: { x: readFloat(reader), y: readFloat(reader), z: readFloat(reader) }, direction: { x: readFloat(reader), y: readFloat(reader), z: readFloat(reader) } };
}
const writeRef = (writer: BitWriter, id: string | undefined, refs: NetRefs): void => { writer.write(id === undefined ? 0 : refs(id), 16); };
function readRef(reader: BitReader, ids: NetIds): string {
  const id = ids(reader.read(16));
  if (id === undefined) throw new NetDecodeError('Command names an unknown handle');
  return id;
}

/** The steer, yaw and pitch the server will decode from `command`, so a client steps what it sends (P1-E5.3-C4). The yaw keeps
 *  its turns: the server's is the same angle, and the view must not jump a turn. */
export function quantiseCommand<C extends Pick<NetCommand, 'steer' | 'yaw' | 'pitch'>>(command: C): C {
  const axis = (value: number): number => unpackAxis(packAxis(value)), { steer } = command;
  return { ...command, steer: { keyX: axis(steer.keyX), keyY: axis(steer.keyY), stickX: axis(steer.stickX), stickY: axis(steer.stickY) },
    yaw: Math.round(command.yaw / TAU * YAW_STEPS) / YAW_STEPS * TAU, pitch: (Math.round((command.pitch / Math.PI + 0.5) * PITCH_TOP) / PITCH_TOP - 0.5) * Math.PI };
}

/** Write one command. A target the receiver has no handle for goes as none. */
export function writeCommand(writer: BitWriter, command: NetCommand, refs: NetRefs): void {
  const { steer, attack, launcher, heavyTarget, lockTarget, hookTarget } = command;
  writer.write(command.seq, 16); writer.write(command.viewTick, 16);
  for (const value of [steer.keyX, steer.keyY, steer.stickX, steer.stickY]) writer.write(packAxis(value), 8);
  writer.write(Math.round((((command.yaw % TAU) + TAU) % TAU) / TAU * YAW_STEPS) % YAW_STEPS, 16);
  writer.write(Math.round((command.pitch / Math.PI + 0.5) * PITCH_TOP), 16);
  // the common eight, then the rare ones only when one is down: a plain command stays at its design size
  writer.write(command.buttons & 0xff, 8); writer.writeBool(command.buttons > 0xff); if (command.buttons > 0xff) writer.write(command.buttons >> 8, 8);
  writer.writeBool(attack !== undefined); writer.writeBool(heavyTarget !== undefined); writer.writeBool(lockTarget !== undefined); writer.writeBool(hookTarget !== undefined); writer.writeBool(launcher !== undefined);
  if (attack !== undefined) { writer.writeBool(attack.targetId !== undefined); if (attack.targetId !== undefined) writeRef(writer, attack.targetId, refs); writeAim(writer, attack.aim); }
  if (heavyTarget !== undefined) writeRef(writer, heavyTarget, refs);
  if (lockTarget !== undefined) writeRef(writer, lockTarget, refs);
  if (hookTarget !== undefined) writer.write(hookTarget, 16);
  if (launcher !== undefined) { writer.write(launcher.slot, 5); writer.write(Math.round(launcher.ads * 255), 8); writer.writeBool(launcher.fire === true); }
}

/** Read one command. Its bounds are not checked here: admission (`NetCommandSchema`) does that on the decoded value. */
export function readCommand(reader: BitReader, ids: NetIds): NetCommand {
  const seq = reader.read(16), viewTick = reader.read(16);
  const steer = { keyX: unpackAxis(reader.read(8)), keyY: unpackAxis(reader.read(8)), stickX: unpackAxis(reader.read(8)), stickY: unpackAxis(reader.read(8)) };
  const yaw = reader.read(16) / YAW_STEPS * TAU, pitch = (reader.read(16) / PITCH_TOP - 0.5) * Math.PI, low = reader.read(8), buttons = reader.readBool() ? low | (reader.read(8) << 8) : low;
  const hasAttack = reader.readBool(), hasHeavy = reader.readBool(), hasLock = reader.readBool(), hasHook = reader.readBool(), hasLauncher = reader.readBool();
  const attack = hasAttack ? (() => { const targeted = reader.readBool(), targetId = targeted ? readRef(reader, ids) : undefined, aim = readAim(reader); return targetId === undefined ? { aim } : { targetId, aim }; })() : undefined;
  const heavyTarget = hasHeavy ? readRef(reader, ids) : undefined, lockTarget = hasLock ? readRef(reader, ids) : undefined, hookTarget = hasHook ? reader.read(16) : undefined;
  const launcher = hasLauncher ? (() => { const slot = reader.read(5), ads = reader.read(8) / 255; return reader.readBool() ? { slot, ads, fire: true as const } : { slot, ads }; })() : undefined;
  return { seq, viewTick, steer, yaw, pitch, buttons, ...(attack === undefined ? {} : { attack }), ...(heavyTarget === undefined ? {} : { heavyTarget }), ...(lockTarget === undefined ? {} : { lockTarget }), ...(hookTarget === undefined ? {} : { hookTarget }), ...(launcher === undefined ? {} : { launcher }) };
}

/** The `cmds` message: the newest frame the client holds, then its bundle. */
export interface CommandBundle { readonly ackFrame: number; readonly commands: readonly NetCommand[] }
/** Encode a `cmds` message. */
export function encodeCommands(writer: BitWriter, bundle: CommandBundle, refs: NetRefs): ArrayBuffer {
  if (bundle.commands.length > MAX_BUNDLE) throw new RangeError('Command bundle exceeds its cap');
  writer.write(MSG_CMDS, 8); writer.write(bundle.ackFrame, 32); writer.write(bundle.commands.length, 8);
  for (const command of bundle.commands) writeCommand(writer, command, refs);
  return writer.finish();
}
/** Decode a `cmds` message, or null when it is malformed or floods its cap. */
export function decodeCommands(bytes: Uint8Array, ids: NetIds): CommandBundle | null {
  try {
    const reader = new BitReader(bytes);
    if (reader.read(8) !== MSG_CMDS) return null;
    const ackFrame = reader.read(32), count = reader.read(8);
    if (count > MAX_BUNDLE) return null;
    const commands: NetCommand[] = [];
    for (let index = 0; index < count; index++) commands.push(readCommand(reader, ids));
    reader.end();
    return { ackFrame, commands };
  } catch (error) { if (error instanceof NetDecodeError) return null; throw error; }
}
