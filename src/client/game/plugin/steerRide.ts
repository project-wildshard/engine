import type { SystemSpec } from '@wildshard/engine/app/systems';
import type { Scope } from '@wildshard/engine/app/scope';
import { app } from '@wildshard/engine/app/runtime';
import { playerModes, type ModePlayer } from '@wildshard/engine/player/modes';
import type { MoverPose } from '@wildshard/format/moverPose';
import { steerStick } from '@wildshard/engine/sim/moverMotion';
import { NET_BUTTONS } from '@wildshard/engine/input/netButtons';
import type { PlayerEye } from '@wildshard/engine/player/Player';
import type { FollowedMovers } from './followedMovers';
import { SEAT_PITCH, SeatEye, type SeatNow } from './seatView';
import type { SteerRow } from './steerPrediction';

/** What the page shows a steer ride in: its speed (a share of the boosted top speed) and whether it boosts, or nothing. */
export interface SteerRideView {
  show: (ride: SteerRideShown | null) => void;
  /** MSZ11: a tap on the gauge runs `run` (a seat swaps its view by it). */
  readonly tap?: (run: () => void) => void;
  /** MSZ12: a vehicle seat is taken (true) or left: the seat's controls show in place of the walk's. */
  readonly seated?: (on: boolean) => void;
}
/** What the chip shows of a ride: its speed (a share of the boosted top), whether it boosts, and (MSZ12, a vehicle seat) its
 *  gear: R rolling back, N standing, D rolling forward. */
export interface SteerRideShown { readonly speed: number; readonly boosting: boolean; readonly gear?: 'R' | 'N' | 'D' }
/** The page's player as a steer ride reads and turns it: the view looks along `yaw` (forward is (-sin yaw, -cos yaw), as a
 *  steer vehicle's heading). */
export interface SteerRider {
  yaw: number; readonly position: { x: number; y: number; z: number };
  /** MSZ11: the look's pitch, and the eye a vehicle seat poses the camera from while it holds the player (`Player.eye`). */
  pitch?: number; eye?: PlayerEye | null;
  /** MSZ12: the seat's controls on the wire while seated (`Player.seatButtons`). */
  seatButtons?: ((buttons: number) => number) | null;
}
/** SS-MS2a3b: what the rider's page predicts its vehicle from. */
export interface SteerPredictPort {
  /** The world move the rider's held stick and view make now: the walk's, as the server reads it off the rider's command. */
  readonly move: () => { readonly x: number; readonly z: number };
  /** The vehicle's row in the newest frame, when that frame carried a sample of it. */
  readonly row: (id: string) => SteerRow | null;
  /** Commands this page sent that the server has not stepped yet. */
  readonly behind: () => number;
}
/** How near its seat the led body stands on the vehicle it rides (m): a row and the lead arrive a step apart. */
const SEAT_REACH = 1.5;
/** Seconds without a look before the view swings back behind the heading, and how fast it does (per second). */
export const STEER_RECENTRE = { idle: 0.8, rate: 2.5 } as const;
/** Below this speed (m/s) the view stays where the rider put it. */
const RECENTRE_SPEED = 0.5;
/** How fast the shown speed follows the measured one (per second): a row's step is a frame's jitter. */
const SPEED_EASE = 8;
const angle = (a: number): number => Math.atan2(Math.sin(a), Math.cos(a));
/** MSZ12: seconds a held BRAKE brakes before it pulls the handbrake. */
export const HANDBRAKE_HOLD = 0.35;
/** The walk's buttons, which a seat sends none of. */
const WALK_BUTTONS = NET_BUTTONS.jump | NET_BUTTONS.dodge | NET_BUTTONS.hover | NET_BUTTONS.sprint | NET_BUTTONS.crouch | NET_BUTTONS.dive | NET_BUTTONS.surface
  | NET_BUTTONS.heavy | NET_BUTTONS.lock | NET_BUTTONS.boost | NET_BUTTONS.secondary;
/**
 * MSZ12: the wire's buttons from a vehicle seat's controls (the `drive` context's actions, held by keys or the seat's discs):
 * sprint is BOOST (Shift, the BOOST disc; a phone's stick pushed all the way no longer boosts), BRAKE brakes and, held
 * `HANDBRAKE_HOLD` s, pulls the handbrake, as Space does, and the horn sounds while held. The walk's own buttons go.
 */
export function seatButtons(buttons: number, held: (action: 'drive.boost' | 'drive.brake' | 'drive.handbrake' | 'drive.horn') => boolean, braking: number): number {
  const brake = held('drive.brake'), pulled = (brake && braking >= HANDBRAKE_HOLD) || held('drive.handbrake');
  return (buttons & ~WALK_BUTTONS) | (held('drive.boost') ? NET_BUTTONS.sprint : 0) | (brake && !pulled ? NET_BUTTONS.brake : 0)
    | (pulled ? NET_BUTTONS.handbrake : 0) | (held('drive.horn') ? NET_BUTTONS.horn : 0);
}

/**
 * SHARD-SOURCE SS-MS2a3: a steer vehicle on the page. The server leads the rider's body (`led`) and steers the vehicle by the
 * rider's stick split along its heading (SS-MS2a1b), and its sprint or boost (Shift; on a phone, the stick pushed all the way)
 * boosts it. Here the page finds the vehicle it rides (led, and its seat under the body), shows only that vehicle's leave
 * prompt (`FollowedMovers.steered`), faces the heading on boarding, turns the view with it and swings it back behind once the rider stops looking,
 * so the stick's forward is the sail's, and shows the speed and the boost.
 */
export function installSteerRide(movers: FollowedMovers, page: {
  readonly system: (spec: SystemSpec) => void; readonly led: () => boolean; readonly player: SteerRider; readonly view: SteerRideView;
  /** whether the rider holds boost (sprint) now: the chip lights on the press, not on a speed a tail wind also reaches */
  readonly boost: () => boolean;
  /** SS-MS2a3b: with it, the page steps the ridden vehicle on its own stick each fixed step and seats the rider on it, ahead of
   *  the rows a round trip behind; without it, the vehicle and the led body stand where the rows say. */
  readonly predict?: SteerPredictPort;
}): void {
  const rows = movers.data.flatMap(row => row.carry !== undefined && row.driver?.kind === 'steer'
    ? [{ id: row.id, seat: row.carry.seat, top: row.driver.speed * row.driver.boost }] : []);
  if (rows.length === 0) return;
  let riding: (typeof rows)[number] | null = null, last: MoverPose | null = null, heading = 0, looked = 0, idle = 0, speed = 0;
  let shown: { speed: number; boosting: boolean } | null = null, predicting = false;
  const predict = page.predict;
  /** The led body sits on the vehicle as this page has it (the server's lead sits it there a round trip later). */
  const seat = (row: (typeof rows)[number]): void => { const at = movers.pose(row.id).position, p = page.player.position; p.x = at.x; p.y = at.y + row.seat; p.z = at.z; };
  const stop = (): void => { if (predicting) { predicting = false; movers.stopPredicting(); } };
  if (predict !== undefined) page.system({ id: 'game.plugin.steer-predict', phase: 'fixed.post', after: ['player.step'], run: () => {
    if (riding === null || !page.led()) { stop(); return; }
    movers.predict(riding.id, steerStick(predict.move(), movers.pose(riding.id).euler.y, page.boost()), predict.row(riding.id), predict.behind());
    predicting = true; seat(riding);
  } });
  const seated = (row: (typeof rows)[number]): boolean => {
    const at = movers.pose(row.id).position, body = page.player.position;
    return Math.hypot(at.x - body.x, at.y + row.seat - body.y, at.z - body.z) <= SEAT_REACH;
  };
  page.system({ id: 'game.plugin.steer-ride', phase: 'update', run: (dt: number) => {
    const led = page.led();
    if (riding !== null && predicting && led) seat(riding); // a frame's rows put the led body back where the server has it
    if (riding !== null && (!led || !seated(riding))) { riding = null; stop(); }
    if (riding === null && led) {
      riding = rows.find(seated) ?? null;
      if (riding !== null) { last = null; speed = 0; page.player.yaw = angle(movers.pose(riding.id).euler.y); } // boarding faces the heading
    }
    movers.steered = riding?.id ?? null;
    if (riding === null) { stop(); last = null; if (shown !== null) { shown = null; page.view.show(null); } return; }
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
    const next = { speed: Math.max(0, Math.min(1, speed / riding.top)), boosting: page.boost() && speed > RECENTRE_SPEED };
    if (shown === null || Math.abs(shown.speed - next.speed) > 0.01 || shown.boosting !== next.boosting) { shown = next; page.view.show(next); }
  } });
}

/** MSZ9b: what a vehicle ride reads of the vehicles a page follows (`FollowedVehicles`). */
export interface VehicleRidePort {
  readonly seatOf: () => { readonly vehicle: string; readonly seat: number } | undefined;
  readonly pose: (id: string) => MoverPose | undefined;
  readonly kindOf: (id: string) => { readonly seats: readonly VehicleRideSeat[]; readonly handling: { readonly speed: number; readonly boost: number } } | undefined;
  /** MSZ11: m clear from `from` toward `to` before a wall, `vehicle`'s own hull aside (the chase view's arm); none, the whole way. */
  readonly clear?: (vehicle: string, from: { x: number; y: number; z: number }, to: { x: number; y: number; z: number }) => number;
  /** MSZ16: where a seat stands as the page draws its vehicle (the driver's, where the page predicts it): the seated body sits there. */
  readonly seatPoint?: (vehicle: string, seat: number) => readonly [number, number, number] | undefined;
}
/** A kind's seat as a ride reads it: who sits there, and (MSZ11) where its base is and how it is sat, for the seat's eye. */
export interface VehicleRideSeat { readonly role: string; readonly at?: readonly [number, number, number]; readonly pose?: 'sit' | 'stand' }

/**
 * MIRROR-SALT-ZONE MSZ9b: a seat in a `world/vehicles` vehicle on the page, as the server's `VehicleRuntime` leads it. While the
 * wire's seat rows put this page's player in a seat, the player is in the reserved `drive` mode (a traversal of `modes.ts`: the
 * walk stands down while the seat leads the body), boarding faces the heading, and a driver's view turns with the vehicle and
 * swings back behind it as the steer ride's does (`STEER_RECENTRE`), with its speed and boost on the steer chip. `vehicles` is
 * read each frame: the follower the page's wire holds now (a grid cell's changes with the feet).
 *
 * MSZ11: while seated the player's eye is the seat's (`SeatEye`: first person from the seat, widening past top speed, or the
 * chase view, swapped by V in the `drive` input context or a tap on the gauge, kept from one ride to the next), and the held
 * item is stowed.
 */
export function installVehicleRide(vehicles: () => VehicleRidePort | undefined, page: {
  readonly system: (spec: SystemSpec) => void; readonly scope: Scope; readonly player: SteerRider; readonly view: SteerRideView; readonly boost: () => boolean;
}): void {
  let seated: { readonly vehicle: string; readonly seat: number } | null = null, last: MoverPose | null = null, heading = 0, looked = 0, idle = 0, speed = 0, lookedPitch = SEAT_PITCH;
  let shown: SteerRideShown | null = null, chase = false, stowed = false, rolling = 0, braking = 0;
  // the reserved `drive` mode: the page's player's mode while a seat holds it (the server leads the body; the walk stands down)
  playerModes(page.player as unknown as ModePlayer).register({ id: 'drive', hud: 'ride', traverse: () => seated !== null }, page.scope, { events: app.events });
  // MSZ11: the seat's eye reads the seat live at the camera's pose, off the vehicle as the page draws it then
  const seatNow = (): SeatNow | null => {
    const port = vehicles(), held = seated === null ? undefined : port?.seatOf(), pose = held === undefined ? undefined : port?.pose(held.vehicle);
    const kind = held === undefined ? undefined : port?.kindOf(held.vehicle), row = held === undefined ? undefined : kind?.seats[held.seat];
    if (pose === undefined || kind === undefined || row === undefined) return null;
    return { pose, at: row.at ?? [0, 0, 0], sit: row.pose ?? 'sit', speed, handling: kind.handling };
  };
  const eye = new SeatEye({ seat: seatNow, look: page.player, chase: () => chase,
    clear: (from, to) => { const port = vehicles(), vehicle = seated?.vehicle; return port?.clear === undefined || vehicle === undefined ? Math.hypot(to.x - from.x, to.y - from.y, to.z - from.z) : port.clear(vehicle, from, to); } });
  const buttons = (held: number): number => seatButtons(held, action => app.input.held(action), braking);
  const sit = (on: boolean): void => {
    if (on) { page.player.eye = eye; page.player.seatButtons = buttons; if (app.input.has('drive')) app.input.push('drive', page.scope); }
    else {
      eye.release(); if (page.player.eye === eye) page.player.eye = null; if (page.player.seatButtons === buttons) page.player.seatButtons = null;
      app.input.pop('drive'); braking = 0;
    }
    page.view.seated?.(on);
    const equipment = app.equipment; // the held item is stowed in a seat, as other pages show it (MSZ10)
    if (on && equipment !== null && !equipment.stowed) { equipment.stowed = true; stowed = true; }
    if (!on && stowed) { stowed = false; if (equipment !== null) equipment.stowed = false; }
  };
  page.view.tap?.(() => { if (seated !== null) chase = !chase; });
  page.scope.onDispose(() => { if (seated !== null) { seated = null; sit(false); } });
  page.system({ id: 'game.plugin.vehicle-ride', phase: 'update', run: (dt: number) => {
    const port = vehicles(), held = port?.seatOf(), pose = held === undefined ? undefined : port?.pose(held.vehicle);
    if (held === undefined || pose === undefined || port === undefined) {
      if (seated !== null) sit(false);
      seated = null; last = null;
      if (shown !== null) { shown = null; page.view.show(null); }
      return;
    }
    const p = page.player, at = port.seatPoint?.(held.vehicle, held.seat);
    // MSZ16: the led body sits where this page draws the seat (a frame's rows put it back where the server has it, a round trip behind)
    if (at !== undefined) { p.position.x = at[0]; p.position.y = at[1]; p.position.z = at[2]; }
    if (seated?.vehicle !== held.vehicle || seated.seat !== held.seat) { // boarding faces the heading, the eye on the road ahead (MSZ11)
      if (seated === null) sit(true);
      seated = held; last = null; speed = 0; rolling = 0; p.yaw = angle(pose.euler.y); if (p.pitch !== undefined) p.pitch = SEAT_PITCH;
    }
    if (app.input.consume('drive.view')) chase = !chase;
    braking = app.input.held('drive.brake') ? braking + dt : 0;
    const pitched = p.pitch !== undefined && Math.abs(p.pitch - lookedPitch) > 1e-4; // a look up or down is a look too
    if (last === null) { heading = pose.euler.y; looked = p.yaw; lookedPitch = p.pitch ?? SEAT_PITCH; }
    const moved = last === null || dt <= 0 ? 0 : Math.hypot(pose.position.x - last.position.x, pose.position.z - last.position.z) / dt;
    // MSZ12: the gauge's gear, off the speed along the heading (forward is (-sin yaw, -cos yaw))
    const along = last === null || dt <= 0 ? 0 : (-(pose.position.x - last.position.x) * Math.sin(pose.euler.y) - (pose.position.z - last.position.z) * Math.cos(pose.euler.y)) / dt;
    if (last !== null && dt > 0) { speed += (moved - speed) * Math.min(1, dt * SPEED_EASE); rolling += (along - rolling) * Math.min(1, dt * SPEED_EASE); }
    last = pose;
    if (Math.abs(angle(p.yaw - looked)) > 1e-4 || pitched) idle = 0; else idle += dt;
    const turned = angle(pose.euler.y - heading); heading = pose.euler.y; p.yaw = angle(p.yaw + turned);
    if (idle >= STEER_RECENTRE.idle && speed > RECENTRE_SPEED) {
      const swing = 1 - Math.exp(-dt * STEER_RECENTRE.rate);
      p.yaw = angle(p.yaw + angle(heading - p.yaw) * swing);
      if (p.pitch !== undefined) p.pitch += (SEAT_PITCH - p.pitch) * swing; // and the eye back down the road
    }
    looked = p.yaw; lookedPitch = p.pitch ?? SEAT_PITCH;
    const kind = port.kindOf(held.vehicle), top = kind === undefined ? 1 : kind.handling.speed * kind.handling.boost;
    const driving = kind?.seats[held.seat]?.role === 'driver';
    const gear = Math.abs(rolling) < RECENTRE_SPEED ? 'N' : rolling > 0 ? 'D' : 'R';
    const next = { speed: Math.max(0, Math.min(1, speed / top)), boosting: driving && page.boost() && speed > RECENTRE_SPEED, gear } as const;
    if (shown === null || Math.abs(shown.speed - next.speed) > 0.01 || shown.boosting !== next.boosting || shown.gear !== next.gear) { shown = next; page.view.show(next); }
  } });
}
