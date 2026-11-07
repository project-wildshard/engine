import { PerspectiveCamera } from 'three';
import { Player, type PlayerWireInput } from '../../../src/client/engine/player/Player';
import { CharacterMotor, PLAYER_BODY, PLAYER_CAPSULE } from '../../../src/shared/engine/physics/CharacterMotor';
import { NET_BUTTONS } from '../../../src/shared/engine/input/netButtons';
import { legacyDouble } from '../../../src/test/engine/FakeGame';
import { FIXED_STEP } from '../../../src/shared/engine/core/fixedStep';
import { leadPlayer } from '../../../src/shared/engine/sim/leadPlayer';
import { runHeadlessJourney, type HeadlessJourneyPlan, type HeadlessJourneyReport, type HeadlessJourneySample } from '../../../src/shared/host/headlessJourney';
import type { TrustedHeadlessResident } from '../../../src/server/host/headlessRuntime';

// P1-E5.3 B3: what a real journey did on the server, tick for tick, run again on the client's step in a second world from
// the same product. The second world is a stand-in for C5's prediction world: the real `Player` on the second resident's
// own capsule, reading that resident's ground and water, with the resident ticked with no input so everything but the player
// moves as it did. I1 holds it to 2 cm. A rope deck is dynamic and chaotic, and Rapier breaks a tie between two planks by its
// collider tree, so that second world has to grow as the first did: one capsule, rebuilt where each leg rebuilt it. A capsule
// of the `Player`'s own there sent a bridge 11 cm off, with no law wrong.

/** Feet and ground, every tick of one or more journeys. */
export interface MotionCapture { readonly samples: HeadlessJourneySample[] }
export interface MotionReplayReport {
  readonly ticks: number;
  /** worst feet error, over every tick */
  readonly worst: number; readonly worstTick: number;
  readonly overTolerance: number; readonly groundTicks: number;
  /** each hundredth of the run's worst error, so a report reads as a curve */
  readonly curve: readonly number[];
}
const TOLERANCE = 0.02;

/** One leg on the server, recorded. */
export function captureJourney(resident: TrustedHeadlessResident, plan: HeadlessJourneyPlan, into: MotionCapture): HeadlessJourneyReport {
  return runHeadlessJourney(resident.host, input => { resident.step(input); }, plan, sample => { into.samples.push(sample); });
}

/** The tick's world-space move as the client's raw axes. A journey sends yaw with each move; a tick without one holds. */
function clientCommand(sample: HeadlessJourneySample, yaw: number): PlayerWireInput {
  const command = sample.commands.find(row => row.kind === 'player');
  if (command?.kind !== 'player') return { steer: { keyX: 0, keyY: 0, stickX: 0, stickY: 0 }, yaw, pitch: 0, buttons: 0 };
  const sin = Math.sin(command.yaw), cos = Math.cos(command.yaw);
  return { steer: { keyX: 0, keyY: 0, stickX: cos * command.moveX - sin * command.moveZ, stickY: -sin * command.moveX - cos * command.moveZ }, yaw: command.yaw, pitch: 0, buttons: command.jump === true ? NET_BUTTONS.jump : 0 };
}

/** Replay a capture on the client's step and report the error against the server's feet, tick by tick. A sample with no
 *  command before any move is a placed start: a leg teleports there, as `Player.spawn` does. */
export function replayOnClient(resident: TrustedHeadlessResident, capture: MotionCapture): MotionReplayReport {
  const { host } = resident, player = new Player(new PerspectiveCamera(), host.physics, legacyDouble<HTMLCanvasElement>({}), { waterLine: { update: () => undefined, setHint: () => undefined } });
  const lead = leadPlayer(host), { samples } = capture, errors = new Float64Array(samples.length);
  const frame = { heightAt: (x: number, z: number) => host.groundHeightAt(x, z), waterSurfaceAt: (x: number, z: number) => host.waterSurfaceAt(x, z), platforms: [] };
  /** The body a leg starts in, as `runHeadlessJourney` makes it. */
  const standIn = (): CharacterMotor => {
    lead.releaseMotor().dispose();
    const motor = new CharacterMotor(host.physics, { ...PLAYER_CAPSULE, ...PLAYER_BODY, owner: lead.id });
    lead.attachMotor(motor); player.bindFrame(host.physics, motor, frame);
    return motor;
  };
  player.motor.dispose(); // the host moves no one: its player's capsule is this `Player`'s
  host.parked.add(lead.id);
  let worst = 0, worstTick = 0, overTolerance = 0, groundTicks = 0, yaw = lead.yaw, previous: HeadlessJourneySample | undefined;
  for (const [tick, sample] of samples.entries()) {
    for (const actor of host.entities.values()) actor.harnessHold = true;
    const placed = previous === undefined || sample.commands.length === 0 && Math.hypot(sample.x - previous.x, sample.y - previous.y, sample.z - previous.z) > 1;
    previous = sample;
    if (placed) { const motor = standIn(); player.spawn(sample.x, sample.z, yaw, sample.y); motor.resetAt(player.position); continue; }
    const command = clientCommand(sample, yaw);
    yaw = command.yaw;
    lead.position.copy(player.position); // the host's bands stand bodies near its player: here, that is the client's feet
    resident.step([]);
    player.step(FIXED_STEP, command);
    const p = player.position, error = Math.hypot(p.x - sample.x, p.y - sample.y, p.z - sample.z);
    errors[tick] = error;
    if (error > worst) { worst = error; worstTick = tick; }
    if (error > TOLERANCE) overTolerance++;
    if (player.onGround !== sample.grounded) groundTicks++;
  }
  const step = Math.max(1, Math.floor(samples.length / 100)), curve: number[] = [];
  for (let at = 0; at < samples.length; at += step) curve.push(Math.max(...errors.subarray(at, at + step)));
  return { ticks: samples.length, worst, worstTick, overTolerance, groundTicks, curve };
}
