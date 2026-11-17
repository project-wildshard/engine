import type { SystemSpec } from '@wildshard/engine/app/systems';
import type { MoverPose } from '@wildshard/engine/physics/mover';
import type { FollowedMovers } from './followedMovers';

/** What the page shows a steer ride in: its speed (a share of the boosted top speed) and whether it boosts, or nothing. */
export interface SteerRideView { show: (ride: { readonly speed: number; readonly boosting: boolean } | null) => void }
/** The page's player as a steer ride reads and turns it: the view looks along `yaw` (forward is (-sin yaw, -cos yaw), as a
 *  steer vehicle's heading). */
export interface SteerRider { yaw: number; readonly position: { readonly x: number; readonly y: number; readonly z: number } }
/** How near its seat the led body stands on the vehicle it rides (m): a row and the lead arrive a step apart. */
const SEAT_REACH = 1.5;
/** Seconds without a look before the view swings back behind the heading, and how fast it does (per second). */
export const STEER_RECENTRE = { idle: 0.8, rate: 2.5 } as const;
/** Below this speed (m/s) the view stays where the rider put it. */
const RECENTRE_SPEED = 0.5;
/** How fast the shown speed follows the measured one (per second): a row's step is a frame's jitter. */
const SPEED_EASE = 8;
const angle = (a: number): number => Math.atan2(Math.sin(a), Math.cos(a));

/**
 * SHARD-SOURCE SS-MS2a3: a steer vehicle on the page. The server leads the rider's body (`led`) and steers the vehicle by the
 * rider's stick split along its heading (SS-MS2a1b), and its sprint or boost (Shift; on a phone, the stick pushed all the way)
 * boosts it. Here the page finds the vehicle it rides (led, and its seat under the body), shows only that vehicle's leave
 * prompt (`FollowedMovers.steered`), faces the heading on boarding, turns the view with it and swings it back behind once the rider stops looking,
 * so the stick's forward is the sail's, and shows the speed and the boost.
 */
export function installSteerRide(movers: FollowedMovers, page: {
  readonly system: (spec: SystemSpec) => void; readonly led: () => boolean; readonly player: SteerRider; readonly view: SteerRideView;
}): void {
  const rows = movers.data.flatMap(row => row.carry !== undefined && row.driver?.kind === 'steer'
    ? [{ id: row.id, seat: row.carry.seat, top: row.driver.speed * row.driver.boost, plain: row.driver.speed }] : []);
  if (rows.length === 0) return;
  let riding: (typeof rows)[number] | null = null, last: MoverPose | null = null, heading = 0, looked = 0, idle = 0, speed = 0;
  let shown: { speed: number; boosting: boolean } | null = null;
  const seated = (row: (typeof rows)[number]): boolean => {
    const at = movers.pose(row.id).position, body = page.player.position;
    return Math.hypot(at.x - body.x, at.y + row.seat - body.y, at.z - body.z) <= SEAT_REACH;
  };
  page.system({ id: 'game.plugin.steer-ride', phase: 'update', run: (dt: number) => {
    const led = page.led();
    if (riding !== null && (!led || !seated(riding))) riding = null;
    if (riding === null && led) {
      riding = rows.find(seated) ?? null;
      if (riding !== null) { last = null; speed = 0; page.player.yaw = angle(movers.pose(riding.id).euler.y); } // boarding faces the heading
    }
    movers.steered = riding?.id ?? null;
    if (riding === null) { last = null; if (shown !== null) { shown = null; page.view.show(null); } return; }
    const pose = movers.pose(riding.id), p = page.player;
    if (last === null) { heading = pose.euler.y; looked = p.yaw; }
    // the measured speed off two frames' poses, eased: a ride with no step between frames reads still, not stopped
    const moved = last === null || dt <= 0 ? 0 : Math.hypot(pose.position.x - last.position.x, pose.position.z - last.position.z) / dt;
    if (last !== null && dt > 0) speed += (moved - speed) * Math.min(1, dt * SPEED_EASE);
    last = pose;
    // the view turns with the vehicle; once the rider stops looking it swings back behind the heading
    if (Math.abs(angle(p.yaw - looked)) > 1e-4) idle = 0; else idle += dt;
    const turned = angle(pose.euler.y - heading); heading = pose.euler.y; p.yaw = angle(p.yaw + turned);
    if (idle >= STEER_RECENTRE.idle && speed > RECENTRE_SPEED) p.yaw = angle(p.yaw + angle(heading - p.yaw) * (1 - Math.exp(-dt * STEER_RECENTRE.rate)));
    looked = p.yaw;
    const next = { speed: Math.max(0, Math.min(1, speed / riding.top)), boosting: speed > riding.plain * 1.02 };
    if (shown === null || Math.abs(shown.speed - next.speed) > 0.01 || shown.boosting !== next.boosting) { shown = next; page.view.show(next); }
  } });
}
