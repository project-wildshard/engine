import { floorBelow } from '@wildshard/engine/physics/query';
import type { SimHost } from '@wildshard/engine/sim';
import type { PlayerSim } from '@wildshard/engine/sim/playerSim';
import type { PlaceArea } from '@wildshard/engine/quest/lastPlace';
import { actRoutes } from '@wildshard/engine/sim/actRoutes';
import { mountedPlayerOf } from './riding/native';

/** Ticks between two reads of the feet: the page reads them four times a second. */
const OBSERVE_TICKS = 15;
/** Ticks between two Unstucks a player may take: 10 s at the 60 Hz tick. */
const UNSTUCK_TICKS = 600;

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
  /** Where a fall puts a player: their own last place, else the shard's spawn, off any mount. */
  const place = (player: PlayerSim): void => {
    const stand = book.stand(player.id), { at, yaw } = host.level.player;
    mountedPlayerOf(host, player.id)?.dismount();
    player.resetPose(stand ?? at, stand?.yaw ?? yaw);
  };
  host.events.on('player.died', ({ actor, checkpoint }) => {
    const player = host.players.get(actor.id);
    if (player === undefined || !serves() || player.borrowed || !player.hasMotor) return;
    book.fell(player.id, player.health);
    if (checkpoint) return;
    place(player);
    host.events.emit('player.respawned', { at: player.position.clone(), checkpoint: false, player: player.id });
  }, host.scope);
  // Jake, 2026-11-12: "Need a button in <dev> to unstuck in settings, unstuck will respawn me like the death behavior but gets
  // me unstuck". The page's Unstuck (UNSTUCK_ACT) lands here: the fall's place, with no fall counted, no fade, health as it
  // stands and no `player.respawned` (that refills ammunition). Any client can send it, so it is no escape hatch: never while
  // something leads the player (a boss's intro, a traversal, a fall's fade), and at most once per UNSTUCK_TICKS.
  const lastUnstuck = new Map<string, number>();
  actRoutes(host).unstuck = id => {
    const player = host.players.get(id), tick = host.state.tick, last = lastUnstuck.get(id);
    if (player === undefined || host.disposed || host.embedded || player.borrowed || !player.hasMotor || host.parked.has(id) || player.led) return;
    if (last !== undefined && tick - last < UNSTUCK_TICKS) return;
    lastUnstuck.set(id, tick);
    place(player);
  };
}
