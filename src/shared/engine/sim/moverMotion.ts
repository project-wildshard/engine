import * as v from 'valibot';
import { Euler, Quaternion } from 'three';
import { lowerMoverMotion, MoverMotionSchema, MoverCarrySchema, type MoverMotion, type MoverCarry as CarryRows } from '@wildshard/format/moverMotion';
import type { ScriptEntity, ScriptEffect } from '../script/effects';

/** Admitted stop/driver data; native execution never accepts a function or an executable URL. */
export type NativeMoverMotion = MoverMotion & { at: { x: number; y: number; z: number }; euler: { x: number; y: number; z: number }; carry?: CarryRows };
/** The existing caller supplies time, command and permission; the mechanic installs no clock. */
export interface MoverFrame { readonly tick: number; readonly dt: number; readonly action: number; readonly permission: number; readonly time?: number;
  /** SS-MS2a1b: a steer vehicle's rider's stick this tick, in the vehicle's frame (throttle forward, turn right, each -1 to 1). */
  readonly steer?: MoverSteer;
  /** The ground height under a steer vehicle that follows the ground, when the caller found one. */
  readonly ground?: number }
/** A rider's stick for a steer vehicle. */
export interface MoverSteer { readonly throttle: number; readonly turn: number; readonly boost: boolean }
/** Fields a steer vehicle publishes: heading (as every mover), speed as a share of its boosted top speed (fields are 0 to 1),
 *  and whether it is ridden. */
export const STEER_FIELDS = { yaw: 2, speed: 5, ridden: 6 } as const;
const signed = (x: number): number => Number.isFinite(x) ? Math.max(-1, Math.min(1, x)) : 0;
const COORD = 250;
/** How far above and below a ground-following steer vehicle its ground probe reaches (m): the server's and its rider's page. */
export const STEER_PROBE = { up: 2, down: 4 } as const;
/** SS-MS2a1b: a rider's world move (the walk's, off a command) as a steer vehicle's stick in its frame (heading `yaw`): forward
 *  is throttle, right is turn. The server reads it off the rider's command and the rider's page off its own (SS-MS2a3b). */
export function steerStick(move: { readonly x: number; readonly z: number }, yaw: number, boost: boolean): MoverSteer {
  const sin = Math.sin(yaw), cos = Math.cos(yaw);
  return { throttle: -sin * move.x - cos * move.z, turn: cos * move.x - sin * move.z, boost };
}
/** Where a steer vehicle's frame rides the mover's numeric input, after the 12 numbers every mover reads. */
const STEER_INPUT = 12;
/** A steer vehicle's stick and ground as numeric mover input (the composed lane's one ABI). */
export function steerInput(stick: MoverSteer | undefined, ground: number | undefined): number[] {
  return [signed(stick?.throttle ?? 0), signed(stick?.turn ?? 0), Number(stick?.boost === true), Number(ground !== undefined), ground ?? 0];
}
/** The frame fields `steerInput` wrote, or none for any other mover's input. */
export function steerFrame(input: readonly number[]): Pick<MoverFrame, 'steer' | 'ground'> {
  if (input.length < STEER_INPUT + 5) return {};
  const [throttle = 0, turn = 0, boost = 0, grounded = 0, ground = 0] = input.slice(STEER_INPUT);
  return { steer: { throttle, turn, boost: boost === 1 }, ...(grounded === 1 ? { ground } : {}) };
}
/** A detached next state; the existing world validates and commits it before publishing collision or views. */
export interface MoverAdvance { readonly entity: ScriptEntity; readonly effects: readonly ScriptEffect[] }
const tau = 2 * Math.PI;
const wrap = (angle: number): number => Math.max(-Math.PI, Math.min(Math.PI, angle - Math.floor(angle / tau + 0.5) * tau)); // fields hold [-π, π] exactly
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
const clamp = (x: number): number => Math.min(1, Math.max(0, x));
function sine(value: number): number {
  const x = value - Math.floor(value / tau + 0.5) * tau, z = x * x;
  return x * (1 + z * (-1 / 6 + z * (1 / 120 + z * (-1 / 5040 + z * (1 / 362880 + z * (-1 / 39916800 + z / 6227020800))))));
}
/**
 * Native execution of admitted motion rows. Fixed drivers retain their six numeric fields and old continuation;
 * reversible surface tracks use the same position/angle/progress publication. Physics and the caller's clock stay owned.
 */
export class MoverMechanic {
  private readonly fixed: NativeMoverMotion | undefined;
  private readonly carry: CarryRows | undefined;
  private readonly parameters: readonly number[];
  /** Former fixed-driver identity; no bytes are needed to execute the admitted row. */
  readonly module: string | undefined;
  constructor(input: NativeMoverMotion) {
    const motion = v.parse(MoverMotionSchema, { driver: input.driver, trigger: input.trigger, ...(input.track === undefined ? {} : { track: input.track }) });
    if (Object.values(input.at).some(value => !Number.isFinite(value) || Math.abs(value) > 250)
      || Object.values(input.euler).some(value => !Number.isFinite(value) || Math.abs(value) > Math.PI)) throw new Error('Invalid mover rest pose');
    this.fixed = { ...motion, at: { ...input.at }, euler: { ...input.euler } };
    this.carry = input.carry === undefined ? undefined : v.parse(MoverCarrySchema, input.carry);
    const lowered = lowerMoverMotion(motion, input); this.parameters = lowered.input; this.module = lowered.module;
  }
  /** Numeric publication matches the original field/position order; carry data is optional and renderer-free. */
  step(before: ScriptEntity, frame: MoverFrame): MoverAdvance {
    if (!Number.isFinite(frame.dt) || frame.dt < 0 || frame.dt > 1 || !Number.isSafeInteger(frame.tick) || frame.tick < 0
      || !Number.isFinite(frame.permission) || !Number.isInteger(frame.action) || frame.action < 0 || frame.action > 3
      || frame.time !== undefined && !Number.isFinite(frame.time)) throw new Error('Invalid mover frame');
    const fields = { ...before.fields }, entity: ScriptEntity = { ...before, fields, position: [...before.position] };
    const effects: ScriptEffect[] = [];
    const field = (id: number, value: number): void => { fields[id] = value; effects.push({ op: 1, a: id, b: value, c: 0, d: 0 }); };
    const position = (x: number, y: number, z: number): void => { entity.position = [x, y, z]; effects.push({ op: 4, a: x, b: y, c: z, d: 0 }); };
    const motion = this.fixed;
    if (motion === undefined) throw new Error('Missing admitted motion');
    const p = (i: number): number => { const value = this.parameters[i]; if (value === undefined) throw new Error('Missing mover parameter'); return value; };
    const { driver, track, trigger } = motion;
    if (driver.kind === 'static') { field(4, 1); return { entity, effects }; }
    if (driver.kind === 'steer') {
      // SS-MS2a1b: board (1) and leave (2) are carry's prompts; a ridden vehicle takes its rider's stick, a riderless one
      // slows to a stand. It does not reverse: a back stick brakes. Heading follows the player's convention: forward is (-sin yaw, -cos yaw), a right turn lowers yaw.
      const top = driver.speed * driver.boost;
      let speed = (fields[STEER_FIELDS.speed] ?? 0) * top, ridden = fields[STEER_FIELDS.ridden] ?? 0, yaw = fields[STEER_FIELDS.yaw] ?? motion.euler.y;
      if (frame.action === 1) ridden = 1; else if (frame.action === 2) ridden = 0;
      const stick = ridden === 1 ? frame.steer : undefined, throttle = Math.max(0, signed(stick?.throttle ?? 0)), turn = signed(stick?.turn ?? 0);
      const target = throttle * driver.speed * (stick?.boost === true ? driver.boost : 1), change = driver.accel * frame.dt;
      speed = speed < target ? Math.min(target, speed + change) : Math.max(target, speed - change);
      yaw = wrap(yaw - turn * driver.turn * frame.dt);
      // SS-MS2a2: a sail's wind push adds along the heading as far as the stick opens it (a let-go sail is furled):
      // straight downwind the full push, across none, upwind it holds the vehicle back, never past a stand
      const forwardX = -Math.sin(yaw), forwardZ = -Math.cos(yaw), wind = driver.wind;
      const along = wind === undefined ? 0 : throttle * wind.push * (wind.toward[0] * forwardX + wind.toward[1] * forwardZ) / Math.hypot(...wind.toward);
      const [x0, y0, z0] = before.position, step = Math.max(0, speed + along) * frame.dt;
      const x = Math.max(-COORD, Math.min(COORD, x0 + forwardX * step)), z = Math.max(-COORD, Math.min(COORD, z0 + forwardZ * step));
      // a ground follower keeps its last height over a gap; a level vehicle keeps its rest height
      const y = !driver.ground ? motion.at.y : frame.ground !== undefined && Number.isFinite(frame.ground) ? Math.max(-COORD, Math.min(COORD, frame.ground)) : y0;
      position(x, y, z); field(1, 0); field(STEER_FIELDS.yaw, yaw); field(3, 0); field(4, 1);
      field(STEER_FIELDS.speed, Math.min(1, speed / top)); field(STEER_FIELDS.ridden, ridden); return { entity, effects };
    }
    if (driver.kind === 'winch' && driver.mode === 'hinge') {
      let angle = fields[1] ?? 0, raised = fields[5] ?? 0, raising = fields[6] ?? 0;
      if (frame.action === 3) { angle = 0; raised = 1; raising = 0; }
      else if (raised === 0 && ((frame.action === 1 && frame.permission === 3) || frame.action === 2)) raising = 1;
      if (raising === 1 && raised === 0) { angle = Math.min(0, angle + frame.dt * driver.speed); if (angle >= 0) { raised = 1; raising = 0; } }
      field(1, angle); field(4, raised); field(5, raised); field(6, raising); return { entity, effects };
    }
    if (driver.kind === 'winch') {
      let phase = fields[5] ?? 0, active = fields[6] ?? 0;
      const commanded = driver.return === 'command', reverse = active === 0.5 || commanded && (active === 0 || active === 0.25) && frame.action === 2;
      if (commanded) {
        if (active === 0 || active === 0.25) {
          if (frame.action === 1) { phase = 0; active = 1; }
          else if (frame.action === 2) { phase = 1; active = 0.5; }
        }
      } else if (active === 0) { if (frame.action === 1 || frame.action === 3) active = 1; }
      else if (active === 1) { if (frame.action === 1 || frame.action === 2) active = 0.5; }
      else if (active === 0.5) { if (frame.action === 1 || frame.action === 3) active = 1; }
      else if (active >= 0.2 && active <= 0.4) {
        if (frame.action === 1 || frame.action === 2) active = 0.5;
        else { active += 0.2 * frame.dt / driver.dwell; if (active >= 0.4 - 1e-9) active = 0.5; }
      }
      const cutoff = driver.snap ?? 0.004;
      if (active === 1) { phase += frame.dt / p(6); if (phase >= 1 - cutoff) { phase = 1; active = commanded ? 0.25 : 0.2; } }
      else if (active === 0.5) { phase -= frame.dt / p(6); if (phase <= cutoff) { phase = 0; active = 0; } }
      const top = 1 / 0.9, e = driver.ease === 'smoothstep' ? phase * phase * (3 - 2 * phase)
        : phase < 0.1 ? top * phase * phase / 0.2 : phase > 0.9 ? 1 - top * (1 - phase) * (1 - phase) / 0.2 : top * (phase - 0.05);
      const x = lerp(p(0), p(3), e), z = lerp(p(2), p(5), e), bank = lerp(p(1), p(4), e), carry = this.carry;
      if (carry === undefined) position(x, bank, z);
      else {
        const surface = carry.surface, water = Math.min(1, Math.min(phase, 1 - phase) * surface.bankRamp), time = frame.time ?? frame.tick / 60;
        position(x, bank + (surface.level - bank) * water + Math.sin(time * surface.bob[0]) * surface.bob[1] * water, z);
        field(1, Math.sin(time * surface.pitch[0]) * surface.pitch[1] * water);
        field(2, Math.atan2((p(3) - p(0)) * (reverse ? -1 : 1), (p(5) - p(2)) * (reverse ? -1 : 1)));
        field(3, Math.sin(time * surface.roll[0] + surface.roll[2]) * surface.roll[1] * water);
      }
      field(4, carry !== undefined ? Number(phase > 0 || active !== 0) : driver.gate ? Number(phase > 0 || active !== 0) : 1);
      field(5, phase); field(6, active); return { entity, effects };
    }
    if (driver.kind === 'waves') {
      const time = frame.tick / 60, x = motion.at.x, z = motion.at.z;
      const displace = (px: number, pz: number): readonly [number, number, number] => {
        let dx = 0, dy = 0, dz = 0;
        for (const [wx, wz, amplitude, length, speed, q] of driver.waves) {
          const k = tau / length, phase = k * (wx * px + wz * pz - speed * time), qa = q / (k * 4), c = sine(phase + Math.PI / 2);
          dx += wx * qa * c; dz += wz * qa * c; dy += amplitude * sine(phase);
        }
        return [dx * driver.damping, dy * driver.damping, dz * driver.damping];
      };
      const height = (px: number, pz: number): number => {
        let d = displace(px, pz), ax = px - d[0], az = pz - d[2]; d = displace(ax, az); ax = px - d[0]; az = pz - d[2]; return displace(ax, az)[1];
      };
      const heading = motion.euler.y, fx = -sine(heading), fz = -sine(heading + Math.PI / 2), sx = -fz, sz = fx;
      const tilt = (value: number): number => { const z2 = value * value; return value * (1 + z2 * (-1 / 3 + z2 * (1 / 5 + z2 * (-1 / 7 + z2 / 9)))); };
      position(x, motion.at.y + height(x, z), z); field(1, tilt((height(x + fx * 2, z + fz * 2) - height(x - fx * 2, z - fz * 2)) / 4));
      field(2, heading); field(3, tilt((height(x + sx * 2, z + sz * 2) - height(x - sx * 2, z - sz * 2)) / 4)); field(4, 1); return { entity, effects };
    }
    let phase = fields[5] ?? 0, active = fields[6] ?? 0;
    if (trigger.kind === 'always') active = 1;
    else if (trigger.kind === 'interact') { if (frame.permission !== 0) { if (frame.action === 1) active = 1 - active; else if (frame.action === 2) active = 0; else if (frame.action === 3) { phase = 0; active = 1; } } }
    else if (trigger.kind === 'stand') active = frame.permission !== 0 ? trigger.delay === 0 ? 1 : Math.min(1, active + frame.dt / trigger.delay) : 0;
    else active = Number(frame.permission !== 0);
    if (active === 1) { const cycle = driver.kind === 'pendulum' ? driver.period : (track?.duration ?? 1) / (track?.speed ?? 1) * (track?.loop === 'pingpong' ? 2 : 1); phase += frame.dt / cycle; phase = driver.kind === 'pendulum' || track?.loop !== 'once' ? phase - Math.floor(phase) : Math.min(1, phase); }
    let pitch = motion.euler.x, yaw = motion.euler.y, roll = motion.euler.z;
    if (driver.kind === 'pendulum') { const angle = driver.amplitude * Math.sin(phase * tau); if (driver.axis === 'x') pitch += angle; else if (driver.axis === 'y') yaw += angle; else roll += angle; }
    else {
      if (track === undefined) throw new Error('Missing track');
      const sample = track.loop === 'pingpong' ? phase < 0.5 ? phase * 2 : (1 - phase) * 2 : phase, time = sample * track.duration;
      let i = 0; while (i < track.times.length - 2 && time > (track.times[i + 1] ?? 0)) i++;
      const a = track.times[i], b = track.times[i + 1]; if (a === undefined || b === undefined) throw new Error('Missing track interval');
      const t = clamp((time - a) / (b - a)), start = track.position?.[i] ?? [motion.at.x, motion.at.y, motion.at.z], end = track.position?.[i + 1] ?? start;
      position(lerp(start[0], end[0], t), lerp(start[1], end[1], t), lerp(start[2], end[2], t));
      const rest = new Quaternion().setFromEuler(new Euler(motion.euler.x, motion.euler.y, motion.euler.z)), from = track.quaternion?.[i], to = track.quaternion?.[i + 1];
      const rotation = from === undefined ? rest : new Quaternion(...from); if (to !== undefined) rotation.slerp(new Quaternion(...to), t);
      const angles = new Euler().setFromQuaternion(rotation, 'YXZ'); pitch = angles.x; yaw = angles.y; roll = angles.z;
    }
    if (driver.kind === 'pendulum') position(motion.at.x, motion.at.y, motion.at.z);
    field(1, pitch); field(2, yaw); field(3, roll); field(5, phase); field(6, active); return { entity, effects };
  }
}
