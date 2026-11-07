import { floorBelow } from '@wildshard/engine/physics/query';
import type { SimHost } from '@wildshard/engine/sim';
import type { PlayerSim } from '@wildshard/engine/sim/playerSim';
import type { PlaceArea } from '@wildshard/engine/quest/lastPlace';
import { mountedPlayerOf } from './riding/native';

/** Ticks between two reads of the feet: the page reads them four times a second. */
const OBSERVE_TICKS = 15;

/** The page's footing test: on foot on the ground, clear of the water. A headless shard's ground may be a height query, so the motor says. */
function feetOf(host: SimHost, player: PlayerSim): { x: number; y: number; z: number; grounded: boolean } {
  const { x, y, z } = player.position, floor = floorBelow(host.physics, x, z, y + 0.6, 1.2, player.motor.collider) ?? y, water = host.water?.surfaceAt(x, z) ?? null;
  return { x, y: floor, z, grounded: Math.abs(floor - y) < 0.3 && player.fall.grounded && player.mode === 'foot' && floor > (water ?? -Infinity) + 0.3 };
}

/**
 * J107 on the server: a fallen player goes back to their own last place, else the shard's spawn, alone, with everything they
 * earned kept. Nobody else moves and the world does not reset. A death a boss fight answered for is that fight's to place
 * (`BossContenders.fell`); this only starts its fade. A lone player outside a net room is left to its caller, as it always was.
 */
export function installRoomRespawn(host: SimHost, places: readonly PlaceArea[]): void {
  const book = host.respawn, serves = (): boolean => host.players.size > 1 || book.served;
  book.places = places;
  host.onStep('room.respawn', () => {
    if (!serves()) return;
    for (const player of host.players.values()) book.rebind(player.id, player.health);
    if (host.state.tick % OBSERVE_TICKS !== 0) return;
    book.keep(host.players);
    for (const player of host.players.values()) if (player.hasMotor && !player.borrowed && !host.parked.has(player.id) && !book.fading(player.id)) book.observe(player.id, feetOf(host, player));
  });
  host.events.on('player.died', ({ actor, checkpoint }) => {
    const player = host.players.get(actor.id);
    if (player === undefined || !serves() || player.borrowed || !player.hasMotor) return;
    book.fell(player.id, player.health);
    if (checkpoint) return;
    const stand = book.stand(player.id), { at, yaw } = host.level.player;
    mountedPlayerOf(host, player.id)?.dismount();
    player.resetPose(stand ?? at, stand?.yaw ?? yaw);
    host.events.emit('player.respawned', { at: player.position.clone(), checkpoint: false, player: player.id });
  }, host.scope);
}
