// WIRE-STABILITY WR5: the game's own event values, said the wire v1 way and back. The wire's descriptors
// (`@wildshard/wire/events`) name the same fields the game does; the differences are the redo's own (5.3): a vector is
// an x, y, z struct, an absent value is absence rather than null, and a class goes by its stable id (index + 1).
import type { WireEvent } from '@wildshard/wire/game';
import type { NetCommand } from '@wildshard/wire/netCommand';
import type { NetRoomAct } from './acts';
import type { NetEvent, NetVector } from './messages';

/** A wire value, as the codec takes and gives it. */
type WireValue = WireEvent['fields'][string];
type WireStruct = WireEvent['fields'];

/** Class ids start at 1 on the wire (5.2); the game numbers its classes from 0. */
const FIRST_CLASS_ID = 1;
/** The event fields that are 3-vectors. */
const VECTORS: ReadonlySet<string> = new Set(['at', 'dir']);

const isVector = (key: string, value: unknown): value is NetVector => VECTORS.has(key) && Array.isArray(value) && value.length === 3;

function wireValue(key: string, value: unknown): WireValue {
  if (value === null || value === undefined) return undefined;
  if (isVector(key, value)) return { x: value[0], y: value[1], z: value[2] };
  if (Array.isArray(value)) return value.map(item => wireValue('', item));
  if (typeof value === 'object') return wireStruct(value);
  return typeof value === 'number' || typeof value === 'string' || typeof value === 'boolean' ? value : undefined;
}

/** A struct's fields; `skip` drops the event's own `kind`, never a nested one (a death cause has its own). */
function wireStruct(value: object, skip?: string): WireStruct {
  const out: Record<string, WireValue> = {};
  for (const [key, inner] of Object.entries(value)) if (key !== skip) out[key] = wireValue(key, inner);
  return out;
}

/** One game event as a wire event. */
export function toWireEvent(event: NetEvent): WireEvent {
  const fields = wireStruct(event, 'kind');
  if (event.kind === 'spawn') return { event: 'spawn', fields: { ...fields, cls: event.cls + FIRST_CLASS_ID } };
  if (event.kind === 'hit') return { event: 'hit', fields: { ...fields, blow: event.blow === true } };
  return { event: event.kind, fields };
}

function gameValue(key: string, value: WireValue): unknown {
  if (Array.isArray(value)) return (value as readonly WireValue[]).map(item => gameValue('', item));
  if (value !== null && typeof value === 'object') {
    const struct = value as WireStruct;
    if (VECTORS.has(key)) return [struct['x'], struct['y'], struct['z']];
    return gameStruct(struct);
  }
  return value;
}

function gameStruct(fields: WireStruct): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(fields)) if (value !== undefined) out[key] = gameValue(key, value);
  return out;
}

/**
 * A wire event as the game's, or null for one this build has no form for. The value has the wire's fields, which
 * admission upstream bounds; the spawn's class goes back to the game's index.
 */
export function fromWireEvent(event: WireEvent): NetEvent | null {
  const fields = gameStruct(event.fields);
  switch (event.event) {
    case 'spawn': return { kind: 'spawn', ...fields, cls: Number(fields['cls']) - FIRST_CLASS_ID } as unknown as NetEvent;
    case 'hit': {
      const { blow, ...rest } = fields;
      return { kind: 'hit', ...rest, ...(blow === true ? { blow: true } : {}) } as unknown as NetEvent;
    }
    case 'quest': return { kind: 'quest', ...fields, step: fields['step'] ?? null } as unknown as NetEvent;
    case 'despawn': case 'died': case 'phase': case 'reward': case 'travel': case 'ledger': case 'chat': case 'mount':
    case 'dismount': case 'owned': case 'view': case 'player-died':
      return { kind: event.event, ...fields } as unknown as NetEvent;
    default: return null;
  }
}

/** Maps a stable id to its net handle (0 for none), as the v0 command writer does. */
export type WireRefs = (id: string) => number;
/** Maps a net handle back to its stable id; undefined for a handle the room does not know. */
export type WireIds = (handle: number) => string | undefined;

const LOW_BYTE = 0x100;
const refOf = (id: string | undefined, refs: WireRefs): number | undefined => id === undefined ? undefined : refs(id);

/** One command as the wire's command struct: the high button byte rides apart, targets go as handles. */
export function toWireCommand(command: NetCommand, refs: WireRefs): WireStruct {
  const { attack, launcher } = command;
  return {
    seq: command.seq, viewTick: command.viewTick, steer: { ...command.steer }, yaw: command.yaw, pitch: command.pitch,
    buttons: command.buttons % LOW_BYTE, buttonsHigh: command.buttons >= LOW_BYTE ? Math.floor(command.buttons / LOW_BYTE) : undefined,
    attack: attack === undefined ? undefined : { targetId: attack.targetId === undefined ? undefined : refs(attack.targetId), aim: { origin: { ...attack.aim.origin }, direction: { ...attack.aim.direction } } },
    heavyTarget: refOf(command.heavyTarget, refs), lockTarget: refOf(command.lockTarget, refs), hookTarget: command.hookTarget,
    launcher: launcher === undefined ? undefined : { slot: launcher.slot, ads: launcher.ads, fire: launcher.fire === true },
  };
}

/** A handle the room must know, or a refusal (a command naming an unknown handle refuses, as in v0). */
function idOf(handle: WireValue, ids: WireIds): string {
  const id = typeof handle === 'number' ? ids(handle) : undefined;
  if (id === undefined) throw new RangeError('Command names an unknown handle');
  return id;
}
const struct = (value: WireValue): WireStruct => (value !== null && typeof value === 'object' && !Array.isArray(value) ? value as WireStruct : {});
const num = (value: WireValue): number => (typeof value === 'number' ? value : 0);
const vec = (value: WireValue): { x: number; y: number; z: number } => { const at = struct(value); return { x: num(at['x']), y: num(at['y']), z: num(at['z']) }; };

/** A decoded wire command as the game's NetCommand; admission (`NetCommandSchema`) bounds it after, as in v0. */
export function fromWireCommand(fields: WireStruct, ids: WireIds): NetCommand {
  const steer = struct(fields['steer']), attack = fields['attack'], launcher = fields['launcher'];
  const buttons = num(fields['buttons']) + (fields['buttonsHigh'] === undefined ? 0 : num(fields['buttonsHigh']) * LOW_BYTE);
  const aimed = attack === undefined ? undefined : (() => {
    const { targetId, aim } = struct(attack), { origin, direction } = struct(aim);
    return { ...(targetId === undefined ? {} : { targetId: idOf(targetId, ids) }), aim: { origin: vec(origin), direction: vec(direction) } };
  })();
  const fired = launcher === undefined ? undefined : (() => {
    const held = struct(launcher);
    return { slot: num(held['slot']), ads: num(held['ads']), ...(held['fire'] === true ? { fire: true as const } : {}) };
  })();
  return {
    seq: num(fields['seq']), viewTick: num(fields['viewTick']),
    steer: { keyX: num(steer['keyX']), keyY: num(steer['keyY']), stickX: num(steer['stickX']), stickY: num(steer['stickY']) },
    yaw: num(fields['yaw']), pitch: num(fields['pitch']), buttons,
    ...(aimed === undefined ? {} : { attack: aimed }),
    ...(fields['heavyTarget'] === undefined ? {} : { heavyTarget: idOf(fields['heavyTarget'], ids) }),
    ...(fields['lockTarget'] === undefined ? {} : { lockTarget: idOf(fields['lockTarget'], ids) }),
    ...(fields['hookTarget'] === undefined ? {} : { hookTarget: num(fields['hookTarget']) }),
    ...(fired === undefined ? {} : { launcher: fired }),
  };
}

/** One act as the wire's act union: its seq, then its arm by the act's kind. */
export function toWireAct(act: NetRoomAct): WireStruct {
  return { seq: act.seq, act: { arm: act.kind, fields: wireStruct(act, 'kind') } };
}

/** A decoded wire act as the game's; admission bounds it after, as in v0. */
export function fromWireAct(fields: WireStruct): NetRoomAct {
  const { arm, fields: inner } = struct(fields['act']);
  return { kind: arm, ...gameStruct(struct(inner)), seq: num(fields['seq']) } as unknown as NetRoomAct;
}
