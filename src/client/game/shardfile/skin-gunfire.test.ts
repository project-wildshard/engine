// QA 11-19 rows 42 and 44 (Jake, Brasscap on his iPhone): a creature's round leaves its muzzle as its windup runs out,
// with the skin's follow-through; a serpent's death thrashes and sinks along its trail.
import { expect, test } from 'vitest';
import { Bone, BufferGeometry, MeshStandardMaterial, Quaternion, QuaternionKeyframeTrack } from 'three';
import type { CreatureSkinClipName } from '@wildshard/format/skinData';
import { SerpentDeath, SkinDriver, type ClientSkin, type SkinDriveState } from './clientSkins';

const turn = (x: number): number[] => new Quaternion().setFromAxisAngle({ x: 1, y: 0, z: 0, isVector3: true } as never, x).toArray();
const clip = (duration: number, angle: number) => ({ duration, layers: null,
  tracks: [{ bone: 'grip', property: 'quaternion' as const, interpolant: new QuaternionKeyframeTrack('grip.quaternion', [0, duration], [...turn(angle), ...turn(angle)]).InterpolantFactoryMethodLinear() }] });
function skin(withFire: boolean): ClientSkin {
  const clips = new Map<CreatureSkinClipName, ReturnType<typeof clip>>([['attack', clip(1, 0.1)], ['idle', clip(2, 0.5)]]);
  if (withFire) clips.set('attack.fire', clip(0.8, -0.3));
  return { id: 'bandit', geometry: new BufferGeometry(), bones: [{ name: 'body', parent: null, pos: [0, 0, 0] }, { name: 'grip', parent: 'body', pos: [0, 1, 0] }],
    material: () => new MeshStandardMaterial(), parts: [], clips, skeleton: 'kit', sockets: [], attackSpan: 1 };
}
const frame = (attack: number, alive = true): SkinDriveState => ({ dt: 1 / 30, t: 0, alive, flinch: 0, attack, speed: 0, strafe: 0, scale: 1, phase: 0, state: 'idle' });
const gripAngle = (bones: Record<string, Bone>): number => 2 * Math.asin(bones['grip']?.quaternion.x ?? 0);

test('a windup that runs out fires once and plays the follow-through', () => {
  const bones = { body: new Bone(), grip: new Bone() }, driver = new SkinDriver(skin(true), bones);
  const fired: number[] = [];
  [0, 0.4, 0.8, 0.97, -1, -1, -1].forEach((attack, i) => { driver.step(frame(attack)); if (driver.released) fired.push(i); });
  expect(fired).toEqual([4]);
  expect(gripAngle(bones)).toBeCloseTo(-0.3, 5);
  // the follow-through ends and the idle comes back
  for (let i = 0; i < 30; i++) driver.step(frame(-1));
  expect(gripAngle(bones)).toBeCloseTo(0.5, 5);
});

test('a windup cut short (a stagger) fires nothing', () => {
  const driver = new SkinDriver(skin(true), { body: new Bone(), grip: new Bone() });
  let fired = 0;
  for (const attack of [0, 0.3, 0.5, -1, -1]) { driver.step(frame(attack)); if (driver.released) fired++; }
  expect(fired).toBe(0);
});

test('a skin with no follow-through still marks the shot, and a death fires nothing', () => {
  const bones = { body: new Bone(), grip: new Bone() }, driver = new SkinDriver(skin(false), bones);
  driver.step(frame(0.9)); driver.step(frame(-1));
  expect(driver.released).toBe(true);
  expect(gripAngle(bones)).toBeCloseTo(0.5, 5);
  const dead = new SkinDriver(skin(true), { body: new Bone(), grip: new Bone() });
  dead.step(frame(0.9)); dead.step(frame(-1, false));
  expect(dead.released).toBe(false);
});

test('a dead serpent thrashes, then sinks its head (and the trail behind it) under the ground', () => {
  const names = ['head', 'seg1', 'seg2'], bones: Record<string, Bone> = Object.fromEntries(names.map(name => [name, new Bone()]));
  const death = new SerpentDeath(names);
  const pose = (): void => { for (const bone of Object.values(bones)) { bone.position.set(0, 0, 0); bone.quaternion.identity(); } };
  pose(); death.step(true, 0.1, bones, 0, 5);
  expect(bones['head']?.position.y).toBe(0);
  let thrashed = 0, deepest = 0;
  for (let t = 0; t < 5; t += 0.1) {
    pose(); death.step(false, 0.1, bones, 0, 5);
    thrashed = Math.max(thrashed, 1 - Math.abs(bones['seg2']?.quaternion.w ?? 1));
    deepest = Math.min(deepest, bones['head']?.position.y ?? 0);
  }
  expect(thrashed).toBeGreaterThan(1e-3);
  // 14 m under at scale 5, in the root's units
  expect(deepest).toBeCloseTo(-14 / 5, 5);
  // alive again (a retry): no overlay
  pose(); death.step(true, 0.1, bones, 0, 5);
  expect(bones['head']?.position.y).toBe(0);
});
