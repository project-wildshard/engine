import type { NetCommand } from '@wildshard/wire/netCommand';
import { NET_BUTTONS } from '../input/netButtons';
import { localWalkingMove } from '../player/walk';
import type { SimCommand } from '../../../server/engine/sim';

/** What a NetCommand means to the movement law: a version-1 command, world move resolved from its raw axes. Pitch, the
 *  swing's aim, a heavy hold and a launcher belong to the weapon systems, which read them from the tick's commands. */
export function netSimCommand(command: NetCommand): SimCommand {
  const move = { x: 0, z: 0 }, { steer, attack, buttons, lockTarget } = command;
  localWalkingMove(steer, command.yaw, move);
  return { moveX: move.x, moveZ: move.z, yaw: command.yaw, commandVersion: 1, steer: { ...steer },
    sprint: (buttons & NET_BUTTONS.sprint) !== 0, crouch: (buttons & NET_BUTTONS.crouch) !== 0,
    dive: (buttons & NET_BUTTONS.dive) !== 0, surface: (buttons & NET_BUTTONS.surface) !== 0,
    ...(attack?.targetId === undefined ? {} : { attack: { targetId: attack.targetId } }), ...(lockTarget === undefined ? {} : { lockTarget }),
    ...((buttons & NET_BUTTONS.hover) === 0 ? {} : { hover: true as const }), ...((buttons & NET_BUTTONS.jump) === 0 ? {} : { jump: true as const }),
    ...((buttons & NET_BUTTONS.dodge) === 0 ? {} : { dodge: true as const }), ...((buttons & NET_BUTTONS.boost) === 0 ? {} : { boost: true as const }) };
}
