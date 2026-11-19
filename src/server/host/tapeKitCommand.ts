// ONE-FORMAT OF42b: a tape tick's player command, as the wire command a cell's client sends its declared kit.
import type { NetCommand } from '@wildshard/wire/netCommand';
import type { SimHost } from '@wildshard/engine/sim';
import { NET_BUTTONS } from '@wildshard/engine/input/netButtons';
import type { HeadlessCommand } from '../../shared/host/tickProtocol';

/** The page's canonical eye above the feet (`Player.sampleAimCommand`), as the kit strikes from. */
const EYE = 1.68;

/** One tape tick's player command as the wire command a declared kit takes (ONE-FORMAT OF42b), as cellWorld hands it a
 *  client's: an `attack` on a target aims from the player's eye at that body, a free `swing` along the look, and `heavy`
 *  is the HEAVY hold. A target the host does not hold (or a dead one) aims at nothing, and the press is dropped. */
export function tapeKitCommand(host: SimHost, player: string, command: Extract<HeadlessCommand, { kind: 'player' }>, seq: number): NetCommand {
  const pitch = command.pitch ?? 0, body = host.players.get(player);
  const base: NetCommand = { seq: command.seq ?? seq, viewTick: command.viewTick ?? 0, steer: { keyX: 0, keyY: 0, stickX: 0, stickY: 0 }, yaw: command.yaw, pitch,
    buttons: command.heavy === undefined ? 0 : NET_BUTTONS.heavy, ...(command.heavy?.targetId === undefined ? {} : { heavyTarget: command.heavy.targetId }) };
  if (body === undefined) return base;
  const origin = { x: body.position.x, y: body.position.y + EYE, z: body.position.z };
  if (command.attack !== undefined) {
    const target = host.entities.get(command.attack.targetId);
    if (target === undefined || !target.alive) return base;
    const to = { x: target.position.x - origin.x, y: target.position.y + target.dims.bodyY * target.scale - origin.y, z: target.position.z - origin.z }, length = Math.hypot(to.x, to.y, to.z);
    if (!(length > 0)) return base;
    return { ...base, attack: { targetId: command.attack.targetId, aim: { origin, direction: { x: to.x / length, y: to.y / length, z: to.z / length } } } };
  }
  // with a HEAVY hold, `swing` says the hold names no target: it charges, and is no press (the native weapon reads it so)
  if (command.swing !== true || command.heavy !== undefined) return base;
  const cos = Math.cos(pitch);
  return { ...base, attack: { aim: { origin, direction: { x: -Math.sin(command.yaw) * cos, y: Math.sin(pitch), z: -Math.cos(command.yaw) * cos } } } };
}
