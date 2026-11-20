import { expect, test } from 'vitest';
import { BufferGeometry, Euler, Float32BufferAttribute, Matrix4, MeshBasicMaterial, Quaternion, Vector3 } from 'three';
import { cosTo, installPortableMath, portableMath, sinTo } from '../src/shared/engine/core/portableMath';
import { CirclingFlyer } from '../src/shared/engine/ai/ambientFlight';
import { PosedInstances } from '../src/client/game/looks/posedInstances';

// DF11 (mini-df11c): sinTo/cosTo write the realm's Math.sin/Math.cos bits into a slot (no returned heap number). Each user
// gives the same bits as the Math calls it replaced.
const inputs = [0, -0, 1e-300, Math.PI / 4, -Math.PI / 4, Math.PI / 2, 3, -7.5, 100.25, 1e6, 268435455, 268435456, -3e9, Infinity, -Infinity, Number.NaN,
  ...Array.from({ length: 20_000 }, (_, i) => Math.sin(i * 12.9898) * 4000 + i / 7)];
const bitsOf = (values: readonly number[]): string => Buffer.from(Float64Array.from(values).buffer).toString('hex');

test('sinTo and cosTo match Math.sin and Math.cos bit for bit, native and portable', () => {
  const out = new Float64Array(2);
  const check = (): void => {
    const ours: number[] = [], theirs: number[] = [];
    for (const x of inputs) { sinTo(x, out, 0); cosTo(x, out, 1); ours.push(out[0] ?? 0, out[1] ?? 0); theirs.push(Math.sin(x), Math.cos(x)); }
    expect(bitsOf(ours)).toBe(bitsOf(theirs));
  };
  check();
  installPortableMath();
  check();
  const ours: number[] = [], theirs: number[] = [];
  for (const x of inputs) { sinTo(x, out, 0); ours.push(out[0] ?? 0); theirs.push(portableMath.sin(x)); }
  expect(bitsOf(ours)).toBe(bitsOf(theirs));
});

test('the flyer and the posed draw keep their bits', () => {
  installPortableMath();
  const tuning = { wave: 1.7, amplitude: 0.8, pitch: 0.6, pitchRate: 3, bank: 0.4, bankLimit: 0.9, bankRate: 2 };
  const wheel = { xAmplitude: 0.3, xFrequency: 2.1, zScale: 0.7, zAmplitude: 0.2, zFrequency: 1.3, altitudeFrequency: 0.9, altitudeAmplitude: 1.5, detailFrequency: 3.3, detailAmplitude: 0.25 };
  const flyer = new CirclingFlyer(tuning, wheel);
  const orbit = { cx: 12, cz: -40, r: 9, alt: 14, w: 0.4, p1: 0.3, p2: 1.1, p3: -0.7, p4: 2.2 }, body = { phase: 0.9, scale: 1.2, altOff: 0.5 };
  const out = { x: 0, y: 0, z: 0 }, pose = { x: 1, y: 2, z: 3, yaw: 0.2, pitch: 0, roll: 0 };
  const got: number[] = [];
  for (let i = 0; i < 400; i++) {
    flyer.wheel(orbit, body, i * 0.37, out); got.push(out.x, out.y, out.z);
    flyer.face(pose, out.x - pose.x, out.y - pose.y, out.z - pose.z, 1 / 30); got.push(pose.yaw, pose.pitch, pose.roll);
  }
  // the same law with Math calls, as it read before the slots
  const want: number[] = [], p = { x: 1, y: 2, z: 3, yaw: 0.2, pitch: 0, roll: 0 };
  for (let i = 0; i < 400; i++) {
    const phase = orbit.w * (i * 0.37) + body.phase, radius = orbit.r * body.scale;
    const x = orbit.cx + radius * (Math.sin(phase + orbit.p1) + wheel.xAmplitude * Math.sin(wheel.xFrequency * phase + orbit.p2));
    const z = orbit.cz + radius * wheel.zScale * (Math.cos(phase + orbit.p1) + wheel.zAmplitude * Math.cos(wheel.zFrequency * phase + orbit.p3));
    const y = orbit.alt + body.altOff + wheel.altitudeAmplitude * Math.sin(wheel.altitudeFrequency * phase + orbit.p4) + wheel.detailAmplitude * Math.sin(wheel.detailFrequency * phase + body.phase);
    want.push(x, y, z);
    const dx = x - p.x, dy = y - p.y, dz = z - p.z, dt = 1 / 30, dh = Math.hypot(dx, dz);
    if (dh >= 1e-5) {
      const turn = Math.atan2(dx, dz) - p.yaw, dyaw = Math.atan2(Math.sin(turn), Math.cos(turn)); p.yaw += dyaw;
      p.pitch += (Math.atan2(dy, dh) * tuning.pitch - p.pitch) * Math.min(1, dt * tuning.pitchRate);
      const turnBank = Math.max(-tuning.bankLimit, Math.min(tuning.bankLimit, dyaw / Math.max(dt, 1e-3) * tuning.bank));
      p.roll += (turnBank - p.roll) * Math.min(1, dt * tuning.bankRate);
    }
    want.push(p.yaw, p.pitch, p.roll);
  }
  expect(bitsOf(got)).toBe(bitsOf(want));

  const geometry = new BufferGeometry().setAttribute('position', new Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0, 1, 0], 3));
  const draw = new PosedInstances(64, 'trig', new MeshBasicMaterial(), () => geometry, ['aAnim', 'aAnim2'] as const);
  draw.begin();
  const expected: number[] = [], m = new Matrix4();
  for (let i = 0; i < 64; i++) {
    const pitch = Math.sin(i) * 3, yaw = i * 0.77 - 20, roll = Math.cos(i * 1.3) * 0.5, scale = 0.5 + i / 50;
    draw.add(i, -i, i / 3, pitch, yaw, roll, scale, 0, 0, 0, 0);
    m.compose(new Vector3(i, -i, i / 3), new Quaternion().setFromEuler(new Euler(-pitch, yaw, roll, 'YXZ')), new Vector3(scale, scale, scale));
    expected.push(...m.elements);
  }
  draw.commit();
  expect(bitsOf(Array.from(draw.mesh.instanceMatrix.array.subarray(0, 64 * 16)))).toBe(bitsOf(Array.from(Float32Array.from(expected))));
});
